import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

// Mock booking data
const mockBookings = [
  {
    id: 'booking-1',
    roomTypeName: 'Deluxe Room',
    checkInDate: '2027-06-15',
    checkOutDate: '2027-06-18',
    numGuests: 2,
    totalPrice: 4500,
    pointsEarned: 450,
    status: 'confirmed',
    notes: 'Early check-in requested',
    cancellationReason: null,
    createdAt: '2027-05-01',
  },
  {
    id: 'booking-2',
    roomTypeName: 'Standard Room',
    checkInDate: '2025-12-10',
    checkOutDate: '2025-12-12',
    numGuests: 1,
    totalPrice: 2000,
    pointsEarned: 200,
    status: 'completed',
    notes: null,
    cancellationReason: null,
    createdAt: '2025-12-01',
  },
  {
    id: 'booking-3',
    roomTypeName: 'Suite',
    checkInDate: '2025-11-20',
    checkOutDate: '2025-11-22',
    numGuests: 2,
    totalPrice: 6000,
    pointsEarned: 600,
    status: 'cancelled',
    notes: 'High floor preferred',
    cancellationReason: 'Change of plans',
    cancelledByAdmin: false,
    createdAt: '2025-11-15',
  },
  {
    id: 'booking-5',
    roomTypeName: 'Presidential Suite',
    checkInDate: '2025-10-15',
    checkOutDate: '2025-10-18',
    numGuests: 2,
    totalPrice: 15000,
    pointsEarned: 1500,
    status: 'cancelled',
    notes: 'VIP guest',
    cancellationReason: 'Policy violation - no show',
    cancelledByAdmin: true,
    createdAt: '2025-10-10',
  },
  {
    id: 'booking-4',
    roomTypeName: 'Executive Room',
    checkInDate: '2025-12-01',
    checkOutDate: '2025-12-03',
    numGuests: 1,
    totalPrice: 3500,
    pointsEarned: 350,
    status: 'confirmed',
    notes: null,
    cancellationReason: null,
    createdAt: '2025-11-20',
  },
];

// Mock bookingService
const mockGetMyBookings = vi.fn();
const mockCancelBooking = vi.fn();
const mockAddSlip = vi.fn();
const mockRemoveSlip = vi.fn();
const mockUploadSlip = vi.fn();
let mockBookingsData: typeof mockBookings | undefined = mockBookings;

vi.mock('../../services/bookingService', () => ({
  bookingService: {
    getMyBookings: (...args: unknown[]) => mockGetMyBookings(...args),
    cancelBooking: (...args: unknown[]) => mockCancelBooking(...args),
    addSlip: (...args: unknown[]) => mockAddSlip(...args),
    removeSlip: (...args: unknown[]) => mockRemoveSlip(...args),
    uploadSlip: (...args: unknown[]) => mockUploadSlip(...args),
  },
}));

