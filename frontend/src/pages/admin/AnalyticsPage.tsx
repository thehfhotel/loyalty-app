import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import AppShell from '../../components/layout/AppShell';
import { Card, EmptyState, FormField, Input, PageHeader, Select, Skeleton } from '../../components/ui';
import {
  analyticsService,
  FUNNEL_GRANULARITIES,
  FUNNEL_PROPERTIES,
  type DepositFunnelBucket,
  type DepositFunnelCounters,
  type FrictionCounters,
  type FrictionRate,
  type FunnelGranularity,
  type FunnelProperty,
} from '../../services/analyticsService';
import { BANGKOK_TIME_ZONE } from '../../utils/bangkokTime';

/**
 * Admin analytics (tasks D6, D15).
 *
 * Two sections: the deposit-request funnel, and the friction proxies beneath
 * it. Every number on both is read live from the tables that already hold the
 * data — there is no rollup job behind this page, so what it shows is what the
 * database says right now.
 */

/** `YYYY-MM-DD` for a date, in Bangkok — the zone the backend buckets on. */
function bangkokDay(date: Date): string {
  // `en-CA` formats as YYYY-MM-DD, which is what the API takes.
  return new Intl.DateTimeFormat('en-CA', { timeZone: BANGKOK_TIME_ZONE }).format(date);
}

/**
 * The backend's own cap. Checked here too so a two-year range shows the
 * operator what is wrong with it instead of a 400 dressed up as a network
 * error.
 */
const MAX_RANGE_DAYS = 366;

/** Days in an inclusive range, or `null` if either end is unparseable. */
function rangeDays(startDate: string, endDate: string): number | null {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {return null;}
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * The backend's own words for a refusal, when it sent any. `AppError`
 * serialises `{ error, message }`, and "The date range must not exceed 366
 * days" is a far more useful thing to put on screen than "network error".
 */
function serverMessage(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: unknown } | undefined;
    if (typeof data?.message === 'string' && data.message.length > 0) {
      return data.message;
    }
  }
  return null;
}

function defaultRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { startDate: bangkokDay(thirtyDaysAgo), endDate: bangkokDay(now) };
}

/**
 * Share of `total`, as a whole percent. `null` when there is no denominator:
 * "0%" of nothing is a claim the data does not support.
 */
function share(value: number, total: number): number | null {
  if (total <= 0) {return null;}
  return Math.round((value / total) * 100);
}

type StatProps = {
  label: string;
  value: number;
  percent: number | null;
  percentLabel: string;
};

