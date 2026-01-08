import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock data for testing
const mockUserWithAllData = {
  userId: 'user-1',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john.doe@example.com',
  phone: '0812345678',
  membershipId: 'MEM001',
  role: 'customer',
  isActive: true,
  emailVerified: true,
  avatarUrl: 'https://example.com/avatar.jpg',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const mockStats = {
  total: 100,
  active: 85,
  admins: 5,
  recentlyJoined: 10,
};

// Mock service
const mockGetUsers = vi.fn();
const mockGetUserStats = vi.fn();
const mockGetUserById = vi.fn();

vi.mock('../../../services/userManagementService', () => ({
  userManagementService: {
    getUsers: (...args: unknown[]) => mockGetUsers(...args),
    getUserStats: () => mockGetUserStats(),
    getUserById: (...args: unknown[]) => mockGetUserById(...args),
    updateUserStatus: vi.fn().mockResolvedValue({}),
    updateUserRole: vi.fn().mockResolvedValue({}),
    deleteUser: vi.fn().mockResolvedValue({}),
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
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        'userManagement.title': 'User Management',
        'userManagement.totalUsers': 'Total Users',
        'userManagement.activeUsers': 'Active Users',
        'userManagement.administrators': 'Administrators',
        'userManagement.recentJoins': 'Recent Joins',
        'userManagement.searchPlaceholder': 'Search users...',
        'userManagement.searchHint': 'Search by name, email, phone, or membership ID',
        'userManagement.user': 'User',
        'userManagement.email': 'Email',
        'userManagement.phone': 'Phone',
        'userManagement.role': 'Role',
        'userManagement.status': 'Status',
        'userManagement.joined': 'Joined',
        'userManagement.actions': 'Actions',
        'userManagement.noNameProvided': 'No name provided',
        'userManagement.notProvided': 'Not provided',
        'userManagement.active': 'Active',
        'userManagement.inactive': 'Inactive',
        'userManagement.customer': 'Customer',
        'userManagement.admin': 'Admin',
        'userManagement.superAdmin': 'Super Admin',
        'profile.membershipId': 'Membership ID',
        'admin.coupons.notAssigned': 'Not assigned',
      };
      return translations[key] ?? fallback ?? key;
    },
  }),
}));

// Mock DashboardButton
vi.mock('../../../components/navigation/DashboardButton', () => ({
  default: () => <div data-testid="dashboard-button">Dashboard</div>,
}));

// Import component after mocks
import UserManagement from '../UserManagement';

