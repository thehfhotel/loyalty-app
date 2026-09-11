/**
 * Admin booking + slip moderation service.
 *
 * Typed client for the Rust handlers in
 * `backend-rust/src/routes/admin_bookings.rs` and
 * `backend-rust/src/routes/admin_slips.rs`, mounted under `/api/admin`.
 * The axios instance's baseURL is already `/api`, so the paths here start
 * at `/admin/...`.
 *
 * Every response the backend sends for these routes is a bare JSON body
 * (`Json(T)`), not the `{ data: T }` envelope some of the older user-facing
 * routes use — so these methods return `response.data` directly.
 *
 * Field names below are the serialised `#[serde(rename_all = "camelCase")]`
 * names of the Rust DTOs. Keep them in step with the handlers; the shapes
 * are asserted in `backend-rust`'s own serialisation tests.
 *
 * **Money is a string on the wire.** `backend-rust` pins `rust_decimal` with
 * only the `serde` feature (no `serde-float`), so a `Decimal` serialises via
 * `serialize_str` — `totalPrice` / `paymentAmount` / `discountAmount` arrive
 * as `"6000.00"`, not `6000`. `bookingService.ts` already types the guest
 * side that way; these mirror it. Coerce with `Number(...)` before any
 * arithmetic, comparison or `.toLocaleString()`, and before POSTing a value
 * back into a handler that deserialises `f64` (`ApplyDiscountRequest`).
 *
 * Endpoints deliberately absent here because no Rust handler exists yet
 * (see `docs/admin-backend-gaps.md`):
 *   - `POST /api/admin/bookings/:id/verify-slip`   (legacy booking-scoped verify)
 *   - `POST /api/admin/bookings/:id/needs-action`  (legacy booking-scoped reject)
 * The desk reaches the same outcome through the per-slip routes below,
 * which the list response already carries a slip id for.
 */

import api from './authService';
import type { SlipOkStatusValue } from '../types/slipok';

// ============================================================================
// Shared booking DTOs (mirror `admin_bookings.rs`)
// ============================================================================

export interface AdminBookingUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  membershipId: string | null;
  phone: string | null;
}

export interface AdminBookingRoomType {
  id: string;
  name: string;
}

/**
 * The primary (most recent) slip, surfaced inline on every list/detail row.
 *
 * `imageUrl` — not `slipUrl` — is what the list serialises; the per-slip
 * routes use `slipUrl`. The two names are the two Rust DTOs, not a typo.
 *
 * `slipokReason` / `slipokCheckedAt` / `autoVerified` are optional because
 * the *list* projection does not carry them; the per-slip `GET` does. The
 * slip viewer fills them in from that read.
 */
export interface AdminBookingSlipSummary {
  id: string;
  /** `null` once the image has been erased under the retention policy (F2),
   *  and on a legacy row with no URL. Never an empty string: an empty `src`
   *  resolves to the page itself and renders as a broken image. Read it
   *  together with `deletedAt`. */
  imageUrl: string | null;
  /** When the image was erased under the retention policy, or `null` while it
   *  is still on disk. The payment record itself is unchanged either way. */
  deletedAt: string | null;
  uploadedAt: string;
  /** `Option<String>` on the wire — NULL on legacy rows, so nullable here.
   *  `deskSlipOkStatus` is the only place that null becomes a badge. */
  slipokStatus: SlipOkStatusValue | null;
  slipokVerifiedAt: string | null;
  slipokReason?: string | null;
  slipokCheckedAt?: string | null;
  /** `Option<String>` on the wire; readers fall back to `pending`. */
  adminStatus: 'pending' | 'verified' | 'needs_action' | null;
  adminVerifiedAt: string | null;
  adminVerifiedBy: string | null;
  adminVerifiedByName: string | null;
  /** True when the verify was the SlipOK system actor's, not a human's. */
  autoVerified?: boolean;
}

/** One slip in the viewer's multi-slip gallery. */
export interface AdminBookingSlip {
  id: string;
  /** `null` once the image has been erased under the retention policy (F2). */
  slipUrl: string | null;
  /** When the image was erased, or `null` while it is still on disk. */
  deletedAt?: string | null;
  /** Why it was erased — `retention_sweep` today. */
  deletionReason?: string | null;
  uploadedAt: string;
  uploadedBy?: string;
  slipokStatus: SlipOkStatusValue | null;
  slipokVerifiedAt: string | null;
  slipokReason?: string | null;
  slipokCheckedAt?: string | null;
  adminStatus: 'pending' | 'verified' | 'needs_action' | null;
  adminVerifiedAt: string | null;
  adminVerifiedBy: string | null;
  adminVerifiedByName?: string | null;
  autoVerified?: boolean;
  adminNotes?: string | null;
  isPrimary?: boolean;
}

