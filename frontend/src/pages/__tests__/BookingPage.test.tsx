import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * BookingPage tests — channel booking flow (ADR-0003).
 *
 * The page is a booking channel into the PMS:
 *   1. Availability is fetched per property from the channel endpoint.
 *   2. Confirming creates the booking with guest details + payment option
 *      (50% deposit or full) in one call, per the locked contract in
 *      docs/launch-plan.md.
 *   3. The per-property PromptPay QR is rendered from the
 *      `promptpay_qr_payload` in the response (no hardcoded account).
 *   4. Slip upload calls `bookingService.uploadSlip` then `addSlip`.
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

const mockGetAvailability = vi.fn();
const mockCreateChannelBooking = vi.fn();
const mockUploadSlip = vi.fn();
const mockAddSlip = vi.fn();
const mockQrToDataURL = vi.fn();

vi.mock('../../services/channelBookingService', () => ({
  channelBookingService: {
    getAvailability: (...args: unknown[]) => mockGetAvailability(...args),
    createBooking: (...args: unknown[]) => mockCreateChannelBooking(...args),
  },
}));

vi.mock('../../services/bookingService', () => ({
  bookingService: {
    uploadSlip: (...args: unknown[]) => mockUploadSlip(...args),
    addSlip: (...args: unknown[]) => mockAddSlip(...args),
  },
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: (...args: unknown[]) => mockQrToDataURL(...args),
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
      if (opts && typeof opts === 'object' && 'count' in opts) {
        return `${key}:${opts.count as number}`;
      }
      return key;
    },
    // `PmsOutageNotice` renders Thai-first through `getFixedT`. The shipped
    // Thai and English copy is asserted against the real bundles in that
    // component's own test; here the language-tagged key is enough to prove
    // the page chose the right line.
    i18n: {
      getFixedT: (lng: string) => (key: string) => `${lng}:${key}`,
    },
  }),
}));

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: {
        id: 'user-1',
        firstName: 'Test',
        lastName: 'Guest',
        phone: '0812345678',
      },
    }),
}));

