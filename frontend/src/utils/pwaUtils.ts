/**
 * PWA Detection and OAuth Handling Utilities
 * Handles OAuth flows in PWA standalone mode to maintain app context
 */

export interface PWAInfo {
  isPWA: boolean;
  isStandalone: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  userAgent: string;
}

/**
 * Detect if app is running as PWA and get platform info
 */
export function detectPWA(): PWAInfo {
  const userAgent = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  
  // Check if running in standalone mode (PWA)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                      (window.navigator as any).standalone === true || // iOS Safari
                      document.referrer.includes('android-app://'); // Android Chrome

  const isPWA = isStandalone && ('serviceWorker' in navigator);

  return {
    isPWA,
    isStandalone,
    isIOS,
    isAndroid,
    userAgent
  };
}

/**
 * Generate PWA-aware OAuth URL with special handling for standalone mode
 */
export function createPWAOAuthURL(provider: 'google' | 'line'): string {
  const pwaInfo = detectPWA();
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4001/api';
  
  // Base OAuth URL
  const oauthUrl = `${apiUrl}/oauth/${provider}`;
  
  // Add PWA context parameters
  const params = new URLSearchParams();
  
  if (pwaInfo.isPWA) {
    params.set('pwa', 'true');
    params.set('standalone', pwaInfo.isStandalone.toString());
    params.set('platform', pwaInfo.isIOS ? 'ios' : pwaInfo.isAndroid ? 'android' : 'web');
  }
  
  // Add current URL as return URL for PWA context preservation
  params.set('return_url', window.location.origin);
  
  return params.toString() ? `${oauthUrl}?${params.toString()}` : oauthUrl;
}

/**
 * Handle OAuth initiation with PWA-specific optimizations
 */
export function initiateOAuth(provider: 'google' | 'line'): void {
  const pwaInfo = detectPWA();
  const oauthUrl = createPWAOAuthURL(provider);
  
  if (pwaInfo.isPWA) {
    // For PWA, store current state and use special handling
    storePWAOAuthState();
    
    if (pwaInfo.isIOS) {
      // iOS PWA: Use location.href to maintain app context better
      window.location.href = oauthUrl;
    } else {
      // Android PWA: Try to open in same context
      window.location.href = oauthUrl;
    }
  } else {
    // Regular web browser
    window.location.href = oauthUrl;
  }
}

/**
 * Store PWA OAuth state for recovery after redirect
 */
function storePWAOAuthState(): void {
  const state = {
    url: window.location.href,
    timestamp: Date.now(),
    pwaContext: true
  };
  
  localStorage.setItem('pwa_oauth_state', JSON.stringify(state));
}

/**
 * Recover PWA OAuth state after successful authentication
 */
export function recoverPWAOAuthState(): { url: string; timestamp: number } | null {
  try {
    const stateJson = localStorage.getItem('pwa_oauth_state');
    if (!stateJson) return null;
    
    const state = JSON.parse(stateJson);
    
    // Clear the stored state
    localStorage.removeItem('pwa_oauth_state');
    
    // Check if state is still valid (within 10 minutes)
    if (Date.now() - state.timestamp > 10 * 60 * 1000) {
      return null;
    }
    
    return state;
  } catch (error) {
    console.error('Failed to recover PWA OAuth state:', error);
    localStorage.removeItem('pwa_oauth_state');
    return null;
  }
}

/**
 * Check if current OAuth success page should redirect back to PWA
 */
export function shouldRedirectToPWA(): boolean {
  const pwaInfo = detectPWA();
  const pwaState = recoverPWAOAuthState();
  
  // If we have PWA state and we're not currently in standalone mode,
  // it means we're in a browser window and need to redirect back to PWA
  return !!(pwaState && !pwaInfo.isStandalone);
}

/**
 * Generate PWA deep link for OAuth success redirect
 */
export function generatePWADeepLink(tokens: { accessToken: string; refreshToken: string; isNewUser: boolean }): string {
  const baseUrl = window.location.origin;
  const params = new URLSearchParams({
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    isNewUser: tokens.isNewUser.toString(),
    pwa_redirect: 'true'
  });
  
  return `${baseUrl}/oauth/success?${params.toString()}`;
}

/**
 * Handle PWA OAuth success with context preservation
 */
export function handlePWAOAuthSuccess(tokens: { accessToken: string; refreshToken: string; isNewUser: boolean }): void {
  const pwaInfo = detectPWA();
  
  if (pwaInfo.isPWA) {
    // Already in PWA context, continue normally
    return;
  }
  
  // Check if we should redirect back to PWA
  if (shouldRedirectToPWA()) {
    const deepLink = generatePWADeepLink(tokens);
    
    // Try to open PWA with deep link
    if (pwaInfo.isIOS) {
      // iOS: Use custom scheme or universal link
      window.location.href = deepLink;
    } else if (pwaInfo.isAndroid) {
      // Android: Use intent or custom scheme
      window.location.href = deepLink;
    } else {
      // Fallback: Regular redirect
      window.location.href = deepLink;
    }
    
    return;
  }
}

/**
 * Enhanced PWA OAuth notification support
 */
export async function requestPWANotificationPermission(): Promise<boolean> {
  const pwaInfo = detectPWA();
  
  if (!pwaInfo.isPWA || !('Notification' in window)) {
    return false;
  }
  
  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch (error) {
    console.error('Failed to request notification permission:', error);
    return false;
  }
}

/**
 * Check PWA installation status and prompt if needed
 */
export function checkPWAInstallPrompt(): void {
  let deferredPrompt: any;
  
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later
    deferredPrompt = e;
    
    // Show custom install prompt if user completes OAuth successfully
    const showInstallPrompt = localStorage.getItem('show_pwa_install_prompt');
    if (showInstallPrompt === 'true') {
      localStorage.removeItem('show_pwa_install_prompt');
      
      setTimeout(() => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          deferredPrompt.userChoice.then((choiceResult: any) => {
            if (choiceResult.outcome === 'accepted') {
              console.log('User accepted the PWA install prompt');
            }
            deferredPrompt = null;
          });
        }
      }, 2000); // Show after 2 seconds
    }
  });
}

/**
 * Debug PWA OAuth flow for development
 */
export function debugPWAOAuth(): void {
  if (import.meta.env?.DEV) {
    const pwaInfo = detectPWA();
    const oauthState = localStorage.getItem('pwa_oauth_state');
    
    console.log('PWA OAuth Debug Info:', {
      pwaInfo,
      oauthState: oauthState ? JSON.parse(oauthState) : null,
      currentUrl: window.location.href,
      referrer: document.referrer,
      userAgent: navigator.userAgent
    });
  }
}