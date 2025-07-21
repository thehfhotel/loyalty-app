import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
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
import { useEffect, useState } from 'react';
import { useFeatureToggle, FEATURE_KEYS } from './hooks/useFeatureToggle';

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Check feature toggles
  const isAccountLinkingEnabled = useFeatureToggle(FEATURE_KEYS.ACCOUNT_LINKING);

  useEffect(() => {
    const initializeAuth = async () => {
      // Give Zustand persist time to rehydrate state from localStorage
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check if we have tokens and validate them
      const checkAuthStatus = useAuthStore.getState().checkAuthStatus;
      try {
        await checkAuthStatus();
      } catch (error) {
        // Auth check failed, but we'll continue - user will be redirected to login if needed
        console.warn('Auth validation failed during initialization:', error);
      }
      
      setIsInitialized(true);
      
      // Only log in development mode
      if (import.meta.env?.DEV) {
        const currentState = useAuthStore.getState();
        console.log('App initialized. Auth state:', { 
          isAuthenticated: currentState.isAuthenticated, 
          user: currentState.user?.email 
        });
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
          path="/account-linking"
          element={
            <ProtectedRoute>
              {isAccountLinkingEnabled ? (
                <AccountLinkingPage />
              ) : (
                <FeatureDisabledPage
                  featureName="Account Linking"
                  description="Account linking is currently disabled by the system administrator. Please contact support if you need this feature enabled."
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