export interface AdminBookingAuditEntry {
  id: string;
  action: string;
  adminId: string;
  adminName: string;
  oldValue: string | null;
  newValue: string | null;
  notes: string | null;
  createdAt: string;
}

export interface AdminBooking {
  id: string;
  userId: string;
  user: AdminBookingUser;
  roomTypeId: string;
  roomType: AdminBookingRoomType;
  checkInDate: string;
  checkOutDate: string;
  numberOfGuests: number;
  /** `Decimal` — a string on the wire (see the module note). */
  totalPrice: number | string;
  /** `Option<String>` on the wire. */
  paymentType: 'full' | 'deposit' | null;
  paymentAmount: number | string | null;
  discountAmount: number | string | null;
  discountReason: string | null;
  status: 'confirmed' | 'cancelled' | 'completed';
  notes: string | null;
  adminNotes: string | null;
  slip: AdminBookingSlipSummary | null;
  /**
   * Only the detail route (`GET /admin/bookings/:id`) and the mutations
   * return audit rows; the list projection omits them, which is why this
   * is optional on the shared shape.
   */
  auditHistory?: AdminBookingAuditEntry[];
  /** Multi-slip gallery. Not served by any route yet — the viewer falls back
   *  to `slip`. Kept so the viewer's gallery code stays typed. */
  slips?: AdminBookingSlip[];
  createdAt: string;
  updatedAt: string;
}

/** `AdminBookingDetail` — the list-item shape flattened together with the
 *  booking's audit history (newest first). */
export interface AdminBookingDetail extends AdminBooking {
  auditHistory: AdminBookingAuditEntry[];
}

export interface AdminBookingStatusCounts {
  all: number;
  confirmed: number;
  cancelled: number;
  completed: number;
}

export interface AdminBookingsListResponse {
  bookings: AdminBooking[];
  total: number;
  page: number;
  limit: number;
  statusCounts: AdminBookingStatusCounts;
}

export type AdminBookingSortField =
  | 'created_at'
  | 'check_in_date'
  | 'room_type'
  | 'status'
  | 'total_price'
  | 'user_name';

export interface AdminBookingListParams {
  page: number;
  limit: number;
  /** Matches guest name, email, membership id, or a booking-id prefix. */
  search?: string | undefined;
  /** One of the three management tabs; anything else means "no filter". */
  status?: 'confirmed' | 'cancelled' | 'completed' | undefined;
  sortBy: AdminBookingSortField;
  sortOrder: 'asc' | 'desc';
}

/** PUT body. Every field optional — only what is sent is written. The
 *  handler ignores anything outside this allow-list. */
export interface UpdateAdminBookingRequest {
  /** `YYYY-MM-DD` — the handler parses a `NaiveDate`, not a timestamp. */
  checkInDate?: string;
  checkOutDate?: string;
  numberOfGuests?: number;
  roomTypeId?: string;
  notes?: string;
  /** Absent means "keep current" to the handler, so send `''` — not
   *  `undefined` — when the admin clears the box, or the delete is lost. */
  adminNotes?: string;
  totalPrice?: number;
  paymentType?: 'full' | 'deposit';
  paymentAmount?: number;
}

export interface ApplyDiscountRequest {
  discountAmount: number;
  reason: string;
}

export interface CancelAdminBookingRequest {
  reason?: string;
}

// ============================================================================
// Slip DTOs (mirror `admin_slips.rs` — `AdminSlipResponse`)
// ============================================================================

export interface AdminSlip {
  id: string;
  bookingId: string;
  /** `null` once the image has been erased under the retention policy (F2). */
  slipUrl: string | null;
  /** When the image was erased, or `null` while it is still on disk. */
  deletedAt: string | null;
  /** Why it was erased — `retention_sweep` today. */
  deletionReason: string | null;
  uploadedAt: string;
  adminStatus: 'pending' | 'verified' | 'needs_action' | null;
  adminVerifiedAt: string | null;
  adminVerifiedBy: string | null;
  adminNotes: string | null;
  /** Locked vocabulary; typed loosely because the wire may carry a value
   *  this bundle predates. `deskSlipOkStatus` narrows it at the badge. */
  slipokStatus: string | null;
  /** Why the machine landed on that status; null when the check passed. */
  slipokReason: string | null;
  /** Bank reference, stored only when every check passed. */
  slipokTransRef: string | null;
  /** When the machine last decided about this slip. */
  slipokCheckedAt: string | null;
  /** Legacy, always null on new rows — the automatic path stamps
   *  `slipokCheckedAt` instead. */
  slipokVerifiedAt: string | null;
  /** True when `adminVerifiedBy` is the SlipOK system actor. */
  autoVerified: boolean;
  /**
   * Whether this verify moved the booking to `confirmed` (A11).
   *
   * **Only meaningful on the verify / needs-action responses.**
   * `GET /admin/bookings/slips/:id` hard-codes it to `false` and
   * `bookingNotConfirmedReason` to `null` (`admin_slips.rs`, "a read decides
   * nothing"), so a reader must not conclude "not confirmed" from a plain
   * read — see `SlipViewerSidebar`, which remembers the mutation's answer
   * rather than reading it back.
   */
  bookingConfirmed?: boolean;
  /**
   * Set only when a verified slip was refused the booking it pays for —
   * today only `booking_not_payable`, from the automatic path meeting a hold
   * that lapsed during the SlipOK round-trip. One of the locked
   * `SLIPOK_REASONS`, so the desk renders it with the `payment.slipok.*`
   * wording the badge already uses.
   */
  bookingNotConfirmedReason?: string | null;
}

