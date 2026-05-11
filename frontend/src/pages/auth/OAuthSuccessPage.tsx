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
      const isNewUser = searchParams.get('isNewUser') === 'true';
      const error = searchParams.get('error');
      const isPWARedirect = searchParams.get('pwa_redirect') === 'true';

      // Phase 3: the backend no longer appends `refreshToken=…` to the
      // OAuth success redirect URL. The refresh token rides exclusively
      // on the `Set-Cookie: refresh_token=…; HttpOnly; Path=/api/auth`
      // header attached to the same redirect — JavaScript can't read it
      // and it never appears in browser history, server logs, or
      // Referer headers.

      if (error) {
        notify.error('Social login failed. Please try again.');
        navigate('/login');
        return;
      }

      // Only `token` (the access token) is required. The refresh token
      // lives in the HttpOnly cookie set on this same redirect response.
      if (!token) {
        notify.error('Invalid authentication response. Please try again.');
        navigate('/login');
        return;
      }

      try {
        const pwaInfo = detectPWA();

        // PWA deep-link handoff. The legacy URL-param refresh-token
        // bridge was removed in Phase 3 — the cookie set by the backend
        // is now the only delivery channel. `handlePWAOAuthSuccess`
        // still receives the access token so it can fire the deep-link
        // redirect, but the refresh-token field is intentionally empty;
        // the standalone PWA picks the refresh token up from the
        // browser's cookie jar on the next `/api/auth/refresh` call.
        const pwaTokens = {
          accessToken: token,
          refreshToken: '',
          isNewUser,
        };

        // Enhanced PWA-specific OAuth flow handling
        if (isPWARedirect || !pwaInfo.isPWA) {
          // Check if we need to redirect back to PWA
          handlePWAOAuthSuccess(pwaTokens);

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

        // Phase 3: store the access token only. The refresh token is in
        // the HttpOnly cookie set by the backend on the OAuth callback
        // redirect — the browser will send it automatically on the next
        // /api/auth/refresh call.
        setTokens(token);

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

        // Update auth store with user data. (No `refreshToken` field —
        // that lives in the HttpOnly cookie now, Phase 3.)
        useAuthStore.setState({
          user,
          accessToken: token,
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