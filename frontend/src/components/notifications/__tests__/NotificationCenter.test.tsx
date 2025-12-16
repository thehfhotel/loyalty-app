import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationCenter from '../NotificationCenter';

// Use vi.hoisted to create all mock state before mocks run
const mocks = vi.hoisted(() => {
  let _user: { id: string; email: string; name: string; role: string } | null = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    role: 'customer',
  };

  return {
    getUser: () => _user,
    setUser: (user: typeof _user) => { _user = user; },
    axiosInstance: {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn(), eject: vi.fn() },
        response: { use: vi.fn(), eject: vi.fn() },
      },
    },
  };
});

// Mock dependencies using the hoisted mocks object
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { user: ReturnType<typeof mocks.getUser> }) => unknown) => {
    return selector({ user: mocks.getUser() });
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'notifications.title': 'Notifications',
        'notifications.markAllRead': 'Mark all read',
        'notifications.unreadCount': `${params?.count || 0} unread`,
        'notifications.loading': 'Loading...',
        'notifications.empty': 'No notifications yet',
        'notifications.markRead': 'Mark as read',
        'notifications.delete': 'Delete',
        'notifications.viewAll': 'View all notifications',
      };
      return translations[key] || defaultValue || key;
    },
  }),
}));

vi.mock('react-icons/fi', () => ({
  FiBell: () => <span data-testid="bell-icon">🔔</span>,
  FiCheck: () => <span data-testid="check-icon">✓</span>,
  FiX: () => <span data-testid="x-icon">✕</span>,
  FiTrash2: () => <span data-testid="trash-icon">🗑️</span>,
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('date-fns', () => ({
  formatDistanceToNow: vi.fn(() => '2 hours ago'),
}));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mocks.axiosInstance),
  },
}));

vi.mock('../../../utils/axiosInterceptor', () => ({
  addAuthTokenInterceptor: vi.fn(),
}));

vi.mock('../../../utils/apiConfig', () => ({
  API_BASE_URL: 'http://localhost:4001/api',
}));

