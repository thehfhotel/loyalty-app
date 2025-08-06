# PWA OAuth and Push Notifications Solution

## Problem Statement

The loyalty app was experiencing OAuth authentication issues when running as a PWA (Progressive Web App) from the homescreen:

1. **OAuth Context Loss**: When users initiated LINE OAuth from PWA standalone mode, the redirect would open LINE app, but the callback would open in a new browser window instead of returning to the PWA
2. **Blank Screen Issue**: The original PWA instance would remain with a blank screen after successful OAuth
3. **Missing Notifications**: PWA users couldn't receive push notifications for loyalty rewards and updates

## Root Cause Analysis

The issue occurred due to browser context switching during OAuth flows in PWA standalone mode:

```
PWA (standalone) → LINE App → Browser Window (callback) → PWA (blank screen)
```

This broke the authentication flow because the OAuth success tokens were delivered to a new browser context rather than the original PWA instance.

## Solution Architecture

### 1. PWA Detection and Context Management

Created `frontend/src/utils/pwaUtils.ts` with comprehensive PWA detection:

```typescript
export interface PWAInfo {
  isPWA: boolean;
  isStandalone: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  userAgent: string;
}

export function detectPWA(): PWAInfo {
  // Detects PWA mode using display-mode media queries and navigator properties
}
```

### 2. OAuth State Persistence

Implemented Redis-based OAuth state storage to maintain session continuity across browser context switches:

**Backend Enhancement** (`backend/src/services/oauthStateService.ts`):
- Extended state data to include PWA context information
- Added PWA-specific parameters: `isPWA`, `isStandalone`, `platform`
- 10-minute TTL for OAuth states with automatic cleanup

**Frontend State Management**:
- Stores PWA context in localStorage before OAuth initiation
- Recovers OAuth state after successful authentication
- Handles cross-context token delivery

### 3. PWA-Aware OAuth Initiation

Updated OAuth buttons to use PWA-aware initiation:

**Line Login Button** (`frontend/src/components/auth/LineLoginButton.tsx`):
```typescript
const handleLineClick = () => {
  checkPWAInstallPrompt();
  initiateOAuth('line'); // PWA-aware OAuth
};
```

**Backend OAuth Routes** (`backend/src/routes/oauth.ts`):
- Added PWA context parameters to OAuth URLs
- Enhanced state data with PWA information
- Improved mobile Safari compatibility

### 4. OAuth Success Page Enhancement

Enhanced `frontend/src/pages/auth/OAuthSuccessPage.tsx`:

```typescript
// Handle PWA-specific OAuth flow
if (isPWARedirect || !pwaInfo.isPWA) {
  handlePWAOAuthSuccess(tokens);
  
  const pwaState = recoverPWAOAuthState();
  if (pwaState && !pwaInfo.isStandalone) {
    // Redirect to PWA context
    return;
  }
}
```

### 5. Push Notification System

Implemented comprehensive push notification support:

**Notification Service** (`frontend/src/services/notificationService.ts`):
- VAPID key management
- Push subscription handling
- Background sync support
- Platform-specific optimizations

**Backend Notification Endpoints** (`backend/src/routes/notifications.ts`):
- `/notifications/vapid-key` - Public VAPID key endpoint
- `/notifications/push/subscribe` - Subscribe to push notifications
- `/notifications/push/unsubscribe` - Unsubscribe from notifications

**Custom Service Worker** (`frontend/public/sw-custom.js`):
- Push notification handling
- OAuth success message broadcasting
- Background sync for offline scenarios
- Notification click handling

### 6. PWA Configuration Updates

Enhanced `frontend/vite.config.ts`:
```typescript
VitePWA({
  strategies: 'injectManifest',
  srcDir: 'public',
  filename: 'sw-custom.js',
  manifest: {
    display: 'standalone',
    orientation: 'portrait-primary',
    categories: ['travel', 'business'],
    // ... enhanced PWA manifest
  }
})
```

## Implementation Features

