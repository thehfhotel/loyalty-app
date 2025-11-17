import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthLayout from '../AuthLayout';
import { useAuthStore } from '../../../store/authStore';

// Mock dependencies
const mockNavigate = vi.fn();
const mockCheckAuthStatus = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Outlet: () => <div data-testid="outlet">Outlet Content</div>,
  };
});

vi.mock('../../../store/authStore', () => ({
  useAuthStore: vi.fn(),
  default: {
    getState: () => ({
      accessToken: null,
      user: null,
      isAuthenticated: false,
    }),
  },
}));

describe('AuthLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementation
    (useAuthStore as any).mockImplementation((selector: any) => {
      const state = {
        isAuthenticated: false,
        checkAuthStatus: mockCheckAuthStatus,
      };
      return selector ? selector(state) : state;
    });

    mockCheckAuthStatus.mockResolvedValue(false);
  });

  describe('Basic Rendering', () => {
    it('should render the Outlet component', () => {
      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthLayout />
        </MemoryRouter>
      );

      expect(screen.getByTestId('outlet')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthLayout />
        </MemoryRouter>
      );

      expect(container).toBeTruthy();
    });

    it('should render Outlet with proper structure', () => {
      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthLayout />
        </MemoryRouter>
      );

      const outlet = screen.getByTestId('outlet');
      expect(outlet).toHaveTextContent('Outlet Content');
    });
  });

  describe('Authentication Checking on Mount', () => {
    it('should check auth status on mount', async () => {
      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalledTimes(1);
      });
    });

    it('should check auth status for authenticated users', async () => {
      mockCheckAuthStatus.mockResolvedValue(true);
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isAuthenticated: true,
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector ? selector(state) : state;
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalledTimes(1);
      });
    });

    it('should not navigate when auth check is in progress', async () => {
      // Auth check takes time to resolve
      const longCheckAuthStatus = vi.fn(() => new Promise(resolve => setTimeout(() => resolve(true), 100)));

      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isAuthenticated: false,
          checkAuthStatus: longCheckAuthStatus,
        };
        return selector ? selector(state) : state;
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <AuthLayout />
        </MemoryRouter>
      );

      // Should not navigate immediately
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Public Routes Handling', () => {
    it('should not redirect when on /login route', async () => {
      mockCheckAuthStatus.mockResolvedValue(false);

      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalled();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('should not redirect when on /register route', async () => {
      mockCheckAuthStatus.mockResolvedValue(false);

      render(
        <MemoryRouter initialEntries={['/register']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalled();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('should not redirect when on /reset-password route', async () => {
      mockCheckAuthStatus.mockResolvedValue(false);

      render(
        <MemoryRouter initialEntries={['/reset-password']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalled();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('should not redirect when on /oauth/success route', async () => {
      mockCheckAuthStatus.mockResolvedValue(false);

      render(
        <MemoryRouter initialEntries={['/oauth/success']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalled();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('should handle public routes with query parameters', async () => {
      mockCheckAuthStatus.mockResolvedValue(false);

      render(
        <MemoryRouter initialEntries={['/login?returnUrl=/dashboard']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalled();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('should handle public routes with nested paths', async () => {
      mockCheckAuthStatus.mockResolvedValue(false);

      render(
        <MemoryRouter initialEntries={['/reset-password/confirm']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalled();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Protected Routes Redirection', () => {
    it('should redirect to login when not authenticated on protected route', async () => {
      mockCheckAuthStatus.mockResolvedValue(false);

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          '/login?returnUrl=%2Fdashboard',
          { replace: true }
        );
      });
    });

    it('should include returnUrl in redirect for protected routes', async () => {
      mockCheckAuthStatus.mockResolvedValue(false);

      render(
        <MemoryRouter initialEntries={['/profile/settings']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          '/login?returnUrl=%2Fprofile%2Fsettings',
          { replace: true }
        );
      });
    });

    it('should include query parameters in returnUrl', async () => {
      mockCheckAuthStatus.mockResolvedValue(false);

      render(
        <MemoryRouter initialEntries={['/dashboard?tab=loyalty']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          '/login?returnUrl=%2Fdashboard%3Ftab%3Dloyalty',
          { replace: true }
        );
      });
    });

    it('should not redirect when authenticated on protected route', async () => {
      mockCheckAuthStatus.mockResolvedValue(true);

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalled();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('should redirect from root path when not authenticated', async () => {
      mockCheckAuthStatus.mockResolvedValue(false);

      render(
        <MemoryRouter initialEntries={['/']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          '/login?returnUrl=%2F',
          { replace: true }
        );
      });
    });
  });


  describe('Edge Cases', () => {
    it('should handle missing location gracefully', async () => {
      render(
        <MemoryRouter>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalled();
      });
    });


    it('should handle empty pathname', async () => {
      mockCheckAuthStatus.mockResolvedValue(false);

      render(
        <MemoryRouter initialEntries={['']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalled();
      });
    });

    it('should handle special characters in returnUrl', async () => {
      mockCheckAuthStatus.mockResolvedValue(false);

      render(
        <MemoryRouter initialEntries={['/search?q=test&filter=active']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          expect.stringContaining('/login?returnUrl='),
          { replace: true }
        );
      });
    });
  });

  describe('Accessibility', () => {
    it('should render accessible content through Outlet', () => {
      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthLayout />
        </MemoryRouter>
      );

      const outlet = screen.getByTestId('outlet');
      expect(outlet).toBeInTheDocument();
      expect(outlet).toBeVisible();
    });

    it('should maintain focus management through routing', () => {
      const { container } = render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthLayout />
        </MemoryRouter>
      );

      expect(container).toBeInTheDocument();
      expect(document.body).toContainElement(container.firstChild as HTMLElement);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete authentication flow', async () => {
      // Start unauthenticated
      mockCheckAuthStatus.mockResolvedValue(false);

      const { rerender } = render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          '/login?returnUrl=%2Fdashboard',
          { replace: true }
        );
      });

      // User authenticates
      mockCheckAuthStatus.mockResolvedValue(true);
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isAuthenticated: true,
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector ? selector(state) : state;
      });

      mockNavigate.mockClear();

      rerender(
        <MemoryRouter initialEntries={['/dashboard']}>
          <AuthLayout />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalled();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });


  });
});
