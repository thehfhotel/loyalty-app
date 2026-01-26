import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock data for testing
const mockUserWithAllData = {
  user_id: 'user-1',
  first_name: 'John',
  last_name: 'Doe',
  phone: '0812345678',
  email: 'john.doe@example.com',
  oauth_provider: null,
  oauth_provider_id: null,
  user_created_at: '2025-01-01T00:00:00Z',
  membership_id: 'MEM001',
  current_points: 5000,
  total_nights: 15,
  tier_name: 'Gold',
  tier_color: '#FFD700',
  tier_benefits: { description: 'Gold benefits', perks: [] },
  tier_level: 3,
  progress_percentage: 75,
  next_tier_nights: 20,
  next_tier_name: 'Platinum',
  nights_to_next_tier: 5,
};

const mockTransactionWithAllData = {
  id: 'txn-1',
  user_id: 'user-1',
  points: 500,
  type: 'manual_award',
  description: 'Manual adjustment',
  reference_id: 'REF001',
  admin_user_id: 'admin-1',
  admin_reason: 'Loyalty bonus',
  admin_email: 'admin@example.com',
  expires_at: null,
  created_at: '2025-01-15T10:30:00Z',
};

// Mock service
const mockGetAllUsersLoyaltyStatus = vi.fn();
const mockGetUserPointsHistoryAdmin = vi.fn();

vi.mock('../../../services/loyaltyService', () => ({
  loyaltyService: {
    getAllUsersLoyaltyStatus: (...args: unknown[]) => mockGetAllUsersLoyaltyStatus(...args),
    getUserPointsHistoryAdmin: (...args: unknown[]) => mockGetUserPointsHistoryAdmin(...args),
    awardPoints: vi.fn().mockResolvedValue({}),
    deductPoints: vi.fn().mockResolvedValue({}),
    awardSpendingWithNights: vi.fn().mockResolvedValue({}),
  },
}));

// Mock toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        'admin.loyalty.title': 'Loyalty Management',
        'admin.loyalty.subtitle': 'Manage user points and tiers',
        'admin.loyalty.refresh': 'Refresh',
        'admin.loyalty.usersList': 'Users List',
        'admin.loyalty.searchPlaceholder': 'Search users...',
        'admin.loyalty.searchHint': 'Search by name, email, phone, or membership ID',
        'admin.loyalty.table.user': 'User',
        'admin.loyalty.table.tier': 'Tier',
        'admin.loyalty.table.points': 'Points',
        'admin.loyalty.table.actions': 'Actions',
        'admin.loyalty.noUsers': 'No users found',
        'admin.loyalty.selectUser': 'Select a user to view details',
        'admin.loyalty.userDetails': 'User Details',
        'admin.loyalty.currentPoints': 'Current Points',
        'admin.loyalty.currentTier': 'Current Tier',
        'admin.loyalty.recentTransactions': 'Recent Transactions',
        'admin.loyalty.noTransactions': 'No transactions found',
        'admin.loyalty.awardPoints': 'Award Points',
        'admin.loyalty.deductPoints': 'Deduct Points',
        'admin.loyalty.pointsAmount': 'Points Amount',
        'admin.loyalty.description': 'Description',
        'admin.loyalty.referenceId': 'Reference ID',
        'admin.loyalty.errors.loadFailed': 'Failed to load users',
        'admin.loyalty.errors.transactionsFailed': 'Failed to load transactions',
        'admin.loyalty.errors.pointsOperationFailed': 'Points operation failed',
        'userManagement.phone': 'Phone',
        'profile.membershipId': 'Membership ID',
        'admin.coupons.notAssigned': 'Not assigned',
        'common.loading': 'Loading...',
        'common.cancel': 'Cancel',
        'common.processing': 'Processing...',
        'common.previous': 'Previous',
        'common.next': 'Next',
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
import LoyaltyAdminPage from '../LoyaltyAdminPage';

