import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import ProtectedRoute from '../ProtectedRoute';
import { useAuthStore } from '../../../store/authStore';

// Mock the auth store
vi.mock('../../../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock react-router-dom Navigate component
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => <div data-testid="navigate-mock">{to}</div>,
  };
});

describe('ProtectedRoute', () => {
  const mockCheckAuthStatus = vi.fn();
  const mockUser = {
    id: '123',
    email: 'test@example.com',
    role: 'customer' as const,
    name: 'Test User',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading State', () => {
    it('should show loading UI when isLoading is true', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: true,
          isAuthenticated: false,
          user: null,
          accessToken: null,
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <BrowserRouter>
          <ProtectedRoute>
            <div>Protected Content</div>
          </ProtectedRoute>
        </BrowserRouter>
      );

      expect(screen.getByText('Verifying authentication...')).toBeInTheDocument();
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });
  });

  describe('Unauthenticated Access', () => {
    it('should redirect to login when not authenticated', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: false,
          user: null,
          accessToken: null,
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <ProtectedRoute>
            <div>Protected Content</div>
          </ProtectedRoute>
        </MemoryRouter>
      );

      const navigateElement = screen.getByTestId('navigate-mock');
      expect(navigateElement).toBeInTheDocument();
      expect(navigateElement.textContent).toContain('/login');
      expect(navigateElement.textContent).toContain('returnUrl=%2Fdashboard');
    });

    it('should redirect to custom redirectTo path when specified', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: false,
          user: null,
          accessToken: null,
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <MemoryRouter initialEntries={['/admin/settings']}>
          <ProtectedRoute redirectTo="/admin/login">
            <div>Protected Content</div>
          </ProtectedRoute>
        </MemoryRouter>
      );

      const navigateElement = screen.getByTestId('navigate-mock');
      expect(navigateElement.textContent).toContain('/admin/login');
      expect(navigateElement.textContent).toContain('returnUrl=%2Fadmin%2Fsettings');
    });

    it('should redirect when authenticated but missing user', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: true,
          user: null,
          accessToken: 'token123',
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <ProtectedRoute>
            <div>Protected Content</div>
          </ProtectedRoute>
        </MemoryRouter>
      );

      expect(screen.getByTestId('navigate-mock')).toBeInTheDocument();
    });

    it('should redirect when authenticated but missing accessToken', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: true,
          user: mockUser,
          accessToken: null,
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <ProtectedRoute>
            <div>Protected Content</div>
          </ProtectedRoute>
        </MemoryRouter>
      );

      expect(screen.getByTestId('navigate-mock')).toBeInTheDocument();
    });

    it('should preserve query parameters in return URL', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: false,
          user: null,
          accessToken: null,
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <MemoryRouter initialEntries={['/dashboard?tab=analytics&filter=weekly']}>
          <ProtectedRoute>
            <div>Protected Content</div>
          </ProtectedRoute>
        </MemoryRouter>
      );

      const navigateElement = screen.getByTestId('navigate-mock');
      expect(navigateElement.textContent).toContain('returnUrl=%2Fdashboard%3Ftab%3Danalytics%26filter%3Dweekly');
    });
  });

  describe('Authenticated Access', () => {
    it('should render children when authenticated without role requirement', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: true,
          user: mockUser,
          accessToken: 'token123',
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <BrowserRouter>
          <ProtectedRoute>
            <div>Protected Content</div>
          </ProtectedRoute>
        </BrowserRouter>
      );

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
      expect(screen.queryByText('Verifying authentication...')).not.toBeInTheDocument();
      expect(screen.queryByTestId('navigate-mock')).not.toBeInTheDocument();
    });
  });

  describe('Role-Based Authorization', () => {
    it('should allow access when user has exact required role', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: true,
          user: { ...mockUser, role: 'staff' },
          accessToken: 'token123',
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <BrowserRouter>
          <ProtectedRoute requiredRole="staff">
            <div>Staff Content</div>
          </ProtectedRoute>
        </BrowserRouter>
      );

      expect(screen.getByText('Staff Content')).toBeInTheDocument();
    });

    it('should allow access when user has higher role than required', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: true,
          user: { ...mockUser, role: 'admin' },
          accessToken: 'token123',
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <BrowserRouter>
          <ProtectedRoute requiredRole="staff">
            <div>Staff Content</div>
          </ProtectedRoute>
        </BrowserRouter>
      );

      expect(screen.getByText('Staff Content')).toBeInTheDocument();
    });

    it('should deny access when user has lower role than required', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: true,
          user: { ...mockUser, role: 'customer' },
          accessToken: 'token123',
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <BrowserRouter>
          <ProtectedRoute requiredRole="admin">
            <div>Admin Content</div>
          </ProtectedRoute>
        </BrowserRouter>
      );

      expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
      expect(screen.getByText('Access Denied')).toBeInTheDocument();
      expect(screen.getByText(/You need admin privileges/i)).toBeInTheDocument();
    });

    it('should show formatted role name in access denied message', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: true,
          user: { ...mockUser, role: 'customer' },
          accessToken: 'token123',
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <BrowserRouter>
          <ProtectedRoute requiredRole="super_admin">
            <div>Super Admin Content</div>
          </ProtectedRoute>
        </BrowserRouter>
      );

      expect(screen.getByText(/You need super admin privileges/i)).toBeInTheDocument();
    });

    it('should render Go Back button in access denied UI', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: true,
          user: { ...mockUser, role: 'customer' },
          accessToken: 'token123',
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <BrowserRouter>
          <ProtectedRoute requiredRole="admin">
            <div>Admin Content</div>
          </ProtectedRoute>
        </BrowserRouter>
      );

      expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
    });
  });

  describe('Role Hierarchy', () => {
    const testRoleHierarchy = (
      userRole: 'customer' | 'staff' | 'admin' | 'super_admin',
      requiredRole: 'customer' | 'staff' | 'admin' | 'super_admin',
      shouldHaveAccess: boolean
    ) => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: true,
          user: { ...mockUser, role: userRole },
          accessToken: 'token123',
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <BrowserRouter>
          <ProtectedRoute requiredRole={requiredRole}>
            <div>Protected Content</div>
          </ProtectedRoute>
        </BrowserRouter>
      );

      if (shouldHaveAccess) {
        expect(screen.getByText('Protected Content')).toBeInTheDocument();
      } else {
        expect(screen.getByText('Access Denied')).toBeInTheDocument();
      }
    };

    it('customer can access customer routes', () => {
      testRoleHierarchy('customer', 'customer', true);
    });

    it('customer cannot access staff routes', () => {
      testRoleHierarchy('customer', 'staff', false);
    });

    it('staff can access customer routes', () => {
      testRoleHierarchy('staff', 'customer', true);
    });

    it('staff can access staff routes', () => {
      testRoleHierarchy('staff', 'staff', true);
    });

    it('staff cannot access admin routes', () => {
      testRoleHierarchy('staff', 'admin', false);
    });

    it('admin can access customer routes', () => {
      testRoleHierarchy('admin', 'customer', true);
    });

    it('admin can access staff routes', () => {
      testRoleHierarchy('admin', 'staff', true);
    });

    it('super_admin can access customer routes', () => {
      testRoleHierarchy('super_admin', 'customer', true);
    });

    it('super_admin can access staff routes', () => {
      testRoleHierarchy('super_admin', 'staff', true);
    });

    it('super_admin can access admin routes', () => {
      testRoleHierarchy('super_admin', 'admin', true);
    });
  });

  describe('Auth Verification', () => {
    it('should call checkAuthStatus when authenticated but missing user data', async () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: true,
          user: null,
          accessToken: null,
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <BrowserRouter>
          <ProtectedRoute>
            <div>Protected Content</div>
          </ProtectedRoute>
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalled();
      });
    });

    it('should not call checkAuthStatus when not authenticated', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: false,
          user: null,
          accessToken: null,
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <BrowserRouter>
          <ProtectedRoute>
            <div>Protected Content</div>
          </ProtectedRoute>
        </BrowserRouter>
      );

      expect(mockCheckAuthStatus).not.toHaveBeenCalled();
    });

    it('should not call checkAuthStatus when authenticated with valid data', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: true,
          user: mockUser,
          accessToken: 'token123',
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <BrowserRouter>
          <ProtectedRoute>
            <div>Protected Content</div>
          </ProtectedRoute>
        </BrowserRouter>
      );

      expect(mockCheckAuthStatus).not.toHaveBeenCalled();
    });

    it('should handle checkAuthStatus errors gracefully', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockCheckAuthStatus.mockRejectedValueOnce(new Error('Auth check failed'));

      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isLoading: false,
          isAuthenticated: true,
          user: null,
          accessToken: null,
          checkAuthStatus: mockCheckAuthStatus,
        };
        return selector(state);
      });

      render(
        <BrowserRouter>
          <ProtectedRoute>
            <div>Protected Content</div>
          </ProtectedRoute>
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(mockCheckAuthStatus).toHaveBeenCalled();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          'Auth verification failed in ProtectedRoute:',
          expect.any(Error)
        );
      });

      consoleWarnSpy.mockRestore();
    });
  });
});
