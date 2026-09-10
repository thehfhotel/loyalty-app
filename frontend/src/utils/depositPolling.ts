import {
  isTerminalDepositLinkState,
  type DepositLinkState,
} from '../services/depositLinkService';

/**
 * How often `/d/:token` re-reads `GET /api/deposit/:token`.
 *
 * The page has no session, so it cannot hold an SSE stream the way the admin
 * booking list does (`useAdminBookingSSE`) — it polls. B1 §3 fixes the
 * cadence: every 5 seconds for 2 minutes after an upload, then every 30
 * seconds, and never once the state can no longer change.
 */
export const DEPOSIT_FAST_POLL_MS = 5_000;
export const DEPOSIT_SLOW_POLL_MS = 30_000;
export const DEPOSIT_FAST_POLL_WINDOW_MS = 120_000;

export interface DepositPollArgs {
  /** Latest state from the server; undefined before the first response. */
  state: DepositLinkState | undefined;
  /**
   * When the guest became "engaged": the moment their upload succeeded, or
   * the moment the page first saw a slip already being checked (a link
   * reopened after an upload from another session). `null` = never — an
   * untouched `awaiting_payment` page does not poll at all, because nothing
   * server-side can change until the guest acts.
   */
  engagedAt: number | null;
  now: number;
}

/**
 * The `refetchInterval` for the deposit query: milliseconds, or `false` to
 * stop polling entirely.
 */
export function depositPollIntervalMs({ state, engagedAt, now }: DepositPollArgs): number | false {
  if (!state || isTerminalDepositLinkState(state)) {
    return false;
  }
  if (engagedAt === null) {
    return false;
  }
  return now - engagedAt < DEPOSIT_FAST_POLL_WINDOW_MS
    ? DEPOSIT_FAST_POLL_MS
    : DEPOSIT_SLOW_POLL_MS;
}
