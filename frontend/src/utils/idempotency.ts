/**
 * One idempotency key per booking attempt.
 *
 * The PMS accepts an `Idempotency-Key` on the channel hold-create and
 * collapses a repeat of the same key into the first hold (new-hotel #305).
 * That only helps if a **retry of one attempt** carries the same value, so
 * the key is minted here — at the call site, once per user-initiated
 * booking — rather than per HTTP request on the server, where a retry would
 * get a fresh key and the two creates would look unrelated.
 *
 * The one retry this app really performs is `axiosInterceptor`'s: after a
 * 401 refresh it replays `error.config`, the *same* object, headers and
 * all. A key set on the request before the first send therefore rides the
 * replay unchanged, which is exactly the behaviour we want.
 */

/**
 * A UUID v4, by whatever the browser can actually do.
 *
 * `crypto.randomUUID()` needs a secure context and a reasonably current
 * engine. Guests reach this app through the LINE in-app WebView on phones
 * that are years old — the same population that cost us
 * `createImageBitmap` — so the two fallbacks are not hypothetical:
 *
 * 1. `crypto.randomUUID()` where it exists;
 * 2. `crypto.getRandomValues()` shaped into a v4 by hand, which every
 *    WebView that can do TLS has;
 * 3. `Math.random()`, which is not cryptographic and does not need to be:
 *    the key is a correlation token between one browser and one booking,
 *    never a secret and never a capability. An attacker who guessed one
 *    would learn nothing and could do nothing — the PMS scopes keys per
 *    caller token, and that token is the server's, not the guest's.
 *
 * The important property at every level is "different every call", because
 * a key that repeated across attempts would collapse a guest's genuine
 * second booking into their first.
 */
export function newIdempotencyKey(): string {
  const cryptoApi: Crypto | undefined =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;

  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    // `set` rather than an indexed loop: a computed index write trips the
    // lint ratchet, and there is nothing to gain by arguing with it here.
    bytes.set(Uint8Array.from({ length: bytes.length }, () => Math.floor(Math.random() * 256)));
  }

  // Version 4, variant 1 — the two fixed nibbles a v4 carries. `?? 0` only
  // to satisfy `noUncheckedIndexedAccess`; the array is a fixed 16 bytes.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
