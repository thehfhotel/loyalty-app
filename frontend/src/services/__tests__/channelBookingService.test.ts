import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A16 — the channel create carries an idempotency key.
 *
 * The PMS collapses a repeat of the same key into the hold it already made
 * (new-hotel #305), so a guest whose request hung and who tapped "book"
 * again gets one room rather than two. That only works if the *client*
 * mints the key: a key minted per HTTP request on the server would be a
 * different value on the retry, and the two creates would look unrelated.
 */

const mockPost = vi.fn();

vi.mock('../authService', () => ({
  default: {
    get: vi.fn(),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import {
  channelBookingService,
  IDEMPOTENCY_KEY_HEADER,
  type CreateChannelBookingRequest,
} from '../channelBookingService';

const REQUEST: CreateChannelBookingRequest = {
  property: 'hf',
  room_type_id: 'room-type-1',
  check_in: '2030-01-01',
  check_out: '2030-01-03',
  guests: 2,
  guest_name: 'Test Guest',
  guest_phone: '0812345678',
  payment_option: 'deposit50',
};

/** The `Idempotency-Key` the Nth call put on the request. */
function keySentOnCall(index: number): string {
  const call = mockPost.mock.calls[index] as unknown[] | undefined;
  const config = call?.[2] as { headers?: Record<string, string> } | undefined;
  const key = config?.headers?.[IDEMPOTENCY_KEY_HEADER];
  expect(key, 'the create must carry an Idempotency-Key header').toBeTruthy();
  return key as string;
}

describe('channelBookingService.createBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ data: { booking_id: 'booking-1' } });
  });

  it('sends an Idempotency-Key the PMS will accept', async () => {
    await channelBookingService.createBooking(REQUEST);

    expect(mockPost).toHaveBeenCalledWith('/bookings/channel', REQUEST, expect.anything());

    const key = keySentOnCall(0);
    // The PMS's rule: 1..255 printable ASCII.
    expect(key.length).toBeGreaterThanOrEqual(1);
    expect(key.length).toBeLessThanOrEqual(255);
    expect(key).toMatch(/^[\x20-\x7E]+$/);
  });

  /**
   * Two *attempts* are two bookings as far as the PMS is concerned. A key
   * that repeated here would collapse a guest's genuine second booking for
   * the same nights into their first.
   */
  it('mints a different key for every attempt', async () => {
    await channelBookingService.createBooking(REQUEST);
    await channelBookingService.createBooking(REQUEST);

    expect(keySentOnCall(0)).not.toBe(keySentOnCall(1));
  });

  /**
   * The other half: a caller that is retrying a *failed* attempt rather
   * than starting a new one can hand the previous key back, and the PMS
   * then replays instead of holding a second room.
   */
  it('reuses a key the caller supplies', async () => {
    const key = '11111111-2222-4333-8444-555555555555';

    await channelBookingService.createBooking(REQUEST, key);
    await channelBookingService.createBooking(REQUEST, key);

    expect(keySentOnCall(0)).toBe(key);
    expect(keySentOnCall(1)).toBe(key);
  });

  it('returns the response body unchanged', async () => {
    mockPost.mockResolvedValue({ data: { booking_id: 'booking-42' } });

    await expect(channelBookingService.createBooking(REQUEST)).resolves.toEqual({
      booking_id: 'booking-42',
    });
  });
});
