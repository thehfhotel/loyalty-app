import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock data for testing
const mockRoomTypeWithAllData = {
  id: 'room-type-1',
  name: 'Deluxe Suite',
  description: 'A luxurious suite with ocean view',
  pricePerNight: 5000,
  maxGuests: 2,
  bedType: 'king' as const,
  amenities: ['wifi', 'airConditioning', 'minibar'],
  images: ['https://example.com/image1.jpg'],
  isActive: true,
  sortOrder: 1,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

// Mock tRPC hooks
let mockRoomTypesData = [mockRoomTypeWithAllData];

vi.mock('../../../utils/trpc', () => ({
  trpc: {
    useUtils: () => ({
      booking: {
        admin: {
          getRoomTypes: { invalidate: vi.fn() },
        },
      },
    }),
    booking: {
      admin: {
        getRoomTypes: {
          useQuery: vi.fn(() => ({
            data: mockRoomTypesData,
            isLoading: false,
            error: null,
          })),
        },
        createRoomType: {
          useMutation: vi.fn(() => ({
            mutate: vi.fn(),
            isPending: false,
          })),
        },
        updateRoomType: {
          useMutation: vi.fn(() => ({
            mutate: vi.fn(),
            isPending: false,
          })),
        },
        deleteRoomType: {
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
    mockRoomTypesData = [mockRoomTypeWithAllData];
  });

  describe('Basic Rendering', () => {
    it('should render the page title', () => {
      render(<RoomTypeManagement />);

      expect(screen.getByText('Room Type Management')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(<RoomTypeManagement />);

      expect(container).toBeTruthy();
    });

    it('should render table headers', () => {
      render(<RoomTypeManagement />);

      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Price Per Night')).toBeInTheDocument();
      expect(screen.getByText('Max Guests')).toBeInTheDocument();
      expect(screen.getByText('Bed Type')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });
  });

  describe('Null Field Rendering', () => {
    it('renders gracefully when description is null', () => {
      const roomTypeWithNullDescription = {
        ...mockRoomTypeWithAllData,
        description: null,
      };
      mockRoomTypesData = [roomTypeWithNullDescription];

      // Should not crash
      const { container } = render(<RoomTypeManagement />);
      expect(container).toBeTruthy();

      // Name should still be displayed
      expect(screen.getByText('Deluxe Suite')).toBeInTheDocument();
    });

    it('renders "-" when bedType is null', () => {
      const roomTypeWithNullBedType = {
        ...mockRoomTypeWithAllData,
        bedType: null,
      };
      mockRoomTypesData = [roomTypeWithNullBedType];

      render(<RoomTypeManagement />);

      // Bed type column should show "-"
      const cells = screen.getAllByRole('cell');
      const bedTypeCell = cells.find(cell => cell.textContent === '-');
      expect(bedTypeCell).toBeInTheDocument();
    });

    it('renders room type with both description and bedType null', () => {
      const roomTypeWithManyNulls = {
        ...mockRoomTypeWithAllData,
        description: null,
        bedType: null,
      };
      mockRoomTypesData = [roomTypeWithManyNulls];

      // Should not crash and render properly
      const { container } = render(<RoomTypeManagement />);
      expect(container).toBeTruthy();

      // Name should still be displayed
      expect(screen.getByText('Deluxe Suite')).toBeInTheDocument();

      // Bed type column should show "-"
      const cells = screen.getAllByRole('cell');
      const dashCell = cells.find(cell => cell.textContent === '-');
      expect(dashCell).toBeInTheDocument();
    });

    it('renders room type with empty amenities array', () => {
      const roomTypeWithEmptyAmenities = {
        ...mockRoomTypeWithAllData,
        amenities: [],
      };
      mockRoomTypesData = [roomTypeWithEmptyAmenities];

      // Should not crash
      const { container } = render(<RoomTypeManagement />);
      expect(container).toBeTruthy();

      // Name and other fields should still be displayed
      expect(screen.getByText('Deluxe Suite')).toBeInTheDocument();
    });

    it('renders room type with empty images array', () => {
      const roomTypeWithEmptyImages = {
        ...mockRoomTypeWithAllData,
        images: [],
      };
      mockRoomTypesData = [roomTypeWithEmptyImages];

      // Should not crash
      const { container } = render(<RoomTypeManagement />);
      expect(container).toBeTruthy();

      // Name should still be displayed
      expect(screen.getByText('Deluxe Suite')).toBeInTheDocument();
    });
  });

  describe('Happy Path Rendering', () => {
    it('renders room type name', () => {
      render(<RoomTypeManagement />);

      expect(screen.getByText('Deluxe Suite')).toBeInTheDocument();
    });

    it('renders description when present', () => {
      render(<RoomTypeManagement />);

      expect(screen.getByText('A luxurious suite with ocean view')).toBeInTheDocument();
    });

    it('renders max guests with label', () => {
      render(<RoomTypeManagement />);

      expect(screen.getByText('2 guests')).toBeInTheDocument();
    });

    it('renders bed type when present', () => {
      render(<RoomTypeManagement />);

      expect(screen.getByText('King')).toBeInTheDocument();
    });

    it('renders active status badge', () => {
      render(<RoomTypeManagement />);

      expect(screen.getByText('Active')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('renders no room types message when list is empty', () => {
      mockRoomTypesData = [];

      render(<RoomTypeManagement />);

      expect(screen.getByText('No room types found')).toBeInTheDocument();
    });
  });
});
