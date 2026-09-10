//! Admin-viewer access logging for slip images (task F2).
//!
//! `docs/privacy/2026-09-pdpa-data-map.md` §7 states the gap this closes:
//!
//! > **Viewing a slip is not recorded anywhere.** `serve_slip` authorises and
//! > returns bytes; it writes no audit row. This is the largest single gap in
//! > the map: today we cannot answer "who looked at this guest's payer's bank
//! > details".
//!
//! A slip is a photograph of a bank transfer and the payer on it is
//! frequently **not** the guest — a family member, an employer, a friend, a
//! third party we have no contract with. That is what makes a read of one
//! worth recording.
//!
//! ## What is logged, and what deliberately is not
//!
//! Logged: every admin-facing surface that returns a slip image or a URL
//! that resolves to one. That is the image route itself, the three
//! slip-moderation routes behind the Slip Viewer Sidebar, and the admin
//! booking list/detail (and the three booking mutations that answer with the
//! same detail shape) — because the sidebar reads the image URL out of
//! *those* responses, not out of a dedicated image endpoint.
//!
//! **Not** logged: the guest reading their own slip. The point of the table
//! is staff accountability, not surveilling the data subject; a guest
//! looking at their own payment is not an event anyone needs to answer for.
//! The public deposit-link routes return no slip URL at all, so nothing
//! there reaches this module either.
//!
//! ## Fail-closed on the bytes, fail-open on the metadata
//!
//! [`record`] is awaited inside the request, and the image route treats a
//! failure as a refusal to serve: the published notice will say every view
//! is logged, and a view we could not log must therefore not happen.
//!
//! The metadata surfaces use [`record_best_effort`] instead. They return a
//! URL, not the photograph — and taking the admin console down over an
//! audit-table insert would be a worse outcome than an ERROR line naming the
//! rows that went unrecorded.

use axum::http::HeaderMap;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppResult;

/// `GET /api/storage/slips/:filename` — the image bytes themselves.
pub const ROUTE_SLIP_IMAGE: &str = "GET /api/storage/slips/:filename";

/// `GET /api/admin/bookings/slips/:slip_id` — the Slip Viewer Sidebar's
/// per-slip read.
pub const ROUTE_ADMIN_SLIP_DETAIL: &str = "GET /api/admin/bookings/slips/:slip_id";

/// `POST /api/admin/bookings/slips/:slip_id/verify`.
pub const ROUTE_ADMIN_SLIP_VERIFY: &str = "POST /api/admin/bookings/slips/:slip_id/verify";

/// `POST /api/admin/bookings/slips/:slip_id/needs-action`.
pub const ROUTE_ADMIN_SLIP_NEEDS_ACTION: &str =
    "POST /api/admin/bookings/slips/:slip_id/needs-action";

/// `GET /api/admin/bookings` — every row carries its most recent slip's URL.
pub const ROUTE_ADMIN_BOOKING_LIST: &str = "GET /api/admin/bookings";

/// `GET /api/admin/bookings/:id` — the Slip Viewer Sidebar's actual image
/// source (`booking.slip.imageUrl`).
pub const ROUTE_ADMIN_BOOKING_DETAIL: &str = "GET /api/admin/bookings/:id";

/// `PUT /api/admin/bookings/:id` — answers with the same detail shape.
pub const ROUTE_ADMIN_BOOKING_UPDATE: &str = "PUT /api/admin/bookings/:id";

/// `POST /api/admin/bookings/:id/discount` — answers with the same detail shape.
pub const ROUTE_ADMIN_BOOKING_DISCOUNT: &str = "POST /api/admin/bookings/:id/discount";

/// `POST /api/admin/bookings/:id/cancel` — answers with the same detail shape.
pub const ROUTE_ADMIN_BOOKING_CANCEL: &str = "POST /api/admin/bookings/:id/cancel";

/// The request's `x-request-id`, so a log row ties back to the request's
/// tracing span.
///
/// `SetRequestIdLayer` (main.rs) puts a v4 UUID on every inbound request
/// under this header before routing, and `make_http_span` reads the same
/// value into the `http_request` span. Reading the header rather than the
/// `RequestId` extension keeps handlers free of a tower-http type and
/// degrades to `None` in a test router that has no such layer.
///
/// The value is client-supplied when the caller sends one, so it is stored
/// as opaque text and bounded: it is a correlation hint, never an identity.
pub fn request_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(200).collect())
}

/// Write one access row per slip, inside the caller's request.
///
/// `slip_ids` may be empty (a booking list page with no slips on it), in
/// which case nothing is written and no statement is issued.
///
/// The rows go in with a single `UNNEST` insert so a 50-row booking page
/// costs one round trip rather than fifty.
pub async fn record(
    db: &PgPool,
    slip_ids: &[Uuid],
    admin_id: Uuid,
    route: &str,
    request_id: Option<&str>,
) -> AppResult<u64> {
    if slip_ids.is_empty() {
        return Ok(0);
    }

    let result = sqlx::query!(
        r#"
        INSERT INTO slip_access_log (slip_id, admin_id, route, request_id)
        SELECT slip_id, $2, $3, $4
        FROM UNNEST($1::uuid[]) AS t(slip_id)
        "#,
        slip_ids,
        admin_id,
        route,
        request_id,
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected())
}

/// [`record`] for the surfaces that return a slip *URL* rather than the
/// image: a failure is logged loudly and swallowed.
///
/// See the module docs for why the image route does not use this.
pub async fn record_best_effort(
    db: &PgPool,
    slip_ids: &[Uuid],
    admin_id: Uuid,
    route: &str,
    request_id: Option<&str>,
) {
    if let Err(e) = record(db, slip_ids, admin_id, route, request_id).await {
        // `route` is one of the constants above, never user input.
        tracing::error!(
            error = %e,
            route = %route,
            admin_id = %admin_id,
            slips = slip_ids.len(),
            "failed to write slip access-log rows; the read went unrecorded"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn request_id_reads_the_header_and_ignores_blanks() {
        let mut headers = HeaderMap::new();
        assert_eq!(request_id(&headers), None, "no header at all");

        headers.insert("x-request-id", HeaderValue::from_static("   "));
        assert_eq!(request_id(&headers), None, "a blank header is not an id");

        headers.insert("x-request-id", HeaderValue::from_static(" abc-123 "));
        assert_eq!(request_id(&headers), Some("abc-123".to_string()));
    }

    /// The header is client-supplied, so a caller must not be able to push an
    /// unbounded string into the audit table through it.
    #[test]
    fn request_id_is_bounded() {
        let mut headers = HeaderMap::new();
        let long = "a".repeat(5000);
        headers.insert("x-request-id", HeaderValue::from_str(&long).unwrap());
        assert_eq!(request_id(&headers).map(|v| v.len()), Some(200));
    }
}
