import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock data for testing
const mockBookingWithAllData = {
  id: 'booking-1',
  userId: 'user-1',
  user: {
    id: 'user-1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    membershipId: 'MEM001',
    phone: '0812345678',
  },
  roomTypeId: 'room-type-1',
  roomType: {
    id: 'room-type-1',
    name: 'Deluxe Suite',
  },
  checkInDate: '2025-01-15',
  checkOutDate: '2025-01-17',
  numberOfGuests: 2,
  totalPrice: 14000,
  paymentType: 'full' as const,
  paymentAmount: 14000,
  discountAmount: 0,
  discountReason: null,
  status: 'confirmed' as const,
  notes: 'Test booking',
  adminNotes: null,
  slip: {
    id: 'slip-1',
    imageUrl: 'https://example.com/slip.jpg',
    uploadedAt: '2025-01-10T10:00:00Z',
    slipokStatus: 'verified' as const,
    slipokVerifiedAt: '2025-01-10T10:05:00Z',
    adminStatus: 'pending' as const,
    adminVerifiedAt: null,
    adminVerifiedBy: null,
    adminVerifiedByName: null,
  },
  auditHistory: [],
  createdAt: '2025-01-10T09:00:00Z',
  updatedAt: '2025-01-10T10:00:00Z',
};

// Mock tRPC hooks
const mockRefetch = vi.fn();

const createMockQuery = (bookings: typeof mockBookingWithAllData[]) => ({
  data: { bookings, total: bookings.length },
  isLoading: false,
  error: null,
  refetch: mockRefetch,
  isRefetching: false,
});

let mockBookingsData = [mockBookingWithAllData];

vi.mock('../../../hooks/useTRPC', () => ({
  trpc: {
    booking: {
      admin: {
        getAllBookingsAdvanced: {
          useQuery: vi.fn(() => createMockQuery(mockBookingsData)),
        },
        verifySlip: {
          useMutation: vi.fn(() => ({
            mutateAsync: vi.fn(),
            isPending: false,
          })),
        },
        markNeedsAction: {
          useMutation: vi.fn(() => ({
            mutateAsync: vi.fn(),
            isPending: false,
          })),
        },
      },
    },
  },
}));

// Mock toast
vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'admin.booking.bookingManagement.title': 'Booking Management',
        'admin.booking.bookingManagement.subtitle': 'Manage all bookings',
        'admin.booking.bookingManagement.searchPlaceholder': 'Search bookings...',
        'admin.booking.bookingManagement.searchHint': 'Search by name, email, or membership ID',
        'admin.booking.bookingManagement.table.created': 'Created',
        'admin.booking.bookingManagement.table.user': 'User',
        'admin.booking.bookingManagement.table.roomType': 'Room Type',
        'admin.booking.bookingManagement.table.dates': 'Dates',
        'admin.booking.bookingManagement.table.payment': 'Payment',
        'admin.booking.bookingManagement.table.slipStatus': 'Slip Status',
        'admin.booking.bookingManagement.table.adminStatus': 'Admin Status',
        'admin.booking.bookingManagement.table.actions': 'Actions',
        'admin.booking.bookingManagement.paymentType.full': 'Full Payment',
        'admin.booking.bookingManagement.paymentType.deposit': 'Deposit',
        'admin.booking.bookingManagement.slipStatus.verified': 'Verified',
        'admin.booking.bookingManagement.slipStatus.pending': 'Pending',
        'admin.booking.bookingManagement.slipStatus.failed': 'Failed',
        'admin.booking.bookingManagement.slipStatus.quotaExceeded': 'Quota Exceeded',
        'admin.booking.bookingManagement.adminStatus.verified': 'Verified',
        'admin.booking.bookingManagement.adminStatus.pending': 'Pending',
        'admin.booking.bookingManagement.adminStatus.needsAction': 'Needs Action',
        'admin.booking.bookingManagement.noSlip': 'No slip',
        'admin.booking.bookingManagement.noBookings': 'No bookings found',
        'common.refresh': 'Refresh',
        'common.previous': 'Previous',
        'common.next': 'Next',
      };
      return translations[key] ?? key;
    },
  }),
}));

// Mock DashboardButton
vi.mock('../../../components/navigation/DashboardButton', () => ({
  default: () => <div data-testid="dashboard-button">Dashboard</div>,
}));

// Mock SlipViewerSidebar
vi.mock('../../../components/admin/SlipViewerSidebar', () => ({
  default: () => <div data-testid="slip-viewer-sidebar">Slip Viewer</div>,
}));

// Mock BookingEditModal
vi.mock('../BookingEditModal', () => ({
  default: () => <div data-testid="booking-edit-modal">Edit Modal</div>,
}));

// Import component after mocks
import BookingManagement from '../BookingManagement';

