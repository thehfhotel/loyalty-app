import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { notify } from '../../utils/notificationManager';
import { API_BASE_URL } from '../../utils/apiConfig';
import { logger } from '../../utils/logger';
import {
  handlePWAOAuthSuccess,
  recoverPWAOAuthState,
  detectPWA,
  requestPWANotificationPermission,
  debugPWAOAuth,
  restoreIOSPWAManifest
} from '../../utils/pwaUtils';

export default function OAuthSuccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setTokens = useAuthStore((state) => state.setTokens);

  useEffect(() => {
    const handleOAuthSuccess = async () => {
      // Debug PWA OAuth flow in development
      debugPWAOAuth();
      
      const token = searchParams.get('token');
      const refreshToken = searchParams.get('refreshToken');
      const isNewUser = searchParams.get('isNewUser') === 'true';
      const error = searchParams.get('error');
      const isPWARedirect = searchParams.get('pwa_redirect') === 'true';

      if (error) {
        notify.error('Social login failed. Please try again.');
        navigate('/login');
        return;
      }

      if (!token || !refreshToken) {
        notify.error('Invalid authentication response. Please try again.');
        navigate('/login');
        return;
      }

      try {
        const pwaInfo = detectPWA();
        const tokens = { accessToken: token, refreshToken, isNewUser };
        
        // Enhanced PWA-specific OAuth flow handling
        if (isPWARedirect || !pwaInfo.isPWA) {
          // Check if we need to redirect back to PWA
          handlePWAOAuthSuccess(tokens);
          
          // If we're in a browser window and have PWA state, 
          // the handlePWAOAuthSuccess will redirect to PWA
          const pwaState = recoverPWAOAuthState();
          if (pwaState && !pwaInfo.isStandalone) {
            // We're in browser window opened by iOS PWA OAuth redirect
            // Show loading message and wait for redirect
            logger.info('OAuth success in browser window, redirecting to PWA...');
            return;
          }
        }
        
        // iOS PWA specific: Handle context restoration after OAuth redirect
        if (pwaInfo.isIOS && pwaInfo.isStandalone) {
          // Restore iOS PWA manifest settings after OAuth success
          restoreIOSPWAManifest();
        }

        // Set tokens in auth store
        setTokens(token, refreshToken);

        // Get user data using the token
        const meUrl = `${API_BASE_URL}/oauth/me`;

        const response = await fetch(meUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error('Failed to get user data');
        }

        const { user } = await response.json();

        // Update auth store with user data
        useAuthStore.setState({
          user,
          accessToken: token,
          refreshToken,
          isAuthenticated: true,
          isLoading: false
        });

        // Request notification permissions for PWA users
        if (pwaInfo.isPWA && isNewUser) {
          try {
            const notificationGranted = await requestPWANotificationPermission();
            if (notificationGranted) {
              logger.info('PWA notification permission granted');
            }
          } catch (error) {
            logger.warn('PWA notification permission request failed:', error);
          }
        }

        // Show success message
        if (isNewUser) {
          notify.success('Welcome! Your account has been created successfully.');
          
          // Set flag to show PWA install prompt later if not already installed
          if (!pwaInfo.isPWA) {
            localStorage.setItem('show_pwa_install_prompt', 'true');
          }
        } else {
          notify.success('Welcome back!');
        }

        // Redirect to dashboard
        navigate('/dashboard');
      } catch (error) {
        logger.error('OAuth success handling error:', error);
        notify.error('Authentication failed. Please try again.');
        navigate('/login');
      }
    };

    handleOAuthSuccess();
  }, [searchParams, navigate, setTokens]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto" />
        <p className="mt-4 text-gray-600">Completing your login...</p>
      </div>
    </div>
  );
}