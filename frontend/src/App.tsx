import React, { Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { LoadingSpinner } from './components/ui/LoadingSpinner';
import { PWAInstallPrompt } from './components/pwa/PWAInstallPrompt';
import { OfflineIndicator } from './components/pwa/OfflineIndicator';

// Lazy loaded pages
const LoginPage = React.lazy(() => import('./pages/auth/LoginPage'));
const DashboardPage = React.lazy(() => import('./pages/dashboard/DashboardPage'));
const ProfilePage = React.lazy(() => import('./pages/profile/ProfilePage'));
const LoyaltyPage = React.lazy(() => import('./pages/loyalty/LoyaltyPage'));
const CouponsPage = React.lazy(() => import('./pages/coupons/CouponsPage'));
const SurveysPage = React.lazy(() => import('./pages/surveys/SurveysPage'));
const TakeSurveyPage = React.lazy(() => import('./pages/surveys/TakeSurveyPage'));

// Layout components
import { AuthLayout } from './layouts/AuthLayout';
import { AppLayout } from './layouts/AppLayout';

// Route protection component
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuthStore();
  
  if (isLoading) {
    return <LoadingSpinner />;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

// Public route component (redirect if authenticated)
const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuthStore();
  
  if (isLoading) {
    return <LoadingSpinner />;
  }
  
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }
  
  return <>{children}</>;
};

const App: React.FC = () => {
  const { initializeAuth } = useAuthStore();
  
  useEffect(() => {
    // Initialize authentication state from localStorage
    initializeAuth();
  }, [initializeAuth]);
  
  return (
    <>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={
            <PublicRoute>
              <AuthLayout>
                <LoginPage />
              </AuthLayout>
            </PublicRoute>
          } />
          
          {/* Protected routes */}
          <Route path="/" element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="loyalty" element={<LoyaltyPage />} />
            <Route path="coupons" element={<CouponsPage />} />
            <Route path="surveys" element={<SurveysPage />} />
            <Route path="surveys/take/:responseId" element={<TakeSurveyPage />} />
          </Route>
          
          {/* Catch all route */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      
      {/* PWA Components */}
      <PWAInstallPrompt />
      <OfflineIndicator />
    </>
  );
};

export default App;