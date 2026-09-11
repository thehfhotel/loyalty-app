import api from './authService';
import { newIdempotencyKey } from '../utils/idempotency';

/**
 * The header the backend forwards to the PMS's channel hold-create.
 *
 * Exported so tests name it once and a rename cannot silently stop the key
 * being sent.
 */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

// Booking-channel contract (docs/launch-plan.md — "Locked interface
// contracts"). The backend proxies availability from the PMS and creates
// confirmed bookings in it; these shapes are hand-written on purpose — do
// NOT regenerate them from the OpenAPI spec until the contract stabilises.

export type Property = 'hf' | 'hfville';

export interface ChannelRoomType {
  room_type_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  nightly_price: number;
  available_count: number;
}

export interface ChannelAvailabilityResponse {
  property: Property;
  check_in: string;
  check_out: string;
  room_types: ChannelRoomType[];
}

export type PaymentOption = 'deposit50' | 'full';

export interface CreateChannelBookingRequest {
  property: Property;
  room_type_id: string;
  check_in: string;
  check_out: string;
  guests: number;
  guest_name: string;
  guest_phone: string;
  payment_option: PaymentOption;
}

export interface ChannelBookingResponse {
  booking_id: string;
  pms_booking_id: string;
  total_amount: number;
  amount_due_now: number;
  balance_due_at_checkin: number;
  promptpay_qr_payload: string;
  hold_expires_at: string;
}

export const channelBookingService = {
  async getAvailability(
    property: Property,
    checkIn: string,
    checkOut: string,
    guests: number,
  ): Promise<ChannelAvailabilityResponse> {
    const response = await api.get<ChannelAvailabilityResponse>('/bookings/availability', {
      params: {
        property,
        check_in: checkIn,
        check_out: checkOut,
        guests,
      },
    });
    return response.data;
  },

  /**
   * Create the held booking, carrying one idempotency key for this attempt.
   *
   * The key is minted per call, not per HTTP request: the backend forwards
   * it to the PMS, which collapses a repeat of the same key into the hold
   * it already made rather than holding a second room (new-hotel #305). The
   * retry that matters is `axiosInterceptor`'s — after a 401 refresh it
   * replays the same config object, so the header set here goes out again
   * unchanged and the two sends are one attempt to the PMS.
   *
   * A caller that is itself retrying a failed attempt (rather than starting
   * a new one) can pass the previous `idempotencyKey` to get the same
   * collapsing behaviour.
   */
  async createBooking(
    data: CreateChannelBookingRequest,
    idempotencyKey: string = newIdempotencyKey(),
  ): Promise<ChannelBookingResponse> {
    const response = await api.post<ChannelBookingResponse>('/bookings/channel', data, {
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    });
    return response.data;
  },
};