// Mock toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'booking.myBookings': 'My Bookings',
        'booking.bookRoom': 'Book Room',
        'booking.noBookings': 'No Bookings Yet',
        'booking.noBookingsDescription': 'You have no bookings yet',
        'booking.bookYourFirstRoom': 'Book Your First Room',
        'booking.checkIn': 'Check-in',
        'booking.checkOut': 'Check-out',
        'booking.guests': 'guests',
        'booking.guest': 'guest',
        'booking.nights': 'nights',
        'booking.night': 'night',
        'booking.totalPrice': 'Total',
        'booking.pointsEarned': 'Points earned',
        'booking.notes': 'Notes',
        'booking.cancellationReason': 'Cancellation reason',
        'booking.bookedOn': 'Booked on',
        'booking.clickForDetails': 'Click for details',
        'booking.cancelBooking': 'Cancel Booking',
        'booking.cancelBookingTitle': 'Cancel Booking',
        'booking.cancelBookingConfirm': 'Are you sure?',
        'booking.cancelReason': 'Reason',
        'booking.cancelReasonPlaceholder': 'Enter reason',
        'booking.cancelWarning': 'Points will be deducted',
        'booking.confirmCancel': 'Confirm Cancel',
        'booking.pointsDeducted': 'deducted',
        'booking.status.confirmed': 'Confirmed',
        'booking.status.cancelled': 'Cancelled',
        'booking.status.cancelledByAdmin': 'Cancelled by Admin',
        'booking.status.completed': 'Completed',
        'booking.currentBookings': 'Current Bookings',
        'booking.bookingHistory': 'Booking History',
        'booking.noCurrentBookings': 'No upcoming bookings',
        'booking.noCurrentBookingsDescription': "You don't have any upcoming room reservations",
        'booking.noBookingHistory': 'No past bookings',
        'booking.noBookingHistoryDescription': "You don't have any booking history yet",
        'loyalty.points': 'points',
        'common.close': 'Close',
        'common.optional': 'optional',
        'common.processing': 'Processing',
        // Locked SlipOK guest vocabulary: only two things a guest ever
        // reads, whatever the machine actually decided.
        'payment.slipok.status.pending': 'Being checked',
        'payment.slipok.status.verified': 'Confirmed',
        'payment.slipok.status.shadow_pass': 'Being checked',
        'payment.slipok.status.manual': 'Being checked',
        'payment.slipok.status.unavailable': 'Being checked',
      };
      return translations[key] ?? key;
    },
  }),
}));

// Mock react-router
vi.mock('react-router', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => ({
    pathname: '/my-bookings',
    search: '',
    hash: '',
    state: null,
    key: 'default',
  }),
  useNavigate: () => vi.fn(),
}));