vi.mock('../../components/layout/AppShell', () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

// Import the component AFTER all mocks are registered.
import BookingPage from '../BookingPage';
import { ApiError } from '../../utils/axiosInterceptor';

// ============================================================================
// Test helpers
// ============================================================================

const SAMPLE_ROOM_TYPE = {
  room_type_id: 'room-type-1',
  name: 'Deluxe Room',
  description: 'A nice room',
  photo_url: null,
  nightly_price: 1000,
  available_count: 5,
};

const SAMPLE_AVAILABILITY = {
  property: 'hf',
  check_in: '2030-01-01',
  check_out: '2030-01-03',
  room_types: [SAMPLE_ROOM_TYPE],
};

const SAMPLE_BOOKING = {
  booking_id: 'booking-123',
  pms_booking_id: 'PMS-9',
  total_amount: 2000,
  amount_due_now: 1000,
  balance_due_at_checkin: 1000,
  promptpay_qr_payload: '00020101021129370016A000000677010111PAYLOAD',
  // Far-future hold so the countdown never hits zero mid-test.
  hold_expires_at: '2099-01-01T00:00:00Z',
};

/**
 * Drive the UI from step 1 (property + dates) to the payment screen.
 */
async function advanceToPaymentStep(user: ReturnType<typeof userEvent.setup>) {
  // Step 1: property + two-night dates. `userEvent.type` is unreliable on
  // <input type="date"> in jsdom, so drive the value with fireEvent.change.
  await user.click(screen.getByTestId('property-hf'));
  fireEvent.change(screen.getByTestId('check-in-date'), { target: { value: '2030-01-01' } });
  fireEvent.change(screen.getByTestId('check-out-date'), { target: { value: '2030-01-03' } });
  await user.click(screen.getByTestId('continue-to-rooms'));

  // Step 2: pick the only available room type.
  await waitFor(() => {
    expect(screen.getByTestId(`room-type-${SAMPLE_ROOM_TYPE.room_type_id}`)).toBeInTheDocument();
  });
  await user.click(screen.getByTestId(`room-type-${SAMPLE_ROOM_TYPE.room_type_id}`));

  // Step 3: guest details are prefilled from the auth store; confirm.
  await waitFor(() => {
    expect(screen.getByTestId('confirm-booking')).toBeInTheDocument();
  });
  await user.click(screen.getByTestId('confirm-booking'));

  // Step 4 (payment) should now be visible.
  await waitFor(() => {
    expect(screen.getAllByText('payment.title').length).toBeGreaterThan(0);
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('BookingPage — channel flow (property → rooms → confirm → payment)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAvailability.mockResolvedValue(SAMPLE_AVAILABILITY);
    mockCreateChannelBooking.mockResolvedValue(SAMPLE_BOOKING);
    mockUploadSlip.mockResolvedValue({ url: '/storage/slips/abc.png' });
    mockAddSlip.mockResolvedValue(undefined);
    mockQrToDataURL.mockResolvedValue('data:image/png;base64,MOCKQR');
  });

  it('fetches availability with the locked contract params', async () => {
    const user = userEvent.setup();
    render(<BookingPage />, { wrapper });

    await user.click(screen.getByTestId('property-hf'));
    fireEvent.change(screen.getByTestId('check-in-date'), { target: { value: '2030-01-01' } });
    fireEvent.change(screen.getByTestId('check-out-date'), { target: { value: '2030-01-03' } });
    await user.click(screen.getByTestId('continue-to-rooms'));

    await waitFor(() => {
      expect(mockGetAvailability).toHaveBeenCalledWith('hf', '2030-01-01', '2030-01-03', 1);
    });
  });

  it('creates the booking with property, guest details, and default deposit50', async () => {
    const user = userEvent.setup();
    render(<BookingPage />, { wrapper });

    await advanceToPaymentStep(user);

    expect(mockCreateChannelBooking).toHaveBeenCalledWith({
      property: 'hf',
      room_type_id: 'room-type-1',
      check_in: '2030-01-01',
      check_out: '2030-01-03',
      guests: 1,
      guest_name: 'Test Guest',
      guest_phone: '0812345678',
      payment_option: 'deposit50',
    });
  });

  it('sends payment_option "full" when the guest chooses to pay in full', async () => {
    const user = userEvent.setup();
    render(<BookingPage />, { wrapper });

    await user.click(screen.getByTestId('property-hf'));
    fireEvent.change(screen.getByTestId('check-in-date'), { target: { value: '2030-01-01' } });
    fireEvent.change(screen.getByTestId('check-out-date'), { target: { value: '2030-01-03' } });
    await user.click(screen.getByTestId('continue-to-rooms'));

    await waitFor(() => {
      expect(screen.getByTestId(`room-type-${SAMPLE_ROOM_TYPE.room_type_id}`)).toBeInTheDocument();
    });
    await user.click(screen.getByTestId(`room-type-${SAMPLE_ROOM_TYPE.room_type_id}`));

    // Switch the payment option radio to "full" before confirming.
    await waitFor(() => {
      expect(screen.getByTestId('confirm-booking')).toBeInTheDocument();
    });
    const radios = screen.getAllByRole('radio');
    const fullRadio = radios.find((r) => r.getAttribute('value') === 'full');
    expect(fullRadio).toBeDefined();
    await user.click(fullRadio!);
    await user.click(screen.getByTestId('confirm-booking'));

    await waitFor(() => {
      expect(mockCreateChannelBooking).toHaveBeenCalled();
    });
    expect(mockCreateChannelBooking.mock.calls[0]?.[0]).toMatchObject({
      payment_option: 'full',
    });
  });

  it('renders the PromptPay QR from the response payload and shows amounts + hold countdown', async () => {
    const user = userEvent.setup();
    render(<BookingPage />, { wrapper });

    await advanceToPaymentStep(user);

    // QR is generated from the per-property payload — never a bundled image.
    await waitFor(() => {
      expect(mockQrToDataURL).toHaveBeenCalledWith(
        SAMPLE_BOOKING.promptpay_qr_payload,
        expect.any(Object),
      );
    });
    await waitFor(() => {
      const qr = screen.getByTestId('promptpay-qr') as HTMLImageElement;
      expect(qr.src).toContain('data:image/png');
    });

    // Deposit summary: amount due now + balance due at check-in.
    expect(screen.getByTestId('amount-due-now')).toHaveTextContent('1,000');
    expect(screen.getByTestId('balance-due')).toHaveTextContent('1,000');

    // Hold countdown is visible while payment is pending.
    expect(screen.getByTestId('hold-countdown')).toBeInTheDocument();
  });

  it('calls uploadSlip then addSlip with the channel booking id', async () => {
    const user = userEvent.setup();
    render(<BookingPage />, { wrapper });

    await advanceToPaymentStep(user);

    await waitFor(() => {
      expect(screen.getByTestId('slip-input')).toBeInTheDocument();
    });

    const slipFile = new File(['fake-png-bytes'], 'slip.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('slip-input') as HTMLInputElement, slipFile);

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

  it('surfaces an error toast when the slip upload fails', async () => {
    const user = userEvent.setup();
    mockUploadSlip.mockRejectedValue(new Error('network'));
    render(<BookingPage />, { wrapper });

    await advanceToPaymentStep(user);

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

  // ==========================================================================
  // A17 — the PMS-outage path
  // ==========================================================================

  /**
   * Walk to the confirm step and press the button, without asserting that
   * anything succeeded — the outage cases deliberately do not reach step 4.
   */
  async function confirmBooking(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId('property-hf'));
    fireEvent.change(screen.getByTestId('check-in-date'), { target: { value: '2030-01-01' } });
    fireEvent.change(screen.getByTestId('check-out-date'), { target: { value: '2030-01-03' } });
    await user.click(screen.getByTestId('continue-to-rooms'));

    await waitFor(() => {
      expect(screen.getByTestId(`room-type-${SAMPLE_ROOM_TYPE.room_type_id}`)).toBeInTheDocument();
    });
    await user.click(screen.getByTestId(`room-type-${SAMPLE_ROOM_TYPE.room_type_id}`));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-booking')).toBeInTheDocument();
    });
    await act(async () => {
      await user.click(screen.getByTestId('confirm-booking'));
    });
  }

  /**
   * The hold create fails closed, so a guest whose booking hit a PMS outage
   * has no room — and one useful next step, which is to phone the desk.
   * Before A17 they got a toast reading `external_service_unavailable`.
   */
  it('shows the desk-contact notice when the booking system cannot be reached', async () => {
    const user = userEvent.setup();
    mockCreateChannelBooking.mockRejectedValue(
      new ApiError('PMS is temporarily unavailable', 'external_service_unavailable', 503),
    );
    render(<BookingPage />, { wrapper });

    await confirmBooking(user);

    await waitFor(() => {
      expect(screen.getByTestId('pms-outage-notice')).toBeInTheDocument();
    });
    // No toast at all on this path: the guest needs the number to stay on
    // screen while they go and find their phone.
    expect(mockToastError).not.toHaveBeenCalled();
    // And the machine key never reaches the page.
    expect(document.body.textContent).not.toContain('external_service_unavailable');
  });

  it('treats a timed-out request with no response as an outage too', async () => {
    const user = userEvent.setup();
    mockCreateChannelBooking.mockRejectedValue(new ApiError('Network Error'));
    render(<BookingPage />, { wrapper });

    await confirmBooking(user);

    await waitFor(() => {
      expect(screen.getByTestId('pms-outage-notice')).toBeInTheDocument();
    });
  });

  /**
   * The other direction, which matters just as much: an answer the PMS
   * actually gave is not an outage, and routing it to "phone reception"
   * would send guests to the desk over a date they can fix themselves.
   */
  it('still toasts an ordinary refusal instead of sending the guest to the desk', async () => {
    const user = userEvent.setup();
    mockCreateChannelBooking.mockRejectedValue(
      new ApiError('No rooms of that type are available', 'bad_request', 400),
    );
    render(<BookingPage />, { wrapper });

    await confirmBooking(user);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('No rooms of that type are available');
    });
    expect(screen.queryByTestId('pms-outage-notice')).not.toBeInTheDocument();
  });

  it('clears the outage notice once a retry succeeds', async () => {
    const user = userEvent.setup();
    mockCreateChannelBooking.mockRejectedValueOnce(
      new ApiError('PMS is temporarily unavailable', 'external_service_unavailable', 503),
    );
    render(<BookingPage />, { wrapper });

    await confirmBooking(user);
    await waitFor(() => {
      expect(screen.getByTestId('pms-outage-notice')).toBeInTheDocument();
    });

    mockCreateChannelBooking.mockResolvedValue(SAMPLE_BOOKING);
    await act(async () => {
      await user.click(screen.getByTestId('confirm-booking'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('pms-outage-notice')).not.toBeInTheDocument();
    });
  });
});
