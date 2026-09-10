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
 * `/d/<token>` is still honoured for links already sent to guests, but
 * only as a client-side rewrite to `/d#<token>` — see
 * [`readDepositToken`]. It is a grace period, not a second supported
 * shape: the rewrite exists so a link printed on a chat message a week ago
 * still works, and it can be deleted once the longest link expiry has
 * passed.
 */

/** The request header the API takes the token in. */
export const DEPOSIT_TOKEN_HEADER = 'X-Deposit-Token';

/** The SPA path the guest page lives on. */
export const DEPOSIT_PAGE_PATH = '/d';

/**
 * A token is 32 CSPRNG bytes as base64url — 43 characters — but this
 * check only has to be good enough to tell "there is something here" from
 * "there is nothing here". The backend decides whether it is a real link,
 * and answers the same 404 for a malformed and an unknown token, so a
 * loose guard here leaks nothing and a tight one would turn a future token
 * length into a broken page.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export interface ResolvedDepositToken {
  /** The token, or `null` when this URL carries none we can use. */
  token: string | null;
  /**
   * True when the token came from the legacy `/d/<token>` path rather than
   * from the fragment. The page rewrites the URL when it sees this — with
   * `history.replaceState`, which makes no request, so the token is not
   * sent anywhere on the way to being removed from the address bar.
   */
  fromLegacyPath: boolean;
}

/** Read the token out of a `#<token>` fragment. */
function fromHash(hash: string): string | null {
  const value = hash.replace(/^#/, '').trim();
  return TOKEN_PATTERN.test(value) ? value : null;
}

/** Read the token out of a legacy `/d/<token>` path. */
function fromLegacyPathname(pathname: string): string | null {
  const match = /^\/d\/([^/]+)\/?$/.exec(pathname);
  const raw = match?.[1];
  if (!raw) {
    return null;
  }
  // Old links were percent-encoded into the path by `encodeURIComponent`.
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    value = raw;
  }
  return TOKEN_PATTERN.test(value) ? value : null;
}

/**
 * Resolve the token for this page load.
 *
 * The fragment wins: if a guest opens `/d/<old>#<new>` — which is what
 * happens when a reissued link is pasted over an old one — the token they
 * just followed is the one that should render.
 */
export function readDepositToken(location: {
  hash: string;
  pathname: string;
}): ResolvedDepositToken {
  const hashToken = fromHash(location.hash);
  if (hashToken) {
    return { token: hashToken, fromLegacyPath: false };
  }
  const pathToken = fromLegacyPathname(location.pathname);
  if (pathToken) {
    return { token: pathToken, fromLegacyPath: true };
  }
  return { token: null, fromLegacyPath: false };
}

/** The canonical guest URL for a token: `/d#<token>`. */
export function depositFragmentUrl(token: string): string {
  return `${DEPOSIT_PAGE_PATH}#${token}`;
}
