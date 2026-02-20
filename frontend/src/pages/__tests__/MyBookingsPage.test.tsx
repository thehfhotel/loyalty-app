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
      };
      return translations[key] ?? key;
    },
  }),
}));

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
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

// Mock MainLayout
vi.mock('../../components/layout/MainLayout', () => ({
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
    expect(screen.getByTestId('tab-current')).toBeInTheDocument();
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
      await user.click(screen.getByTestId('tab-history'));

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
      await user.click(screen.getByTestId('tab-history'));
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
      await user.click(screen.getByTestId('tab-history'));
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

      expect(screen.getByTestId('booking-details-modal')).toBeInTheDocument();
    });

    it('should open details modal on Enter key', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const card = screen.getByTestId('booking-card-booking-1');
      card.focus();
      await user.keyboard('{Enter}');

      expect(screen.getByTestId('booking-details-modal')).toBeInTheDocument();
    });
  });

  describe('Booking Details Modal', () => {
    it('should show all booking information in modal', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Open modal for first booking
      await user.click(screen.getByTestId('booking-card-booking-1'));

      const modal = screen.getByTestId('booking-details-modal');
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
      expect(screen.getByTestId('booking-details-modal')).toBeInTheDocument();

      await user.click(screen.getByTestId('booking-details-close'));
      expect(screen.queryByTestId('booking-details-modal')).not.toBeInTheDocument();
    });

    it('should close modal when clicking backdrop', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('booking-card-booking-1'));
      expect(screen.getByTestId('booking-details-modal')).toBeInTheDocument();

      await user.click(screen.getByTestId('booking-details-modal-backdrop'));
      expect(screen.queryByTestId('booking-details-modal')).not.toBeInTheDocument();
    });

    it('should close modal when clicking Close button in footer', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('booking-card-booking-1'));
      expect(screen.getByTestId('booking-details-modal')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByTestId('booking-details-modal')).not.toBeInTheDocument();
    });

    it('should show cancellation reason for cancelled bookings', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // booking-3 is cancelled and in history tab
      await user.click(screen.getByTestId('tab-history'));
      await user.click(screen.getByTestId('booking-card-booking-3'));

      const modal = screen.getByTestId('booking-details-modal');
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
      await user.click(screen.getByTestId('tab-history'));

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

      // Details modal should close
      expect(screen.queryByTestId('booking-details-modal')).not.toBeInTheDocument();

      // Cancel confirmation modal should open
      expect(screen.getByTestId('cancel-modal')).toBeInTheDocument();
      expect(screen.getByText('Cancel Booking')).toBeInTheDocument();
      expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    });

    it('should close cancel modal when clicking close button', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('booking-card-booking-1'));
      await user.click(screen.getByTestId('booking-details-cancel'));

      expect(screen.getByTestId('cancel-modal')).toBeInTheDocument();

      await user.click(screen.getByTestId('cancel-modal-close'));
      expect(screen.queryByTestId('cancel-modal')).not.toBeInTheDocument();
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
      expect(badge).toHaveClass('bg-green-100', 'text-green-800');
    });

    it('should display cancelled status with red badge', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // booking-3 is cancelled and in history tab
      await user.click(screen.getByTestId('tab-history'));

      const card = screen.getByTestId('booking-card-booking-3');
      const badge = within(card).getByText('Cancelled');
      expect(badge).toHaveClass('bg-red-100', 'text-red-800');
    });

    it('should display completed status with blue badge', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // booking-2 is completed and in history tab
      await user.click(screen.getByTestId('tab-history'));

      const card = screen.getByTestId('booking-card-booking-2');
      const badge = within(card).getByText('Completed');
      expect(badge).toHaveClass('bg-blue-100', 'text-blue-800');
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

      expect(screen.getByTestId('tab-current')).toBeInTheDocument();
      expect(screen.getByTestId('tab-history')).toBeInTheDocument();
    });

    it('should show Current Bookings tab as active by default', async () => {
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const currentTab = screen.getByTestId('tab-current');
      const historyTab = screen.getByTestId('tab-history');

      expect(currentTab).toHaveClass('border-primary-500', 'text-primary-600');
      expect(historyTab).toHaveClass('border-transparent', 'text-gray-500');
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
      expect(screen.getByTestId('tab-current')).toHaveTextContent('Current Bookings (1)');
      expect(screen.getByTestId('tab-history')).toHaveTextContent('Booking History (4)');
    });
  });

  describe('Tab Switching', () => {
    it('should switch to history tab when clicked', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const historyTab = screen.getByTestId('tab-history');
      await user.click(historyTab);

      expect(historyTab).toHaveClass('border-primary-500', 'text-primary-600');
    });

    it('should update active tab styling on switch', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      const currentTab = screen.getByTestId('tab-current');
      const historyTab = screen.getByTestId('tab-history');

      // Initially current is active
      expect(currentTab).toHaveClass('border-primary-500');
      expect(historyTab).toHaveClass('border-transparent');

      // Switch to history
      await user.click(historyTab);
      expect(historyTab).toHaveClass('border-primary-500');
      expect(currentTab).toHaveClass('border-transparent');

      // Switch back to current
      await user.click(currentTab);
      expect(currentTab).toHaveClass('border-primary-500');
      expect(historyTab).toHaveClass('border-transparent');
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

      await user.click(screen.getByTestId('tab-history'));

      // booking-2 is completed
      expect(screen.getByTestId('booking-card-booking-2')).toBeInTheDocument();
    });

    it('should show cancelled bookings in history tab', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('tab-history'));

      // booking-3 is cancelled
      expect(screen.getByTestId('booking-card-booking-3')).toBeInTheDocument();
    });

    it('should show past confirmed bookings in history tab', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('tab-history'));

      // booking-4 is confirmed but past (2025-12-01)
      expect(screen.getByTestId('booking-card-booking-4')).toBeInTheDocument();
    });

    it('should NOT show future confirmed bookings in history tab', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('tab-history'));

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

      await user.click(screen.getByTestId('tab-history'));

      expect(screen.getByText('No past bookings')).toBeInTheDocument();
    });
  });

  describe('Tab Integration with Existing Features', () => {
    it('should open details modal when clicking card in current tab', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('booking-card-booking-1'));

      expect(screen.getByTestId('booking-details-modal')).toBeInTheDocument();
    });

    it('should open details modal when clicking card in history tab', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      await user.click(screen.getByTestId('tab-history'));
      await user.click(screen.getByTestId('booking-card-booking-2'));

      expect(screen.getByTestId('booking-details-modal')).toBeInTheDocument();
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
      await user.click(screen.getByTestId('tab-history'));
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
      await user.click(screen.getByTestId('tab-history'));

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
      await user.click(screen.getByTestId('tab-history'));

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
      await user.click(screen.getByTestId('tab-history'));

      // Click on the admin-cancelled booking
      await user.click(screen.getByTestId('booking-card-booking-5'));

      const modal = screen.getByTestId('booking-details-modal');

      // Should show the cancellation reason
      expect(within(modal).getByText('Policy violation - no show')).toBeInTheDocument();
      expect(within(modal).getByText('Cancellation reason')).toBeInTheDocument();
    });

    it('should use amber/orange color for admin cancellation badge vs red for user cancellation', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Switch to history tab
      await user.click(screen.getByTestId('tab-history'));

      // booking-3 (user cancelled) should have red badge
      const userCancelledCard = screen.getByTestId('booking-card-booking-3');
      const userBadge = within(userCancelledCard).getByText('Cancelled');
      expect(userBadge).toHaveClass('bg-red-100', 'text-red-800');

      // booking-5 (admin cancelled) should have amber/orange badge
      const adminCancelledCard = screen.getByTestId('booking-card-booking-5');
      const adminBadge = within(adminCancelledCard).getByText('Cancelled by Admin');
      expect(adminBadge).toHaveClass('bg-amber-100', 'text-amber-800');
    });

    it('should differentiate admin and user cancelled bookings in the modal', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />, { wrapper });
      await waitForBookingsLoaded();

      // Switch to history tab
      await user.click(screen.getByTestId('tab-history'));

      // Open user-cancelled booking modal
      await user.click(screen.getByTestId('booking-card-booking-3'));
      let modal = screen.getByTestId('booking-details-modal');
      expect(within(modal).getByText('Cancelled')).toBeInTheDocument();
      await user.click(screen.getByTestId('booking-details-close'));

      // Open admin-cancelled booking modal
      await user.click(screen.getByTestId('booking-card-booking-5'));
      modal = screen.getByTestId('booking-details-modal');
      expect(within(modal).getByText('Cancelled by Admin')).toBeInTheDocument();
    });
  });
});