### OAuth Flow Enhancements

1. **Context Preservation**: OAuth state includes PWA context information
2. **Cross-Context Recovery**: Tokens can be delivered across browser contexts
3. **Mobile Optimization**: Special handling for iOS Safari and Android Chrome
4. **Fallback Support**: Graceful degradation for non-PWA environments

### Notification System

1. **Push Notifications**: Full VAPID-based push notification support
2. **Permission Management**: Automatic permission requests for PWA users
3. **Platform Detection**: iOS/Android/Web platform-specific handling
4. **Background Sync**: Offline notification queueing and delivery

### PWA Features

1. **Install Prompts**: Automatic PWA install prompts after successful OAuth
2. **Standalone Detection**: Accurate PWA mode detection across platforms
3. **Service Worker**: Custom service worker for advanced PWA features
4. **Manifest Enhancement**: Improved PWA manifest with proper categorization

## Usage Flow

### For PWA Users (Standalone Mode)

1. User opens PWA from homescreen
2. Clicks LINE login button
3. PWA stores context in localStorage
4. Redirects to LINE with PWA parameters
5. LINE authentication completes
6. OAuth callback includes PWA context
7. Success page detects PWA context and maintains app session
8. User remains in PWA with successful authentication
9. Push notifications are automatically enabled

### For Browser Users

1. Standard OAuth flow continues to work normally
2. PWA install prompt shown after successful OAuth
3. Optional push notification enrollment

## Configuration Requirements

### Backend Environment Variables

```env
# Push Notifications (Optional)
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key

# OAuth Configuration (Existing)
LINE_CHANNEL_ID=your-line-channel-id
LINE_CHANNEL_SECRET=your-line-channel-secret
LINE_CALLBACK_URL=your-callback-url
```

### Frontend Environment Variables

```env
VITE_API_URL=your-backend-api-url
```

## Testing Scenarios

### PWA OAuth Testing

1. **Install PWA**: Add app to homescreen on mobile device
2. **OAuth from PWA**: Initiate LINE login from PWA standalone mode
3. **Verify Context**: Ensure OAuth success returns to PWA (not new browser)
4. **Check Authentication**: Verify user is logged in within PWA context

### Push Notification Testing

1. **Permission Request**: Verify notification permission prompt appears
2. **Subscription**: Check that push subscription is sent to backend
3. **Notification Display**: Test notification display and click handling
4. **App Focus**: Ensure clicking notification focuses/opens PWA

## Browser Support

- **iOS Safari**: Full PWA support with OAuth context preservation
- **Android Chrome**: Complete PWA functionality with push notifications
- **Desktop Browsers**: Standard OAuth flow with PWA install prompts
- **Other Mobile Browsers**: Fallback OAuth handling

## Security Considerations

1. **OAuth State Security**: 10-minute TTL with secure Redis storage
2. **VAPID Keys**: Proper VAPID key management for push notifications
3. **Context Validation**: PWA context verification to prevent abuse
4. **Token Security**: Secure token delivery across browser contexts

## Monitoring and Analytics

The solution includes comprehensive logging:

- OAuth flow tracking with PWA context
- Push notification subscription/delivery metrics
- Service worker performance monitoring
- Cross-context authentication success rates

## Future Enhancements

1. **Universal Links**: iOS Universal Links for seamless OAuth returns
2. **Android App Links**: Android App Links for improved OAuth flow
3. **Advanced Notifications**: Rich notifications with actions and replies
4. **Offline OAuth**: Offline OAuth state caching and recovery
5. **Multi-Provider**: Extended PWA support for Google OAuth

## Deployment Notes

1. **Service Worker**: Custom service worker must be properly cached
2. **HTTPS Required**: PWA features require HTTPS in production
3. **Manifest Caching**: PWA manifest should be properly cached
4. **Push Certificates**: VAPID keys required for production push notifications

This solution ensures seamless OAuth authentication and push notification delivery for PWA users while maintaining backward compatibility with standard browser usage.