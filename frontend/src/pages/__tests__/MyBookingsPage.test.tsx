import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock booking data
const mockBookings = [
  {
    id: 'booking-1',
    roomTypeName: 'Deluxe Room',
    checkInDate: '2026-02-15',
    checkOutDate: '2026-02-18',
    numGuests: 2,
    totalPrice: 4500,
    pointsEarned: 450,
    status: 'confirmed',
    notes: 'Early check-in requested',
    cancellationReason: null,
    createdAt: '2026-01-05',
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
    createdAt: '2025-11-15',
  },
];

// Mock tRPC hooks
const mockRefetch = vi.fn();
const mockMutate = vi.fn();
let mockBookingsData: typeof mockBookings | undefined = mockBookings;
let mockIsLoading = false;

vi.mock('../../hooks/useTRPC', () => ({
  trpc: {
    booking: {
      getMyBookings: {
        useQuery: vi.fn(() => ({
          data: mockBookingsData,
          isLoading: mockIsLoading,
          refetch: mockRefetch,
        })),
      },
      cancelBooking: {
        useMutation: vi.fn(() => ({
          mutate: mockMutate,
          isPending: false,
        })),
      },
    },
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
        'booking.status.completed': 'Completed',
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

describe('MyBookingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBookingsData = mockBookings;
    mockIsLoading = false;
  });

  describe('Loading State', () => {
    it('should render loading spinner when loading', () => {
      mockIsLoading = true;
      render(<MyBookingsPage />);

      expect(screen.getByRole('heading', { name: 'My Bookings' })).toBeInTheDocument();
      // Check for loading spinner (animate-spin class)
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should render empty state when no bookings', () => {
      mockBookingsData = [];
      render(<MyBookingsPage />);

      expect(screen.getByText('No Bookings Yet')).toBeInTheDocument();
      expect(screen.getByText('Book Your First Room')).toBeInTheDocument();
    });

    it('should render empty state when bookings is undefined', () => {
      mockBookingsData = undefined;
      render(<MyBookingsPage />);

      expect(screen.getByText('No Bookings Yet')).toBeInTheDocument();
    });
  });

  describe('Booking Cards Rendering', () => {
    it('should render booking cards with correct info', () => {
      render(<MyBookingsPage />);

      // Check first booking (confirmed)
      expect(screen.getByTestId('booking-card-booking-1')).toBeInTheDocument();
      expect(screen.getByText('Deluxe Room')).toBeInTheDocument();
      expect(screen.getByText('Confirmed')).toBeInTheDocument();

      // Check second booking (completed)
      expect(screen.getByTestId('booking-card-booking-2')).toBeInTheDocument();
      expect(screen.getByText('Standard Room')).toBeInTheDocument();

      // Check third booking (cancelled)
      expect(screen.getByTestId('booking-card-booking-3')).toBeInTheDocument();
      expect(screen.getByText('Suite')).toBeInTheDocument();
    });

    it('should display prices correctly', () => {
      render(<MyBookingsPage />);

      expect(screen.getByText('฿4,500')).toBeInTheDocument();
      expect(screen.getByText('฿2,000')).toBeInTheDocument();
      expect(screen.getByText('฿6,000')).toBeInTheDocument();
    });

    it('should display click for details hint', () => {
      render(<MyBookingsPage />);

      const detailsHints = screen.getAllByText('Click for details');
      expect(detailsHints.length).toBe(3);
    });
  });

  describe('Booking Card Interaction', () => {
    it('should open details modal when clicking booking card', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />);

      const card = screen.getByTestId('booking-card-booking-1');
      await user.click(card);

      expect(screen.getByTestId('booking-details-modal')).toBeInTheDocument();
    });

    it('should open details modal on Enter key', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />);

      const card = screen.getByTestId('booking-card-booking-1');
      card.focus();
      await user.keyboard('{Enter}');

      expect(screen.getByTestId('booking-details-modal')).toBeInTheDocument();
    });
  });

  describe('Booking Details Modal', () => {
    it('should show all booking information in modal', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />);

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
      render(<MyBookingsPage />);

      await user.click(screen.getByTestId('booking-card-booking-1'));
      expect(screen.getByTestId('booking-details-modal')).toBeInTheDocument();

      await user.click(screen.getByTestId('booking-details-close'));
      expect(screen.queryByTestId('booking-details-modal')).not.toBeInTheDocument();
    });

    it('should close modal when clicking backdrop', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />);

      await user.click(screen.getByTestId('booking-card-booking-1'));
      expect(screen.getByTestId('booking-details-modal')).toBeInTheDocument();

      await user.click(screen.getByTestId('booking-details-modal-backdrop'));
      expect(screen.queryByTestId('booking-details-modal')).not.toBeInTheDocument();
    });

    it('should close modal when clicking Close button in footer', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />);

      await user.click(screen.getByTestId('booking-card-booking-1'));
      expect(screen.getByTestId('booking-details-modal')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByTestId('booking-details-modal')).not.toBeInTheDocument();
    });

    it('should show cancellation reason for cancelled bookings', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />);

      await user.click(screen.getByTestId('booking-card-booking-3'));

      const modal = screen.getByTestId('booking-details-modal');
      expect(within(modal).getByText('Change of plans')).toBeInTheDocument();
      expect(within(modal).getByText('Cancellation reason')).toBeInTheDocument();
    });
  });

  describe('Cancel Flow', () => {
    it('should show cancel button only for cancellable bookings', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />);

      // Open confirmed future booking modal - should have cancel button
      await user.click(screen.getByTestId('booking-card-booking-1'));
      expect(screen.getByTestId('booking-details-cancel')).toBeInTheDocument();
      await user.click(screen.getByTestId('booking-details-close'));

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
      render(<MyBookingsPage />);

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
      render(<MyBookingsPage />);

      await user.click(screen.getByTestId('booking-card-booking-1'));
      await user.click(screen.getByTestId('booking-details-cancel'));

      expect(screen.getByTestId('cancel-modal')).toBeInTheDocument();

      await user.click(screen.getByTestId('cancel-modal-close'));
      expect(screen.queryByTestId('cancel-modal')).not.toBeInTheDocument();
    });

    it('should call mutate when confirming cancellation', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />);

      await user.click(screen.getByTestId('booking-card-booking-1'));
      await user.click(screen.getByTestId('booking-details-cancel'));

      // Enter cancellation reason
      await user.type(screen.getByTestId('cancel-reason-input'), 'Test reason');

      // Confirm cancel
      await user.click(screen.getByTestId('confirm-cancel-button'));

      expect(mockMutate).toHaveBeenCalledWith({
        id: 'booking-1',
        reason: 'Test reason',
      });
    });

    it('should allow cancellation without reason', async () => {
      const user = userEvent.setup();
      render(<MyBookingsPage />);

      await user.click(screen.getByTestId('booking-card-booking-1'));
      await user.click(screen.getByTestId('booking-details-cancel'));
      await user.click(screen.getByTestId('confirm-cancel-button'));

      expect(mockMutate).toHaveBeenCalledWith({
        id: 'booking-1',
        reason: undefined,
      });
    });
  });

  describe('Status Display', () => {
    it('should display confirmed status with green badge', async () => {
      render(<MyBookingsPage />);

      const card = screen.getByTestId('booking-card-booking-1');
      const badge = within(card).getByText('Confirmed');
      expect(badge).toHaveClass('bg-green-100', 'text-green-800');
    });

    it('should display cancelled status with red badge', async () => {
      render(<MyBookingsPage />);

      const card = screen.getByTestId('booking-card-booking-3');
      const badge = within(card).getByText('Cancelled');
      expect(badge).toHaveClass('bg-red-100', 'text-red-800');
    });

    it('should display completed status with blue badge', async () => {
      render(<MyBookingsPage />);

      const card = screen.getByTestId('booking-card-booking-2');
      const badge = within(card).getByText('Completed');
      expect(badge).toHaveClass('bg-blue-100', 'text-blue-800');
    });
  });

  describe('New Booking Button', () => {
    it('should render new booking button', () => {
      render(<MyBookingsPage />);

      expect(screen.getByTestId('new-booking-button')).toBeInTheDocument();
      expect(screen.getByText('Book Room')).toBeInTheDocument();
    });

    it('should link to booking page', () => {
      render(<MyBookingsPage />);

      const link = screen.getByTestId('new-booking-button');
      expect(link).toHaveAttribute('href', '/booking');
    });
  });
});
