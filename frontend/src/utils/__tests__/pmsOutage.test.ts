import { describe, it, expect } from 'vitest';
import { ApiError } from '../axiosInterceptor';
import { isPmsOutage } from '../pmsOutage';

/**
 * A17 — which booking failures send the guest to the front desk.
 *
 * The line matters in both directions. Too narrow and a guest sits looking
 * at a raw error during a real PMS outage; too wide and someone who typed a
 * check-out date before their check-in date is told to phone reception.
 */
describe('isPmsOutage', () => {
  it('treats 503 and 504 as an outage', () => {
    expect(
      isPmsOutage(
        new ApiError('PMS is temporarily unavailable', 'external_service_unavailable', 503),
      ),
    ).toBe(true);
    expect(
      isPmsOutage(new ApiError('PMS request timed out', 'external_service_timeout', 504)),
    ).toBe(true);
  });

  /**
   * No status means no response — the request never completed. A browser
   * timeout on a LINE webview's flaky connection is indistinguishable from
   * the tunnel to the PMS being down, and the guest's next step is the same
   * either way.
   */
  it('treats a request that never got a response as an outage', () => {
    expect(isPmsOutage(new ApiError('Network Error'))).toBe(true);
    expect(isPmsOutage(new ApiError('timeout of 10000ms exceeded'))).toBe(true);
  });

  it('leaves every answer the PMS actually gave alone', () => {
    // Sold out, or dates the PMS rejected — the guest fixes those here.
    expect(isPmsOutage(new ApiError('PMS rejected create booking', 'bad_request', 400))).toBe(
      false,
    );
    // A duplicate hold in flight, or a reused idempotency key.
    expect(isPmsOutage(new ApiError('already being created', 'conflict', 409))).toBe(false);
    expect(isPmsOutage(new ApiError('Unauthorized', 'unauthorized', 401))).toBe(false);
    expect(isPmsOutage(new ApiError('An internal error occurred', 'internal_error', 500))).toBe(
      false,
    );
  });

  /**
   * The page also throws plain `Error`s of its own ("property and room type
   * are required"), and those are programmer errors, not outages.
   */
  it('ignores anything that is not an ApiError', () => {
    expect(isPmsOutage(new Error('property and room type are required'))).toBe(false);
    expect(isPmsOutage('external_service_unavailable')).toBe(false);
    expect(isPmsOutage(undefined)).toBe(false);
    expect(isPmsOutage(null)).toBe(false);
  });

  /**
   * A status is the contract; a code is the fallback for an error some
   * other caller built by hand without one.
   */
  it('falls back to the backend code when there is no status', () => {
    expect(isPmsOutage(new ApiError('down', 'external_service_unavailable'))).toBe(true);
    expect(isPmsOutage(new ApiError('nope', 'validation_error'))).toBe(false);
  });
});
