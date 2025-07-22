import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

/**
 * Hook to automatically redirect unauthenticated users to login
 * Can be used as a backup to ProtectedRoute for extra security
 */
export function useAuthRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);

  useEffect(() => {
    // Skip if we're already on auth pages
    const authPages = ['/login', '/register', '/reset-password', '/oauth/success'];
    if (authPages.some(page => location.pathname.startsWith(page))) {
      return;
    }

    // Redirect if not properly authenticated
    if (!isAuthenticated || !user || !accessToken) {
      const returnUrl = location.pathname + location.search;
      navigate(`/login?returnUrl=${encodeURIComponent(returnUrl)}`, { replace: true });
    }
  }, [isAuthenticated, user, accessToken, navigate, location]);

  return { isAuthenticated: isAuthenticated && !!user && !!accessToken };
}

/**
 * Hook to check if user has required role, redirects to login if not authenticated
 */
export function useRoleCheck(requiredRole?: 'customer' | 'staff' | 'admin' | 'super_admin') {
  const { isAuthenticated } = useAuthRedirect(); // This handles auth redirect
  const user = useAuthStore((state) => state.user);

  const hasRole = () => {
    if (!isAuthenticated || !user || !requiredRole) return isAuthenticated;

    const roleHierarchy = {
      'customer': 0,
      'staff': 1,
      'admin': 2,
      'super_admin': 3
    };

    const userRoleLevel = roleHierarchy[user.role] || 0;
    const requiredRoleLevel = roleHierarchy[requiredRole] || 0;

    return userRoleLevel >= requiredRoleLevel;
  };

  return { isAuthenticated, hasRole: hasRole() };
}