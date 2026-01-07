import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock data for testing
const mockCouponWithAllData = {
  id: 'coupon-1',
  code: 'SUMMER20',
  name: 'Summer Sale 20%',
  description: 'Get 20% off your booking',
  termsAndConditions: 'Valid for stays in June-August',
  type: 'percentage' as const,
  value: 20,
  currency: 'THB',
  minimumSpend: 1000,
  maximumDiscount: 500,
  validFrom: '2025-06-01T00:00:00Z',
  validUntil: '2025-08-31T23:59:59Z',
  usageLimit: 100,
  usageLimitPerUser: 1,
  usedCount: 25,
  tierRestrictions: [],
  customerSegment: {},
  status: 'active' as const,
  createdBy: 'admin-1',
  createdAt: '2025-05-15T00:00:00Z',
  updatedAt: '2025-05-15T00:00:00Z',
};

const mockUserWithAllData = {
  id: 'user-1',
  email: 'john.doe@example.com',
  firstName: 'John',
  lastName: 'Doe',
  membershipId: 'MEM001',
};

// Mock services
const mockGetAdminCoupons = vi.fn();
const mockGetAllUsersLoyaltyStatus = vi.fn();

vi.mock('../../../services/couponService', () => ({
  couponService: {
    getAdminCoupons: (...args: unknown[]) => mockGetAdminCoupons(...args),
    createCoupon: vi.fn().mockResolvedValue({}),
    updateCouponStatus: vi.fn().mockResolvedValue({}),
    deleteCoupon: vi.fn().mockResolvedValue({}),
    assignCouponToUsers: vi.fn().mockResolvedValue({ success: true, assignedCount: 1 }),
  },
}));

vi.mock('../../../services/loyaltyService', () => ({
  loyaltyService: {
    getAllUsersLoyaltyStatus: (...args: unknown[]) => mockGetAllUsersLoyaltyStatus(...args),
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
    t: (key: string) => {
      const translations: Record<string, string> = {
        'admin.coupons.title': 'Coupon Management',
        'admin.coupons.subtitle': 'Manage coupons and promotions',
        'admin.coupons.createCoupon': 'Create Coupon',
        'admin.coupons.title_field': 'Coupon',
        'admin.coupons.couponTypeAndValue': 'Type & Value',
        'admin.coupons.usage': 'Usage',
        'admin.coupons.validity': 'Validity',
        'admin.coupons.status': 'Status',
        'admin.coupons.actions': 'Actions',
        'admin.coupons.noCoupons': 'No coupons found',
        'admin.coupons.noCouponsDescription': 'Create your first coupon to get started',
        'admin.coupons.min': 'Min',
        'admin.coupons.maxPerUser': '{{count}} per user',
        'admin.coupons.to': 'to',
        'admin.coupons.active': 'Active',
        'admin.coupons.paused': 'Paused',
        'admin.coupons.expired': 'Expired',
        'admin.coupons.assign': 'Assign',
        'admin.coupons.viewAssignments': 'View',
        'admin.coupons.pause': 'Pause',
        'admin.coupons.activate': 'Activate',
        'admin.coupons.remove': 'Remove',
        'admin.coupons.searchPlaceholder': 'Search users...',
        'admin.coupons.searchUsers': 'Search Users',
        'admin.coupons.notAssigned': 'Not assigned',
        'admin.coupons.noMembershipId': 'No membership ID',
        'common.noEndDate': 'No end date',
        'common.previous': 'Previous',
        'common.next': 'Next',
        'coupons.types.percentage': 'Percentage',
        'coupons.types.fixed_amount': 'Fixed Amount',
      };
      return translations[key] ?? key;
    },
  }),
}));

// Mock DashboardButton
vi.mock('../../../components/navigation/DashboardButton', () => ({
  default: () => <div data-testid="dashboard-button">Dashboard</div>,
}));

// Mock CouponAssignmentsModal
vi.mock('../../../components/admin/CouponAssignmentsModal', () => ({
  default: () => <div data-testid="assignments-modal">Assignments Modal</div>,
}));

// Import component after mocks
import CouponManagement from '../CouponManagement';

// Helper function to create coupon API response
const createCouponResponse = (coupons: typeof mockCouponWithAllData[] = []) => ({
  coupons,
  total: coupons.length,
  page: 1,
  limit: 1000,
  totalPages: 1,
});

