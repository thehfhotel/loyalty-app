import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  DepositFunnel,
  DepositFunnelCounters,
  DepositFunnelParams,
  FrictionRate,
} from '../../../services/analyticsService';

const mockGetDepositFunnel = vi.fn();

vi.mock('../../../services/analyticsService', async () => {
  const actual = await vi.importActual<typeof import('../../../services/analyticsService')>(
    '../../../services/analyticsService',
  );
  return {
    ...actual,
    analyticsService: {
      getDepositFunnel: (...args: unknown[]) => mockGetDepositFunnel(...args),
    },
  };
});

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Thai is the app's default language; the keys are asserted by their key
// names here so a copy change does not break the test.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'analytics.funnel.minutes') {return `${options?.count} min`;}
      if (key === 'analytics.funnel.ofIssued') {return `${options?.percent}% of links issued`;}
      if (key === 'analytics.friction.percent') {return `${options?.percent}%`;}
      if (key === 'analytics.friction.ratio') {return `${options?.numerator} / ${options?.denominator}`;}
      if (key === 'analytics.filters.rangeTooLong') {
        return `The date range must not exceed ${options?.max} days`;
      }
      return key;
    },
  }),
}));

vi.mock('../../../components/layout/AppShell', () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="app-shell">
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

import AnalyticsPage from '../AnalyticsPage';

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function funnelFixture(overrides: Partial<DepositFunnel> = {}): DepositFunnel {
  return {
    granularity: 'day',
    startDate: '2026-09-01',
    endDate: '2026-09-02',
    property: null,
    timezone: 'Asia/Bangkok',
    totals: {
      linksIssued: 10,
      linksOpened: 8,
      slipsUploaded: 6,
      machineVerdict: { verified: 0, shadowPass: 4, manual: 1, unavailable: 1, pending: 0 },
      humanDecision: { verified: 4, needsAction: 1, autoVerified: 2, pending: 1 },
      bookingsConfirmed: 4,
      medianMinutesLinkToSlip: 23.5,
      medianMinutesSlipToDecision: 11,
      bookingsBySource: { depositLink: 4, app: 3, channel: 2 },
      // Consistent with the counters above: 1 of the 6 links with a slip sits
      // on needs_action, 1 of the 4 confirmed bookings cancelled after paying,
      // 3 of the 10 issued links lapsed unpaid.
      friction: {
        needsActionSlipRate: { rate: 0.1667, numerator: 1, denominator: 6 },
        cancelAfterDepositRate: { rate: 0.25, numerator: 1, denominator: 4 },
        expiredHoldRate: { rate: 0.3, numerator: 3, denominator: 10 },
      },
    },
    buckets: [
      {
        bucketStart: '2026-09-01',
        property: 'hf',
        linksIssued: 6,
        linksOpened: 5,
        slipsUploaded: 4,
        machineVerdict: { verified: 0, shadowPass: 3, manual: 1, unavailable: 0, pending: 0 },
        humanDecision: { verified: 3, needsAction: 1, autoVerified: 0, pending: 0 },
        bookingsConfirmed: 3,
        medianMinutesLinkToSlip: 20,
        medianMinutesSlipToDecision: 10,
        bookingsBySource: { depositLink: 3, app: 0, channel: 1 },
        friction: {
          needsActionSlipRate: { rate: 0.25, numerator: 1, denominator: 4 },
          cancelAfterDepositRate: { rate: 0.3333, numerator: 1, denominator: 3 },
          expiredHoldRate: { rate: 0.3333, numerator: 2, denominator: 6 },
        },
      },
      {
        bucketStart: '2026-09-02',
        property: 'hfville',
        linksIssued: 4,
        linksOpened: 3,
        slipsUploaded: 2,
        machineVerdict: { verified: 0, shadowPass: 1, manual: 0, unavailable: 1, pending: 0 },
        humanDecision: { verified: 1, needsAction: 0, autoVerified: 0, pending: 1 },
        bookingsConfirmed: 1,
        medianMinutesLinkToSlip: 30,
        medianMinutesSlipToDecision: null,
        bookingsBySource: { depositLink: 1, app: 3, channel: 1 },
        friction: {
          // A real 0%, not a missing one: two links got a slip and neither
          // came back.
          needsActionSlipRate: { rate: 0, numerator: 0, denominator: 2 },
          cancelAfterDepositRate: { rate: 0, numerator: 0, denominator: 1 },
          expiredHoldRate: { rate: 0.25, numerator: 1, denominator: 4 },
        },
      },
    ],
    ...overrides,
  };
}

/** The params of one call, with the index checked rather than assumed. */
function callParams(index: number): DepositFunnelParams {
  const call = mockGetDepositFunnel.mock.calls[index];
  expect(call).toBeDefined();
  return (call as unknown[])[0] as DepositFunnelParams;
}

function lastCallParams(): DepositFunnelParams {
  return callParams(mockGetDepositFunnel.mock.calls.length - 1);
}

describe('AnalyticsPage — deposit funnel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDepositFunnel.mockResolvedValue(funnelFixture());
  });

  it('asks for the last 30 Bangkok days by day, every property, on first render', async () => {
    render(<AnalyticsPage />, { wrapper });

    await waitFor(() => expect(mockGetDepositFunnel).toHaveBeenCalled());
    const params = callParams(0);
    expect(params.granularity).toBe('day');
    expect(params.property).toBe('');
    const start = new Date(`${params.startDate}T00:00:00Z`).getTime();
    const end = new Date(`${params.endDate}T00:00:00Z`).getTime();
    expect(Math.round((end - start) / 86_400_000) + 1).toBe(30);
  });

  it('renders every funnel stage with its share of the links issued', async () => {
    render(<AnalyticsPage />, { wrapper });

    // Several of these labels appear twice — once on the stat tile, once as
    // a column header — so each is asserted as "at least one".
    for (const stage of [
      'analytics.funnel.linksIssued',
      'analytics.funnel.linksOpened',
      'analytics.funnel.slipsUploaded',
      'analytics.funnel.machineDecided',
      'analytics.funnel.humanDecided',
      'analytics.funnel.bookingsConfirmed',
    ]) {
      expect((await screen.findAllByText(stage)).length).toBeGreaterThan(0);
    }

    // 8 of 10 links opened.
    expect(screen.getByText('80% of links issued')).toBeInTheDocument();
    // 6 of 10 slips, and 6 of 10 machine verdicts (4 shadow_pass + 1 manual
    // + 1 unavailable) — two tiles carrying the same share.
    expect(screen.getAllByText('60% of links issued')).toHaveLength(2);
    // 4 of 10 bookings confirmed.
    expect(screen.getByText('40% of links issued')).toBeInTheDocument();
  });

  it('shows the machine verdict, staff decision and source splits', async () => {
    render(<AnalyticsPage />, { wrapper });

    await screen.findByText('analytics.funnel.machineVerdict');
    expect(screen.getByTestId('breakdown-analytics.funnel.verdict.shadowPass')).toHaveTextContent('4');
    expect(screen.getByTestId('breakdown-analytics.funnel.decision.needsAction')).toHaveTextContent('1');
    expect(screen.getByTestId('breakdown-analytics.funnel.source.app')).toHaveTextContent('3');
    expect(screen.getByTestId('breakdown-analytics.funnel.source.channel')).toHaveTextContent('2');
  });

  it('shows auto-verified slips beside the staff decisions, not inside them', async () => {
    render(<AnalyticsPage />, { wrapper });

    // SlipOK closed two of them. Folded into "verified" they would flatter
    // the desk's throughput and hide what auto-verify is actually doing.
    expect(
      await screen.findByTestId('breakdown-analytics.funnel.decision.autoVerified'),
    ).toHaveTextContent('2');
    expect(screen.getByTestId('breakdown-analytics.funnel.decision.verified')).toHaveTextContent('4');

    // The staff stage counts the 4 + 1 a person decided, not the 2 SlipOK did.
    expect(screen.getByText('50% of links issued')).toBeInTheDocument();
  });

  it('renders the median timings and leaves an undecided one blank', async () => {
    render(<AnalyticsPage />, { wrapper });

    expect(await screen.findByTestId('median-link-to-slip')).toHaveTextContent('23.5 min');
    expect(screen.getByTestId('median-slip-to-decision')).toHaveTextContent('11 min');

    // The second bucket has no staff decision at all: an em dash, never "0",
    // which would read as an instant decision.
    const rows = within(screen.getByTestId('funnel-table')).getAllByRole('row');
    expect(rows[2]).toHaveTextContent('—');
  });

  it('lists one table row per bucket and property', async () => {
    render(<AnalyticsPage />, { wrapper });

    const table = await screen.findByTestId('funnel-table');
    const rows = within(table).getAllByRole('row');
    // header + two buckets
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('2026-09-01');
    expect(rows[1]).toHaveTextContent('property.hf');
    expect(rows[2]).toHaveTextContent('2026-09-02');
    expect(rows[2]).toHaveTextContent('property.hfville');
  });

  it('refetches with the property filter when one is chosen', async () => {
    const user = userEvent.setup();
    render(<AnalyticsPage />, { wrapper });

    await screen.findByTestId('funnel-property');
    await user.selectOptions(screen.getByTestId('funnel-property'), 'hfville');

    await waitFor(() => {
      const last = lastCallParams();
      expect(last.property).toBe('hfville');
    });
  });

  it('refetches at the chosen granularity', async () => {
    const user = userEvent.setup();
    render(<AnalyticsPage />, { wrapper });

    await screen.findByTestId('funnel-granularity');
    await user.selectOptions(screen.getByTestId('funnel-granularity'), 'month');

    await waitFor(() => {
      const last = lastCallParams();
      expect(last.granularity).toBe('month');
    });
  });

  it('refetches when the date range changes', async () => {
    const user = userEvent.setup();
    render(<AnalyticsPage />, { wrapper });

    const startInput = await screen.findByTestId('funnel-start-date');
    await user.clear(startInput);
    await user.type(startInput, '2026-09-01');

    await waitFor(() => {
      const last = lastCallParams();
      expect(last.startDate).toBe('2026-09-01');
    });
  });

  it('renders an empty window as zeros rather than nothing', async () => {
    mockGetDepositFunnel.mockResolvedValue(
      funnelFixture({
        totals: {
          linksIssued: 0,
          linksOpened: 0,
          slipsUploaded: 0,
          machineVerdict: { verified: 0, shadowPass: 0, manual: 0, unavailable: 0, pending: 0 },
          humanDecision: { verified: 0, needsAction: 0, autoVerified: 0, pending: 0 },
          bookingsConfirmed: 0,
          medianMinutesLinkToSlip: null,
          medianMinutesSlipToDecision: null,
          bookingsBySource: { depositLink: 0, app: 0, channel: 0 },
          friction: {
            needsActionSlipRate: { rate: null, numerator: 0, denominator: 0, reason: 'no_data' },
            cancelAfterDepositRate: { rate: null, numerator: 0, denominator: 0, reason: 'no_data' },
            expiredHoldRate: { rate: null, numerator: 0, denominator: 0, reason: 'no_data' },
          },
        },
        buckets: [],
      }),
    );

    render(<AnalyticsPage />, { wrapper });

    expect(await screen.findByTestId('funnel-empty')).toHaveTextContent('analytics.funnel.noData');
    expect(screen.getByTestId('median-link-to-slip')).toHaveTextContent('—');
    // No denominator means no percentage, not "0%".
    expect(screen.queryByText('0% of links issued')).not.toBeInTheDocument();
  });

  it('shows an error state when the endpoint fails', async () => {
    mockGetDepositFunnel.mockRejectedValue(new Error('boom'));

    render(<AnalyticsPage />, { wrapper });

    expect(await screen.findByText('analytics.loadError')).toBeInTheDocument();
    expect(screen.queryByTestId('funnel-table')).not.toBeInTheDocument();
  });

  it('shows the backend\'s own words when it refuses the request', async () => {
    mockGetDepositFunnel.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        response: {
          status: 400,
          data: { error: 'bad_request', message: 'The date range must not exceed 366 days' },
        },
      }),
    );

    render(<AnalyticsPage />, { wrapper });

    // "Network error" would send the operator to check their wifi over a
    // parameter they typed.
    expect(
      await screen.findByText('The date range must not exceed 366 days'),
    ).toBeInTheDocument();
    expect(screen.queryByText('errors.networkError')).not.toBeInTheDocument();
  });

  it('refuses a range longer than the cap without asking the server', async () => {
    const user = userEvent.setup();
    render(<AnalyticsPage />, { wrapper });

    await waitFor(() => expect(mockGetDepositFunnel).toHaveBeenCalledTimes(1));

    const startInput = await screen.findByTestId('funnel-start-date');
    await user.clear(startInput);
    await user.type(startInput, '2020-01-01');

    expect(await screen.findByTestId('funnel-range-error')).toHaveTextContent(
      'The date range must not exceed 366 days',
    );
    expect(screen.queryByTestId('funnel-table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('funnel-loading')).not.toBeInTheDocument();
    // Still the one call from the default window: a range the backend will
    // refuse is not worth a round trip.
    expect(mockGetDepositFunnel).toHaveBeenCalledTimes(1);
  });
});

