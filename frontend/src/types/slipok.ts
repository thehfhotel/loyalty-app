/**
 * SlipOK vocabulary — the frontend's single source of truth for
 * `booking_slips.slipok_status` and `booking_slips.slipok_reason`.
 *
 * The status set and the reason set are a locked interface shared with the
 * backend (`services::slip_confirm`) and the admin slip API
 * (`routes/admin_slips.rs`). Adding a value here without adding it there —
 * or without adding the matching `payment.slipok.*` strings in en and th —
 * is what makes a guest see a raw enum value on their booking card.
 *
 * Two audiences, two vocabularies, deliberately:
 *
 * - **Guest** (`MyBookingsPage`): only ever "confirmed" or "being checked".
 *   Every non-verified status collapses onto the same reassuring string, so
 *   a vendor outage or a quota exhaustion never reaches a guest's phone as
 *   an error. That collapse lives in the `payment.slipok.status.*` strings
 *   themselves, so there is exactly one place to re-read it.
 * - **Admin** (`SlipViewerSidebar`, `BookingManagement`): one distinct badge
 *   per status, plus the machine's reason and the time it checked, because
 *   the whole point of surfacing the reason at the desk is that reception
 *   does not re-check the slip by hand.
 */

/** The locked `booking_slips.slipok_status` values. */
export const SLIPOK_STATUSES = [
  'pending',
  'verified',
  'shadow_pass',
  'manual',
  'unavailable',
] as const;

export type SlipOkStatus = (typeof SLIPOK_STATUSES)[number];

/**
 * Statuses written before the vocabulary was locked. Old rows still carry
 * them, so every reader must keep rendering them rather than falling off
 * the end of a lookup table.
 */
export const LEGACY_SLIPOK_STATUSES = ['failed', 'quota_exceeded'] as const;

export type LegacySlipOkStatus = (typeof LEGACY_SLIPOK_STATUSES)[number];

/** What a slip row's `slipokStatus` may actually hold today. */
export type SlipOkStatusValue = SlipOkStatus | LegacySlipOkStatus;

/** The locked `booking_slips.slipok_reason` keys. */
export const SLIPOK_REASONS = [
  'amount_mismatch',
  'receiver_mismatch',
  'duplicate',
  'slip_invalid',
  'booking_not_payable',
  'confirm_failed',
  'quota_exceeded',
  'api_error',
  'not_configured',
  'timeout',
] as const;

export type SlipOkReason = (typeof SLIPOK_REASONS)[number];

const STATUS_SET = new Set<string>(SLIPOK_STATUSES);
const REASON_SET = new Set<string>(SLIPOK_REASONS);

export function isSlipOkStatus(value: string | null | undefined): value is SlipOkStatus {
  return typeof value === 'string' && STATUS_SET.has(value);
}

export function isSlipOkReason(value: string | null | undefined): value is SlipOkReason {
  return typeof value === 'string' && REASON_SET.has(value);
}

/**
 * Guest-facing i18n key for a slip status.
 *
 * Anything outside the locked set — a legacy `failed`/`quota_exceeded` row,
 * or a status added by a newer backend than this bundle — reads as
 * `pending`, i.e. "being checked". A guest is never shown a verdict the app
 * cannot phrase kindly.
 */
export function guestSlipOkStatusKey(status: string | null | undefined): string {
  return `payment.slipok.status.${isSlipOkStatus(status) ? status : 'pending'}`;
}

/**
 * Admin-facing i18n key for a slip reason, or `null` when the reason is not
 * one we have a string for — the caller then shows the raw value, which is
 * still more use at the desk than nothing.
 */
export function slipOkReasonKey(reason: string | null | undefined): string | null {
  return isSlipOkReason(reason) ? `payment.slipok.reason.${reason}` : null;
}