describe('BookingManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBookingsData = [mockBookingWithAllData];
  });

  describe('Basic Rendering', () => {
    it('should render the page title', () => {
      render(<BookingManagement />);

      expect(screen.getByText('Booking Management')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(<BookingManagement />);

      expect(container).toBeTruthy();
    });

    it('should render search input', () => {
      render(<BookingManagement />);

      expect(screen.getByPlaceholderText('Search bookings...')).toBeInTheDocument();
    });

    it('should render table headers', () => {
      render(<BookingManagement />);

      expect(screen.getByText('Created')).toBeInTheDocument();
      expect(screen.getByText('User')).toBeInTheDocument();
      expect(screen.getByText('Room Type')).toBeInTheDocument();
      expect(screen.getByText('Payment')).toBeInTheDocument();
    });
  });

  describe('Null Field Rendering', () => {
    it('renders "-" when paymentAmount is null', () => {
      const bookingWithNullPayment = {
        ...mockBookingWithAllData,
        paymentAmount: null,
      } as unknown as typeof mockBookingWithAllData;
      mockBookingsData = [bookingWithNullPayment];

      render(<BookingManagement />);

      // The payment column should show "-" instead of crashing
      const paymentCells = screen.getAllByRole('cell');
      // Find the cell that should contain the payment amount
      const paymentCell = paymentCells.find(cell => cell.textContent?.includes('Full Payment'));
      expect(paymentCell).toBeInTheDocument();
      // Check that "-" is shown for null payment amount
      expect(paymentCell?.textContent).toContain('-');
    });

    it('renders "No slip" when slip is null', () => {
      const bookingWithoutSlip = {
        ...mockBookingWithAllData,
        slip: null,
      } as unknown as typeof mockBookingWithAllData;
      mockBookingsData = [bookingWithoutSlip];

      render(<BookingManagement />);

      // Should show "No slip" text instead of slip status badges
      expect(screen.getByText('No slip')).toBeInTheDocument();
    });

    it('renders email fallback when both firstName and lastName are null', () => {
      const bookingWithNullNames = {
        ...mockBookingWithAllData,
        user: {
          ...mockBookingWithAllData.user,
          firstName: null,
          lastName: null,
        },
      } as unknown as typeof mockBookingWithAllData;
      mockBookingsData = [bookingWithNullNames];

      render(<BookingManagement />);

      // Should show email instead of name
      expect(screen.getByText('john.doe@example.com')).toBeInTheDocument();
    });

    it('renders email when only firstName is null', () => {
      const bookingWithNullFirstName = {
        ...mockBookingWithAllData,
        user: {
          ...mockBookingWithAllData.user,
          firstName: null,
          lastName: 'Doe',
        },
      } as unknown as typeof mockBookingWithAllData;
      mockBookingsData = [bookingWithNullFirstName];

      render(<BookingManagement />);

      // With only lastName available, it should fall back to email
      expect(screen.getByText('john.doe@example.com')).toBeInTheDocument();
    });

    it('renders email when only lastName is null', () => {
      const bookingWithNullLastName = {
        ...mockBookingWithAllData,
        user: {
          ...mockBookingWithAllData.user,
          firstName: 'John',
          lastName: null,
        },
      } as unknown as typeof mockBookingWithAllData;
      mockBookingsData = [bookingWithNullLastName];

      render(<BookingManagement />);

      // With only firstName available, it should fall back to email
      expect(screen.getByText('john.doe@example.com')).toBeInTheDocument();
    });

    it('renders "-" when membershipId is null', () => {
      const bookingWithNullMembership = {
        ...mockBookingWithAllData,
        user: {
          ...mockBookingWithAllData.user,
          membershipId: null,
        },
      } as unknown as typeof mockBookingWithAllData;
      mockBookingsData = [bookingWithNullMembership];

      render(<BookingManagement />);

      // The membership ID should show "-"
      const cells = screen.getAllByRole('cell');
      const userCell = cells.find(cell => cell.textContent?.includes('John Doe'));
      expect(userCell?.textContent).toContain('-');
    });

    it('renders properly when discountAmount is null', () => {
      const bookingWithNullDiscount = {
        ...mockBookingWithAllData,
        discountAmount: null,
        discountReason: null,
      } as unknown as typeof mockBookingWithAllData;
      mockBookingsData = [bookingWithNullDiscount];

      // Should not crash
      const { container } = render(<BookingManagement />);
      expect(container).toBeTruthy();
    });

    it('renders with all optional fields null', () => {
      const bookingWithManyNulls = {
        ...mockBookingWithAllData,
        paymentAmount: null,
        discountAmount: null,
        discountReason: null,
        notes: null,
        adminNotes: null,
        slip: null,
        user: {
          ...mockBookingWithAllData.user,
          firstName: null,
          lastName: null,
          membershipId: null,
          phone: null,
        },
      } as unknown as typeof mockBookingWithAllData;
      mockBookingsData = [bookingWithManyNulls];

      // Should not crash and render properly
      const { container } = render(<BookingManagement />);
      expect(container).toBeTruthy();

      // Email should be shown as fallback
      expect(screen.getByText('john.doe@example.com')).toBeInTheDocument();
      // No slip text should appear
      expect(screen.getByText('No slip')).toBeInTheDocument();
    });
  });

  describe('Happy Path Rendering', () => {
    it('renders full name when both firstName and lastName are present', () => {
      render(<BookingManagement />);

      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('renders payment amount with THB suffix', () => {
      render(<BookingManagement />);

      expect(screen.getByText('14,000 THB')).toBeInTheDocument();
    });

    it('renders membership ID when present', () => {
      render(<BookingManagement />);

      expect(screen.getByText('MEM001')).toBeInTheDocument();
    });

    it('renders room type name', () => {
      render(<BookingManagement />);

      expect(screen.getByText('Deluxe Suite')).toBeInTheDocument();
    });

    it('renders slip status badge when slip is present', () => {
      render(<BookingManagement />);

      // Should show slip status (verified)
      expect(screen.getByText('Verified')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('renders no bookings message when list is empty', () => {
      mockBookingsData = [];

      render(<BookingManagement />);

      expect(screen.getByText('No bookings found')).toBeInTheDocument();
    });
  });
});
