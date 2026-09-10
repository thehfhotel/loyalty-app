import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// The real i18n bundles: the modal's labels are what reception reads.
import '../../../i18n/config';

const mockCreateLink = vi.fn();
const mockListRoomTypes = vi.fn();

vi.mock('../../../services/depositLinkService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../services/depositLinkService')>();
  return {
    ...actual,
    depositLinkService: {
      createLink: (...args: unknown[]) => mockCreateLink(...args),
      listRoomTypes: (...args: unknown[]) => mockListRoomTypes(...args),
    },
  };
});

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import DepositLinkModal from '../DepositLinkModal';

const GUEST_URL = `https://loyalty.saichon.com/d/${'a'.repeat(43)}`;

const ISSUED = {
  linkId: 'link-1',
  bookingId: 'booking-1',
  token: 'a'.repeat(43),
  url: GUEST_URL,
  lineShareUrl: `https://line.me/R/share?text=${encodeURIComponent(GUEST_URL)}`,
  totalAmount: 4000,
  amountDueNow: 2000,
  expiresAt: '2026-10-01T05:00:00.000Z',
};

function renderWithClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

/**
 * `fireEvent.change` rather than `userEvent.type` throughout: these are
 * `number` and `date` inputs, and typing them a character at a time goes
 * through intermediate values ("2345.") that the DOM sanitises away.
 */
function setValue(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
}

// Queried by test id, not by label: the app's default language is Thai, so
// label text would make these assertions a translation test by accident.
async function fillRequiredFields() {
  setValue(screen.getByTestId('deposit-link-property'), 'hfville');
  setValue(screen.getByTestId('deposit-link-guest-name'), 'Somchai');
  setValue(screen.getByTestId('deposit-link-guest-phone'), '0812345678');
  setValue(screen.getByTestId('deposit-link-check-in'), '2026-10-01');
  setValue(screen.getByTestId('deposit-link-check-out'), '2026-10-03');
  await waitFor(() => expect(screen.getByRole('option', { name: 'Deluxe' })).toBeInTheDocument());
  setValue(screen.getByTestId('deposit-link-room-type'), 'rt-1');
}

describe('DepositLinkModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRoomTypes.mockResolvedValue([{ id: 'rt-1', name: 'Deluxe' }]);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('pre-fills the deposit with 50% of the total, rounded half up to two decimals', () => {
    renderWithClient(<DepositLinkModal open onClose={vi.fn()} />);

    setValue(screen.getByTestId('deposit-link-total'), '4000');
    expect(screen.getByTestId('deposit-link-amount')).toHaveValue(2000);

    setValue(screen.getByTestId('deposit-link-total'), '2345.67');
    expect(screen.getByTestId('deposit-link-amount')).toHaveValue(1172.84);
  });

  it('keeps an overridden deposit when the total changes afterwards', () => {
    renderWithClient(<DepositLinkModal open onClose={vi.fn()} />);

    setValue(screen.getByTestId('deposit-link-total'), '4000');
    setValue(screen.getByTestId('deposit-link-amount'), '1500');
    setValue(screen.getByTestId('deposit-link-total'), '6000');

    expect(screen.getByTestId('deposit-link-amount')).toHaveValue(1500);
  });

  it('refuses a deposit above the booking total without calling the API', async () => {
    renderWithClient(<DepositLinkModal open onClose={vi.fn()} />);

    await fillRequiredFields();
    setValue(screen.getByTestId('deposit-link-total'), '4000');
    setValue(screen.getByTestId('deposit-link-amount'), '5000');

    fireEvent.click(screen.getByTestId('deposit-link-submit'));

    expect(screen.getByTestId('deposit-link-error')).toBeInTheDocument();
    expect(mockCreateLink).not.toHaveBeenCalled();
  });

  it('sends the overridden deposit and the chosen expiry to the locked endpoint', async () => {
    mockCreateLink.mockResolvedValue(ISSUED);
    renderWithClient(<DepositLinkModal open onClose={vi.fn()} />);

    await fillRequiredFields();
    setValue(screen.getByTestId('deposit-link-total'), '4000');
    setValue(screen.getByTestId('deposit-link-amount'), '1500');
    setValue(screen.getByTestId('deposit-link-expiry'), '72');

    fireEvent.click(screen.getByTestId('deposit-link-submit'));

    await waitFor(() => expect(mockCreateLink).toHaveBeenCalledTimes(1));
    expect(mockCreateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        property: 'hfville',
        guestName: 'Somchai',
        guestPhone: '0812345678',
        checkIn: '2026-10-01',
        checkOut: '2026-10-03',
        guests: 1,
        roomTypeId: 'rt-1',
        totalPrice: 4000,
        amountDueNow: 1500,
        expiresInHours: 72,
      }),
    );
  });

  it('shows the token once, with a copy button and a LINE share link', async () => {
    mockCreateLink.mockResolvedValue(ISSUED);
    renderWithClient(<DepositLinkModal open onClose={vi.fn()} />);

    await fillRequiredFields();
    setValue(screen.getByTestId('deposit-link-total'), '4000');
    fireEvent.click(screen.getByTestId('deposit-link-submit'));

    await waitFor(() => expect(screen.getByTestId('issued-deposit-link')).toBeInTheDocument());
    expect(screen.getByTestId('issued-deposit-link-url')).toHaveTextContent(GUEST_URL);
    // The form is gone with it: the token is shown exactly once, and losing
    // it means Reissue rather than a second look.
    expect(screen.queryByTestId('deposit-link-total')).not.toBeInTheDocument();

    const share = screen.getByTestId('share-deposit-link-line');
    expect(share).toHaveAttribute('href', expect.stringContaining('line.me/R/share'));
    expect(share).toHaveAttribute('href', expect.stringContaining(encodeURIComponent(GUEST_URL)));

    fireEvent.click(screen.getByTestId('copy-deposit-link'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(GUEST_URL));
  });
});
