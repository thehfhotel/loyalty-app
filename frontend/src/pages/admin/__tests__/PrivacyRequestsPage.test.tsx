import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

/**
 * The desk's PDPA rights queue (task F3).
 *
 * The property these tests exist for: **resolving an erasure runs a real,
 * irreversible account erasure**, so it must be confirmed. Before this
 * guard the page showed a red warning paragraph next to a plain "Mark
 * answered" button, while the member's own (reversible) act of *filing* a
 * request got a confirmation dialog — the asymmetry was backwards.
 *
 * The other three kinds resolve in one click, deliberately: sending someone
 * a copy of their data or correcting a surname is undoable work, and a
 * dialog on every row trains people to click through them.
 */

const mockList = vi.fn();
const mockResolve = vi.fn();
const mockExport = vi.fn();

vi.mock('../../../services/privacyService', async () => {
  const actual = await vi.importActual<typeof import('../../../services/privacyService')>(
    '../../../services/privacyService',
  );
  return {
    ...actual,
    privacyService: {
      listRequests: (...args: unknown[]) => mockList(...args),
      resolveRequest: (...args: unknown[]) => mockResolve(...args),
      getExport: (...args: unknown[]) => mockExport(...args),
    },
  };
});

// `t` echoes the key, and appends the interpolated member so the dialog's
// "which account" property can be asserted without pinning the copy.
// The second argument is not always an options object — shared primitives
// (Modal, ConfirmDialog) call `t(key, 'Close')` with a string default — so
// this narrows before reaching for a property.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: unknown) =>
      typeof params === 'object' && params !== null && 'member' in params
        ? `${key}:${String((params as { member: unknown }).member)}`
        : key,
    i18n: { language: 'th' },
  }),
}));

vi.mock('../../../components/layout/AppShell', () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import PrivacyRequestsPage from '../PrivacyRequestsPage';

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    userId: 'user-1',
    email: 'somchai@example.com',
    membershipId: 'HF123456',
    kind: 'erasure',
    status: 'open',
    note: null,
    requestedAt: '2026-09-01T00:00:00Z',
    dueAt: '2026-10-01T00:00:00Z',
    overdue: false,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <PrivacyRequestsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('PrivacyRequestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({
      requests: [request()],
      openCount: 1,
      overdueCount: 0,
      pageLimit: 500,
      responseWindowDays: 30,
    });
    mockResolve.mockResolvedValue(undefined);
  });

  it('shows the queue with the member and the deadline', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('privacy-row-req-1')).toBeInTheDocument());
    // The default is the live queue, not everything.
    expect(mockList).toHaveBeenCalledWith('open');
    expect(screen.getByText(/somchai@example.com/)).toBeInTheDocument();
  });

  it('asks before erasing, and does not resolve until confirmed', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('privacy-row-req-1')).toBeInTheDocument());

    const noteBox = screen.getByLabelText('privacy.adminResolutionNote');
    await user.type(noteBox, 'Erased on request');
    await user.click(screen.getByTestId('privacy-done-req-1'));

    // The dialog is open and nothing has been sent.
    expect(mockResolve).not.toHaveBeenCalled();
    expect(screen.getByText('privacy.adminErasureConfirmTitle')).toBeInTheDocument();
    // It names the account, so an admin cannot confirm the wrong row blind.
    expect(
      screen.getByText('privacy.adminErasureConfirmBody:somchai@example.com'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'privacy.adminErasureConfirmOk' }));

    await waitFor(() =>
      expect(mockResolve).toHaveBeenCalledWith('req-1', 'done', 'Erased on request'),
    );
  });

  it('cancelling the dialog erases nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('privacy-row-req-1')).toBeInTheDocument());

    await user.type(screen.getByLabelText('privacy.adminResolutionNote'), 'oops');
    await user.click(screen.getByTestId('privacy-done-req-1'));
    await user.click(screen.getByRole('button', { name: 'privacy.cancel' }));

    expect(mockResolve).not.toHaveBeenCalled();
    expect(screen.queryByText('privacy.adminErasureConfirmTitle')).toBeNull();
  });

  it('resolves a non-destructive request in one click', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      requests: [request({ id: 'req-2', kind: 'rectification' })],
      openCount: 1,
      overdueCount: 0,
      pageLimit: 500,
      responseWindowDays: 30,
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('privacy-row-req-2')).toBeInTheDocument());

    await user.type(screen.getByLabelText('privacy.adminResolutionNote'), 'Surname corrected');
    await user.click(screen.getByTestId('privacy-done-req-2'));

    await waitFor(() =>
      expect(mockResolve).toHaveBeenCalledWith('req-2', 'done', 'Surname corrected'),
    );
    expect(screen.queryByText('privacy.adminErasureConfirmTitle')).toBeNull();
  });

  it('will not close a request without a resolution note', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('privacy-row-req-1')).toBeInTheDocument());
    // The backend refuses a terminal status with no note; the form does too,
    // so the admin is not told "no" only after pressing.
    expect(screen.getByTestId('privacy-done-req-1')).toBeDisabled();
  });

  it('offers the export only on an access request', async () => {
    mockList.mockResolvedValue({
      requests: [request({ id: 'req-3', kind: 'access' }), request({ id: 'req-4' })],
      openCount: 2,
      overdueCount: 0,
      pageLimit: 500,
      responseWindowDays: 30,
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('privacy-row-req-3')).toBeInTheDocument());

    expect(screen.getByTestId('privacy-export-req-3')).toBeInTheDocument();
    expect(screen.queryByTestId('privacy-export-req-4')).toBeNull();
  });
});