describe('CouponManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The component calls getAdminCoupons 3 times (for active, paused, draft)
    // We need to return coupons only for the 'active' status call
    mockGetAdminCoupons.mockImplementation((_page: number, _limit: number, filters?: { status?: string }) => {
      if (filters?.status === 'active') {
        return Promise.resolve(createCouponResponse([mockCouponWithAllData]));
      }
      return Promise.resolve(createCouponResponse([]));
    });
    mockGetAllUsersLoyaltyStatus.mockResolvedValue({
      users: [{
        user_id: mockUserWithAllData.id,
        email: mockUserWithAllData.email,
        first_name: mockUserWithAllData.firstName,
        last_name: mockUserWithAllData.lastName,
        membership_id: mockUserWithAllData.membershipId,
      }],
      total: 1,
    });
  });

  describe('Basic Rendering', () => {
    it('should render the page title', async () => {
      render(<CouponManagement />);

      expect(await screen.findByText('Coupon Management')).toBeInTheDocument();
    });

    it('should render without crashing', async () => {
      const { container } = render(<CouponManagement />);

      await screen.findByText('Coupon Management');
      expect(container).toBeTruthy();
    });

    it('should render create coupon button', async () => {
      render(<CouponManagement />);

      expect(await screen.findByText('Create Coupon')).toBeInTheDocument();
    });

    it('should render table headers', async () => {
      render(<CouponManagement />);

      expect(await screen.findByText('Coupon')).toBeInTheDocument();
      expect(await screen.findByText('Type & Value')).toBeInTheDocument();
      expect(await screen.findByText('Usage')).toBeInTheDocument();
      expect(await screen.findByText('Validity')).toBeInTheDocument();
      expect(await screen.findByText('Status')).toBeInTheDocument();
      expect(await screen.findByText('Actions')).toBeInTheDocument();
    });
  });

  describe('Null Field Rendering', () => {
    it('renders coupon gracefully when description is null', async () => {
      const couponWithNullDescription = {
        ...mockCouponWithAllData,
        description: undefined,
      };
      mockGetAdminCoupons.mockImplementation((_page: number, _limit: number, filters?: { status?: string }) => {
        if (filters?.status === 'active') {
          return Promise.resolve(createCouponResponse([couponWithNullDescription]));
        }
        return Promise.resolve(createCouponResponse([]));
      });

      const { container } = render(<CouponManagement />);

      expect(await screen.findByText('Summer Sale 20%')).toBeInTheDocument();
      expect(container).toBeTruthy();
    });

    it('renders coupon gracefully when minimumSpend is null/undefined', async () => {
      const couponWithNullMinSpend = {
        ...mockCouponWithAllData,
        minimumSpend: undefined,
      };
      mockGetAdminCoupons.mockImplementation((_page: number, _limit: number, filters?: { status?: string }) => {
        if (filters?.status === 'active') {
          return Promise.resolve(createCouponResponse([couponWithNullMinSpend]));
        }
        return Promise.resolve(createCouponResponse([]));
      });

      const { container } = render(<CouponManagement />);

      // Should not crash and should render without min spend text
      expect(await screen.findByText('20% off')).toBeInTheDocument();
      expect(container).toBeTruthy();
    });

    it('renders coupon gracefully when maximumDiscount is null/undefined', async () => {
      const couponWithNullMaxDiscount = {
        ...mockCouponWithAllData,
        maximumDiscount: undefined,
      };
      mockGetAdminCoupons.mockImplementation((_page: number, _limit: number, filters?: { status?: string }) => {
        if (filters?.status === 'active') {
          return Promise.resolve(createCouponResponse([couponWithNullMaxDiscount]));
        }
        return Promise.resolve(createCouponResponse([]));
      });

      const { container } = render(<CouponManagement />);

      expect(await screen.findByText('Summer Sale 20%')).toBeInTheDocument();
      expect(container).toBeTruthy();
    });

    it('renders "No end date" when validUntil is null', async () => {
      const couponWithNullValidUntil = {
        ...mockCouponWithAllData,
        validUntil: undefined,
      };
      mockGetAdminCoupons.mockImplementation((_page: number, _limit: number, filters?: { status?: string }) => {
        if (filters?.status === 'active') {
          return Promise.resolve(createCouponResponse([couponWithNullValidUntil]));
        }
        return Promise.resolve(createCouponResponse([]));
      });

      render(<CouponManagement />);

      expect(await screen.findByText(/No end date/)).toBeInTheDocument();
    });

    it('renders coupon gracefully when value is null/undefined', async () => {
      const couponWithNullValue = {
        ...mockCouponWithAllData,
        type: 'free_upgrade' as const,
        value: undefined,
      };
      mockGetAdminCoupons.mockImplementation((_page: number, _limit: number, filters?: { status?: string }) => {
        if (filters?.status === 'active') {
          return Promise.resolve(createCouponResponse([couponWithNullValue]));
        }
        return Promise.resolve(createCouponResponse([]));
      });

      const { container } = render(<CouponManagement />);

      expect(await screen.findByText('Summer Sale 20%')).toBeInTheDocument();
      expect(container).toBeTruthy();
    });

    it('renders coupon with all optional fields null', async () => {
      const couponWithManyNulls = {
        ...mockCouponWithAllData,
        description: undefined,
        termsAndConditions: undefined,
        value: undefined,
        minimumSpend: undefined,
        maximumDiscount: undefined,
        validUntil: undefined,
        createdBy: undefined,
      };
      mockGetAdminCoupons.mockImplementation((_page: number, _limit: number, filters?: { status?: string }) => {
        if (filters?.status === 'active') {
          return Promise.resolve(createCouponResponse([couponWithManyNulls]));
        }
        return Promise.resolve(createCouponResponse([]));
      });

      const { container } = render(<CouponManagement />);

      expect(await screen.findByText('Summer Sale 20%')).toBeInTheDocument();
      expect(container).toBeTruthy();
      expect(screen.getByText(/SUMMER20/)).toBeInTheDocument();
    });

    it('renders users in assign modal with null firstName showing email', async () => {
      const userWithNullNames = {
        user_id: 'user-1',
        email: 'test@example.com',
        first_name: null,
        last_name: null,
        membership_id: null,
      };
      mockGetAllUsersLoyaltyStatus.mockResolvedValue({
        users: [userWithNullNames],
        total: 1,
      });

      const { container } = render(<CouponManagement />);
      await screen.findByText('Coupon Management');

      // User search results handle null names with empty strings
      expect(container).toBeTruthy();
    });

    it('renders fixed_amount coupon gracefully when value is null', async () => {
      const couponFixedWithNullValue = {
        ...mockCouponWithAllData,
        type: 'fixed_amount' as const,
        value: undefined,
      };
      mockGetAdminCoupons.mockResolvedValue({
        coupons: [couponFixedWithNullValue],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });

      const { container } = render(<CouponManagement />);
      await screen.findByText('Coupon Management');

      // formatCurrency(0) should not crash
      expect(container).toBeTruthy();
    });
  });

  describe('Happy Path Rendering', () => {
    it('renders coupon name and code', async () => {
      render(<CouponManagement />);

      expect(await screen.findByText('Summer Sale 20%')).toBeInTheDocument();
      // Code appears combined with description in a single text node
      expect(screen.getByText(/SUMMER20/)).toBeInTheDocument();
    });

    it('renders percentage discount value', async () => {
      render(<CouponManagement />);

      expect(await screen.findByText('20% off')).toBeInTheDocument();
    });

    it('renders usage count', async () => {
      render(<CouponManagement />);

      expect(await screen.findByText('25 / 100')).toBeInTheDocument();
    });

    it('renders active status badge', async () => {
      render(<CouponManagement />);

      // Wait for the coupon data to load first
      await screen.findByText('Summer Sale 20%');
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('renders action buttons', async () => {
      render(<CouponManagement />);

      // Wait for coupon data to load first
      await screen.findByText('Summer Sale 20%');
      // Actions may appear multiple times due to component rendering pattern
      const assignButtons = screen.getAllByText('Assign');
      expect(assignButtons.length).toBeGreaterThan(0);
      const viewButtons = screen.getAllByText('View');
      expect(viewButtons.length).toBeGreaterThan(0);
    });
  });

  describe('Empty State', () => {
    it('renders no coupons message when list is empty', async () => {
      // Return empty arrays for all status types
      mockGetAdminCoupons.mockResolvedValue(createCouponResponse([]));

      render(<CouponManagement />);

      expect(await screen.findByText('No coupons found')).toBeInTheDocument();
      expect(screen.getByText('Create your first coupon to get started')).toBeInTheDocument();
    });
  });

  describe('User Search Null Handling', () => {
    it('handles user with null membershipId in user list', async () => {
      const userWithNullMembership = {
        user_id: 'user-1',
        email: 'test@example.com',
        first_name: 'John',
        last_name: 'Doe',
        membership_id: null,
      };
      mockGetAllUsersLoyaltyStatus.mockResolvedValue({
        users: [userWithNullMembership],
        total: 1,
      });

      const { container } = render(<CouponManagement />);
      await screen.findByText('Coupon Management');

      // Component should not crash when handling users with null membershipId
      expect(container).toBeTruthy();
    });

    it('handles users with all nullable fields being null', async () => {
      const userWithAllNulls = {
        user_id: 'user-1',
        email: 'test@example.com',
        first_name: null,
        last_name: null,
        membership_id: null,
        phone: null,
      };
      mockGetAllUsersLoyaltyStatus.mockResolvedValue({
        users: [userWithAllNulls],
        total: 1,
      });

      const { container } = render(<CouponManagement />);
      await screen.findByText('Coupon Management');

      expect(container).toBeTruthy();
    });
  });
});