describe('UserManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUsers.mockResolvedValue({
      data: [mockUserWithAllData],
      pagination: { pages: 1, total: 1 },
    });
    mockGetUserStats.mockResolvedValue({ data: mockStats });
  });

  describe('Basic Rendering', () => {
    it('should render the page title', async () => {
      render(<UserManagement />);

      expect(await screen.findByText('User Management')).toBeInTheDocument();
    });

    it('should render without crashing', async () => {
      const { container } = render(<UserManagement />);

      await screen.findByText('User Management');
      expect(container).toBeTruthy();
    });

    it('should render search input', async () => {
      render(<UserManagement />);

      expect(await screen.findByPlaceholderText('Search users...')).toBeInTheDocument();
    });

    it('should render stats cards', async () => {
      render(<UserManagement />);

      expect(await screen.findByText('100')).toBeInTheDocument();
      expect(await screen.findByText('85')).toBeInTheDocument();
    });
  });

  describe('Null Field Rendering', () => {
    it('renders "No name provided" when both firstName and lastName are null', async () => {
      const userWithNullNames = {
        ...mockUserWithAllData,
        firstName: null,
        lastName: null,
      };
      mockGetUsers.mockResolvedValue({
        data: [userWithNullNames],
        pagination: { pages: 1, total: 1 },
      });

      render(<UserManagement />);

      expect(await screen.findByText('No name provided')).toBeInTheDocument();
    });

    it('renders name when only firstName is available', async () => {
      const userWithOnlyFirstName = {
        ...mockUserWithAllData,
        firstName: 'John',
        lastName: null,
      };
      mockGetUsers.mockResolvedValue({
        data: [userWithOnlyFirstName],
        pagination: { pages: 1, total: 1 },
      });

      render(<UserManagement />);

      expect(await screen.findByText('John')).toBeInTheDocument();
    });

    it('renders name when only lastName is available', async () => {
      const userWithOnlyLastName = {
        ...mockUserWithAllData,
        firstName: null,
        lastName: 'Doe',
      };
      mockGetUsers.mockResolvedValue({
        data: [userWithOnlyLastName],
        pagination: { pages: 1, total: 1 },
      });

      render(<UserManagement />);

      expect(await screen.findByText('Doe')).toBeInTheDocument();
    });

    it('renders "-" when membershipId is null', async () => {
      const userWithNullMembership = {
        ...mockUserWithAllData,
        membershipId: null,
      };
      mockGetUsers.mockResolvedValue({
        data: [userWithNullMembership],
        pagination: { pages: 1, total: 1 },
      });

      render(<UserManagement />);

      await screen.findByText('User Management');
      // Find the table cell with "-" for membership ID
      const cells = screen.getAllByRole('cell');
      const membershipCell = cells.find(cell => cell.textContent === '-');
      expect(membershipCell).toBeInTheDocument();
    });

    it('renders "-" when phone is null', async () => {
      const userWithNullPhone = {
        ...mockUserWithAllData,
        phone: null,
      };
      mockGetUsers.mockResolvedValue({
        data: [userWithNullPhone],
        pagination: { pages: 1, total: 1 },
      });

      render(<UserManagement />);

      await screen.findByText('User Management');
      // Phone column should show "-"
      const cells = screen.getAllByRole('cell');
      const phoneCell = cells.find(cell => cell.textContent === '-');
      expect(phoneCell).toBeInTheDocument();
    });

    it('renders default avatar when avatarUrl is null', async () => {
      const userWithNullAvatar = {
        ...mockUserWithAllData,
        avatarUrl: null,
      };
      mockGetUsers.mockResolvedValue({
        data: [userWithNullAvatar],
        pagination: { pages: 1, total: 1 },
      });

      render(<UserManagement />);

      await screen.findByText('User Management');
      // Should not have img element, should have fallback div
      const images = screen.queryAllByRole('img');
      expect(images).toHaveLength(0);
    });

    it('renders user with all optional fields null', async () => {
      const userWithManyNulls = {
        userId: 'user-1',
        firstName: null,
        lastName: null,
        email: 'test@example.com',
        phone: null,
        membershipId: null,
        role: 'customer',
        isActive: true,
        emailVerified: false,
        avatarUrl: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };
      mockGetUsers.mockResolvedValue({
        data: [userWithManyNulls],
        pagination: { pages: 1, total: 1 },
      });

      // Should not crash
      const { container } = render(<UserManagement />);
      await screen.findByText('User Management');

      expect(container).toBeTruthy();
      expect(screen.getByText('No name provided')).toBeInTheDocument();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });
  });

  describe('Happy Path Rendering', () => {
    it('renders full name when both firstName and lastName are present', async () => {
      render(<UserManagement />);

      expect(await screen.findByText('John Doe')).toBeInTheDocument();
    });

    it('renders email', async () => {
      render(<UserManagement />);

      expect(await screen.findByText('john.doe@example.com')).toBeInTheDocument();
    });

    it('renders phone when present', async () => {
      render(<UserManagement />);

      expect(await screen.findByText('0812345678')).toBeInTheDocument();
    });

    it('renders membership ID when present', async () => {
      render(<UserManagement />);

      expect(await screen.findByText('MEM001')).toBeInTheDocument();
    });

    it('renders active status badge', async () => {
      render(<UserManagement />);

      expect(await screen.findByText('Active')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('renders empty table when no users', async () => {
      mockGetUsers.mockResolvedValue({
        data: [],
        pagination: { pages: 0, total: 0 },
      });

      render(<UserManagement />);

      await screen.findByText('User Management');
      // Table should be empty (no user rows)
      const rows = screen.queryAllByRole('row');
      // Only header row should exist
      expect(rows.length).toBeLessThanOrEqual(2);
    });
  });
});
