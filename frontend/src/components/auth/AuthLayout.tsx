import { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

export default function AuthLayout() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const checkAuthStatus = useAuthStore((state) => state.checkAuthStatus);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Check auth status on mount and token changes
    const checkAuth = async () => {
      const isValid = await checkAuthStatus();
      
      // If not authenticated and not on a public route, redirect to login
      const publicRoutes = ['/login', '/register', '/reset-password', '/oauth/success'];
      const isPublicRoute = publicRoutes.some(route => location.pathname.startsWith(route));
      
      if (!isValid && !isPublicRoute) {
        const returnUrl = location.pathname + location.search;
        navigate(`/login?returnUrl=${encodeURIComponent(returnUrl)}`, { replace: true });
      }
    };

    checkAuth();

    // Set up an interval to periodically check auth status
    const interval = setInterval(checkAuth, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [checkAuthStatus, navigate, location, isAuthenticated]);

  return <Outlet />;
}