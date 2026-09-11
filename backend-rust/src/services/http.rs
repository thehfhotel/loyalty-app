//! The one bounded HTTP client every outbound call in the app shares.
//!
//! `reqwest::Client::new()` has **no timeout of any kind**. A peer that
//! accepts the connection and then says nothing holds the caller's task —
//! and the guest's request behind it — open until something else gives up:
//! in this app the router's own 30 s `TimeoutLayer`, which turns a hung
//! third party into a 408 for a guest whose request had nothing wrong with
//! it. `services::pms_channel` learned that the hard way (A15) and bounds
//! its own client; this module is the same decision for the rest: the OAuth
//! token/userinfo exchanges (`routes::oauth`), the Cloudflare Access JWKS
//! fetch (`routes::auth`) and the two LINE Platform calls
//! (`services::line`).
//!
//! ## One client, not one per call
//!
//! A `reqwest::Client` owns a connection pool and is designed to be cloned
//! or shared, never rebuilt per request: building one per call throws the
//! pool away every time, so every LINE push pays a fresh TCP and TLS
//! handshake to a host we talk to all day. The client is therefore built
//! once, lazily, and handed out as a `&'static`.
//!
//! Only the timeouts are configured here. Redirect policy, headers and
//! proxy handling stay at reqwest's defaults, which is what the call sites
//! already had — this module bounds them, it does not otherwise change how
//! they behave.

use std::time::Duration;

use once_cell::sync::Lazy;

/// Ceiling on *establishing* the connection.
///
/// The total timeout alone leaves the worst case — a host that accepts the
/// SYN and then goes quiet — costing the whole budget before the caller
/// learns the peer is not really there. A bounded connect turns a dead host
/// into a fast, unambiguous failure and leaves the rest of the budget for a
/// peer that is actually answering. Same split, and the same numbers, as
/// [`crate::services::pms_channel::PMS_CONNECT_TIMEOUT`].
pub const OUTBOUND_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Ceiling on the whole request, connect included.
///
/// Ten seconds is generous for every call that uses it: an OAuth token
/// exchange, a userinfo or LINE profile GET, a JWKS fetch, a LINE push.
/// Anything slower than this is an outage at the other end, and the caller
/// — usually a guest waiting on a login — is better off being told so than
/// left holding an open request.
pub const OUTBOUND_TOTAL_TIMEOUT: Duration = Duration::from_secs(10);

/// Build a client with an explicit connect and total budget.
///
/// Split out from [`outbound`] so a test can exercise the *builder* with
/// timeouts short enough to observe: `reqwest::Client` exposes no getters
/// for its timeouts, so the only honest way to prove they are applied is to
/// watch a request give up.
fn build(connect: Duration, total: Duration) -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(connect)
        .timeout(total)
        .build()
}

/// [`build`], plus `redirect(Policy::none())`. See [`outbound_no_redirect`].
fn build_no_redirect(connect: Duration, total: Duration) -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(connect)
        .timeout(total)
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

/// The shared client, built on first use.
///
/// `expect` rather than a fallback: the only way `build` fails is that the
/// TLS backend could not be initialised, and `reqwest::Client::new()` — what
/// every one of these call sites used before — panics on exactly that. A
/// silent fallback would produce an unbounded client, which is the bug this
/// module exists to remove.
static OUTBOUND: Lazy<reqwest::Client> = Lazy::new(|| {
    build(OUTBOUND_CONNECT_TIMEOUT, OUTBOUND_TOTAL_TIMEOUT)
        .expect("the outbound HTTP client could not be built (TLS backend unavailable)")
});

/// The shared redirect-refusing client, built on first use.
///
/// Separate `Lazy` rather than a per-call rebuild for the reason in the
/// module note: a `reqwest::Client` owns a connection pool, and the OAuth
/// token and userinfo endpoints are hosts we talk to on every login.
static OUTBOUND_NO_REDIRECT: Lazy<reqwest::Client> = Lazy::new(|| {
    build_no_redirect(OUTBOUND_CONNECT_TIMEOUT, OUTBOUND_TOTAL_TIMEOUT).expect(
        "the redirect-refusing outbound HTTP client could not be built (TLS backend unavailable)",
    )
});

/// The app's shared outbound HTTP client: connect ≤ 5 s, request ≤ 10 s.
///
/// Reuse it rather than calling `reqwest::Client::new()`; see the module
/// note for why both halves of that matter.
pub fn outbound() -> &'static reqwest::Client {
    &OUTBOUND
}

