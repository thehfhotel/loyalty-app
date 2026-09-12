import { describe, it, expect } from 'vitest';
import { ApiError } from '../axiosInterceptor';
import { pmsReasonOf, reasonWantsPanel } from '../pmsReason';

/**
 * A19 — reading the PMS's machine reason off a failed request.
 *
 * Why this is a helper and not `error.reason === 'sold_out'` at the call
 * site: an unknown token must degrade to the generic copy. A page that
 * compared strings directly would render whatever new word the PMS invented
 * straight at a Thai guest the first time new-hotel grew a reason.
 */
describe('pmsReasonOf', () => {
  it('reads a known reason off an ApiError', () => {
    expect(
      pmsReasonOf(new ApiError('Sold out', 'conflict', 409, 'Sold out', 'sold_out')),
    ).toBe('sold_out');
  });

  it('tells the two 409s apart', () => {
    const soldOut = new ApiError('x', 'conflict', 409, 'x', 'sold_out');
    const deskHeld = new ApiError('x', 'conflict', 409, 'x', 'last_room_held_for_desk');

    expect(pmsReasonOf(soldOut)).not.toBe(pmsReasonOf(deskHeld));
    expect(pmsReasonOf(deskHeld)).toBe('last_room_held_for_desk');
  });

  it('answers null for a token this build has never heard of', () => {
    expect(
      pmsReasonOf(new ApiError('x', 'conflict', 409, 'x', 'rate_limited_by_the_moon')),
    ).toBeNull();
  });

  it('answers null when the backend sent no reason', () => {
    expect(pmsReasonOf(new ApiError('x', 'conflict', 409))).toBeNull();
  });

  it('answers null for anything that is not an ApiError', () => {
    expect(pmsReasonOf(new Error('Network Error'))).toBeNull();
    expect(pmsReasonOf({ reason: 'sold_out' })).toBeNull();
    expect(pmsReasonOf(null)).toBeNull();
    expect(pmsReasonOf(undefined)).toBeNull();
  });
});

/**
 * Which reasons keep something on screen. A toast scrolls away, and three
 * of these need the guest to still be able to act on them thirty seconds
 * later.
 */
describe('reasonWantsPanel', () => {
  it.each([
    'channel_disabled',
    'unauthorized',
    'sold_out',
    'last_room_held_for_desk',
    'inventory_lock_timeout',
  ] as const)('gives %s the sticky panel', (reason) => {
    expect(reasonWantsPanel(reason)).toBe(true);
  });

  it('leaves a reused idempotency key as a toast', () => {
    expect(reasonWantsPanel('idempotency_key_mismatch')).toBe(false);
  });

  it('leaves a failure with no reason to the outage check', () => {
    expect(reasonWantsPanel(null)).toBe(false);
  });
});
