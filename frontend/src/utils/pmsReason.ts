import { ApiError } from './axiosInterceptor';

/**
 * The machine `reason` the PMS booking channel puts on every error body,
 * forwarded verbatim by the backend as `ErrorResponse.reason` (A19).
 *
 * The tokens are the wire contract — `PmsReason::as_str()` in
 * `backend-rust/src/services/pms_channel.rs`, which in turn mirrors
 * new-hotel's channel API. Renaming one here does not rename it there; it
 * only stops this app recognising it.
 *
 * Why the app branches on this rather than on the HTTP status: `sold_out`
 * and `last_room_held_for_desk` are **both 409**, and the guest's next step
 * is opposite in each case — change the dates, versus phone the desk because
 * the room is right there. The status cannot carry that, and a sentence
 * parsed out of `message` is not a contract.
 */
export type PmsReason =
  | 'channel_disabled'
  | 'unauthorized'
  | 'sold_out'
  | 'last_room_held_for_desk'
  | 'inventory_lock_timeout'
  | 'idempotency_key_mismatch';

const KNOWN_REASONS = new Set<string>([
  'channel_disabled',
  'unauthorized',
  'sold_out',
  'last_room_held_for_desk',
  'inventory_lock_timeout',
  'idempotency_key_mismatch',
]);

/**
 * The reason on a failed request, when the backend sent one this build
 * knows.
 *
 * A token this build has never heard of answers `null` — the same answer as
 * no reason at all — so a PMS that grows a new reason degrades to the
 * generic copy instead of rendering a raw machine key at a guest.
 */
export function pmsReasonOf(error: unknown): PmsReason | null {
  if (!(error instanceof ApiError) || typeof error.reason !== 'string') {
    return null;
  }
  return KNOWN_REASONS.has(error.reason) ? (error.reason as PmsReason) : null;
}

/**
 * Reasons whose answer is a **panel** on the confirm step rather than a
 * toast.
 *
 * A toast scrolls away; these four all need something to stay on screen —
 * a button back to the dates, a number to tap, or the fact that the channel
 * is shut. `idempotency_key_mismatch` is deliberately not among them: its
 * own sentence ("start a new booking rather than trying this one again") is
 * the whole answer, it has nothing to do with the desk, and putting it
 * behind a call-reception panel would send a guest to the phone over a
 * duplicate request they can simply reissue.
 */
const PANEL_REASONS = new Set<PmsReason>([
  'channel_disabled',
  'unauthorized',
  'sold_out',
  'last_room_held_for_desk',
  'inventory_lock_timeout',
]);

/** Does this reason want the sticky panel rather than a toast? */
export function reasonWantsPanel(reason: PmsReason | null): boolean {
  return reason !== null && PANEL_REASONS.has(reason);
}
