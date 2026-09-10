/**
 * Where the deposit-link token lives in the browser, and where it must
 * never live.
 *
 * The token is a bearer capability for a payment: whoever holds it can see
 * a stranger's booking and upload a slip against it. So it is kept out of
 * every URL a server ever sees.
 *
 * - **The link is `https://loyalty.saichon.com/d#<token>`.** A URL
 *   fragment is not sent in the HTTP request at all, so it cannot reach
 *   the frontend container's nginx access log, Cloudflare's HTTP logs, or
 *   a `Referer` header on any outbound link. A path segment reaches all
 *   three, on every page load and every 5-second poll.
 * - **The API takes `X-Deposit-Token`.** Headers are not part of the
 *   request line, so no proxy on the way writes them down by default.
 *
 * There is no `/d/<token>` form and there never was: no deposit link has
 * been issued in any environment, so there is nothing in circulation to
 * keep working. A path-shaped variant added later would put the token
 * back into the request line of every page load — the one thing this
 * module exists to prevent.
 */

/** The request header the API takes the token in. */
export const DEPOSIT_TOKEN_HEADER = 'X-Deposit-Token';

/**
 * A token is 32 CSPRNG bytes as base64url — 43 characters — but this
 * check only has to be good enough to tell "there is something here" from
 * "there is nothing here". The backend decides whether it is a real link,
 * and answers the same 404 for a malformed and an unknown token, so a
 * loose guard here leaks nothing and a tight one would turn a future token
 * length into a broken page.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Resolve the token for this page load: the `#<token>` fragment, or
 * `null` when this URL carries none we can use.
 *
 * Only the fragment is read. The pathname is deliberately not consulted —
 * see the module comment.
 */
export function readDepositToken(location: { hash: string }): string | null {
  const value = location.hash.replace(/^#/, '').trim();
  return TOKEN_PATTERN.test(value) ? value : null;
}
