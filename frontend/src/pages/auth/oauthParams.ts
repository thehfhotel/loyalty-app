/**
 * OAuth success-redirect parameter parsing.
 *
 * Split into its own module so the React Fast Refresh rule
 * (`react-refresh/only-export-components`) doesn't fire on
 * `OAuthSuccessPage.tsx` — that file must only export the page
 * component for HMR to work cleanly.
 */

/**
 * Read OAuth handoff parameters from `window.location.hash`, falling
 * back to the query string for the deep-link / legacy / error paths.
 *
 * LOW-2 (docs/audits/security-2026-05-13.md): the backend now redirects
 * to `/oauth/success#token=…&isNewUser=…` (fragment) instead of
 * `?token=…&isNewUser=…` (query string). Fragments are NEVER sent to
 * servers by the browser, so the access token cannot land in upstream
 * HTTP access logs, proxy access logs, or `Referer` headers. The token
 * stays confined to this page's JS runtime.
 *
 * Falls back to query-string parsing for two cases:
 *   1. The PWA deep-link flow in `pwaUtils.generatePWADeepLink` still
 *      uses `?token=…` to relaunch the installed PWA — that's an
 *      internal `window.location.href = …` assignment that never hits
 *      a real server, so the leakage concern doesn't apply.
 *   2. The `error` parameter is still delivered via query string by
 *      `build_error_redirect` on the backend so existing error-pixel
 *      analytics keep working.
 */
export function readOAuthParams(
  hash: string,
  searchParams: URLSearchParams,
): {
  token: string | null;
  isNewUser: boolean;
  error: string | null;
  isPWARedirect: boolean;
} {
  // `window.location.hash` is the raw "#a=b&c=d" form; strip the leading
  // `#` and parse with the same URLSearchParams API. An empty hash
  // (just "#" or "") yields an empty params object — falls through to
  // the query-string fallback below.
  const stripped = hash.startsWith('#') ? hash.slice(1) : hash;
  const hashParams = new URLSearchParams(stripped);

  // Prefer fragment values; fall back to query string for legacy /
  // error / deep-link paths. The fragment is the source of truth for
  // post-LOW-2 server callbacks.
  return {
    token: hashParams.get('token') ?? searchParams.get('token'),
    isNewUser:
      (hashParams.get('isNewUser') ?? searchParams.get('isNewUser')) === 'true',
    error: hashParams.get('error') ?? searchParams.get('error'),
    isPWARedirect:
      (hashParams.get('pwa_redirect') ?? searchParams.get('pwa_redirect')) ===
      'true',
  };
}
