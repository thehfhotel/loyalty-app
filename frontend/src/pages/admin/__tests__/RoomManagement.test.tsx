import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock data for testing
const mockRoomWithAllData = {
  id: 'room-1',
  roomTypeId: 'room-type-1',
  roomNumber: '101',
  floor: 1,
  notes: 'Near elevator',
  isActive: true,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  roomType: {
    id: 'room-type-1',
    name: 'Deluxe Suite',
  },
};

const mockRoomType = {
  id: 'room-type-1',
  name: 'Deluxe Suite',
  isActive: true,
};

// Mock tRPC hooks
let mockRoomsData = [mockRoomWithAllData];
let mockRoomTypesData = [mockRoomType];

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      booking: {
        admin: {
          getRooms: { invalidate: vi.fn() },
          getRoomTypes: { invalidate: vi.fn() },
        },
      },
    }),
    booking: {
      admin: {
        getRooms: {
          useQuery: vi.fn(() => ({
            data: mockRoomsData,
            isLoading: false,
            error: null,
          })),
        },
        getRoomTypes: {
          useQuery: vi.fn(() => ({
            data: mockRoomTypesData,
            isLoading: false,
            error: null,
          })),
        },
        createRoom: {
          useMutation: vi.fn(() => ({
            mutate: vi.fn(),
            isPending: false,
          })),
        },
        updateRoom: {
          useMutation: vi.fn(() => ({
            mutate: vi.fn(),
            isPending: false,
          })),
        },
        deleteRoom: {
          useMutation: vi.fn(() => ({
            mutate: vi.fn(),
            isPending: false,
          })),
        },
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
    mockRoomsData = [mockRoomWithAllData];
    mockRoomTypesData = [mockRoomType];
  });

  describe('Basic Rendering', () => {
    it('should render the page title', () => {
      render(<RoomManagement />);

      expect(screen.getByText('Room Management')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(<RoomManagement />);

      expect(container).toBeTruthy();
    });

    it('should render table headers', () => {
      render(<RoomManagement />);

      expect(screen.getByText('Room Number')).toBeInTheDocument();
      expect(screen.getByText('Floor')).toBeInTheDocument();
      expect(screen.getByText('Room Type')).toBeInTheDocument();
      expect(screen.getByText('Notes')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });
  });

  describe('Null Field Rendering', () => {
    it('renders "-" when floor is null', () => {
      const roomWithNullFloor = {
        ...mockRoomWithAllData,
        floor: null,
      };
      mockRoomsData = [roomWithNullFloor];

      render(<RoomManagement />);

      // Floor column should show "-"
      const cells = screen.getAllByRole('cell');
      const floorCell = cells.find(cell => cell.textContent === '-');
      expect(floorCell).toBeInTheDocument();
    });

    it('renders "-" when notes is null', () => {
      const roomWithNullNotes = {
        ...mockRoomWithAllData,
        notes: null,
      };
      mockRoomsData = [roomWithNullNotes];

      render(<RoomManagement />);

      // Notes column should show "-"
      const cells = screen.getAllByRole('cell');
      // Count cells with "-" (floor should still be 1, notes should be "-")
      const dashCells = cells.filter(cell => cell.textContent === '-');
      expect(dashCells.length).toBeGreaterThanOrEqual(1);
    });

    it('renders room with both floor and notes null', () => {
      const roomWithManyNulls = {
        ...mockRoomWithAllData,
        floor: null,
        notes: null,
      };
      mockRoomsData = [roomWithManyNulls];

      // Should not crash and render properly
      const { container } = render(<RoomManagement />);
      expect(container).toBeTruthy();

      // Both floor and notes columns should show "-"
      const cells = screen.getAllByRole('cell');
      const dashCells = cells.filter(cell => cell.textContent === '-');
      expect(dashCells.length).toBeGreaterThanOrEqual(2);
    });

    it('renders room number when other fields are null', () => {
      const roomWithNulls = {
        ...mockRoomWithAllData,
        floor: null,
        notes: null,
      };
      mockRoomsData = [roomWithNulls];

      render(<RoomManagement />);

      // Room number should still be displayed
      expect(screen.getByText('101')).toBeInTheDocument();
    });
  });

  describe('Happy Path Rendering', () => {
    it('renders room number', () => {
      render(<RoomManagement />);

      expect(screen.getByText('101')).toBeInTheDocument();
    });

    it('renders floor when present', () => {
      render(<RoomManagement />);

      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('renders notes when present', () => {
      render(<RoomManagement />);

      expect(screen.getByText('Near elevator')).toBeInTheDocument();
    });

    it('renders room type name in table', () => {
      render(<RoomManagement />);

      // Room type appears in both the filter dropdown and the table cell
      // Use getAllByText to verify it's present at least in the table
      const elements = screen.getAllByText('Deluxe Suite');
      expect(elements.length).toBeGreaterThanOrEqual(1);

      // Verify it's in a table cell specifically
      const cells = screen.getAllByRole('cell');
      const roomTypeCell = cells.find(cell => cell.textContent === 'Deluxe Suite');
      expect(roomTypeCell).toBeInTheDocument();
    });

    it('renders active status badge', () => {
      render(<RoomManagement />);

      expect(screen.getByText('Active')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('renders no rooms message when list is empty', () => {
      mockRoomsData = [];

      render(<RoomManagement />);

      expect(screen.getByText('No rooms found')).toBeInTheDocument();
    });
  });
});
