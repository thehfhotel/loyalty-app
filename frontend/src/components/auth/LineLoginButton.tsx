import { useTranslation } from 'react-i18next';
import { initiateOAuth, checkPWAInstallPrompt } from '../../utils/pwaUtils';

interface LineLoginButtonProps {
  onSuccess?: () => void;
  onFailure?: () => void;
  size?: 'small' | 'medium' | 'large';
  variant?: 'signIn' | 'continue';
}

export default function LineLoginButton({ size = 'medium', variant = 'signIn' }: LineLoginButtonProps) {
  const { t } = useTranslation();
  
  const handleLineClick = () => {
    // Check for PWA install prompt availability
    checkPWAInstallPrompt();
    
    // Use PWA-aware OAuth initiation
    initiateOAuth('line');
  };

  // Official LINE branding guidelines colors
  const lineColors = {
    base: '#06C755',
    hover: '#05B04A', // Base + 10% black opacity approximation
    pressed: '#048A3D', // Base + 30% black opacity approximation
    disabled: '#FFFFFF'
  };

  // Size configurations
  const sizeConfigs = {
    small: { height: '36px', fontSize: '12px', iconSize: '16' },
    medium: { height: '44px', fontSize: '14px', iconSize: '20' },
    large: { height: '52px', fontSize: '16px', iconSize: '24' }
  };

  const config = sizeConfigs[size];

  return (
    <button
      onClick={handleLineClick}
      className="w-full flex justify-center items-center rounded-md shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
      style={{
        backgroundColor: lineColors.base,
        border: 'none',
        color: '#FFFFFF',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontSize: config.fontSize,
        fontWeight: '600',
        height: config.height,
        padding: '0 16px'
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.backgroundColor = lineColors.hover;
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.backgroundColor = lineColors.base;
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.backgroundColor = lineColors.pressed;
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.backgroundColor = lineColors.hover;
      }}
    >
      {/* Official LINE logo SVG */}
      <svg
        width={config.iconSize}
        height={config.iconSize}
        viewBox="0 0 24 24"
        className="mr-2"
        style={{ flexShrink: 0 }}
        fill="white"
      >
        <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.2 0-.395-.078-.546-.207l-2.05-1.742v2.948c0 .348-.281.63-.631.63-.345 0-.626-.282-.626-.63V8.108c0-.27.173-.51.43-.595.063-.022.132-.032.199-.032.2 0 .394.078.545.207l2.05 1.742V6.482c0-.349.281-.63.63-.63.351 0 .63.281.63.63v4.397zm-5.741 0c0 .348-.282.63-.631.63-.345 0-.627-.282-.627-.63V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.282-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.774.039 1.085l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
      </svg>
      {variant === 'signIn' ? t('auth.signInWithLine') : t('auth.continueWithLine')}
    </button>
  );
}