function Stat({ label, value, percent, percentLabel }: StatProps) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-card p-4">
      <p className="text-fine text-ink-muted">{label}</p>
      <p className="text-display font-semibold text-ink">{value}</p>
      <p className="text-fine text-ink-muted">
        {percent === null ? '—' : percentLabel}
      </p>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  return (
    <div>
      <p className="mb-2 text-caption font-semibold text-ink">{title}</p>
      <dl className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-caption text-ink-muted">{row.label}</dt>
            <dd className="text-caption font-semibold text-ink" data-testid={`breakdown-${row.label}`}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The three friction proxies, in the order the card reads them. Tiles and
 * table share this list so a column can never drift from the tile above it.
 */
const FRICTION_PROXIES = [
  {
    key: 'needsAction',
    testId: 'friction-needs-action',
    pick: (friction: FrictionCounters) => friction.needsActionSlipRate,
  },
  {
    key: 'cancelAfterDeposit',
    testId: 'friction-cancel-after-deposit',
    pick: (friction: FrictionCounters) => friction.cancelAfterDepositRate,
  },
  {
    key: 'expiredHold',
    testId: 'friction-expired-hold',
    pick: (friction: FrictionCounters) => friction.expiredHoldRate,
  },
] as const;

/** The last column drops its trailing gutter, as in the funnel table. */
function isLastFrictionColumn(index: number): boolean {
  return index === FRICTION_PROXIES.length - 1;
}

/**
 * Both class strings are written out in full rather than concatenated:
 * Tailwind only emits utilities it can read literally in the source.
 */
function frictionCellClass(index: number): string {
  return isLastFrictionColumn(index) ? 'py-2 text-right text-ink' : 'py-2 pr-4 text-right text-ink';
}

function frictionHeaderClass(index: number): string {
  return isLastFrictionColumn(index)
    ? 'py-2 text-right font-semibold'
    : 'py-2 pr-4 text-right font-semibold';
}

type FrictionStatProps = {
  label: string;
  hint: string;
  /** The rate as a percent, or an em dash when there is nothing to divide by. */
  value: string;
  ratio: string;
  /** Why there is no rate, or `null` when there is one. */
  reason: string | null;
  testId: string;
};

function FrictionStat({ label, hint, value, ratio, reason, testId }: FrictionStatProps) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-card p-4" data-testid={testId}>
      <p className="text-fine text-ink-muted">{label}</p>
      <p className="text-display font-semibold text-ink">{value}</p>
      {/* Kept even when the rate is withheld: "0 / 0" tells the operator the
          window was empty, which an em dash on its own does not. */}
      <p className="text-fine text-ink-muted">{ratio}</p>
      {reason === null ? null : <p className="text-fine text-ink-muted">{reason}</p>}
      <p className="mt-2 text-fine text-ink-muted">{hint}</p>
    </div>
  );
}

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const initialRange = useMemo(defaultRange, []);
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [granularity, setGranularity] = useState<FunnelGranularity>('day');
  const [property, setProperty] = useState<FunnelProperty | ''>('');

  const span = rangeDays(startDate, endDate);
  const rangeError =
    span === null
      ? t('analytics.filters.rangeInvalid')
      : span < 1
        ? t('analytics.filters.rangeReversed')
        : span > MAX_RANGE_DAYS
          ? t('analytics.filters.rangeTooLong', { max: MAX_RANGE_DAYS })
          : null;

  const params = { startDate, endDate, granularity, property } as const;
  const funnelQuery = useQuery({
    queryKey: ['admin', 'analytics', 'depositFunnel', params],
    queryFn: () => analyticsService.getDepositFunnel(params),
    // A range the backend will refuse is not worth a round trip.
    enabled: rangeError === null,
  });

  const funnel = funnelQuery.data;
  const totals: DepositFunnelCounters | undefined = funnel?.totals;

  const minutes = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : t('analytics.funnel.minutes', { count: value });

  /**
   * A friction rate as a percent to one decimal, or an em dash. The wire
   * carries a fraction and withholds it entirely when nothing reached the
   * denominator, so a rate nobody could measure never renders as "0.0%".
   */
  const frictionPercent = (rate: FrictionRate) =>
    rate.rate === null ? '—' : t('analytics.friction.percent', { percent: (rate.rate * 100).toFixed(1) });

  const frictionRatio = (rate: FrictionRate) =>
    t('analytics.friction.ratio', { numerator: rate.numerator, denominator: rate.denominator });

  /**
   * Why the percent is missing. An absent `reason` still means an empty
   * denominator, so "no data" is the default rather than a blank line.
   */
  const frictionReason = (rate: FrictionRate) => {
    if (rate.rate !== null) {return null;}
    return rate.reason === 'not_instrumented'
      ? t('analytics.friction.reason.notInstrumented')
      : t('analytics.friction.reason.noData');
  };

  const stageRows = (counters: DepositFunnelCounters) => {
    const issued = counters.linksIssued;
    const machineDecided =
      counters.machineVerdict.verified +
      counters.machineVerdict.shadowPass +
      counters.machineVerdict.manual +
      counters.machineVerdict.unavailable;
    const humanDecided = counters.humanDecision.verified + counters.humanDecision.needsAction;
    return [
      { key: 'linksIssued', value: issued },
      { key: 'linksOpened', value: counters.linksOpened },
      { key: 'slipsUploaded', value: counters.slipsUploaded },
      { key: 'machineDecided', value: machineDecided },
      { key: 'humanDecided', value: humanDecided },
      { key: 'bookingsConfirmed', value: counters.bookingsConfirmed },
    ].map((stage) => ({ ...stage, percent: share(stage.value, issued) }));
  };

  return (
    <AppShell variant="admin" title={t('analytics.title')}>
      <div className="mx-auto max-w-page px-4 py-8 sm:px-6">
        <PageHeader
          density="admin"
          title={t('analytics.title')}
          subtitle={t('analytics.subtitle')}
          backTo="/admin/loyalty"
        />

        <Card className="mb-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label={t('analytics.filters.startDate')} htmlFor="funnel-start-date">
              <Input
                type="date"
                value={startDate}
                max={endDate}
                onChange={(event) => setStartDate(event.target.value)}
                data-testid="funnel-start-date"
              />
            </FormField>
            <FormField label={t('analytics.filters.endDate')} htmlFor="funnel-end-date">
              <Input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(event) => setEndDate(event.target.value)}
                data-testid="funnel-end-date"
              />
            </FormField>
            <FormField label={t('analytics.filters.granularity')} htmlFor="funnel-granularity">
              <Select
                value={granularity}
                onChange={(event) => setGranularity(event.target.value as FunnelGranularity)}
                data-testid="funnel-granularity"
              >
                {FUNNEL_GRANULARITIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`analytics.filters.${value}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('analytics.filters.property')} htmlFor="funnel-property">
              <Select
                value={property}
                onChange={(event) => setProperty(event.target.value as FunnelProperty | '')}
                data-testid="funnel-property"
              >
                <option value="">{t('analytics.filters.allProperties')}</option>
                {FUNNEL_PROPERTIES.map((value) => (
                  <option key={value} value={value}>
                    {value === 'unknown' ? t('analytics.filters.unknownProperty') : t(`property.${value}`)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <p className="mt-3 text-fine text-ink-muted">{t('analytics.timezoneNote')}</p>
        </Card>

        <Card as="section" aria-labelledby="deposit-funnel-heading">
          <h2 id="deposit-funnel-heading" className="text-title text-ink">
            {t('analytics.funnel.title')}
          </h2>
          <p className="mt-1 text-caption text-ink-muted">{t('analytics.funnel.description')}</p>

          {rangeError ? (
            <div className="mt-6" data-testid="funnel-range-error">
              <EmptyState title={rangeError} />
            </div>
          ) : null}

          {rangeError === null && funnelQuery.isPending ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="funnel-loading">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <Skeleton key={index} className="h-24" />
              ))}
            </div>
          ) : null}

          {rangeError === null && funnelQuery.isError ? (
            <div className="mt-6">
              <EmptyState
                title={t('analytics.loadError')}
                description={serverMessage(funnelQuery.error) ?? t('errors.networkError')}
              />
            </div>
          ) : null}

          {rangeError === null && totals && funnel ? (
            <>
              <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {stageRows(totals).map((stage) => (
                  <Stat
                    key={stage.key}
                    label={t(`analytics.funnel.${stage.key}`)}
                    value={stage.value}
                    percent={stage.percent}
                    percentLabel={t('analytics.funnel.ofIssued', { percent: stage.percent ?? 0 })}
                  />
                ))}
              </div>

              <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <Breakdown
                  title={t('analytics.funnel.machineVerdict')}
                  rows={[
                    { label: t('analytics.funnel.verdict.verified'), value: totals.machineVerdict.verified },
                    { label: t('analytics.funnel.verdict.shadowPass'), value: totals.machineVerdict.shadowPass },
                    { label: t('analytics.funnel.verdict.manual'), value: totals.machineVerdict.manual },
                    { label: t('analytics.funnel.verdict.unavailable'), value: totals.machineVerdict.unavailable },
                    { label: t('analytics.funnel.verdict.pending'), value: totals.machineVerdict.pending },
                  ]}
                />
                <Breakdown
                  title={t('analytics.funnel.humanDecision')}
                  rows={[
                    { label: t('analytics.funnel.decision.verified'), value: totals.humanDecision.verified },
                    { label: t('analytics.funnel.decision.needsAction'), value: totals.humanDecision.needsAction },
                    // Closed by SlipOK, not by anyone at the desk. Shown
                    // beside the staff decisions rather than folded into
                    // them: with auto-verify on, the gap between these two
                    // columns is the calibration.
                    { label: t('analytics.funnel.decision.autoVerified'), value: totals.humanDecision.autoVerified },
                    { label: t('analytics.funnel.decision.pending'), value: totals.humanDecision.pending },
                  ]}
                />
                <div>
                  <p className="mb-2 text-caption font-semibold text-ink">{t('analytics.funnel.timings')}</p>
                  <dl className="space-y-1">
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="text-caption text-ink-muted">{t('analytics.funnel.medianLinkToSlip')}</dt>
                      <dd className="text-caption font-semibold text-ink" data-testid="median-link-to-slip">
                        {minutes(totals.medianMinutesLinkToSlip)}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="text-caption text-ink-muted">{t('analytics.funnel.medianSlipToDecision')}</dt>
                      <dd className="text-caption font-semibold text-ink" data-testid="median-slip-to-decision">
                        {minutes(totals.medianMinutesSlipToDecision)}
                      </dd>
                    </div>
                  </dl>
                </div>
                <Breakdown
                  title={t('analytics.funnel.bySource')}
                  rows={[
                    { label: t('analytics.funnel.source.depositLink'), value: totals.bookingsBySource.depositLink },
                    { label: t('analytics.funnel.source.app'), value: totals.bookingsBySource.app },
                    { label: t('analytics.funnel.source.channel'), value: totals.bookingsBySource.channel },
                  ]}
                />
              </div>

              <div className="mt-8 overflow-x-auto">
                <table className="w-full text-caption" data-testid="funnel-table">
                  <caption className="sr-only">{t('analytics.funnel.title')}</caption>
                  <thead>
                    <tr className="border-b border-hairline text-left text-ink-muted">
                      <th scope="col" className="py-2 pr-4 font-semibold">{t('analytics.funnel.bucket')}</th>
                      <th scope="col" className="py-2 pr-4 font-semibold">{t('analytics.filters.property')}</th>
                      <th scope="col" className="py-2 pr-4 text-right font-semibold">{t('analytics.funnel.linksIssued')}</th>
                      <th scope="col" className="py-2 pr-4 text-right font-semibold">{t('analytics.funnel.linksOpened')}</th>
                      <th scope="col" className="py-2 pr-4 text-right font-semibold">{t('analytics.funnel.slipsUploaded')}</th>
                      <th scope="col" className="py-2 pr-4 text-right font-semibold">{t('analytics.funnel.humanDecided')}</th>
                      <th scope="col" className="py-2 pr-4 text-right font-semibold">{t('analytics.funnel.bookingsConfirmed')}</th>
                      <th scope="col" className="py-2 pr-4 text-right font-semibold">{t('analytics.funnel.medianLinkToSlip')}</th>
                      <th scope="col" className="py-2 text-right font-semibold">{t('analytics.funnel.medianSlipToDecision')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funnel.buckets.map((bucket: DepositFunnelBucket) => (
                      <tr key={`${bucket.bucketStart}-${bucket.property}`} className="border-b border-hairline">
                        <td className="py-2 pr-4 text-ink">{bucket.bucketStart}</td>
                        <td className="py-2 pr-4 text-ink">
                          {bucket.property === 'unknown'
                            ? t('analytics.filters.unknownProperty')
                            : t(`property.${bucket.property}`)}
                        </td>
                        <td className="py-2 pr-4 text-right text-ink">{bucket.linksIssued}</td>
                        <td className="py-2 pr-4 text-right text-ink">{bucket.linksOpened}</td>
                        <td className="py-2 pr-4 text-right text-ink">{bucket.slipsUploaded}</td>
                        <td className="py-2 pr-4 text-right text-ink">
                          {bucket.humanDecision.verified + bucket.humanDecision.needsAction}
                        </td>
                        <td className="py-2 pr-4 text-right text-ink">{bucket.bookingsConfirmed}</td>
                        <td className="py-2 pr-4 text-right text-ink">{minutes(bucket.medianMinutesLinkToSlip)}</td>
                        <td className="py-2 text-right text-ink">{minutes(bucket.medianMinutesSlipToDecision)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {funnel.buckets.length === 0 ? (
                  <p className="py-6 text-center text-caption text-ink-muted" data-testid="funnel-empty">
                    {t('analytics.funnel.noData')}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </Card>

        <Card as="section" aria-labelledby="friction-heading" className="mt-6">
          <h2 id="friction-heading" className="text-title text-ink">
            {t('analytics.friction.title')}
          </h2>
          <p className="mt-1 text-caption text-ink-muted">{t('analytics.friction.description')}</p>

          {/* No range error and no load error are repeated here: both cards
              read the one query, and saying "could not load" twice about a
              single failed request is noise, not information. The funnel card
              above carries the message; this one simply shows nothing. */}
          {rangeError === null && funnelQuery.isPending ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-3" data-testid="friction-loading">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-24" />
              ))}
            </div>
          ) : null}

          {rangeError === null && totals && funnel ? (
            <>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {FRICTION_PROXIES.map((proxy) => {
                  const rate = proxy.pick(totals.friction);
                  return (
                    <FrictionStat
                      key={proxy.key}
                      testId={proxy.testId}
                      label={t(`analytics.friction.${proxy.key}.label`)}
                      hint={t(`analytics.friction.${proxy.key}.hint`)}
                      value={frictionPercent(rate)}
                      ratio={frictionRatio(rate)}
                      reason={frictionReason(rate)}
                    />
                  );
                })}
              </div>

              <p className="mb-2 mt-8 text-caption font-semibold text-ink">
                {t('analytics.friction.bucketHeading')}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-caption" data-testid="friction-table">
                  <caption className="sr-only">{t('analytics.friction.title')}</caption>
                  <thead>
                    <tr className="border-b border-hairline text-left text-ink-muted">
                      <th scope="col" className="py-2 pr-4 font-semibold">{t('analytics.funnel.bucket')}</th>
                      <th scope="col" className="py-2 pr-4 font-semibold">{t('analytics.filters.property')}</th>
                      {FRICTION_PROXIES.map((proxy, index) => (
                        <th key={proxy.key} scope="col" className={frictionHeaderClass(index)}>
                          {t(`analytics.friction.${proxy.key}.label`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {funnel.buckets.map((bucket: DepositFunnelBucket) => (
                      <tr key={`${bucket.bucketStart}-${bucket.property}`} className="border-b border-hairline">
                        <td className="py-2 pr-4 text-ink">{bucket.bucketStart}</td>
                        <td className="py-2 pr-4 text-ink">
                          {bucket.property === 'unknown'
                            ? t('analytics.filters.unknownProperty')
                            : t(`property.${bucket.property}`)}
                        </td>
                        {FRICTION_PROXIES.map((proxy, index) => (
                          <td key={proxy.key} className={frictionCellClass(index)}>
                            {frictionPercent(proxy.pick(bucket.friction))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {funnel.buckets.length === 0 ? (
                  <p className="py-6 text-center text-caption text-ink-muted" data-testid="friction-empty">
                    {t('analytics.friction.noData')}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </Card>
      </div>
    </AppShell>
  );
}
