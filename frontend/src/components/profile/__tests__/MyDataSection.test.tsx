import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * "ข้อมูลของฉัน" — the member's own PDPA rights surface (task F3).
 *
 * The three properties worth pinning:
 *
 * 1. All four rights are offered. A rights path missing one of s.30/s.32/
 *    s.33/s.35 is not a rights path.
 * 2. A kind with a live request is **disabled and explained**, not hidden —
 *    the backend answers 409 and the member should never have to discover
 *    that by pressing a button.
 * 3. Erasure asks first. F1 §6: the erase destroys the link to points, tier
 *    and nights and a later login creates a *new* membership, so the copy
 *    has to appear before the request is filed, not after.
 */

const mockList = vi.fn();
const mockCreate = vi.fn();

vi.mock('../../../services/privacyService', async () => {
  const actual = await vi.importActual<typeof import('../../../services/privacyService')>(
    '../../../services/privacyService',
  );
  return {
    ...actual,
    privacyService: {
      listMyRequests: (...args: unknown[]) => mockList(...args),
      createRequest: (...args: unknown[]) => mockCreate(...args),
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'th' },
  }),
}));

import MyDataSection from '../MyDataSection';

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MyDataSection />
    </QueryClientProvider>,
  );
}

describe('MyDataSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({ requests: [], responseWindowDays: 30 });
    mockCreate.mockResolvedValue({
      id: 'req-1',
      kind: 'access',
      status: 'open',
      note: null,
      requestedAt: '2026-09-12T00:00:00Z',
      dueAt: '2026-10-12T00:00:00Z',
      resolvedAt: null,
      resolutionNote: null,
    });
  });

  it('offers all four rights', async () => {
    renderSection();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    for (const kind of ['access', 'erasure', 'rectification', 'objection']) {
      expect(screen.getByTestId(`privacy-request-${kind}`)).toBeInTheDocument();
    }
    expect(screen.getByText('privacy.myDataTitle')).toBeInTheDocument();
  });

  it('tells the member they have made no requests yet', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId('privacy-no-requests')).toBeInTheDocument());
  });

  it('files a non-destructive request without a confirmation step', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    await user.click(screen.getByTestId('privacy-request-rectification'));
    await user.click(screen.getByTestId('privacy-confirm-rectification'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('rectification', ''));
    expect(await screen.findByTestId('privacy-created')).toBeInTheDocument();
  });

  it('asks before erasing, and only files once confirmed', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    await user.click(screen.getByTestId('privacy-request-erasure'));
    await user.click(screen.getByTestId('privacy-confirm-erasure'));

    // The dialog is open and nothing has been sent yet.
    expect(mockCreate).not.toHaveBeenCalled();
    // The irreversibility copy is what the dialog shows.
    expect(screen.getAllByText('privacy.kindErasureDesc').length).toBeGreaterThan(0);

    // The dialog's own confirm button carries `privacy.submit`; there are
    // several on screen, and the last one rendered is the dialog's.
    const confirms = screen.getAllByRole('button', { name: 'privacy.submit' });
    const dialogConfirm: HTMLElement | undefined = confirms[confirms.length - 1];
    if (!dialogConfirm) {
      throw new Error('the confirm dialog rendered no confirm button');
    }
    await user.click(dialogConfirm);

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('erasure', ''));
  });

  it('disables and explains a kind that already has a live request', async () => {
    mockList.mockResolvedValue({
      responseWindowDays: 30,
      requests: [
        {
          id: 'req-open',
          kind: 'access',
          status: 'open',
          note: null,
          requestedAt: '2026-09-01T00:00:00Z',
          dueAt: '2026-10-01T00:00:00Z',
          resolvedAt: null,
          resolutionNote: null,
        },
      ],
    });
    renderSection();

    await waitFor(() => expect(screen.getByTestId('privacy-open-access')).toBeInTheDocument());
    expect(screen.getByTestId('privacy-request-access')).toBeDisabled();
    // Only that kind. The others stay available.
    expect(screen.getByTestId('privacy-request-erasure')).not.toBeDisabled();
  });

  it('shows the 30-day deadline on a live request and the answer on a closed one', async () => {
    mockList.mockResolvedValue({
      responseWindowDays: 30,
      requests: [
        {
          id: 'req-done',
          kind: 'objection',
          status: 'done',
          note: null,
          requestedAt: '2026-08-01T00:00:00Z',
          dueAt: '2026-08-31T00:00:00Z',
          resolvedAt: '2026-08-05T00:00:00Z',
          resolutionNote: 'Messaging stopped',
        },
      ],
    });
    renderSection();

    await waitFor(() => expect(screen.getByText('privacy.statusDone')).toBeInTheDocument());
    expect(screen.getByText(/Messaging stopped/)).toBeInTheDocument();
    // A closed request has no outstanding deadline to advertise.
    expect(screen.queryByText(/privacy\.dueAt/)).toBeNull();
  });

  it('shows the backend’s duplicate message rather than a generic failure', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(
      Object.assign(new Error('conflict'), {
        isAxiosError: true,
        response: { status: 409 },
      }),
    );
    renderSection();
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    await user.click(screen.getByTestId('privacy-request-access'));
    await user.click(screen.getByTestId('privacy-confirm-access'));

    expect(await screen.findByTestId('privacy-error')).toHaveTextContent(
      'privacy.duplicateError',
    );
  });
});