/// The same client, for callers that must not follow redirects.
///
/// One caller, and it is not a style preference: `oauth2` v5 requires the
/// client used for a token exchange to refuse redirects, as an SSRF
/// mitigation (upstream's v4→v5 upgrade guide). `services::oauth` built its
/// own `reqwest::Client` for exactly that reason — and got no timeouts with
/// it, because `Client::builder()` starts from none, so a hung Google or
/// LINE token endpoint held a guest's login open until the router's 30 s
/// `TimeoutLayer` turned it into a 408.
///
/// Handing that call site [`outbound`] would have bounded it and silently
/// dropped the redirect policy, so the fix is this: same constants, same
/// built-once sharing, one behavioural difference that the caller actually
/// needs. Redirect policy is the *only* thing that differs.
pub fn outbound_no_redirect() -> &'static reqwest::Client {
    &OUTBOUND_NO_REDIRECT
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One client, shared — not one per call site, and not one per call.
    #[test]
    fn the_outbound_client_is_built_once_and_reused() {
        let first = outbound();
        let second = outbound();
        assert!(
            std::ptr::eq(first, second),
            "every caller must get the same client, so they share its connection pool"
        );
    }

    /// The builder really does apply the total timeout.
    ///
    /// A listener that accepts the connection and then never writes is the
    /// exact failure the unbounded client could not survive: the TCP
    /// handshake succeeds, so a connect timeout never fires, and without a
    /// request timeout the call waits forever. Milliseconds here rather
    /// than the production ten seconds, because what is under test is that
    /// the value reaches the client at all.
    #[tokio::test]
    async fn a_built_client_gives_up_on_a_peer_that_accepts_and_says_nothing() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind a local listener");
        let addr = listener.local_addr().expect("listener address");

        // Hold the accepted socket open for the duration of the test:
        // dropping it would close the connection and the client would fail
        // with a connection error rather than the timeout under test.
        let accept = tokio::spawn(async move {
            let socket = listener.accept().await;
            tokio::time::sleep(Duration::from_secs(2)).await;
            drop(socket);
        });

        let client = build(Duration::from_millis(200), Duration::from_millis(200))
            .expect("build a short-budget client");
        let error = client
            .get(format!("http://{addr}/"))
            .send()
            .await
            .expect_err("a peer that never answers must not be waited on forever");

        assert!(
            error.is_timeout(),
            "the request must end as a timeout, not some other failure: {error}"
        );
        accept.abort();
    }

    /// The redirect-refusing client is shared too, and is not the same
    /// object as the ordinary one: a caller that asked for no redirects
    /// must never be handed a client that follows them.
    #[test]
    fn the_no_redirect_client_is_its_own_shared_client() {
        assert!(
            std::ptr::eq(outbound_no_redirect(), outbound_no_redirect()),
            "every caller must get the same redirect-refusing client"
        );
        assert!(
            !std::ptr::eq(outbound(), outbound_no_redirect()),
            "the two clients differ in redirect policy, so they cannot be one object"
        );
    }

    /// And it really refuses: a 302 comes back as a 302, not as whatever
    /// was at the other end. This is the SSRF mitigation `oauth2` v5 asks
    /// for, so it is asserted rather than assumed from the builder call.
    #[tokio::test]
    async fn the_no_redirect_client_hands_back_the_redirect_itself() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind a local listener");
        let addr = listener.local_addr().expect("listener address");

        let server = tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                use tokio::io::AsyncWriteExt;
                let _ = socket
                    .write_all(
                        b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/\r\n\
                          Content-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .await;
                let _ = socket.flush().await;
            }
        });

        let response = outbound_no_redirect()
            .get(format!("http://{addr}/token"))
            .send()
            .await
            .expect("the request itself succeeds");

        assert_eq!(
            response.status().as_u16(),
            302,
            "the redirect must be returned, not followed to the Location host"
        );
        server.abort();
    }

    /// And the production constants are the ones the rest of the app was
    /// told to expect: connect inside total, both bounded.
    #[test]
    fn the_connect_budget_sits_inside_the_total_budget() {
        assert!(
            OUTBOUND_CONNECT_TIMEOUT < OUTBOUND_TOTAL_TIMEOUT,
            "a connect timeout at or above the total budget can never fire first"
        );
    }
}
