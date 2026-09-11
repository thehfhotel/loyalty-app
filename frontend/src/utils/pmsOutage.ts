import { ApiError } from './axiosInterceptor';

/**
 * Did this booking failure happen because the PMS could not answer?
 *
 * The channel create **fails closed**: when the PMS is unreachable, times
 * out, or answers a 5xx, the backend refuses rather than pretending a room
 * is held. A guest on the other end of that has one useful next step —
 * phone the desk — and telling them so requires recognising the shape of
 * the failure, not the words in it.
 *
 * What counts, and why each one:
 *
 * * **503** — `AppError::ExternalServiceUnavailable` / `ServiceUnavailable`:
 *   the PMS was unreachable or answered 5xx.
 * * **504** — `AppError::ExternalServiceTimeout`: the PMS accepted the call
 *   and never finished it.
 * * **no status at all** — the request never got a response: the browser
 *   timed out, the connection dropped, the tunnel is down. Indistinguishable
 *   from an outage at this end, and the advice is the same either way.
 *
 * Deliberately **not** included: 409 (a duplicate hold in flight, or a
 * reused idempotency key), 400 (sold out, bad dates) and 401/403. Those are
 * answers, not outages, and each has its own copy — routing them to "phone
 * the desk" would send guests to reception over a typo in a date.
 */
export function isPmsOutage(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }

  if (error.status === 503 || error.status === 504) {
    return true;
  }

  // A response we did get, with some other status, is an answer — the guest
  // is told what it said, not to phone reception.
  if (typeof error.status === 'number') {
    return false;
  }

  // No status: the request never completed. `code` may still name the
  // backend's own verdict if some other caller constructed the error.
  return error.code === undefined || OUTAGE_CODES.has(error.code);
}

/**
 * The backend's machine keys for "the other side could not answer".
 *
 * Kept as a fallback rather than the primary test: the HTTP status is the
 * contract, and these strings are `AppError::error_code()` in
 * `backend-rust/src/error.rs`, which is free to grow new names.
 */
const OUTAGE_CODES = new Set([
  'external_service_unavailable',
  'external_service_timeout',
  'service_unavailable',
]);
