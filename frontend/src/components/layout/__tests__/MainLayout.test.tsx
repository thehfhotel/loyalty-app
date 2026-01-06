import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import MainLayout from '../MainLayout';
import { useAuthStore } from '../../../store/authStore';

// Helper to render with router
const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>);
};

// Mock dependencies
vi.mock('../../../store/authStore', () => ({
  useAuthStore: vi.fn(),
  default: {
    getState: () => ({
      accessToken: 'mock-token-123',
      user: null,
      isAuthenticated: false,
    }),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: any) => {
      const translations: Record<string, string> = {
        'dashboard.welcome': `Welcome, ${params?.name || 'User'}`,
      };
      return translations[key] || key;
    },
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
}));

vi.mock('react-icons/fi', () => ({
  FiBell: () => <span data-testid="bell-icon">🔔</span>,
  FiGlobe: () => <span data-testid="globe-icon">🌐</span>,
  FiCheck: () => <span data-testid="check-icon">✓</span>,
}));

vi.mock('../../../utils/userHelpers', () => ({
  getUserDisplayName: (user: any) => user?.name || 'Guest',
}));

// Mock child components
vi.mock('../../LanguageSwitcher', () => ({
  default: () => <div data-testid="language-switcher">Language Switcher</div>,
}));

vi.mock('../../profile/ProfileCompletionBanner', () => ({
  default: () => <div data-testid="profile-completion-banner">Profile Banner</div>,
}));

vi.mock('../../navigation/DashboardButton', () => ({
  default: ({ variant, size }: { variant: string; size: string }) => (
    <button data-testid="dashboard-button" data-variant={variant} data-size={size}>
      Dashboard
    </button>
  ),
}));

vi.mock('../../notifications/NotificationCenter', () => ({
  default: () => <div data-testid="notification-center">Notifications</div>,
}));