export interface VerifySlipRequest {
  adminNotes?: string;
}

export interface SlipNeedsActionRequest {
  /** Required, 1–2000 chars — the whole point is telling the guest what to fix. */
  notes: string;
}

// ============================================================================
// Service
// ============================================================================

export const adminBookingService = {
  /** `GET /api/admin/bookings` — paginated list + per-tab status counts. */
  async listBookings(params: AdminBookingListParams): Promise<AdminBookingsListResponse> {
    const response = await api.get<AdminBookingsListResponse>('/admin/bookings', {
      params: {
        page: params.page,
        limit: params.limit,
        // Omit rather than send empty strings: the handler treats a present
        // but blank filter the same way, but leaving them out keeps the
        // request URL (and the server log line) readable.
        ...(params.search ? { search: params.search } : {}),
        ...(params.status ? { status: params.status } : {}),
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      },
    });
    return response.data;
  },

  /** `GET /api/admin/bookings/:id` — full detail + audit history. */
  async getBooking(bookingId: string): Promise<AdminBookingDetail> {
    const response = await api.get<AdminBookingDetail>(`/admin/bookings/${bookingId}`);
    return response.data;
  },

  /** `PUT /api/admin/bookings/:id` — partial update of the editable fields. */
  async updateBooking(
    bookingId: string,
    data: UpdateAdminBookingRequest
  ): Promise<AdminBookingDetail> {
    const response = await api.put<AdminBookingDetail>(`/admin/bookings/${bookingId}`, data);
    return response.data;
  },

  /** `POST /api/admin/bookings/:id/discount` — set or replace the discount. */
  async applyDiscount(
    bookingId: string,
    data: ApplyDiscountRequest
  ): Promise<AdminBookingDetail> {
    const response = await api.post<AdminBookingDetail>(
      `/admin/bookings/${bookingId}/discount`,
      data
    );
    return response.data;
  },

  /** `POST /api/admin/bookings/:id/cancel` — admin cancel (any user's booking). */
  async cancelBooking(
    bookingId: string,
    data: CancelAdminBookingRequest = {}
  ): Promise<AdminBookingDetail> {
    const response = await api.post<AdminBookingDetail>(
      `/admin/bookings/${bookingId}/cancel`,
      data
    );
    return response.data;
  },

  /** `GET /api/admin/bookings/room-types` — active types for the edit modal. */
  async listRoomTypes(): Promise<AdminBookingRoomType[]> {
    const response = await api.get<AdminBookingRoomType[]>('/admin/bookings/room-types');
    return response.data;
  },

  /** `GET /api/admin/bookings/slips/:slipId` — one slip, including the
   *  machine's decision record (`slipokReason` / `slipokTransRef` /
   *  `slipokCheckedAt` / `autoVerified`) the list projection omits. */
  async getSlip(slipId: string): Promise<AdminSlip> {
    const response = await api.get<AdminSlip>(`/admin/bookings/slips/${slipId}`);
    return response.data;
  },

  /** `POST /api/admin/bookings/slips/:slipId/verify` — admin verify. */
  async verifySlip(slipId: string, data: VerifySlipRequest = {}): Promise<AdminSlip> {
    const response = await api.post<AdminSlip>(`/admin/bookings/slips/${slipId}/verify`, data);
    return response.data;
  },

  /** `POST /api/admin/bookings/slips/:slipId/needs-action` — admin reject. */
  async markSlipNeedsAction(slipId: string, data: SlipNeedsActionRequest): Promise<AdminSlip> {
    const response = await api.post<AdminSlip>(
      `/admin/bookings/slips/${slipId}/needs-action`,
      data
    );
    return response.data;
  },
};

export default adminBookingService;
