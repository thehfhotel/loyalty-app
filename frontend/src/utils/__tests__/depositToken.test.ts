import { describe, it, expect } from 'vitest';
import { DEPOSIT_TOKEN_HEADER, readDepositToken } from '../depositToken';

/**
 * The rule these tests exist to hold: the deposit token is a bearer
 * capability for a payment, and it must never sit anywhere a server writes
 * down. A URL path reaches the frontend nginx access log and Cloudflare's
 * HTTP logs on every request; a fragment reaches neither.
 */
describe('readDepositToken', () => {
  it('reads the token out of the fragment', () => {
    expect(readDepositToken({ hash: '#abcdefghijklmnop' })).toBe('abcdefghijklmnop');
  });

  it('accepts the base64url alphabet a real token uses', () => {
    const token = 'aB3-_dEfGhIjKlMnOpQrStUvWxYz0123456789-_x';
    expect(readDepositToken({ hash: `#${token}` })).toBe(token);
  });

  it('has no token when the fragment is empty or is not token-shaped', () => {
    for (const hash of ['', '#', '#short', '#has spaces', '#../../etc/passwd', '#a!b@c']) {
      expect(readDepositToken({ hash })).toBeNull();
    }
  });

  it('reads only the fragment, never a path', () => {
    // There is no `/d/<token>` form: none was ever issued, and honouring
    // one would mean accepting a token out of a request line that nginx
    // and Cloudflare both write to disk. A URL carrying a path-shaped
    // token and no fragment therefore has no token at all.
    const pathShaped = { hash: '', pathname: '/d/abcdefghijklmnop' };
    expect(readDepositToken(pathShaped)).toBeNull();
  });
});

describe('DEPOSIT_TOKEN_HEADER', () => {
  it('is the name the backend reads', () => {
    // Locked with `routes::deposit_links::DEPOSIT_TOKEN_HEADER`. Changing
    // one side alone breaks every live link at once.
    expect(DEPOSIT_TOKEN_HEADER).toBe('X-Deposit-Token');
  });
});
