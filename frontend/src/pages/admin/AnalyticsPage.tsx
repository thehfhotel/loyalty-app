import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import AppShell from '../../components/layout/AppShell';
import { Card, EmptyState, FormField, Input, PageHeader, Select, Skeleton } from '../../components/ui';
import {
  analyticsService,
  FUNNEL_GRANULARITIES,
  FUNNEL_PROPERTIES,
  type DepositFunnelBucket,
  type DepositFunnelCounters,
  type FunnelGranularity,
  type FunnelProperty,
} from '../../services/analyticsService';
import { BANGKOK_TIME_ZONE } from '../../utils/bangkokTime';

/**
 * Admin analytics (task D6).
 *
 * One section so far: the deposit-request funnel. Every number on it is read
 * live from the tables that already hold the data — there is no rollup job
 * behind this page, so what it shows is what the database says right now.
 */

/** `YYYY-MM-DD` for a date, in Bangkok — the zone the backend buckets on. */
function bangkokDay(date: Date): string {
  // `en-CA` formats as YYYY-MM-DD, which is what the API takes.
  return new Intl.DateTimeFormat('en-CA', { timeZone: BANGKOK_TIME_ZONE }).format(date);
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

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const initialRange = useMemo(defaultRange, []);
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [granularity, setGranularity] = useState<FunnelGranularity>('day');
  const [property, setProperty] = useState<FunnelProperty | ''>('');

  const params = { startDate, endDate, granularity, property } as const;
  const funnelQuery = useQuery({
    queryKey: ['admin', 'analytics', 'depositFunnel', params],
    queryFn: () => analyticsService.getDepositFunnel(params),
  });

  const funnel = funnelQuery.data;
  const totals: DepositFunnelCounters | undefined = funnel?.totals;

  const minutes = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : t('analytics.funnel.minutes', { count: value });

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

          {funnelQuery.isPending ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="funnel-loading">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <Skeleton key={index} className="h-24" />
              ))}
            </div>
          ) : null}

          {funnelQuery.isError ? (
            <div className="mt-6">
              <EmptyState title={t('analytics.loadError')} description={t('errors.networkError')} />
            </div>
          ) : null}

          {totals && funnel ? (
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
      </div>
    </AppShell>
  );
}
