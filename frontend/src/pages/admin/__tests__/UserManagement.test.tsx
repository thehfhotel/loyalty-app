import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';

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

// Mock react-i18next. `t` must keep one stable identity across renders —
// same as the real hook — because UserManagement's fetchUsers/fetchStats
// callbacks depend on it ([t] in their useCallback deps); a `t` that were
// re-created on every call would make those callbacks re-identify every
// render and defeat the mount/search fetch-count guarantees below.
const { t } = vi.hoisted(() => {
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
    'userManagement.viewDetails': 'View Details',
    'userManagement.deactivate': 'Deactivate',
    'userManagement.activate': 'Activate',
    'userManagement.deleteUser': 'Delete User',
    'userManagement.delete': 'Delete',
    'userManagement.cancel': 'Cancel',
    'userManagement.userDetails': 'User Details',
    'userManagement.name': 'Name',
    'userManagement.emailVerified': 'Email Verified',
    'userManagement.yes': 'Yes',
    'userManagement.no': 'No',
    'userManagement.confirmDelete': 'Are you sure you want to delete {{name}}? This action cannot be undone.',
    'profile.membershipId': 'Membership ID',
    'admin.coupons.notAssigned': 'Not assigned',
  };
  return {
    t: (key: string, fallback?: string) => translations[key] ?? fallback ?? key,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t }),
}));

// Mock AppShell — its own AdminTopBar/AdminNavRail behavior is covered by
// AppShell's/AdminTopBar's dedicated test suites.
vi.mock('../../../components/layout/AppShell', () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="app-shell">
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

// Import component after mocks
import UserManagement from '../UserManagement';

// The Table primitive dual-renders a desktop <table> and a mobile card list
// simultaneously (CSS controls which is visible) — scope row-content
// assertions to the desktop table to avoid ambiguous duplicate matches.
function getDesktopTable() {
  return screen.getByRole('table');
}

// Mount performs exactly one fetch (see "Fetch behavior" below), but a
// search-term or page change still flips `isSearching` and makes <Table
// loading> swap every row for a Skeleton while the fetch resolves. A bare
// `expect(await findByText(x)).toBeInTheDocument()` can capture a row node
// that a later render tears back out of the DOM before the assertion runs.
//
// Re-querying inside waitFor removes that race: it retries through any
// skeleton window and only ever asserts on a node that is live at assertion
// time.
async function expectTextInTable(text: string) {
  await waitFor(() => {
    expect(within(getDesktopTable()).getByText(text)).toBeInTheDocument();
  });
}

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

      await waitFor(() => {
        expect(screen.getByText('User Management')).toBeInTheDocument();
      });
    });

    it('should render without crashing', async () => {
      const { container } = render(<UserManagement />);

      await screen.findByText('User Management');
      expect(container).toBeTruthy();
    });

    it('should render search input', async () => {
      render(<UserManagement />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search users...')).toBeInTheDocument();
      });
    });

    it('should render stats cards', async () => {
      render(<UserManagement />);

      await waitFor(() => {
        expect(screen.getByText('100')).toBeInTheDocument();
        expect(screen.getByText('85')).toBeInTheDocument();
      });
    });
  });

  describe('Fetch behavior', () => {
    it('fetches users exactly once on mount', async () => {
      render(<UserManagement />);

      await expectTextInTable('John Doe');

      // The auto-search effect re-runs the instant `initialLoading` flips to
      // false; if the mount-skip guard regressed, this would observe a
      // second identical call here.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
      });

      expect(mockGetUsers).toHaveBeenCalledTimes(1);
      expect(mockGetUsers).toHaveBeenCalledWith(1, 10, '');
      expect(mockGetUserStats).toHaveBeenCalledTimes(1);
    });

    it('fetches users exactly once per search term change', async () => {
      render(<UserManagement />);
      await expectTextInTable('John Doe');
      mockGetUsers.mockClear();

      const input = screen.getByPlaceholderText('Search users...');
      fireEvent.change(input, { target: { value: 'jane' } });

      await waitFor(() => {
        expect(mockGetUsers).toHaveBeenCalledTimes(1);
      });
      expect(mockGetUsers).toHaveBeenCalledWith(1, 10, 'jane');

      // A second, distinct search change fetches exactly once more.
      mockGetUsers.mockClear();
      fireEvent.change(input, { target: { value: 'jane doe' } });

      await waitFor(() => {
        expect(mockGetUsers).toHaveBeenCalledTimes(1);
      });
      expect(mockGetUsers).toHaveBeenCalledWith(1, 10, 'jane doe');
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

      await expectTextInTable('No name provided');
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

      await expectTextInTable('John');
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

      await expectTextInTable('Doe');
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

      // Find the table cell with "-" for membership ID. Re-query inside
      // waitFor: during the post-load re-fetch every cell holds a Skeleton.
      await waitFor(() => {
        const cells = screen.getAllByRole('cell');
        const membershipCell = cells.find(cell => cell.textContent === '-');
        expect(membershipCell).toBeInTheDocument();
      });
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

      // Phone column should show "-". Re-query inside waitFor: during the
      // post-load re-fetch every cell holds a Skeleton.
      await waitFor(() => {
        const cells = screen.getAllByRole('cell');
        const phoneCell = cells.find(cell => cell.textContent === '-');
        expect(phoneCell).toBeInTheDocument();
      });
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

      // Anchor on the rendered row first — asserting absence while the table
      // still shows loading Skeletons would pass for the wrong reason.
      await expectTextInTable('John Doe');

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

      await expectTextInTable('No name provided');
      await expectTextInTable('test@example.com');
      expect(container).toBeTruthy();
    });
  });

  describe('Happy Path Rendering', () => {
    it('renders full name when both firstName and lastName are present', async () => {
      render(<UserManagement />);

      await expectTextInTable('John Doe');
    });

    it('renders email', async () => {
      render(<UserManagement />);

      await expectTextInTable('john.doe@example.com');
    });

    it('renders phone when present', async () => {
      render(<UserManagement />);

      await expectTextInTable('0812345678');
    });

    it('renders membership ID when present', async () => {
      render(<UserManagement />);

      await expectTextInTable('MEM001');
    });

    it('renders active status badge', async () => {
      render(<UserManagement />);

      await expectTextInTable('Active');
    });
  });

  describe('Empty State', () => {
    it('renders empty table when no users', async () => {
      mockGetUsers.mockResolvedValue({
        data: [],
        pagination: { pages: 0, total: 0 },
      });

      render(<UserManagement />);

      // Re-query inside waitFor: the loading pass renders placeholder
      // Skeleton rows, so a single read can see more rows than the settled
      // empty state has. Only header row + the empty-state row should remain.
      await waitFor(() => {
        expect(screen.queryAllByRole('row').length).toBeLessThanOrEqual(2);
      });
    });
  });

  describe('Actions', () => {
    it('should render view/status/delete actions for each user', async () => {
      render(<UserManagement />);

      // Re-query inside waitFor: the loading pass replaces the action
      // buttons with Skeletons.
      await waitFor(() => {
        const table = getDesktopTable();
        expect(within(table).getByRole('button', { name: 'View Details' })).toBeInTheDocument();
        expect(within(table).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
        expect(within(table).getByRole('button', { name: 'Delete User' })).toBeInTheDocument();
      });
    });
  });
});
