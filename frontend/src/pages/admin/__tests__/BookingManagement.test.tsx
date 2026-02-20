import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
        'admin.booking.bookingManagement.table.status': 'Status',
        'admin.booking.bookingManagement.table.actions': 'Actions',
        'admin.booking.bookingManagement.noBookings': 'No bookings found',
        'admin.booking.bookingManagement.allStatuses': 'All',
        'booking.status.confirmed': 'Confirmed',
        'booking.status.cancelled': 'Cancelled',
        'booking.status.completed': 'Completed',
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

// Mock useAdminBookingSSE hook
vi.mock('../../../hooks/useAdminBookingSSE', () => ({
  useAdminBookingSSE: vi.fn(),
}));

// Import component after mocks
import BookingManagement from '../BookingManagement';

describe('BookingManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the page title', async () => {
      render(<BookingManagement />, { wrapper });

      // Wait for initial loading to complete (the stub query resolves immediately)
      await waitFor(() => {
        expect(screen.getByText('Booking Management')).toBeInTheDocument();
      });
    });

    it('should render without crashing', async () => {
      const { container } = render(<BookingManagement />, { wrapper });

      await waitFor(() => {
        expect(container).toBeTruthy();
      });
    });

    it('should render search input', async () => {
      render(<BookingManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search bookings...')).toBeInTheDocument();
      });
    });

    it('should render table headers', async () => {
      render(<BookingManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Created')).toBeInTheDocument();
        expect(screen.getByText('User')).toBeInTheDocument();
        expect(screen.getByText('Room Type')).toBeInTheDocument();
        expect(screen.getByText('Payment')).toBeInTheDocument();
      });
    });
  });

  describe('Empty State', () => {
    it('renders no bookings message when list is empty', async () => {
      render(<BookingManagement />, { wrapper });

      // The stub queryFn returns empty bookings, so we should see the empty state
      await waitFor(() => {
        expect(screen.getByText('No bookings found')).toBeInTheDocument();
      });
    });
  });
});
