import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * BookingPage tests
 *
 * These tests focus on the Step 4 (Payment) flow that was wired in
 * `feat/promptpay-slip-flow`:
 *   1. PromptPay QR is fetched dynamically once the user confirms a payment
 *      type (deposit vs. full).
 *   2. Slip upload calls `bookingService.uploadSlip` followed by
 *      `bookingService.addSlip`.
 *   3. Failure paths surface a toast and mark the slip status as failed.
 *
 * To keep the suite focused (and fast), we render BookingPage with
 * in-memory state advanced past steps 1–3 by driving the existing UI
 * controls; the room-availability and booking creation services are mocked
 * out to avoid touching the network.
 */

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = createTestQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// ============================================================================
// Service mocks
// ============================================================================

const mockCheckAvailability = vi.fn();
const mockCreateBooking = vi.fn();
const mockUploadSlip = vi.fn();
const mockAddSlip = vi.fn();
const mockGetPromptPayQr = vi.fn();

vi.mock('../../services/bookingService', () => ({
  bookingService: {
    checkAvailability: (...args: unknown[]) => mockCheckAvailability(...args),
    createBooking: (...args: unknown[]) => mockCreateBooking(...args),
    uploadSlip: (...args: unknown[]) => mockUploadSlip(...args),
    addSlip: (...args: unknown[]) => mockAddSlip(...args),
  },
}));

