import { describe, it, expect, afterEach, vi } from 'vitest';
import { newIdempotencyKey } from '../idempotency';

/**
 * A16 — the key generator, including the paths old phones actually take.
 *
 * `crypto.randomUUID` needs a secure context and a reasonably current
 * engine; guests reach this app through the LINE in-app WebView on phones
 * that are years old, which is the same population that cost us
 * `createImageBitmap`. So every fallback is exercised here, not assumed.
 */
describe('newIdempotencyKey', () => {
  const realCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      value: realCrypto,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  function useCrypto(value: unknown) {
    Object.defineProperty(globalThis, 'crypto', {
      value,
      configurable: true,
      writable: true,
    });
  }

  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('uses crypto.randomUUID where the browser has it', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555');
    useCrypto({ randomUUID });

    expect(newIdempotencyKey()).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('falls back to getRandomValues when randomUUID is missing', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xab);
      return bytes;
    });
    useCrypto({ getRandomValues });

    const key = newIdempotencyKey();
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(key).toMatch(UUID_V4);
  });

  /**
   * The last resort. `Math.random()` is not cryptographic and does not need
   * to be: the key is a correlation token between one browser and one
   * booking, never a secret and never a capability.
   */
  it('still produces a usable key with no crypto object at all', () => {
    useCrypto(undefined);

    expect(newIdempotencyKey()).toMatch(UUID_V4);
  });

  it('produces a different key every call', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newIdempotencyKey()));

    expect(keys.size).toBe(200);
  });

  it('produces a key the PMS would accept: 1..255 printable ASCII', () => {
    const key = newIdempotencyKey();

    expect(key.length).toBeGreaterThanOrEqual(1);
    expect(key.length).toBeLessThanOrEqual(255);
    expect(key).toMatch(/^[\x20-\x7E]+$/);
  });
});
