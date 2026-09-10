import { describe, it, expect } from 'vitest';
import {
  DEPOSIT_TOKEN_HEADER,
  depositFragmentUrl,
  readDepositToken,
} from '../depositToken';

/**
 * The rule these tests exist to hold: the deposit token is a bearer
 * capability for a payment, and it must never sit anywhere a server writes
 * down. A URL path reaches the frontend nginx access log and Cloudflare's
 * HTTP logs on every request; a fragment reaches neither.
 */
describe('readDepositToken', () => {
  it('reads the token out of the fragment', () => {
    expect(readDepositToken({ pathname: '/d', hash: '#abcdefghijklmnop' })).toEqual({
      token: 'abcdefghijklmnop',
      fromLegacyPath: false,
    });
  });

  it('accepts the base64url alphabet a real token uses', () => {
    const token = 'aB3-_dEfGhIjKlMnOpQrStUvWxYz0123456789-_x';
    expect(readDepositToken({ pathname: '/d', hash: `#${token}` }).token).toBe(token);
  });

  it('has no token when the fragment is empty or is not token-shaped', () => {
    for (const hash of ['', '#', '#short', '#has spaces', '#../../etc/passwd', '#a!b@c']) {
      expect(readDepositToken({ pathname: '/d', hash }).token).toBeNull();
    }
  });

  it('reads a legacy /d/<token> path and flags it for rewriting', () => {
    expect(readDepositToken({ pathname: '/d/abcdefghijklmnop', hash: '' })).toEqual({
      token: 'abcdefghijklmnop',
      fromLegacyPath: true,
    });
    // A trailing slash is the same link.
    expect(readDepositToken({ pathname: '/d/abcdefghijklmnop/', hash: '' })).toEqual({
      token: 'abcdefghijklmnop',
      fromLegacyPath: true,
    });
  });

  it('decodes a percent-encoded legacy path segment', () => {
    // Old links were built with `encodeURIComponent`, which leaves the
    // base64url alphabet alone but would have encoded anything else.
    expect(readDepositToken({ pathname: '/d/abcdefghij%2Dklmnop', hash: '' }).token).toBe(
      'abcdefghij-klmnop',
    );
  });

  it('prefers the fragment when a URL carries both', () => {
    // What a reissued link pasted over an old one looks like: the token the
    // guest just followed is the one that should render.
    expect(
      readDepositToken({ pathname: '/d/old-token-aaaaaaaa', hash: '#new-token-bbbbbbbb' }),
    ).toEqual({ token: 'new-token-bbbbbbbb', fromLegacyPath: false });
  });

  it('has no token for any other page', () => {
    expect(readDepositToken({ pathname: '/dashboard', hash: '' }).token).toBeNull();
    expect(readDepositToken({ pathname: '/d/a/b', hash: '' }).token).toBeNull();
    expect(readDepositToken({ pathname: '/', hash: '' }).token).toBeNull();
  });
});

describe('depositFragmentUrl', () => {
  it('puts the token in the fragment, never in the path', () => {
    const url = depositFragmentUrl('abcdefghijklmnop');
    expect(url).toBe('/d#abcdefghijklmnop');
    const [beforeHash] = url.split('#');
    expect(beforeHash).not.toContain('abcdefghijklmnop');
  });
});

describe('DEPOSIT_TOKEN_HEADER', () => {
  it('is the name the backend reads', () => {
    // Locked with `routes::deposit_links::DEPOSIT_TOKEN_HEADER`. Changing
    // one side alone breaks every live link at once.
    expect(DEPOSIT_TOKEN_HEADER).toBe('X-Deposit-Token');
  });
});
