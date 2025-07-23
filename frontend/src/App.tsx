import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from './store/authStore';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import OAuthSuccessPage from './pages/auth/OAuthSuccessPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import AccountLinkingPage from './pages/AccountLinkingPage';
import FeatureTogglePage from './pages/admin/FeatureTogglePage';
import LoyaltyAdminPage from './pages/admin/LoyaltyAdminPage';
import CouponManagement from './pages/admin/CouponManagement';
import FeatureDisabledPage from './components/FeatureDisabledPage';
import LoyaltyDashboard from './pages/loyalty/LoyaltyDashboard';
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
import { useEffect, useState } from 'react';
import { useFeatureToggle, FEATURE_KEYS } from './hooks/useFeatureToggle';

function App() {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Check feature toggles
  const isAccountLinkingEnabled = useFeatureToggle(FEATURE_KEYS.ACCOUNT_LINKING);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Give Zustand persist more time to rehydrate state from localStorage
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Get current auth state after rehydration
        const authStore = useAuthStore.getState();
        
        // If we have stored auth data, validate it
        if (authStore.accessToken && authStore.refreshToken) {
          try {
            const isValid = await authStore.checkAuthStatus();
            if (!isValid) {
              console.warn('Stored auth tokens are invalid, clearing auth state');
              authStore.clearAuth();
            }
          } catch (error) {
            console.warn('Auth validation failed during initialization:', error);
            // Clear potentially corrupted auth state
            authStore.clearAuth();
          }
        } else if (authStore.isAuthenticated) {
          // If marked as authenticated but missing tokens, clear state
          console.warn('Auth state inconsistent (authenticated but missing tokens), clearing');
          authStore.clearAuth();
        }
        
        // Only log in development mode
        if (import.meta.env?.DEV) {
          const finalState = useAuthStore.getState();
          console.log('App initialized. Final auth state:', { 
            isAuthenticated: finalState.isAuthenticated, 
            user: finalState.user?.email,
            hasAccessToken: !!finalState.accessToken,
            hasRefreshToken: !!finalState.refreshToken
          });
        }
      } catch (error) {
        console.error('Critical error during auth initialization:', error);
        // Clear auth state on any critical error
        useAuthStore.getState().clearAuth();
      } finally {
        // Always mark as initialized, even if auth checks failed
        setIsInitialized(true);
      }
    };
    
    initializeAuth();
  }, []); // Only run once on mount

  // Show loading while Zustand rehydrates from localStorage
  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <LanguageProvider>
      <Router
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <SessionManager />
        <Toaster 
          position="top-right"
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
          element={!isAuthenticated ? <LoginPage /> : <Navigate to="/dashboard" />}
        />
        <Route
          path="/register"
          element={!isAuthenticated ? <RegisterPage /> : <Navigate to="/dashboard" />}
        />
        <Route
          path="/reset-password"
          element={!isAuthenticated ? <ResetPasswordPage /> : <Navigate to="/dashboard" />}
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
          path="/loyalty"
          element={
            <ProtectedRoute>
              <LoyaltyDashboard />
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
          path="/account-linking"
          element={
            <ProtectedRoute>
              {isAccountLinkingEnabled ? (
                <AccountLinkingPage />
              ) : (
                <FeatureDisabledPage
                  featureName={t('profile.accountLinking')}
                />
              )}
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/feature-toggles"
          element={
            <ProtectedRoute requiredRole="super_admin">
              <FeatureTogglePage />
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

        {/* Default redirect */}
        <Route path="/" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} />} />
      </Routes>
      
        {/* Development tools - only shows in development mode */}
        <DevTools />
      </Router>
    </LanguageProvider>
  );
}

export default App;