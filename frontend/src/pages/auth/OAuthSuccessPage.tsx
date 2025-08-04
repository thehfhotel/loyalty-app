import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { notify } from '../../utils/notificationManager';

export default function OAuthSuccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setTokens = useAuthStore((state) => state.setTokens);

  useEffect(() => {
    const handleOAuthSuccess = async () => {
      const token = searchParams.get('token');
      const refreshToken = searchParams.get('refreshToken');
      const isNewUser = searchParams.get('isNewUser') === 'true';
      const error = searchParams.get('error');


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
        // Set tokens in auth store
        setTokens(token, refreshToken);

        // Get user data using the token
        const meUrl = `${import.meta.env.VITE_API_URL}/api/oauth/me`;
        
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

        // Show success message
        if (isNewUser) {
          notify.success('Welcome! Your account has been created successfully.');
        } else {
          notify.success('Welcome back!');
        }

        // Redirect to dashboard
        navigate('/dashboard');
      } catch (error) {
        console.error('OAuth success handling error:', error);
        notify.error('Authentication failed. Please try again.');
        navigate('/login');
      }
    };

    handleOAuthSuccess();
  }, [searchParams, navigate]); // Removed setTokens to prevent re-runs

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Completing your login...</p>
      </div>
    </div>
  );
}