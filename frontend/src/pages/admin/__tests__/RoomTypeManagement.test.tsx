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
        'admin.booking.roomTypes.title': 'Room Type Management',
        'admin.booking.roomTypes.subtitle': 'Manage room types and pricing',
        'admin.booking.roomTypes.name': 'Name',
        'admin.booking.roomTypes.pricePerNight': 'Price Per Night',
        'admin.booking.roomTypes.maxGuests': 'Max Guests',
        'admin.booking.roomTypes.bedType': 'Bed Type',
        'admin.booking.roomTypes.status': 'Status',
        'admin.booking.roomTypes.actions': 'Actions',
        'admin.booking.roomTypes.createRoomType': 'Create Room Type',
        'admin.booking.roomTypes.noRoomTypes': 'No room types found',
        'admin.booking.roomTypes.noRoomTypesDescription': 'Create your first room type',
        'admin.booking.roomTypes.guests': 'guests',
        'admin.booking.roomTypes.bedTypes.single': 'Single',
        'admin.booking.roomTypes.bedTypes.double': 'Double',
        'admin.booking.roomTypes.bedTypes.twin': 'Twin',
        'admin.booking.roomTypes.bedTypes.king': 'King',
        'common.active': 'Active',
        'common.inactive': 'Inactive',
        'common.edit': 'Edit',
        'common.delete': 'Delete',
      };
      return translations[key] ?? key;
    },
  }),
}));

// Mock DashboardButton
vi.mock('../../../components/navigation/DashboardButton', () => ({
  default: () => <div data-testid="dashboard-button">Dashboard</div>,
}));

// Import component after mocks
import RoomTypeManagement from '../RoomTypeManagement';

describe('RoomTypeManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the page title', async () => {
      render(<RoomTypeManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Room Type Management')).toBeInTheDocument();
      });
    });

    it('should render without crashing', () => {
      const { container } = render(<RoomTypeManagement />, { wrapper });

      expect(container).toBeTruthy();
    });

    it('should render table headers', async () => {
      render(<RoomTypeManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Name')).toBeInTheDocument();
        expect(screen.getByText('Price Per Night')).toBeInTheDocument();
        expect(screen.getByText('Max Guests')).toBeInTheDocument();
        expect(screen.getByText('Bed Type')).toBeInTheDocument();
        expect(screen.getByText('Status')).toBeInTheDocument();
        expect(screen.getByText('Actions')).toBeInTheDocument();
      });
    });
  });

  describe('Empty State', () => {
    it('renders no room types message when list is empty', async () => {
      render(<RoomTypeManagement />, { wrapper });

      // The stub queryFn returns [], so we should see the empty state
      await waitFor(() => {
        expect(screen.getByText('No room types found')).toBeInTheDocument();
      });
    });
  });
});