// Mock AppShell
vi.mock('../../components/layout/AppShell', () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

// Import component after mocks
import MyBookingsPage from '../MyBookingsPage';

/** Wait for the query to resolve and bookings UI to render */
async function waitForBookingsLoaded() {
  await waitFor(() => {
    expect(screen.getByRole('tab', { name: /Current Bookings/ })).toBeInTheDocument();
  });
}

describe('MyBookingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBookingsData = mockBookings;
    mockGetMyBookings.mockImplementation(() => Promise.resolve(mockBookingsData));
    mockCancelBooking.mockResolvedValue(undefined);
    mockAddSlip.mockResolvedValue(undefined);
    mockRemoveSlip.mockResolvedValue(undefined);
    mockUploadSlip.mockResolvedValue({ url: 'http://example.com/slip.png' });
  });

  describe('Loading State', () => {
    it('should render loading spinner when loading', () => {
      mockGetMyBookings.mockReturnValue(new Promise(() => {}));
      render(<MyBookingsPage />, { wrapper });

      expect(screen.getByRole('heading', { name: 'My Bookings' })).toBeInTheDocument();
      // Check for loading spinner (animate-spin class)
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should render empty state when no bookings', async () => {
      mockBookingsData = [];
      render(<MyBookingsPage />, { wrapper });

      await waitFor(() => {
        // With tabs, empty current tab shows "No upcoming bookings"
        expect(screen.getByText('No upcoming bookings')).toBeInTheDocument();
      });
      expect(screen.getByText('Book Your First Room')).toBeInTheDocument();
    });

    it('should render empty state when bookings is undefined', async () => {
      mockGetMyBookings.mockResolvedValue(undefined);
      render(<MyBookingsPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('No upcoming bookings')).toBeInTheDocument();
      });
    });
  });

  describe('Booking Cards Rendering', () => {
    it('should render booking cards with correct info', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Check first booking (confirmed) in current tab
      expect(screen.getByTestId('booking-card-booking-1')).toBeInTheDocument();
      expect(screen.getByText('Deluxe Room')).toBeInTheDocument();
      expect(screen.getByText('Confirmed')).toBeInTheDocument();

      // Switch to history tab for completed and cancelled bookings
      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      // Check second booking (completed)
      expect(screen.getByTestId('booking-card-booking-2')).toBeInTheDocument();
      expect(screen.getByText('Standard Room')).toBeInTheDocument();

      // Check third booking (cancelled)
      expect(screen.getByTestId('booking-card-booking-3')).toBeInTheDocument();
      expect(screen.getByText('Suite')).toBeInTheDocument();
    });

    it('should display prices correctly', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Current tab shows booking-1
      expect(screen.getByText('฿4,500')).toBeInTheDocument();

      // History tab shows booking-2 and booking-3
      await user.click(screen.getByRole('tab', { name: /Booking History/ }));
      expect(screen.getByText('฿2,000')).toBeInTheDocument();
      expect(screen.getByText('฿6,000')).toBeInTheDocument();
    });

    it('should display click for details hint', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Current tab has 1 booking
      expect(screen.getAllByText('Click for details').length).toBe(1);

      // History tab has 4 bookings (booking-2, booking-3, booking-4, booking-5)
      await user.click(screen.getByRole('tab', { name: /Booking History/ }));
      expect(screen.getAllByText('Click for details').length).toBe(4);
    });
  });

  describe('Booking Card Interaction', () => {
    it('should open details modal when clicking booking card', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const card = screen.getByTestId('booking-card-booking-1');
      await user.click(card);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should open details modal on Enter key', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const card = screen.getByTestId('booking-card-booking-1');
      card.focus();
      await user.keyboard('{Enter}');

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('Booking Details Modal', () => {
    it('should show all booking information in modal', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Open modal for first booking
      await user.click(screen.getByTestId('booking-card-booking-1'));

      const modal = screen.getByRole('dialog');
      expect(modal).toBeInTheDocument();

      // Check room type name
      expect(within(modal).getByText('Deluxe Room')).toBeInTheDocument();

      // Check status
      expect(within(modal).getByText('Confirmed')).toBeInTheDocument();

      // Check nights count
      expect(screen.getByTestId('booking-nights-count')).toBeInTheDocument();

      // Check total price
      expect(within(modal).getByText('฿4,500')).toBeInTheDocument();

      // Check points
      expect(within(modal).getByText(/450/)).toBeInTheDocument();

      // Check notes
      expect(within(modal).getByText('Early check-in requested')).toBeInTheDocument();
    });

    it('should close modal when clicking close button', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('booking-card-booking-1'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.click(screen.getByTestId('booking-details-close'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should close modal when clicking backdrop', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('booking-card-booking-1'));
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();

      // Modal's backdrop is the dialog panel's portal parent — clicking it
      // (not the panel itself) is what triggers the dismiss-on-backdrop
      // behavior baked into the shared Modal primitive.
      await user.click(dialog.parentElement as HTMLElement);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should close modal when clicking Close button in footer', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('booking-card-booking-1'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should show cancellation reason for cancelled bookings', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // booking-3 is cancelled and in history tab
      await user.click(screen.getByRole('tab', { name: /Booking History/ }));
      await user.click(screen.getByTestId('booking-card-booking-3'));

      const modal = screen.getByRole('dialog');
      expect(within(modal).getByText('Change of plans')).toBeInTheDocument();
      expect(within(modal).getByText('Cancellation reason')).toBeInTheDocument();
    });
  });

  describe('Cancel Flow', () => {
    it('should show cancel button only for cancellable bookings', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Open confirmed future booking modal - should have cancel button
      await user.click(screen.getByTestId('booking-card-booking-1'));
      expect(screen.getByTestId('booking-details-cancel')).toBeInTheDocument();
      await user.click(screen.getByTestId('booking-details-close'));

      // Switch to history tab for completed and cancelled bookings
      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      // Open completed booking modal - should NOT have cancel button
      await user.click(screen.getByTestId('booking-card-booking-2'));
      expect(screen.queryByTestId('booking-details-cancel')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('booking-details-close'));

      // Open cancelled booking modal - should NOT have cancel button
      await user.click(screen.getByTestId('booking-card-booking-3'));
      expect(screen.queryByTestId('booking-details-cancel')).not.toBeInTheDocument();
    });

    it('should open cancel confirmation modal when clicking cancel button', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('booking-card-booking-1'));
      await user.click(screen.getByTestId('booking-details-cancel'));

      // Details modal should close — its content is gone, replaced by the
      // cancel-confirmation dialog (both render as role="dialog", so content
      // unique to the details modal body — not also shown on the booking
      // card underneath — is the reliable way to tell them apart here).
      expect(screen.queryByTestId('booking-nights-count')).not.toBeInTheDocument();

      // Cancel confirmation modal should open
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Cancel Booking')).toBeInTheDocument();
      expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    });

    it('should close cancel modal when clicking close button', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('booking-card-booking-1'));
      await user.click(screen.getByTestId('booking-details-cancel'));

      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.click(screen.getByTestId('cancel-modal-close'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should call mutate when confirming cancellation', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('booking-card-booking-1'));
      await user.click(screen.getByTestId('booking-details-cancel'));

      // Enter cancellation reason
      await user.type(screen.getByTestId('cancel-reason-input'), 'Test reason');

      // Confirm cancel
      await user.click(screen.getByTestId('confirm-cancel-button'));

      expect(mockCancelBooking).toHaveBeenCalledWith('booking-1', 'Test reason');
    });

    it('should allow cancellation without reason', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('booking-card-booking-1'));
      await user.click(screen.getByTestId('booking-details-cancel'));
      await user.click(screen.getByTestId('confirm-cancel-button'));

      expect(mockCancelBooking).toHaveBeenCalledWith('booking-1', undefined);
    });
  });

  describe('Status Display', () => {
    it('should display confirmed status with green badge', async () => {
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const card = screen.getByTestId('booking-card-booking-1');
      const badge = within(card).getByText('Confirmed');
      expect(badge).toHaveAttribute('data-tone', 'success');
    });

    it('should display cancelled status with red badge', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // booking-3 is cancelled and in history tab
      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      const card = screen.getByTestId('booking-card-booking-3');
      const badge = within(card).getByText('Cancelled');
      expect(badge).toHaveAttribute('data-tone', 'error');
    });

    it('should display completed status with blue badge', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // booking-2 is completed and in history tab
      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      const card = screen.getByTestId('booking-card-booking-2');
      const badge = within(card).getByText('Completed');
      expect(badge).toHaveAttribute('data-tone', 'brand');
    });
  });

  describe('New Booking Button', () => {
    it('should render new booking button', async () => {
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      expect(screen.getByTestId('new-booking-button')).toBeInTheDocument();
      expect(screen.getByText('Book Room')).toBeInTheDocument();
    });

    it('should link to booking page', async () => {
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const link = screen.getByTestId('new-booking-button');
      expect(link).toHaveAttribute('href', '/booking');
    });
  });

  describe('Tab Rendering', () => {
    it('should render both tab buttons', async () => {
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      expect(screen.getByRole('tab', { name: /Current Bookings/ })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Booking History/ })).toBeInTheDocument();
    });

    it('should show Current Bookings tab as active by default', async () => {
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const currentTab = screen.getByRole('tab', { name: /Current Bookings/ });
      const historyTab = screen.getByRole('tab', { name: /Booking History/ });

      expect(currentTab).toHaveAttribute('aria-selected', 'true');
      expect(historyTab).toHaveAttribute('aria-selected', 'false');
    });

    it('should display booking counts in tab labels', async () => {
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // booking-1 is confirmed + future = current (1)
      // booking-2 is completed = history
      // booking-3 is cancelled = history
      // booking-4 is confirmed + past = history
      // booking-5 is cancelled by admin = history
      // So: current = 1, history = 4
      expect(screen.getByRole('tab', { name: /Current Bookings/ })).toHaveTextContent('Current Bookings (1)');
      expect(screen.getByRole('tab', { name: /Booking History/ })).toHaveTextContent('Booking History (4)');
    });
  });

  describe('Tab Switching', () => {
    it('should switch to history tab when clicked', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const historyTab = screen.getByRole('tab', { name: /Booking History/ });
      await user.click(historyTab);

      expect(historyTab).toHaveAttribute('aria-selected', 'true');
    });

    it('should update active tab styling on switch', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const currentTab = screen.getByRole('tab', { name: /Current Bookings/ });
      const historyTab = screen.getByRole('tab', { name: /Booking History/ });

      // Initially current is active
      expect(currentTab).toHaveAttribute('aria-selected', 'true');
      expect(historyTab).toHaveAttribute('aria-selected', 'false');

      // Switch to history
      await user.click(historyTab);
      expect(historyTab).toHaveAttribute('aria-selected', 'true');
      expect(currentTab).toHaveAttribute('aria-selected', 'false');

      // Switch back to current
      await user.click(currentTab);
      expect(currentTab).toHaveAttribute('aria-selected', 'true');
      expect(historyTab).toHaveAttribute('aria-selected', 'false');
    });
  });

  describe('Current Bookings Filter', () => {
    it('should show only confirmed future bookings in current tab', async () => {
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Only booking-1 (confirmed + future check-in 2027-06-15) should be visible
      expect(screen.getByTestId('booking-card-booking-1')).toBeInTheDocument();

      // These should NOT be visible in current tab
      expect(screen.queryByTestId('booking-card-booking-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('booking-card-booking-3')).not.toBeInTheDocument();
      expect(screen.queryByTestId('booking-card-booking-4')).not.toBeInTheDocument();
    });

    it('should NOT show cancelled bookings in current tab', async () => {
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // booking-3 is cancelled
      expect(screen.queryByTestId('booking-card-booking-3')).not.toBeInTheDocument();
    });

    it('should NOT show completed bookings in current tab', async () => {
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // booking-2 is completed
      expect(screen.queryByTestId('booking-card-booking-2')).not.toBeInTheDocument();
    });

    it('should NOT show past confirmed bookings in current tab', async () => {
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // booking-4 is confirmed but past (2025-12-01)
      expect(screen.queryByTestId('booking-card-booking-4')).not.toBeInTheDocument();
    });
  });

  describe('History Bookings Filter', () => {
    it('should show completed bookings in history tab', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      // booking-2 is completed
      expect(screen.getByTestId('booking-card-booking-2')).toBeInTheDocument();
    });

    it('should show cancelled bookings in history tab', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      // booking-3 is cancelled
      expect(screen.getByTestId('booking-card-booking-3')).toBeInTheDocument();
    });

    it('should show past confirmed bookings in history tab', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      // booking-4 is confirmed but past (2025-12-01)
      expect(screen.getByTestId('booking-card-booking-4')).toBeInTheDocument();
    });

    it('should NOT show future confirmed bookings in history tab', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      // booking-1 is confirmed + future
      expect(screen.queryByTestId('booking-card-booking-1')).not.toBeInTheDocument();
    });
  });

  describe('Tab-specific Empty States', () => {
    it('should show "No upcoming bookings" when current tab is empty', async () => {
      // Set mock to only have history bookings
      mockBookingsData = [
        {
          id: 'booking-completed',
          roomTypeName: 'Standard Room',
          checkInDate: '2025-12-10',
          checkOutDate: '2025-12-12',
          numGuests: 1,
          totalPrice: 2000,
          pointsEarned: 200,
          status: 'completed',
          notes: null,
          cancellationReason: null,
          createdAt: '2025-12-01',
        },
      ];

      render(<MyBookingsPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('No upcoming bookings')).toBeInTheDocument();
      });
    });

    it('should show "No past bookings" when history tab is empty', async () => {
      const user = userEvent.setup();
      // Set mock to only have current bookings
      mockBookingsData = [
        {
          id: 'booking-future',
          roomTypeName: 'Deluxe Room',
          checkInDate: '2027-06-15',
          checkOutDate: '2027-06-18',
          numGuests: 2,
          totalPrice: 4500,
          pointsEarned: 450,
          status: 'confirmed',
          notes: null,
          cancellationReason: null,
          createdAt: '2027-05-01',
        },
      ];

      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      expect(screen.getByText('No past bookings')).toBeInTheDocument();
    });
  });

  describe('Tab Integration with Existing Features', () => {
    it('should open details modal when clicking card in current tab', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('booking-card-booking-1'));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should open details modal when clicking card in history tab', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByRole('tab', { name: /Booking History/ }));
      await user.click(screen.getByTestId('booking-card-booking-2'));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should show cancel button only for current bookings in modal', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Open current booking - should have cancel button
      await user.click(screen.getByTestId('booking-card-booking-1'));
      expect(screen.getByTestId('booking-details-cancel')).toBeInTheDocument();
      await user.click(screen.getByTestId('booking-details-close'));

      // Open history booking - should NOT have cancel button
      await user.click(screen.getByRole('tab', { name: /Booking History/ }));
      await user.click(screen.getByTestId('booking-card-booking-2'));
      expect(screen.queryByTestId('booking-details-cancel')).not.toBeInTheDocument();
    });
  });

  describe('Admin Cancelled Booking Display', () => {
    it('should show "Cancelled by Admin" badge for bookings with cancelledByAdmin=true', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Switch to history tab to see the admin-cancelled booking
      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      // booking-5 is cancelled by admin
      const adminCancelledCard = screen.getByTestId('booking-card-booking-5');
      expect(adminCancelledCard).toBeInTheDocument();

      // Should show "Cancelled by Admin" badge
      const badge = within(adminCancelledCard).getByText('Cancelled by Admin');
      expect(badge).toBeInTheDocument();
    });

    it('should show regular "Cancelled" badge for bookings with cancelledByAdmin=false', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Switch to history tab
      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      // booking-3 is cancelled by user (cancelledByAdmin=false)
      const userCancelledCard = screen.getByTestId('booking-card-booking-3');
      expect(userCancelledCard).toBeInTheDocument();

      // Should show regular "Cancelled" badge
      const badge = within(userCancelledCard).getByText('Cancelled');
      expect(badge).toBeInTheDocument();
    });

    it('should display admin cancellation reason in details modal', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Switch to history tab
      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      // Click on the admin-cancelled booking
      await user.click(screen.getByTestId('booking-card-booking-5'));

      const modal = screen.getByRole('dialog');

      // Should show the cancellation reason
      expect(within(modal).getByText('Policy violation - no show')).toBeInTheDocument();
      expect(within(modal).getByText('Cancellation reason')).toBeInTheDocument();
    });

    it('should use amber/orange color for admin cancellation badge vs red for user cancellation', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Switch to history tab
      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      // booking-3 (user cancelled) should have red badge
      const userCancelledCard = screen.getByTestId('booking-card-booking-3');
      const userBadge = within(userCancelledCard).getByText('Cancelled');
      expect(userBadge).toHaveAttribute('data-tone', 'error');

      // booking-5 (admin cancelled) should have amber/orange badge
      const adminCancelledCard = screen.getByTestId('booking-card-booking-5');
      const adminBadge = within(adminCancelledCard).getByText('Cancelled by Admin');
      expect(adminBadge).toHaveAttribute('data-tone', 'warning');
    });

    it('should differentiate admin and user cancelled bookings in the modal', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Switch to history tab
      await user.click(screen.getByRole('tab', { name: /Booking History/ }));

      // Open user-cancelled booking modal
      await user.click(screen.getByTestId('booking-card-booking-3'));
      let modal = screen.getByRole('dialog');
      expect(within(modal).getByText('Cancelled')).toBeInTheDocument();
      await user.click(screen.getByTestId('booking-details-close'));

      // Open admin-cancelled booking modal
      await user.click(screen.getByTestId('booking-card-booking-5'));
      modal = screen.getByRole('dialog');
      expect(within(modal).getByText('Cancelled by Admin')).toBeInTheDocument();
    });
  });
  describe('SlipOK Status Badge', () => {
    /** A future confirmed booking (so it lands in the Current tab) carrying one slip status. */
    function bookingWithSlipStatus(id: string, slipOkStatus: string | null) {
      return {
        id,
        roomTypeName: `Room ${id}`,
        checkInDate: '2027-08-01',
        checkOutDate: '2027-08-03',
        numGuests: 1,
        totalPrice: 1000,
        pointsEarned: 100,
        status: 'confirmed',
        notes: null,
        cancellationReason: null,
        createdAt: '2027-07-01',
        slipOkStatus,
      };
    }

    it('should show a confirmed badge only for the verified status', async () => {
      mockBookingsData = [bookingWithSlipStatus('slip-verified', 'verified')] as never;
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const card = screen.getByTestId('booking-card-slip-verified');
      // Two badges read "Confirmed" on a verified card: the booking status
      // and the slip status. The second one is the slip.
      const badges = within(card).getAllByText('Confirmed');
      expect(badges).toHaveLength(2);
      expect(badges[1]).toHaveAttribute('data-tone', 'success');
      expect(within(card).queryByText('Being checked')).not.toBeInTheDocument();
    });

    it.each(['pending', 'shadow_pass', 'manual', 'unavailable'])(
      'should show the neutral "being checked" badge for %s',
      async (status) => {
        mockBookingsData = [bookingWithSlipStatus(`slip-${status}`, status)] as never;
        render(<MyBookingsPage />, { wrapper });
        await waitForBookingsLoaded();

        const card = screen.getByTestId(`booking-card-slip-${status}`);
        const badge = within(card).getByText('Being checked');
        expect(badge).toHaveAttribute('data-tone', 'warning');
        // A guest must never read the machine's own vocabulary — least of
        // all a vendor outage (`unavailable`) — off their booking card.
        expect(within(card).queryByText(status)).not.toBeInTheDocument();
      }
    );

    it('should fall back to "being checked" for a pre-lock status value', async () => {
      // Rows written before the vocabulary lock still carry `failed`.
      mockBookingsData = [bookingWithSlipStatus('slip-legacy', 'failed')] as never;
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const card = screen.getByTestId('booking-card-slip-legacy');
      expect(within(card).getByText('Being checked')).toBeInTheDocument();
      expect(within(card).queryByText('failed')).not.toBeInTheDocument();
      expect(within(card).queryByText(/payment\.slipok/)).not.toBeInTheDocument();
    });

    it('should render no slip badge at all when the booking has no slip status', async () => {
      mockBookingsData = [bookingWithSlipStatus('slip-none', null)] as never;
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const card = screen.getByTestId('booking-card-slip-none');
      expect(within(card).queryByText('Being checked')).not.toBeInTheDocument();
      // Only the booking-status badge remains.
      expect(within(card).getAllByText('Confirmed')).toHaveLength(1);
    });

    it('gives the icon-only slip thumbnail badge a label a screen reader can reach', async () => {
      const user = userEvent.setup();
      mockBookingsData = [
        {
          ...bookingWithSlipStatus('slip-thumb', 'manual'),
          slips: [
            {
              id: 'slip-thumb-1',
              slipUrl: 'https://example.test/slip-1.png',
              uploadedAt: '2027-07-01T10:00:00Z',
              slipokStatus: 'manual',
              adminStatus: 'pending',
            },
          ],
        },
      ] as never;
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('booking-card-slip-thumb'));
      const modal = screen.getByRole('dialog');

      // The glyph inside the badge is aria-hidden, and ARIA ignores
      // aria-label on a bare <span> (role=generic) — without an explicit
      // role the badge is silent, which is what this asserts against.
      const badge = within(modal).getByLabelText('Being checked');
      expect(badge).toHaveAttribute('role', 'img');
    });
  });
});