describe('MainLayout', () => {
  const mockUser = {
    id: '123',
    email: 'test@example.com',
    name: 'John Doe',
    role: 'customer' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    (useAuthStore as any).mockImplementation((selector: any) => {
      const state = {
        user: mockUser,
      };
      return selector(state);
    });
  });

  describe('Basic Rendering', () => {
    it('should render layout with title', () => {
      renderWithRouter(<MainLayout title="Test Page">Content</MainLayout>);
      expect(screen.getByText('Test Page')).toBeInTheDocument();
    });

    it('should render children content', () => {
      renderWithRouter(<MainLayout title="Test">Test Content</MainLayout>);
      expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('should have minimum height full screen', () => {
      const { container } = renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('min-h-screen');
    });

    it('should have gray background', () => {
      const { container } = renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('bg-gray-50');
    });
  });

  describe('Header Section', () => {
    it('should render header with white background and shadow', () => {
      const { container } = renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      const header = container.querySelector('header');
      expect(header?.className).toContain('bg-white');
      expect(header?.className).toContain('shadow');
    });

    it('should display title in header', () => {
      renderWithRouter(<MainLayout title="Dashboard Page">Content</MainLayout>);
      const title = screen.getByText('Dashboard Page');
      expect(title.tagName).toBe('H1');
      expect(title.className).toContain('text-3xl');
      expect(title.className).toContain('font-bold');
    });

    it('should display welcome message with user name', () => {
      renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      expect(screen.getByText('Welcome, John Doe')).toBeInTheDocument();
    });

    it('should render language switcher', () => {
      renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    });

    it('should render notification center', () => {
      renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      expect(screen.getByTestId('notification-center')).toBeInTheDocument();
    });

    it('should render dashboard button', () => {
      renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      expect(screen.getByTestId('dashboard-button')).toBeInTheDocument();
    });

    it('should have proper header spacing and layout', () => {
      const { container } = renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      const header = container.querySelector('header');
      const headerContent = header?.querySelector('.flex');
      expect(headerContent?.className).toContain('justify-between');
      expect(headerContent?.className).toContain('items-center');
    });
  });

  describe('Profile Completion Banner', () => {
    it('should show profile banner by default', () => {
      renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      expect(screen.getByTestId('profile-completion-banner')).toBeInTheDocument();
    });

    it('should show profile banner when showProfileBanner is true', () => {
      renderWithRouter(
        <MainLayout title="Test" showProfileBanner={true}>
          Content
        </MainLayout>
      );
      expect(screen.getByTestId('profile-completion-banner')).toBeInTheDocument();
    });

    it('should hide profile banner when showProfileBanner is false', () => {
      renderWithRouter(
        <MainLayout title="Test" showProfileBanner={false}>
          Content
        </MainLayout>
      );
      expect(screen.queryByTestId('profile-completion-banner')).not.toBeInTheDocument();
    });
  });

  describe('Dashboard Button', () => {
    it('should always show dashboard button', () => {
      renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      expect(screen.getByTestId('dashboard-button')).toBeInTheDocument();
    });

    it('should render dashboard button with correct variant and size', () => {
      renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      const button = screen.getByTestId('dashboard-button');
      expect(button.getAttribute('data-variant')).toBe('outline');
      expect(button.getAttribute('data-size')).toBe('md');
    });
  });

  describe('Main Content Area', () => {
    it('should render main content with proper container', () => {
      const { container } = renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      const main = container.querySelector('main');
      expect(main).toBeInTheDocument();
      expect(main?.className).toContain('max-w-7xl');
      expect(main?.className).toContain('mx-auto');
    });

    it('should have proper padding in main content', () => {
      const { container } = renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      const main = container.querySelector('main');
      expect(main?.className).toContain('py-6');
    });

    it('should render children inside main content area', () => {
      renderWithRouter(
        <MainLayout title="Test">
          <div data-testid="child-content">Child Component</div>
        </MainLayout>
      );
      expect(screen.getByTestId('child-content')).toBeInTheDocument();
    });

    it('should allow complex children components', () => {
      renderWithRouter(
        <MainLayout title="Test">
          <div>
            <h2>Section Title</h2>
            <p>Section Content</p>
            <button>Action</button>
          </div>
        </MainLayout>
      );
      expect(screen.getByText('Section Title')).toBeInTheDocument();
      expect(screen.getByText('Section Content')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
    });
  });

  describe('User Display', () => {
    it('should display user name in welcome message', () => {
      renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      expect(screen.getByText(/John Doe/)).toBeInTheDocument();
    });

    it('should handle user without name gracefully', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          user: { id: '123', email: 'test@example.com' },
        };
        return selector(state);
      });

      renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      expect(screen.getByText('Welcome, Guest')).toBeInTheDocument();
    });

    it('should display welcome message with proper styling', () => {
      renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      const welcomeText = screen.getByText(/Welcome/);
      expect(welcomeText.className).toContain('text-sm');
      expect(welcomeText.className).toContain('text-gray-500');
    });
  });

  describe('Responsive Layout', () => {
    it('should have responsive padding classes on header', () => {
      const { container } = renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      const headerContainer = container.querySelector('header > div');
      expect(headerContainer?.className).toContain('sm:px-6');
      expect(headerContainer?.className).toContain('lg:px-8');
    });

    it('should have responsive padding classes on main content', () => {
      const { container } = renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      const main = container.querySelector('main');
      expect(main?.className).toContain('sm:px-6');
      expect(main?.className).toContain('lg:px-8');
    });

    it('should have max-width constraint for large screens', () => {
      const { container } = renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      const headerContainer = container.querySelector('header > div');
      const main = container.querySelector('main');
      expect(headerContainer?.className).toContain('max-w-7xl');
      expect(main?.className).toContain('max-w-7xl');
    });
  });

  describe('Prop Combinations', () => {
    it('should handle showProfileBanner=true', () => {
      renderWithRouter(
        <MainLayout title="Full Page" showProfileBanner={true}>
          Content
        </MainLayout>
      );
      expect(screen.getByText('Full Page')).toBeInTheDocument();
      expect(screen.getByTestId('profile-completion-banner')).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-button')).toBeInTheDocument();
    });

    it('should handle showProfileBanner=false', () => {
      renderWithRouter(
        <MainLayout title="Minimal Page" showProfileBanner={false}>
          Content
        </MainLayout>
      );
      expect(screen.getByText('Minimal Page')).toBeInTheDocument();
      expect(screen.queryByTestId('profile-completion-banner')).not.toBeInTheDocument();
      expect(screen.getByTestId('dashboard-button')).toBeInTheDocument();
    });

    it('should handle long titles without breaking layout', () => {
      const longTitle = 'This is a Very Long Page Title That Should Still Display Properly';
      renderWithRouter(<MainLayout title={longTitle}>Content</MainLayout>);
      expect(screen.getByText(longTitle)).toBeInTheDocument();
    });

    it('should handle empty children', () => {
      renderWithRouter(<MainLayout title="Test">{null}</MainLayout>);
      expect(screen.getByText('Test')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should use semantic header element', () => {
      const { container } = renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      expect(container.querySelector('header')).toBeInTheDocument();
    });

    it('should use semantic main element', () => {
      const { container } = renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      expect(container.querySelector('main')).toBeInTheDocument();
    });

    it('should have proper heading hierarchy', () => {
      renderWithRouter(<MainLayout title="Page Title">Content</MainLayout>);
      const h1 = screen.getByRole('heading', { level: 1 });
      expect(h1.textContent).toBe('Page Title');
    });

    it('should have accessible dashboard button', () => {
      renderWithRouter(<MainLayout title="Test">Content</MainLayout>);
      const dashboardButton = screen.getByTestId('dashboard-button');
      expect(dashboardButton).toBeInTheDocument();
    });
  });
});