vi.mock('../../services/paymentService', () => ({
  paymentService: {
    getPromptPayQr: (...args: unknown[]) => mockGetPromptPayQr(...args),
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Return the key (or a key:count stub) so the tests assert on
      // structural elements / test-ids rather than translated strings.
      if (opts && typeof opts === 'object' && 'count' in opts) {
        return `${key}:${opts.count as number}`;
      }
      return key;
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../components/layout/MainLayout', () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

// Stub the asset imports so vite/vitest doesn't choke in jsdom.
vi.mock('../../assets/company-promptpay-qr.png', () => ({ default: 'company-qr.png' }));
vi.mock('../../assets/kbank-logo.png', () => ({ default: 'kbank-logo.png' }));

// Import the component AFTER all mocks are registered.
import BookingPage from '../BookingPage';

// ============================================================================
// Test helpers
// ============================================================================

const SAMPLE_ROOM_TYPE = {
  id: 'room-type-1',
  name: 'Deluxe Room',
  description: 'A nice room',
  pricePerNight: 1000,
  maxGuests: 2,
  bedType: 'king',
  amenities: ['wifi'],
  images: [],
  availableRooms: 5,
};

/**
 * Drive the BookingPage UI from step 1 through to the payment screen so
 * each test starts from a known good state with a created booking.
 */
async function advanceToPaymentStep(user: ReturnType<typeof userEvent.setup>) {
  // Step 1: pick dates two nights apart. `userEvent.type` is unreliable on
  // <input type="date"> in jsdom, so drive the value with fireEvent.change.
  const checkIn = '2030-01-01';
  const checkOut = '2030-01-03';
  fireEvent.change(screen.getByTestId('check-in-date'), { target: { value: checkIn } });
  fireEvent.change(screen.getByTestId('check-out-date'), { target: { value: checkOut } });
  await user.click(screen.getByTestId('continue-to-rooms'));

  // Step 2: pick the only available room type.
  await waitFor(() => {
    expect(screen.getByTestId(`room-type-${SAMPLE_ROOM_TYPE.id}`)).toBeInTheDocument();
  });
  await user.click(screen.getByTestId(`room-type-${SAMPLE_ROOM_TYPE.id}`));

  // Step 3: confirm the booking.
  await waitFor(() => {
    expect(screen.getByTestId('confirm-booking')).toBeInTheDocument();
  });
  await user.click(screen.getByTestId('confirm-booking'));

  // Step 4 should now be visible (payment).
  // 'payment.title' appears in both the stepper and the section heading;
  // assert ANY occurrence is rendered rather than requiring a unique match.
  await waitFor(() => {
    expect(screen.getAllByText('payment.title').length).toBeGreaterThan(0);
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('BookingPage — payment step (PromptPay QR + slip upload)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckAvailability.mockResolvedValue([SAMPLE_ROOM_TYPE]);
    mockCreateBooking.mockResolvedValue({
      id: 'booking-123',
      totalPrice: 2000,
    });
    mockUploadSlip.mockResolvedValue({ url: '/storage/slips/abc.png' });
    mockAddSlip.mockResolvedValue(undefined);
    mockGetPromptPayQr.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      amount: 1000,
      currency: 'THB',
    });
  });

  it('should fetch the PromptPay QR for the deposit amount once payment type is confirmed', async () => {
    const user = userEvent.setup();
    render(<BookingPage />, { wrapper });

    await advanceToPaymentStep(user);

    // QR should NOT be requested before the user confirms payment type.
    expect(mockGetPromptPayQr).not.toHaveBeenCalled();

    // Confirm the (default-selected) deposit payment type.
    await user.click(screen.getByText('payment.confirmPaymentType'));

    // Total price is 2000, deposit is 50% = 1000.
    await waitFor(() => {
      expect(mockGetPromptPayQr).toHaveBeenCalledWith(1000, 'booking-123');
    });

    // The dynamically-generated SVG should be rendered as a data URL <img>.
    await waitFor(() => {
      const qr = screen.getByTestId('promptpay-qr') as HTMLImageElement;
      expect(qr.src).toContain('data:image/svg+xml');
    });
  });

  it('should re-fetch the QR when the user switches from deposit to pay-in-full', async () => {
    const user = userEvent.setup();
    render(<BookingPage />, { wrapper });

    await advanceToPaymentStep(user);

    // Switch to "Pay in Full" (the radio whose value attribute is "full"),
    // then confirm.
    const radios = screen.getAllByRole('radio');
    const fullRadio = radios.find((r) => r.getAttribute('value') === 'full');
    expect(fullRadio).toBeDefined();
    await user.click(fullRadio!);
    await user.click(screen.getByText('payment.confirmPaymentType'));

    // Pay-in-full of total 2000 should request 2000 (not 1000).
    await waitFor(() => {
      expect(mockGetPromptPayQr).toHaveBeenCalledWith(2000, 'booking-123');
    });
  });

  it('should fall back to the bundled QR image when the dynamic generator fails', async () => {
    const user = userEvent.setup();
    mockGetPromptPayQr.mockRejectedValue(new Error('Tax ID not configured'));
    render(<BookingPage />, { wrapper });

    await advanceToPaymentStep(user);
    await user.click(screen.getByText('payment.confirmPaymentType'));

    // useQuery has retry: 1, so the error state lands after the second
    // failed fetch. Bump timeout from 1s default to 4s to cover that.
    await waitFor(
      () => {
        expect(screen.getByTestId('qr-error')).toBeInTheDocument();
      },
      { timeout: 4000 },
    );

    const qr = screen.getByTestId('promptpay-qr') as HTMLImageElement;
    expect(qr.src).toContain('company-qr.png');
  });

  it('should call uploadSlip then addSlip when the user submits a payment slip', async () => {
    const user = userEvent.setup();
    render(<BookingPage />, { wrapper });

    await advanceToPaymentStep(user);
    await user.click(screen.getByText('payment.confirmPaymentType'));

    // Wait for the slip dropzone (only visible after payment type confirmed).
    await waitFor(() => {
      expect(screen.getByTestId('slip-input')).toBeInTheDocument();
    });

    // Upload a tiny PNG file.
    const slipFile = new File(['fake-png-bytes'], 'slip.png', { type: 'image/png' });
    const input = screen.getByTestId('slip-input') as HTMLInputElement;
    await user.upload(input, slipFile);

    // Submit the slip.
    await waitFor(() => {
      expect(screen.getByTestId('submit-slip')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('submit-slip'));

    await waitFor(() => {
      expect(mockUploadSlip).toHaveBeenCalledTimes(1);
    });
    expect(mockUploadSlip).toHaveBeenCalledWith(slipFile);
    expect(mockAddSlip).toHaveBeenCalledWith('booking-123', '/storage/slips/abc.png');
    expect(mockToastSuccess).toHaveBeenCalledWith('payment.slipUploaded');
  });

  it('should surface an error toast when the slip upload fails', async () => {
    const user = userEvent.setup();
    mockUploadSlip.mockRejectedValue(new Error('network'));
    render(<BookingPage />, { wrapper });

    await advanceToPaymentStep(user);
    await user.click(screen.getByText('payment.confirmPaymentType'));

    await waitFor(() => {
      expect(screen.getByTestId('slip-input')).toBeInTheDocument();
    });

    const slipFile = new File(['fake'], 'slip.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('slip-input') as HTMLInputElement, slipFile);

    await waitFor(() => {
      expect(screen.getByTestId('submit-slip')).toBeInTheDocument();
    });
    await act(async () => {
      await user.click(screen.getByTestId('submit-slip'));
    });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('payment.uploadError');
    });
    // addSlip must NOT be called when uploadSlip itself fails.
    expect(mockAddSlip).not.toHaveBeenCalled();
  });
});
