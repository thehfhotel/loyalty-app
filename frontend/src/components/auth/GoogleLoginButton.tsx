import { useTranslation } from 'react-i18next';
import { initiateOAuth, checkPWAInstallPrompt } from '../../utils/pwaUtils';

interface GoogleLoginButtonProps {
  onSuccess?: () => void;
  onFailure?: () => void;
  theme?: 'light' | 'dark' | 'neutral';
  variant?: 'signIn' | 'continue';
}

export default function GoogleLoginButton({ theme = 'light', variant = 'signIn' }: GoogleLoginButtonProps) {
  const { t } = useTranslation();
  
  const handleGoogleClick = () => {
    // Check for PWA install prompt availability
    checkPWAInstallPrompt();
    
    // Use PWA-aware OAuth initiation
    initiateOAuth('google');
  };

  // Official Google branding guidelines colors and styles
  const getThemeStyles = () => {
    switch (theme) {
      case 'dark':
        return {
          background: '#131314',
          border: '#8E918F',
          text: '#E3E3E3',
          hover: '#292a2d'
        };
      case 'neutral':
        return {
          background: '#F2F2F2',
          border: 'transparent',
          text: '#1F1F1F',
          hover: '#e8e8e8'
        };
      default: // light
        return {
          background: '#FFFFFF',
          border: '#747775',
          text: '#1F1F1F',
          hover: '#F8F9FA'
        };
    }
  };

  const themeStyles = getThemeStyles();

  return (
    <button
      onClick={handleGoogleClick}
      className="w-full flex justify-center items-center px-3 py-2 rounded-md shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      style={{
        backgroundColor: themeStyles.background,
        border: `1px solid ${themeStyles.border}`,
        color: themeStyles.text,
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: '14px',
        fontWeight: '500',
        height: '44px'
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.backgroundColor = themeStyles.hover;
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.backgroundColor = themeStyles.background;
      }}
    >
      {/* Official Google "G" logo SVG */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        className="mr-3"
        style={{ flexShrink: 0 }}
      >
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
      {variant === 'signIn' ? t('auth.signInWithGoogle') : t('auth.continueWithGoogle')}
    </button>
  );
}