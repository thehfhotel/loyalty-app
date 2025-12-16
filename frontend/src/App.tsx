import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
// Removed unused useTranslation import
import { Suspense } from 'react';
import { useAuthStore } from './store/authStore';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import OAuthSuccessPage from './pages/auth/OAuthSuccessPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import LoyaltyAdminPage from './pages/admin/LoyaltyAdminPage';
import CouponManagement from './pages/admin/CouponManagement';
import CouponWallet from './pages/coupons/CouponWallet';
import ProtectedRoute from './components/auth/ProtectedRoute';
import SessionManager from './components/auth/SessionManager';
import LanguageProvider from './components/LanguageProvider';
import DevTools from './components/dev/DevTools';
import SurveyList from './pages/surveys/SurveyList';
import TakeSurvey from './pages/surveys/TakeSurvey';
import SurveyDetailsPage from './pages/surveys/SurveyDetailsPage';
import SurveyManagement from './pages/admin/SurveyManagement';
import SurveyBuilder from './pages/admin/SurveyBuilder';
import SurveyAnalytics from './pages/admin/SurveyAnalytics';
import SurveyPreviewPage from './pages/admin/SurveyPreview';
import SurveyTemplates from './pages/admin/SurveyTemplates';
import SurveyInvitations from './pages/admin/SurveyInvitations';
import ThaiSurveyDebug from './pages/admin/ThaiSurveyDebug';
import UserManagement from './pages/admin/UserManagement';
import NewMemberCouponSettings from './pages/admin/NewMemberCouponSettings';
import AdminTransactionHistoryPage from './pages/admin/AdminTransactionHistoryPage';
import { useEffect, useState, useRef } from 'react';
import { checkPWAInstallPrompt } from './utils/pwaUtils';
import { notificationService } from './services/notificationService';
import { logger } from './utils/logger';

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const [isInitialized, setIsInitialized] = useState(false);
  const initializingRef = useRef(false);

  // Fully authenticated = has all auth components (prevents redirect loop with ProtectedRoute)
  const isFullyAuthenticated = isAuthenticated && !!user && !!accessToken;
  

  useEffect(() => {
    const initializeAuth = async () => {
      // Prevent duplicate initialization (React StrictMode causes double mounting)
      if (initializingRef.current) {
        logger.debug('Auth initialization already in progress, skipping duplicate');
        return;
      }

      initializingRef.current = true;

      // Set maximum timeout for initialization to prevent infinite loading
      const initTimeout = setTimeout(() => {
        logger.warn('Auth initialization timeout - forcing app to load');
        setIsInitialized(true);
      }, 5000); // 5 second max timeout

      try {
        // Give Zustand persist time to rehydrate state from localStorage
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Get current auth state after rehydration
        const authStore = useAuthStore.getState();
        
        // Check for corrupted localStorage data and clear if needed
        try {
          const storedAuth = localStorage.getItem('auth-storage');
          if (storedAuth) {
            const parsed = JSON.parse(storedAuth);
            // Validate structure - if malformed, clear it
            if (!parsed.state || typeof parsed.state !== 'object') {
              logger.warn('Corrupted auth storage detected, clearing');
              localStorage.removeItem('auth-storage');
              authStore.clearAuth();
              clearTimeout(initTimeout);
              setIsInitialized(true);
              return;
            }
          }
        } catch (parseError) {
          logger.warn('Failed to parse auth storage, clearing:', parseError);
          localStorage.removeItem('auth-storage');
          authStore.clearAuth();
          clearTimeout(initTimeout);
          setIsInitialized(true);
          return;
        }
        
        // Quick consistency check - if inconsistent state, clear immediately
        if (authStore.isAuthenticated && (!authStore.accessToken || !authStore.refreshToken)) {
          logger.warn('Auth state inconsistent (authenticated but missing tokens), clearing');
          authStore.clearAuth();
          clearTimeout(initTimeout);
          setIsInitialized(true);
          return;
        }
        
        // If we have stored auth data, validate it with timeout
        if (authStore.accessToken && authStore.refreshToken) {
          try {
            // Add timeout to auth validation to prevent hanging
            // Use 5s timeout - generous enough for slow networks
            const validationPromise = authStore.checkAuthStatus();
            const timeoutPromise = new Promise<boolean>((resolve) => {
              setTimeout(() => {
                logger.debug('Auth validation timeout - keeping user logged in');
                resolve(true); // On timeout, assume valid and let subsequent requests handle refresh
              }, 5000);
            });

            const isValid = await Promise.race([validationPromise, timeoutPromise]);

            if (!isValid) {
              // checkAuthStatus returns false for network errors but doesn't clear auth
              // Only log a warning - the auth state is already handled by checkAuthStatus
              // The axios interceptor will handle token refresh on subsequent API calls
              logger.debug('Auth validation returned false - auth state handled by checkAuthStatus');
            }
          } catch (error) {
            logger.warn('Auth validation failed during initialization:', error instanceof Error ? error.message : error);
            // On any error during initialization, keep user logged in if they have tokens
            // The axios interceptor will handle token refresh/logout on actual API calls
            // This prevents logout on network issues, slow backend, or temporary errors
            const httpError = error as { response?: { status?: number } };
            const status = httpError?.response?.status;

            // Only clear auth on explicit auth failures (401/403 from the server)
            if (status === 401 || status === 403) {
              logger.warn('Auth explicitly rejected by server, clearing auth state');
              authStore.clearAuth();
            } else {
              logger.debug('Non-auth error during init, keeping user logged in');
            }
          }
        }
        
        // Only log in development mode
        if (import.meta.env?.DEV) {
          const finalState = useAuthStore.getState();
          logger.debug('App initialized. Final auth state:', {
            isAuthenticated: finalState.isAuthenticated,
            user: finalState.user?.email,
            hasAccessToken: !!finalState.accessToken,
            hasRefreshToken: !!finalState.refreshToken
          });
        }
      } catch (error) {
        logger.error('Critical error during auth initialization:', error);
        // Clear auth state on any critical error
        useAuthStore.getState().clearAuth();
      } finally {
        // Always clear timeout and mark as initialized
        clearTimeout(initTimeout);
        setIsInitialized(true);
        initializingRef.current = false;
      }
    };
    
    initializeAuth();
  }, []); // Only run once on mount

  // Initialize PWA features when user is authenticated
  useEffect(() => {
    if (isAuthenticated && user && isInitialized) {
      const initializePWA = async () => {
        try {
          // Initialize PWA install prompt check
          checkPWAInstallPrompt();
          
          // Initialize notification service
          const notificationInitialized = await notificationService.initialize();
          
          if (notificationInitialized) {
            // Auto-subscribe to notifications for PWA users
            const subscribed = await notificationService.subscribeToPush(user.id);
            if (subscribed) {
              logger.debug('Successfully subscribed to push notifications');
            }
          }
        } catch (error) {
          logger.error('Failed to initialize PWA features:', error);
        }
      };

      initializePWA();
    }
  }, [isAuthenticated, user, isInitialized]);

  // Show loading while Zustand rehydrates from localStorage
  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <LanguageProvider>
      <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
        <Router>
          <SessionManager />
          <Toaster 
            position="top-center"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#363636',
                color: '#fff',
              },
            }}
          />
          <Routes>
        {/* Public routes */}
        <Route
          path="/login"
          element={!isFullyAuthenticated ? <LoginPage /> : <Navigate to="/dashboard" />}
        />
        <Route
          path="/register"
          element={!isFullyAuthenticated ? <RegisterPage /> : <Navigate to="/dashboard" />}
        />
        <Route
          path="/reset-password"
          element={!isFullyAuthenticated ? <ResetPasswordPage /> : <Navigate to="/dashboard" />}
        />
        <Route
          path="/oauth/success"
          element={<OAuthSuccessPage />}
        />

        {/* Protected routes */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/coupons"
          element={
            <ProtectedRoute>
              <CouponWallet />
            </ProtectedRoute>
          }
        />
        <Route
          path="/surveys"
          element={
            <ProtectedRoute>
              <SurveyList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/surveys/:id/take"
          element={
            <ProtectedRoute>
              <TakeSurvey />
            </ProtectedRoute>
          }
        />
        <Route
          path="/surveys/:id/details"
          element={
            <ProtectedRoute>
              <SurveyDetailsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/loyalty"
          element={
            <ProtectedRoute requiredRole="admin">
              <LoyaltyAdminPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/coupons"
          element={
            <ProtectedRoute requiredRole="admin">
              <CouponManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute requiredRole="admin">
              <UserManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/surveys"
          element={
            <ProtectedRoute requiredRole="admin">
              <SurveyManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/surveys/create"
          element={
            <ProtectedRoute requiredRole="admin">
              <SurveyBuilder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/surveys/:id/edit"
          element={
            <ProtectedRoute requiredRole="admin">
              <SurveyBuilder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/surveys/:id/analytics"
          element={
            <ProtectedRoute requiredRole="admin">
              <SurveyAnalytics />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/surveys/:id/preview"
          element={
            <ProtectedRoute requiredRole="admin">
              <SurveyPreviewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/surveys/templates"
          element={
            <ProtectedRoute requiredRole="admin">
              <SurveyTemplates />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/surveys/:id/invitations"
          element={
            <ProtectedRoute requiredRole="admin">
              <SurveyInvitations />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/surveys/debug/thai"
          element={
            <ProtectedRoute requiredRole="admin">
              <ThaiSurveyDebug />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/new-member-coupons"
          element={
            <ProtectedRoute requiredRole="admin">
              <NewMemberCouponSettings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/transaction-history"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminTransactionHistoryPage />
            </ProtectedRoute>
          }
        />

        {/* Default redirect */}
        <Route path="/" element={<Navigate to={isFullyAuthenticated ? "/dashboard" : "/login"} />} />

        {/* Catch-all route for unknown paths - redirect based on auth status */}
        <Route path="*" element={<Navigate to={isFullyAuthenticated ? "/dashboard" : "/login"} replace />} />
          </Routes>
          
          {/* Development tools - only shows in development mode */}
          <DevTools />
        </Router>
      </Suspense>
    </LanguageProvider>
  );
}

export default App;