describe('AnalyticsPage — friction proxies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDepositFunnel.mockResolvedValue(funnelFixture());
  });

  /** The fixture's totals, with one proxy swapped for the case under test. */
  function totalsWithFriction(
    proxy: keyof DepositFunnelCounters['friction'],
    rate: FrictionRate,
  ): DepositFunnelCounters {
    const { totals } = funnelFixture();
    return { ...totals, friction: { ...totals.friction, [proxy]: rate } };
  }

  it('renders each proxy as a percentage over the two counts behind it', async () => {
    render(<AnalyticsPage />, { wrapper });

    // 1 of the 6 links that got a slip is still asking the guest to retry.
    const needsAction = await screen.findByTestId('friction-needs-action');
    expect(needsAction).toHaveTextContent('16.7%');
    expect(needsAction).toHaveTextContent('1 / 6');

    const cancelled = screen.getByTestId('friction-cancel-after-deposit');
    expect(cancelled).toHaveTextContent('25.0%');
    expect(cancelled).toHaveTextContent('1 / 4');

    const expired = screen.getByTestId('friction-expired-hold');
    expect(expired).toHaveTextContent('30.0%');
    expect(expired).toHaveTextContent('3 / 10');
  });

  it('shows an em dash and a reason where a rate has no denominator', async () => {
    mockGetDepositFunnel.mockResolvedValue(
      funnelFixture({
        totals: totalsWithFriction('cancelAfterDepositRate', {
          rate: null,
          numerator: 0,
          denominator: 0,
          reason: 'no_data',
        }),
      }),
    );

    render(<AnalyticsPage />, { wrapper });

    const cancelled = await screen.findByTestId('friction-cancel-after-deposit');
    expect(cancelled).toHaveTextContent('—');
    expect(cancelled).toHaveTextContent('analytics.friction.reason.noData');
    // The counts stay on: "0 / 0" says the window was empty, which an em dash
    // on its own does not.
    expect(cancelled).toHaveTextContent('0 / 0');
    // "0% of nothing" is a claim the data does not support.
    expect(cancelled).not.toHaveTextContent('0.0%');
  });

  it('keeps an uninstrumented proxy on the card and says why it is blank', async () => {
    mockGetDepositFunnel.mockResolvedValue(
      funnelFixture({
        totals: totalsWithFriction('expiredHoldRate', {
          rate: null,
          numerator: 0,
          denominator: 0,
          reason: 'not_instrumented',
        }),
      }),
    );

    render(<AnalyticsPage />, { wrapper });

    // Dropping the line would quietly shrink the weekly pack by one proxy.
    const expired = await screen.findByTestId('friction-expired-hold');
    expect(expired).toHaveTextContent('analytics.friction.reason.notInstrumented');
    expect(expired).toHaveTextContent('—');
    expect(expired).not.toHaveTextContent('analytics.friction.reason.noData');
  });

  it('defaults a reasonless null rate to "no data" rather than a blank line', async () => {
    mockGetDepositFunnel.mockResolvedValue(
      funnelFixture({
        totals: totalsWithFriction('needsActionSlipRate', {
          rate: null,
          numerator: 0,
          denominator: 0,
        }),
      }),
    );

    render(<AnalyticsPage />, { wrapper });

    expect(await screen.findByTestId('friction-needs-action')).toHaveTextContent(
      'analytics.friction.reason.noData',
    );
  });

  it('lists one friction row per bucket, so two periods can be read against each other', async () => {
    render(<AnalyticsPage />, { wrapper });

    const table = await screen.findByTestId('friction-table');
    const rows = within(table).getAllByRole('row');
    // header + two buckets
    expect(rows).toHaveLength(3);

    // 1 of 4 slips sent back, 1 of 3 cancelled, 2 of 6 holds lapsed.
    expect(rows[1]).toHaveTextContent('2026-09-01');
    expect(rows[1]).toHaveTextContent('property.hf');
    expect(rows[1]).toHaveTextContent('25.0%');
    expect(rows[1]).toHaveTextContent('33.3%');

    // A measured zero, which is not the same as no measurement.
    expect(rows[2]).toHaveTextContent('2026-09-02');
    expect(rows[2]).toHaveTextContent('property.hfville');
    expect(rows[2]).toHaveTextContent('0.0%');
  });

  it('shows the friction empty state for a window with no buckets', async () => {
    mockGetDepositFunnel.mockResolvedValue(funnelFixture({ buckets: [] }));

    render(<AnalyticsPage />, { wrapper });

    expect(await screen.findByTestId('friction-empty')).toHaveTextContent(
      'analytics.friction.noData',
    );
  });
});
