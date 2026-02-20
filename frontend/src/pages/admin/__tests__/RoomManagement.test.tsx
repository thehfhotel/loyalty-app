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
        'admin.booking.rooms.title': 'Room Management',
        'admin.booking.rooms.subtitle': 'Manage hotel rooms',
        'admin.booking.rooms.roomNumber': 'Room Number',
        'admin.booking.rooms.floor': 'Floor',
        'admin.booking.rooms.roomType': 'Room Type',
        'admin.booking.rooms.notes': 'Notes',
        'admin.booking.rooms.status': 'Status',
        'admin.booking.rooms.actions': 'Actions',
        'admin.booking.rooms.createRoom': 'Create Room',
        'admin.booking.rooms.noRooms': 'No rooms found',
        'admin.booking.rooms.noRoomsDescription': 'Create your first room',
        'admin.booking.rooms.filterByType': 'Filter by type',
        'admin.booking.rooms.allRoomTypes': 'All room types',
        'admin.booking.rooms.noRoomTypesWarning': 'No room types warning',
        'admin.booking.rooms.createRoomTypesFirst': 'Create room types first',
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
import RoomManagement from '../RoomManagement';

describe('RoomManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the page title', async () => {
      render(<RoomManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Room Management')).toBeInTheDocument();
      });
    });

    it('should render without crashing', () => {
      const { container } = render(<RoomManagement />, { wrapper });

      expect(container).toBeTruthy();
    });

    it('should render table headers', async () => {
      render(<RoomManagement />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Room Number')).toBeInTheDocument();
        expect(screen.getByText('Floor')).toBeInTheDocument();
        expect(screen.getByText('Room Type')).toBeInTheDocument();
        expect(screen.getByText('Notes')).toBeInTheDocument();
        expect(screen.getByText('Status')).toBeInTheDocument();
        expect(screen.getByText('Actions')).toBeInTheDocument();
      });
    });
  });

  describe('Empty State', () => {
    it('renders no rooms message when list is empty', async () => {
      render(<RoomManagement />, { wrapper });

      // The stub queryFn returns [], so we should see the empty state
      await waitFor(() => {
        expect(screen.getByText('No rooms found')).toBeInTheDocument();
      });
    });
  });
});
