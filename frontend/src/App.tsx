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
import FeatureDisabledPage from './components/FeatureDisabledPage';
import ProtectedRoute from './components/auth/ProtectedRoute';
import SessionManager from './components/auth/SessionManager';
import { useEffect, useState } from 'react';
import { useFeatureToggle, FEATURE_KEYS } from './hooks/useFeatureToggle';

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Check feature toggles
  const isAccountLinkingEnabled = useFeatureToggle(FEATURE_KEYS.ACCOUNT_LINKING);

  useEffect(() => {
    // Give Zustand persist time to rehydrate state from localStorage
    const timer = setTimeout(() => {
      setIsInitialized(true);
      console.log('App initialized. Auth state:', { isAuthenticated, user: user?.email });
    }, 100);
    
    return () => clearTimeout(timer);
  }, [isAuthenticated, user]);

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
    <Router>
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

        {/* Default redirect */}
        <Route path="/" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} />} />
      </Routes>
    </Router>
  );
}

export default App;