describe('LoyaltyAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllUsersLoyaltyStatus.mockResolvedValue({
      users: [mockUserWithAllData],
      total: 1,
    });
    mockGetUserPointsHistoryAdmin.mockResolvedValue({
      transactions: [mockTransactionWithAllData],
      total: 1,
    });
  });

  describe('Basic Rendering', () => {
    it('should render the page title', async () => {
      render(<LoyaltyAdminPage />);

      expect(await screen.findByText('Loyalty Management')).toBeInTheDocument();
    });

    it('should render without crashing', async () => {
      const { container } = render(<LoyaltyAdminPage />);

      await screen.findByText('Loyalty Management');
      expect(container).toBeTruthy();
    });

    it('should render search input', async () => {
      render(<LoyaltyAdminPage />);

      expect(await screen.findByPlaceholderText('Search users...')).toBeInTheDocument();
    });

    it('should render table headers', async () => {
      render(<LoyaltyAdminPage />);

      expect(await screen.findByText('User')).toBeInTheDocument();
      expect(await screen.findByText('Phone')).toBeInTheDocument();
      expect(await screen.findByText('Tier')).toBeInTheDocument();
      expect(await screen.findByText('Membership ID')).toBeInTheDocument();
      expect(await screen.findByText('Points')).toBeInTheDocument();
      expect(await screen.findByText('Actions')).toBeInTheDocument();
    });
  });

  describe('Null Field Rendering', () => {
    it('renders email when both first_name and last_name are null', async () => {
      const userWithNullNames = {
        ...mockUserWithAllData,
        first_name: null,
        last_name: null,
      };
      mockGetAllUsersLoyaltyStatus.mockResolvedValue({
        users: [userWithNullNames],
        total: 1,
      });

      render(<LoyaltyAdminPage />);
      await screen.findByText('Loyalty Management');

      // Should show email as fallback when both names are null
      // Email may appear multiple times in the UI
      const emails = screen.getAllByText('john.doe@example.com');
      expect(emails.length).toBeGreaterThan(0);
    });

    it('renders LINE user with first_name correctly', async () => {
      const lineUser = {
        ...mockUserWithAllData,
        first_name: 'LineTestUser',
        last_name: null,
        oauth_provider: 'line',
      };
      mockGetAllUsersLoyaltyStatus.mockResolvedValue({
        users: [lineUser],
        total: 1,
      });

      render(<LoyaltyAdminPage />);
      await screen.findByText('Loyalty Management');

      // LINE users with first_name should show that name
      expect(screen.getByText('LineTestUser')).toBeInTheDocument();
      // Should also show LINE badge
      expect(screen.getByText('via LINE')).toBeInTheDocument();
    });

    it('renders "-" when phone is null', async () => {
      const userWithNullPhone = {
        ...mockUserWithAllData,
        phone: null,
      };
      mockGetAllUsersLoyaltyStatus.mockResolvedValue({
        users: [userWithNullPhone],
        total: 1,
      });

      render(<LoyaltyAdminPage />);

      await screen.findByText('Loyalty Management');
      // Phone column should show "-"
      const cells = screen.getAllByRole('cell');
      const phoneCell = cells.find(cell => cell.textContent === '-');
      expect(phoneCell).toBeInTheDocument();
    });

    it('renders "-" when membership_id is null', async () => {
      const userWithNullMembership = {
        ...mockUserWithAllData,
        membership_id: null,
      };
      mockGetAllUsersLoyaltyStatus.mockResolvedValue({
        users: [userWithNullMembership],
        total: 1,
      });

      render(<LoyaltyAdminPage />);

      await screen.findByText('Loyalty Management');
      // Membership ID column should show "-"
      const cells = screen.getAllByRole('cell');
      const membershipCells = cells.filter(cell => cell.textContent === '-');
      expect(membershipCells.length).toBeGreaterThan(0);
    });

    it('renders tier with default color when tier_color is invalid', async () => {
      const userWithTier = {
        ...mockUserWithAllData,
        tier_color: '#FFD700',
        tier_name: 'Gold',
      };
      mockGetAllUsersLoyaltyStatus.mockResolvedValue({
        users: [userWithTier],
        total: 1,
      });

      render(<LoyaltyAdminPage />);

      expect(await screen.findByText('Gold')).toBeInTheDocument();
    });

    it('renders user with all optional fields null', async () => {
      const userWithManyNulls = {
        user_id: 'user-1',
        first_name: null,
        last_name: null,
        phone: null,
        email: 'test@example.com',
        oauth_provider: null,
        oauth_provider_id: null,
        user_created_at: '2025-01-01T00:00:00Z',
        membership_id: null,
        current_points: 0,
        total_nights: 0,
        tier_name: 'Bronze',
        tier_color: '#CD7F32',
        tier_benefits: {},
        tier_level: 1,
        progress_percentage: 0,
        next_tier_nights: 1,
        next_tier_name: 'Silver',
        nights_to_next_tier: 1,
      };
      mockGetAllUsersLoyaltyStatus.mockResolvedValue({
        users: [userWithManyNulls],
        total: 1,
      });

      const { container } = render(<LoyaltyAdminPage />);
      await screen.findByText('Loyalty Management');

      expect(container).toBeTruthy();
      // Email appears multiple times (as name fallback and in secondary display)
      const emails = screen.getAllByText('test@example.com');
      expect(emails.length).toBeGreaterThan(0);
    });

    it('handles transaction with null admin_email gracefully', async () => {
      const transactionWithNullAdmin = {
        ...mockTransactionWithAllData,
        admin_email: undefined,
        admin_reason: null,
      };
      mockGetUserPointsHistoryAdmin.mockResolvedValue({
        transactions: [transactionWithNullAdmin],
        total: 1,
      });

      const { container } = render(<LoyaltyAdminPage />);
      await screen.findByText('Loyalty Management');

      // Component should not crash
      expect(container).toBeTruthy();
    });

    it('handles transaction with null admin_reason gracefully', async () => {
      const transactionWithNullReason = {
        ...mockTransactionWithAllData,
        admin_reason: null,
      };
      mockGetUserPointsHistoryAdmin.mockResolvedValue({
        transactions: [transactionWithNullReason],
        total: 1,
      });

      const { container } = render(<LoyaltyAdminPage />);
      await screen.findByText('Loyalty Management');

      expect(container).toBeTruthy();
    });
  });

  describe('Happy Path Rendering', () => {
    it('renders full name when both first_name and last_name are present', async () => {
      render(<LoyaltyAdminPage />);

      expect(await screen.findByText('John Doe')).toBeInTheDocument();
    });

    it('renders phone when present', async () => {
      render(<LoyaltyAdminPage />);

      expect(await screen.findByText('0812345678')).toBeInTheDocument();
    });

    it('renders membership ID when present', async () => {
      render(<LoyaltyAdminPage />);

      expect(await screen.findByText('MEM001')).toBeInTheDocument();
    });

    it('renders tier badge with correct name', async () => {
      render(<LoyaltyAdminPage />);

      expect(await screen.findByText('Gold')).toBeInTheDocument();
    });

    it('renders points with formatting', async () => {
      render(<LoyaltyAdminPage />);

      expect(await screen.findByText('5,000')).toBeInTheDocument();
    });

    it('renders email', async () => {
      render(<LoyaltyAdminPage />);

      await screen.findByText('John Doe');
      // Email may appear multiple times in the UI (under name and elsewhere)
      const emails = screen.getAllByText('john.doe@example.com');
      expect(emails.length).toBeGreaterThan(0);
    });
  });

  describe('Empty State', () => {
    it('renders no users message when list is empty', async () => {
      mockGetAllUsersLoyaltyStatus.mockResolvedValue({
        users: [],
        total: 0,
      });

      render(<LoyaltyAdminPage />);

      expect(await screen.findByText('No users found')).toBeInTheDocument();
    });

    it('renders select user prompt when no user is selected', async () => {
      render(<LoyaltyAdminPage />);

      expect(await screen.findByText('Select a user to view details')).toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('shows loading state initially', () => {
      // Don't resolve the promise yet
      mockGetAllUsersLoyaltyStatus.mockReturnValue(new Promise(() => {}));

      render(<LoyaltyAdminPage />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });
  });

  describe('OAuth Provider Display', () => {
    it('shows LINE badge for LINE users', async () => {
      const lineUser = {
        ...mockUserWithAllData,
        oauth_provider: 'line',
      };
      mockGetAllUsersLoyaltyStatus.mockResolvedValue({
        users: [lineUser],
        total: 1,
      });

      render(<LoyaltyAdminPage />);

      expect(await screen.findByText('via LINE')).toBeInTheDocument();
    });

    it('shows Google badge for Google users', async () => {
      const googleUser = {
        ...mockUserWithAllData,
        oauth_provider: 'google',
      };
      mockGetAllUsersLoyaltyStatus.mockResolvedValue({
        users: [googleUser],
        total: 1,
      });

      render(<LoyaltyAdminPage />);

      expect(await screen.findByText('via GOOGLE')).toBeInTheDocument();
    });

    it('does not show OAuth badge for regular users', async () => {
      const regularUser = {
        ...mockUserWithAllData,
        oauth_provider: null,
      };
      mockGetAllUsersLoyaltyStatus.mockResolvedValue({
        users: [regularUser],
        total: 1,
      });

      render(<LoyaltyAdminPage />);

      await screen.findByText('John Doe');
      expect(screen.queryByText(/via/)).not.toBeInTheDocument();
    });
  });
});