describe('NotificationCenter', () => {
  const defaultUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    role: 'customer',
  };

  const mockNotifications = [
    {
      id: 'notif-1',
      title: 'Welcome Bonus',
      message: 'You earned 500 points!',
      type: 'reward' as const,
      data: { pointsAwarded: 500 },
      readAt: null,
      createdAt: '2024-01-15T10:30:00Z',
    },
    {
      id: 'notif-2',
      title: 'New Coupon',
      message: 'You received a new coupon',
      type: 'coupon' as const,
      data: { coupon: { id: 'coupon-1', name: '10% Off' } },
      readAt: '2024-01-14T12:00:00Z',
      createdAt: '2024-01-14T10:00:00Z',
    },
    {
      id: 'notif-3',
      title: 'Survey Available',
      message: 'Please take our quick survey',
      type: 'survey' as const,
      data: { surveyId: 'survey-1' },
      readAt: null,
      createdAt: '2024-01-13T08:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset user state
    mocks.setUser(defaultUser);

    // Setup default axios mock responses
    mocks.axiosInstance.get.mockResolvedValue({
      data: {
        notifications: mockNotifications,
        pagination: { total: 3 },
      },
    });
    mocks.axiosInstance.post.mockResolvedValue({ data: { success: true } });
    mocks.axiosInstance.delete.mockResolvedValue({ data: { success: true } });
  });

  describe('Basic Rendering', () => {
    it('should render the bell icon button', () => {
      render(<NotificationCenter />);

      expect(screen.getByTestId('bell-icon')).toBeInTheDocument();
    });

    it('should have accessible label on bell button', () => {
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      expect(button).toBeInTheDocument();
    });

    it('should not show dropdown initially', () => {
      render(<NotificationCenter />);

      expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
    });

    it('should not render when user is null', () => {
      mocks.setUser(null);

      const { container } = render(<NotificationCenter />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Notification Badge', () => {
    it('should show unread count badge', async () => {
      render(<NotificationCenter />);

      await waitFor(() => {
        expect(screen.getByText('2')).toBeInTheDocument();
      });
    });

    it('should show 9+ when more than 9 unread', async () => {
      const manyUnread = Array.from({ length: 12 }, (_, i) => ({
        id: `notif-${i}`,
        title: `Notification ${i}`,
        message: `Message ${i}`,
        type: 'info' as const,
        readAt: null,
        createdAt: '2024-01-15T10:30:00Z',
      }));

      mocks.axiosInstance.get.mockResolvedValue({
        data: {
          notifications: manyUnread,
          pagination: { total: 12 },
        },
      });

      render(<NotificationCenter />);

      await waitFor(() => {
        expect(screen.getByText('9+')).toBeInTheDocument();
      });
    });

    it('should have red background for badge', async () => {
      const { container } = render(<NotificationCenter />);

      await waitFor(() => {
        const badge = container.querySelector('.bg-red-500');
        expect(badge).toBeInTheDocument();
      });
    });
  });

  describe('Dropdown Toggle', () => {
    it('should open dropdown when bell icon clicked', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const bellButton = screen.getByRole('button', { name: /notifications/i });
      await user.click(bellButton);

      await waitFor(() => {
        expect(screen.getByText('Notifications')).toBeInTheDocument();
      });
    });

    it('should close dropdown when clicking outside', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <NotificationCenter />
          <div data-testid="outside">Outside</div>
        </div>
      );

      const bellButton = screen.getByRole('button', { name: /notifications/i });
      await user.click(bellButton);

      await waitFor(() => {
        expect(screen.getByText('Notifications')).toBeInTheDocument();
      });

      const outside = screen.getByTestId('outside');
      await user.click(outside);

      await waitFor(() => {
        expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
      });
    });
  });

  describe('Loading State', () => {
    it('should show loading spinner when fetching notifications', async () => {
      const user = userEvent.setup();

      let resolveGet: (value: unknown) => void;
      const getPromise = new Promise(resolve => {
        resolveGet = resolve;
      });

      mocks.axiosInstance.get.mockReturnValue(getPromise);

      render(<NotificationCenter />);

      const bellButton = screen.getByRole('button', { name: /notifications/i });
      await user.click(bellButton);

      await waitFor(() => {
        expect(screen.getByText('Loading...')).toBeInTheDocument();
      });

      resolveGet!({
        data: {
          notifications: [],
          pagination: { total: 0 },
        },
      });

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      });
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no notifications', async () => {
      const user = userEvent.setup();

      mocks.axiosInstance.get.mockResolvedValue({
        data: {
          notifications: [],
          pagination: { total: 0 },
        },
      });

      render(<NotificationCenter />);

      const bellButton = screen.getByRole('button', { name: /notifications/i });
      await user.click(bellButton);

      await waitFor(() => {
        expect(screen.getByText('No notifications yet')).toBeInTheDocument();
      });
    });
  });

  describe('Notification List Display', () => {
    it('should display all notifications', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const bellButton = screen.getByRole('button', { name: /notifications/i });
      await user.click(bellButton);

      await waitFor(() => {
        expect(screen.getByText('Welcome Bonus')).toBeInTheDocument();
        expect(screen.getByText('New Coupon')).toBeInTheDocument();
        expect(screen.getByText('Survey Available')).toBeInTheDocument();
      });
    });

    it('should display notification messages', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const bellButton = screen.getByRole('button', { name: /notifications/i });
      await user.click(bellButton);

      await waitFor(() => {
        expect(screen.getByText('You earned 500 points!')).toBeInTheDocument();
        expect(screen.getByText('You received a new coupon')).toBeInTheDocument();
        expect(screen.getByText('Please take our quick survey')).toBeInTheDocument();
      });
    });

    it('should display notification icons based on type', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const bellButton = screen.getByRole('button', { name: /notifications/i });
      await user.click(bellButton);

      await waitFor(() => {
        expect(screen.getByText('🎉')).toBeInTheDocument(); // reward
        expect(screen.getAllByText('🎫').length).toBeGreaterThan(0); // coupon (icon + data display)
        expect(screen.getByText('📝')).toBeInTheDocument(); // survey
      });
    });

    it('should highlight unread notifications', async () => {
      const user = userEvent.setup();

      // Delay the mark-all-read POST so we can check unread state before it resolves
      let resolvePost: ((value: unknown) => void) | undefined;
      mocks.axiosInstance.post.mockImplementation(() => {
        return new Promise((resolve) => {
          resolvePost = resolve;
        });
      });

      const { container } = render(<NotificationCenter />);

      const bellButton = screen.getByRole('button', { name: /notifications/i });
      await user.click(bellButton);

      await waitFor(() => {
        const unreadBgs = container.querySelectorAll('.bg-blue-50');
        expect(unreadBgs.length).toBeGreaterThan(0);
      });

      // Cleanup: resolve the pending promise
      if (resolvePost) {
        resolvePost({ data: { success: true } });
      }
    });
  });

  describe('Mark as Read Functionality', () => {
    it('should show mark as read button for unread notifications', async () => {
      const user = userEvent.setup();

      // Delay the mark-all-read POST so we can check unread state before it resolves
      let resolvePost: ((value: unknown) => void) | undefined;
      mocks.axiosInstance.post.mockImplementation(() => {
        return new Promise((resolve) => {
          resolvePost = resolve;
        });
      });

      render(<NotificationCenter />);

      const bellButton = screen.getByRole('button', { name: /notifications/i });
      await user.click(bellButton);

      await waitFor(() => {
        const checkIcons = screen.getAllByTestId('check-icon');
        expect(checkIcons.length).toBeGreaterThan(0);
      });

      // Cleanup: resolve the pending promise
      if (resolvePost) {
        resolvePost({ data: { success: true } });
      }
    });

    it('should show "Mark all read" button when there are unread notifications', async () => {
      const user = userEvent.setup();

      // Delay the mark-all-read POST so we can check unread state before it resolves
      let resolvePost: ((value: unknown) => void) | undefined;
      mocks.axiosInstance.post.mockImplementation(() => {
        return new Promise((resolve) => {
          resolvePost = resolve;
        });
      });

      render(<NotificationCenter />);

      const bellButton = screen.getByRole('button', { name: /notifications/i });
      await user.click(bellButton);

      await waitFor(() => {
        expect(screen.getByText('Mark all read')).toBeInTheDocument();
      });

      // Cleanup: resolve the pending promise
      if (resolvePost) {
        resolvePost({ data: { success: true } });
      }
    });
  });

  describe('Delete Functionality', () => {
    it('should display delete buttons for notifications', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const bellButton = screen.getByRole('button', { name: /notifications/i });
      await user.click(bellButton);

      await waitFor(() => {
        const trashIcons = screen.getAllByTestId('trash-icon');
        expect(trashIcons.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle fetch error gracefully', async () => {
      const user = userEvent.setup();

      mocks.axiosInstance.get.mockRejectedValue(new Error('Network error'));

      render(<NotificationCenter />);

      const bellButton = screen.getByRole('button', { name: /notifications/i });
      await user.click(bellButton);

      // Component should still be functional even after error
      await waitFor(() => {
        // Verify the dropdown is open (even if fetch failed)
        expect(screen.getByText('Notifications')).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have accessible bell button', () => {
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      expect(button).toHaveAttribute('aria-label', 'Notifications');
    });

    it('should have proper heading hierarchy', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const bellButton = screen.getByRole('button', { name: /notifications/i });
      await user.click(bellButton);

      await waitFor(() => {
        const heading = screen.getByText('Notifications');
        expect(heading.tagName).toBe('H3');
      });
    });
  });
});
