import { describe, it, expect } from 'vitest';
import { readOAuthParams } from '../oauthParams';

/**
 * LOW-2 (docs/audits/security-2026-05-13.md): the OAuth backend now
 * redirects to `/oauth/success#token=…&isNewUser=…` (fragment) instead
 * of `?token=…` (query string). The fragment never hits the server,
 * keeping the access token out of HTTP access logs, proxy logs, and
 * Referer headers.
 *
 * These tests pin the contract:
 *   - The fragment is the source of truth.
 *   - The query-string fallback still works for PWA deep-link relaunch
 *     and any pre-deploy in-flight backend redirects (graceful rollout).
 */
describe('readOAuthParams', () => {
  it('reads token and isNewUser from the URL fragment (post-LOW-2)', () => {
    const hash = '#token=jwt.value.here&isNewUser=true';
    const search = new URLSearchParams();

    const result = readOAuthParams(hash, search);

    expect(result.token).toBe('jwt.value.here');
    expect(result.isNewUser).toBe(true);
    expect(result.error).toBeNull();
    expect(result.isPWARedirect).toBe(false);
  });

  it('falls back to query string when the fragment is empty (deep-link / legacy)', () => {
    // PWA deep-link relaunch path: `pwaUtils.generatePWADeepLink` still
    // emits `?token=…` because that URL is consumed by an internal
    // `window.location.href = …` assignment, not a server request.
    const hash = '';
    const search = new URLSearchParams('token=legacy.jwt&isNewUser=false');

    const result = readOAuthParams(hash, search);

    expect(result.token).toBe('legacy.jwt');
    expect(result.isNewUser).toBe(false);
  });

  it('prefers fragment over query string when both are present', () => {
    // Defence-in-depth: if both happen to be set (e.g. during a
    // staged rollout where one tab loaded a pre-deploy URL), the
    // fragment wins because that's the post-LOW-2 source of truth.
    const hash = '#token=fragment.wins';
    const search = new URLSearchParams('token=query.loses');

    const result = readOAuthParams(hash, search);

    expect(result.token).toBe('fragment.wins');
  });

  it('treats isNewUser as boolean false when missing or non-"true"', () => {
    // The handler downstream branches on `isNewUser === true`, so any
    // other value (missing, "false", "1") must yield `false`.
    expect(readOAuthParams('', new URLSearchParams()).isNewUser).toBe(false);
    expect(
      readOAuthParams('#isNewUser=1', new URLSearchParams()).isNewUser,
    ).toBe(false);
    expect(
      readOAuthParams('#isNewUser=true', new URLSearchParams()).isNewUser,
    ).toBe(true);
  });

  it('returns null token when neither fragment nor query carry one', () => {
    // The handler treats a missing token as a hard failure and
    // navigates back to /login with an error toast. The function
    // contract guarantees `null` (not `undefined`, not `""`) on miss.
    const result = readOAuthParams('', new URLSearchParams());
    expect(result.token).toBeNull();
  });

  it('strips the leading `#` from the hash before parsing', () => {
    // `window.location.hash` includes the leading `#`; raw fragment
    // body does not. Both inputs must yield the same parse result.
    const withHash = readOAuthParams('#token=abc', new URLSearchParams());
    const withoutHash = readOAuthParams('token=abc', new URLSearchParams());
    expect(withHash.token).toBe('abc');
    expect(withoutHash.token).toBe('abc');
  });

  it('reads error parameter from query string for backend error redirects', () => {
    // `build_error_redirect` on the backend still emits `?error=…`
    // because some error-pixel analytics depend on that surface. The
    // function must surface it regardless of which side it landed on.
    const fromQuery = readOAuthParams(
      '',
      new URLSearchParams('error=oauth_provider_error'),
    );
    expect(fromQuery.error).toBe('oauth_provider_error');

    const fromHash = readOAuthParams(
      '#error=session_expired',
      new URLSearchParams(),
    );
    expect(fromHash.error).toBe('session_expired');
  });
});
