import api from './authService';
import type { Property } from './channelBookingService';

/**
 * Admin analytics (task D6).
 *
 * `GET /api/analytics/deposit-funnel` counts the stages a deposit request
 * passes through — link issued → opened → slip uploaded → machine verdict →
 * human decision → booking confirmed — per property, per day/week/month.
 * It is computed live from `booking_deposit_links`, `booking_slips` and
 * `bookings`; there is no rollup table behind it, so the numbers are always
 * current and there is nothing to backfill.
 *
 * Shapes are hand-written against `backend-rust/src/routes/analytics.rs`.
 * The backend serialises camelCase, so nothing is renamed here.
 */

export type FunnelGranularity = 'day' | 'week' | 'month';

/**
 * `unknown` is not a placeholder for a loading state: `bookings.property` is
 * nullable and the member-app booking flow never writes it, so those rows
 * have to be reportable under some name.
 */
export type FunnelProperty = Property | 'unknown';

export const FUNNEL_GRANULARITIES: readonly FunnelGranularity[] = ['day', 'week', 'month'];
export const FUNNEL_PROPERTIES: readonly FunnelProperty[] = ['hf', 'hfville', 'unknown'];

/** Exhaustive over `booking_slips.slipok_status`, so it sums to `slipsUploaded`. */
export type MachineVerdictCounts = {
  verified: number;
  shadowPass: number;
  manual: number;
  unavailable: number;
  pending: number;
};

/** Exhaustive over `booking_slips.admin_status`, so it sums to `slipsUploaded`. */
export type HumanDecisionCounts = {
  verified: number;
  needsAction: number;
  pending: number;
};

export type BookingSourceCounts = {
  depositLink: number;
  app: number;
  channel: number;
};

export type DepositFunnelCounters = {
  linksIssued: number;
  linksOpened: number;
  slipsUploaded: number;
  machineVerdict: MachineVerdictCounts;
  humanDecision: HumanDecisionCounts;
  bookingsConfirmed: number;
  /** `null` when no link in the row got a slip — not 0, which would read as instant. */
  medianMinutesLinkToSlip: number | null;
  medianMinutesSlipToDecision: number | null;
  bookingsBySource: BookingSourceCounts;
};

/** The counters are flattened onto the bucket by the backend. */
export type DepositFunnelBucket = DepositFunnelCounters & {
  /** First day of the bucket, `YYYY-MM-DD` in the response's `timezone`. */
  bucketStart: string;
  property: FunnelProperty;
};

export type DepositFunnel = {
  granularity: FunnelGranularity;
  startDate: string;
  endDate: string;
  property: FunnelProperty | null;
  timezone: string;
  totals: DepositFunnelCounters;
  buckets: DepositFunnelBucket[];
};

export type DepositFunnelParams = {
  startDate?: string;
  endDate?: string;
  granularity?: FunnelGranularity;
  /** Empty string means "every property" — the parameter is then omitted. */
  property?: FunnelProperty | '';
};

/**
 * An empty string is a filter the operator cleared, which is not the same as
 * a filter set to `""` — the parameter has to be left off the request
 * entirely, or the backend rejects it as an unknown value.
 */
function omitEmpty<T extends string>(value: T | '' | undefined): T | undefined {
  return value === undefined || value === '' ? undefined : value;
}

export const analyticsService = {
  async getDepositFunnel(params: DepositFunnelParams = {}): Promise<DepositFunnel> {
    const response = await api.get<DepositFunnel>('/analytics/deposit-funnel', {
      params: {
        startDate: omitEmpty(params.startDate),
        endDate: omitEmpty(params.endDate),
        granularity: omitEmpty(params.granularity),
        property: omitEmpty(params.property),
      },
    });
    return response.data;
  },
};

export default analyticsService;
