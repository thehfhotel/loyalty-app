/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import passport from 'passport';
import { logger } from '../utils/logger';
import { sanitizeLogValue, sanitizeEmail, sanitizeUserId, sanitizeUrl } from '../utils/logSanitizer';
import { oauthStateService } from '../services/oauthStateService';

/**
 * Validates and sanitizes OAuth return URLs to prevent open redirect attacks.
 * Only allows redirects to the configured frontend URL origin.
 */
function validateReturnUrl(inputUrl: string | undefined): string {
  const defaultUrl = process.env.FRONTEND_URL ?? 'http://localhost:4001';

  if (!inputUrl) {
    return defaultUrl;
  }

  try {
    const parsed = new URL(inputUrl);
    const frontendOrigin = new URL(defaultUrl).origin;

    // Only allow redirects to the same origin as the configured frontend
    if (parsed.origin === frontendOrigin) {
      return inputUrl;
    }

    // Log attempted open redirect attack
    logger.warn('[OAuth] Blocked potential open redirect attempt', {
      attemptedUrl: sanitizeUrl(inputUrl),
      allowedOrigin: frontendOrigin
    });

    return defaultUrl;
  } catch {
    // Invalid URL, use default
    return defaultUrl;
  }
}

/**
 * OAuth 2.0 standard error codes (RFC 6749 Section 4.1.2.1)
 * Only these values are valid OAuth error responses from providers.
 */
const OAUTH_ERROR_CODES = new Set([
  'invalid_request',
  'unauthorized_client',
  'access_denied',
  'unsupported_response_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
  // Additional provider-specific errors
  'interaction_required',
  'login_required',
  'consent_required'
]);

/**
 * Validates if the error query parameter is a legitimate OAuth error code.
 * Returns the error code if valid, null otherwise.
 */
function getValidOAuthError(errorParam: unknown): string | null {
  if (typeof errorParam !== 'string' || !errorParam) {
    return null;
  }
  return OAUTH_ERROR_CODES.has(errorParam) ? errorParam : null;
}

const router = Router();

// Google OAuth routes
router.get('/google', async (req, res) => {
  try {
    logger.debug('[OAuth] Google OAuth initiated', {
      headers: req.headers,
      protocol: req.protocol,
      secure: req.secure,
      ip: req.ip,
      originalUrl: req.originalUrl,
      host: req.get('host'),
      forwardedProto: req.get('X-Forwarded-Proto'),
      forwardedHost: req.get('X-Forwarded-Host')
    });
    
    // Check if Google strategy is configured
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    
    if (!googleClientId || googleClientId === 'your-google-client-id') {
      const error = `Google OAuth not configured - Client ID: ${googleClientId}`;
      logger.warn('[OAuth] ' + error);
      return res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=google_not_configured`);
    }
    
    logger.debug('[OAuth] Initiating Google OAuth with scopes', { scopes: ['profile', 'email'] });
    
    // Create OAuth state for session continuity across browser context switches
    const userAgent = req.get('User-Agent') ?? '';
    const returnUrl = validateReturnUrl((req.query.return_url as string) ?? req.headers.referer);
    
    // PWA-specific parameters
    const isPWA = req.query.pwa === 'true';
    const isStandalone = req.query.standalone === 'true';
    const platform = (req.query.platform as string) ?? 'web';
    
    const stateData = {
      sessionId: req.sessionID,
      userId: (req.session as any)?.userId,
      userAgent,
      timestamp: Date.now(),
      returnUrl,
      provider: 'google' as const,
      originalUrl: req.originalUrl,
      ip: req.ip ?? req.connection.remoteAddress ?? 'unknown',
      secure: req.secure,
      host: req.get('host') ?? 'localhost',
      // PWA context
      isPWA,
      isStandalone,
      platform
    };
    
    const stateKey = await oauthStateService.createState(stateData);
    
    // Enhanced mobile-friendly Google OAuth initiation for Safari iPhone
    const isMobile = /iPhone|iPad|iPod|Android/i.test(userAgent);
    const isSafari = /Safari/i.test(userAgent) && !/Chrome|CriOS/i.test(userAgent);
    
    if (isMobile && isSafari) {
      // For Safari mobile, construct Google OAuth URL manually
      const callbackURL = encodeURIComponent(process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:4001/api/oauth/google/callback');
      const scope = encodeURIComponent('profile email');
      
      const googleOAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${googleClientId}&redirect_uri=${callbackURL}&scope=${scope}&state=${stateKey}`;
      
      logger.debug('[OAuth] Generating mobile-friendly Google OAuth redirect with state', { 
        googleOAuthUrl: googleOAuthUrl.replace(googleClientId, '***'),
        stateKey,
        userAgent,
        isMobile,
        isSafari 
      });
      
      const htmlRedirect = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Redirecting to Google...</title>
    <meta http-equiv="refresh" content="0;url=${googleOAuthUrl}">
</head>
<body>
    <script>
        window.location.href = '${googleOAuthUrl}';
    </script>
    <p>Redirecting to Google for authentication...</p>
    <p>If you are not redirected automatically, <a href="${googleOAuthUrl}">click here</a>.</p>
</body>
</html>`;
      
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.status(200).send(htmlRedirect);
    } else {
      // For desktop and other mobile browsers, we still use passport but with state
      // Store state in request for passport to use
      (req as any).oauthState = stateKey;
      
      // Custom passport authentication with state parameter
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${googleClientId}&redirect_uri=${encodeURIComponent(process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:4001/api/oauth/google/callback')}&scope=${encodeURIComponent('profile email')}&state=${stateKey}`;
      
      logger.debug('[OAuth] Redirecting to Google OAuth with state', {
        stateKey,
        authUrl: authUrl.replace(googleClientId, '***')
      });
      
      res.redirect(authUrl);
    }
  } catch (error) {
    logger.error('[OAuth] Google initiation error:', error);
    res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=oauth_error`);
  }
});

router.get('/google/callback', 
  (req, res, next) => {
    try {
      // Check for OAuth errors in callback - only accept whitelisted OAuth error codes
      const oauthError = getValidOAuthError(req.query.error);
      if (oauthError) {
        logger.error('[OAuth] Google OAuth error', {
          error: oauthError,
          description: sanitizeLogValue((req.query.error_description as string) ?? 'No description')
        });
        return res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=oauth_provider_error`);
      }

      
      logger.debug('[OAuth] Google OAuth callback received', {
        query: req.query,
        headers: req.headers,
        cookies: req.cookies,
        sessionID: req.sessionID,
        session: req.session
      });
      next();
    } catch (error) {
      logger.error('[OAuth] Google callback preprocessing error:', error);
      res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=oauth_error`);
    }
  },
  (req, res, next) => {
    // Custom passport authentication with debug logging
    passport.authenticate('google', { session: false }, (err, user, info) => {
      if (err) {
        logger.error('[OAuth] Google passport authentication error:', err);
        return res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=oauth_auth_error`);
      }
      
      if (!user) {
        logger.error('[OAuth] Google authentication failed - no user:', info);
        return res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=oauth_no_user`);
      }

      req.user = user;
      next();
    })(req, res, next);
  },
  async (req, res) => {
    try {
      logger.debug('[OAuth] Google OAuth authenticated, processing result');
      const oauthResult = req.user as any;
      
      if (!oauthResult) {
        logger.error('[OAuth] Google OAuth failed - no user data received');
        return res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=oauth_failed`);
      }

      const { user, tokens, isNewUser } = oauthResult;
      
      // Validate required data
      if (!user || !tokens?.accessToken) {
        logger.error('[OAuth] Incomplete OAuth result:', { hasUser: !!user, hasTokens: !!tokens, hasAccessToken: !!tokens?.accessToken });
        return res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=oauth_incomplete`);
      }

      
      logger.debug('[OAuth] Google OAuth user data', {
        userId: user.id,
        email: user.email,
        isNewUser,
        provider: (user as any).oauthProvider
      });

      // Create success URL with tokens
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:4001';
      const successUrl = new URL('/oauth/success', frontendUrl);
      successUrl.searchParams.set('token', tokens.accessToken);
      successUrl.searchParams.set('refreshToken', tokens.refreshToken);
      successUrl.searchParams.set('isNewUser', isNewUser.toString());

      logger.info(`[OAuth] Google OAuth success for user ${sanitizeEmail(user.email)}, isNewUser: ${isNewUser}`);
      logger.info('[OAuth] Environment check', {
        frontendUrl,
        nodeEnv: process.env.NODE_ENV,
        host: req.get('host'),
        protocol: req.protocol,
        secure: req.secure,
        forwardedProto: req.get('x-forwarded-proto')
      });
      logger.debug('[OAuth] Redirecting to success URL', { successUrl: successUrl.toString() });
      
      // Enhanced mobile-friendly redirect for Safari iPhone compatibility
      const userAgent = req.get('User-Agent') ?? '';
      const isMobile = /iPhone|iPad|iPod|Android/i.test(userAgent);
      const isSafari = /Safari/i.test(userAgent) && !/Chrome|CriOS/i.test(userAgent);
      
      if (isMobile && isSafari) {
        // Use HTML meta refresh for Safari mobile compatibility
        const htmlRedirect = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Redirecting...</title>
    <meta http-equiv="refresh" content="0;url=${successUrl.toString()}">
</head>
<body>
    <script>
        window.location.href = '${successUrl.toString()}';
    </script>
    <p>If you are not redirected automatically, <a href="${successUrl.toString()}">click here</a>.</p>
</body>
</html>`;
        
        res.set({
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.status(200).send(htmlRedirect);
      } else {
        // Standard redirect for desktop and other mobile browsers
        res.redirect(302, successUrl.toString());
      }
    } catch (error) {
      logger.error('[OAuth] Google OAuth callback error:', error);
      
      // Enhanced mobile-friendly error redirect
      const userAgent = req.get('User-Agent') ?? '';
      const isMobile = /iPhone|iPad|iPod|Android/i.test(userAgent);
      const isSafari = /Safari/i.test(userAgent) && !/Chrome|CriOS/i.test(userAgent);
      const errorUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=oauth_error`;
      
      if (isMobile && isSafari) {
        const htmlRedirect = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Redirecting...</title>
    <meta http-equiv="refresh" content="0;url=${errorUrl}">
</head>
<body>
    <script>
        window.location.href = '${errorUrl}';
    </script>
    <p>If you are not redirected automatically, <a href="${errorUrl}">click here</a>.</p>
</body>
</html>`;
        
        res.set({
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.status(200).send(htmlRedirect);
      } else {
        res.redirect(302, errorUrl);
      }
    }
  }
);


// LINE OAuth routes
router.get('/line', async (req, res) => {
  try {
    logger.debug('[OAuth] LINE OAuth initiated', {
      headers: req.headers,
      protocol: req.protocol,
      secure: req.secure,
      ip: req.ip,
      originalUrl: req.originalUrl,
      host: req.get('host'),
      forwardedProto: req.get('X-Forwarded-Proto'),
      forwardedHost: req.get('X-Forwarded-Host')
    });
    
    // Check if LINE strategy is configured
    const lineChannelId = process.env.LINE_CHANNEL_ID;
    
    if (!lineChannelId || lineChannelId === 'your-line-channel-id') {
      logger.warn('[OAuth] LINE OAuth not configured', { lineChannelId });
      return res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=line_not_configured`);
    }
    
    logger.debug('[OAuth] Initiating LINE OAuth', { channelId: lineChannelId });
    
    // Create OAuth state for session continuity across browser context switches
    const userAgent = req.get('User-Agent') ?? '';
    const returnUrl = validateReturnUrl((req.query.return_url as string) ?? req.headers.referer);
    
    // PWA-specific parameters
    const isPWA = req.query.pwa === 'true';
    const isStandalone = req.query.standalone === 'true';
    const platform = (req.query.platform as string) ?? 'web';
    
    const stateData = {
      sessionId: req.sessionID,
      userId: (req.session as any)?.userId,
      userAgent,
      timestamp: Date.now(),
      returnUrl,
      provider: 'line' as const,
      originalUrl: req.originalUrl,
      ip: req.ip ?? req.connection.remoteAddress ?? 'unknown',
      secure: req.secure,
      host: req.get('host') ?? 'localhost',
      // PWA context
      isPWA,
      isStandalone,
      platform
    };
    
    const stateKey = await oauthStateService.createState(stateData);
    
    // Enhanced mobile-friendly LINE OAuth initiation for Safari iPhone
    // Fix: Safari iPhone treats OAuth redirects as file downloads when using standard HTTP redirects
    // Solution: Use HTML meta refresh + JavaScript redirect for mobile Safari compatibility
    const isMobile = /iPhone|iPad|iPod|Android/i.test(userAgent);
    const isSafari = /Safari/i.test(userAgent) && !/Chrome|CriOS/i.test(userAgent);
    
    if (isMobile && isSafari) {
      // For Safari mobile, we need to construct the LINE OAuth URL manually
      // and return an HTML page to avoid the redirect being treated as a download
      const callbackURL = encodeURIComponent(process.env.LINE_CALLBACK_URL ?? 'http://localhost:4001/api/oauth/line/callback');
      const scope = 'profile%20openid%20email';
      
      const lineOAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${lineChannelId}&redirect_uri=${callbackURL}&state=${stateKey}&scope=${scope}`;
      
      logger.debug('[OAuth] Generating mobile-friendly LINE OAuth redirect with state', { 
        lineOAuthUrl: lineOAuthUrl.replace(lineChannelId, '***'),
        stateKey,
        userAgent,
        isMobile,
        isSafari 
      });
      
      const htmlRedirect = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Redirecting to LINE...</title>
    <meta http-equiv="refresh" content="0;url=${lineOAuthUrl}">
</head>
<body>
    <script>
        window.location.href = '${lineOAuthUrl}';
    </script>
    <p>Redirecting to LINE for authentication...</p>
    <p>If you are not redirected automatically, <a href="${lineOAuthUrl}">click here</a>.</p>
</body>
</html>`;
      
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.status(200).send(htmlRedirect);
    } else {
      // For desktop and other mobile browsers, we need to store the state and use it
      // Store state in request for passport to use
      (req as any).oauthState = stateKey;
      
      // Custom passport authentication with state parameter
      const authUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${lineChannelId}&redirect_uri=${encodeURIComponent(process.env.LINE_CALLBACK_URL ?? 'http://localhost:4001/api/oauth/line/callback')}&state=${stateKey}&scope=profile%20openid%20email`;
      
      logger.debug('[OAuth] Redirecting to LINE OAuth with state', {
        stateKey,
        authUrl: authUrl.replace(lineChannelId, '***')
      });
      
      res.redirect(authUrl);
    }
  } catch (error) {
    logger.error('[OAuth] LINE initiation error:', error);
    res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=oauth_error`);
  }
});

router.get('/line/callback', async (req, res) => {
  try {
    // Check for OAuth errors in callback - only accept whitelisted OAuth error codes
    const oauthError = getValidOAuthError(req.query.error);
    if (oauthError) {
      logger.error('[OAuth] LINE OAuth error', {
        error: oauthError,
        description: sanitizeLogValue((req.query.error_description as string) ?? 'No description')
      });
      return res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=oauth_provider_error`);
    }

    const { code, state } = req.query;
    
    if (!code || !state) {
      logger.error('[OAuth] LINE callback missing required parameters', { code: !!code, state: !!state });
      return res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=oauth_invalid`);
    }

    logger.debug('[OAuth] LINE OAuth callback received', {
      hasCode: !!code,
      hasState: !!state,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    // Retrieve state data for session continuity
    const stateData = await oauthStateService.getState(state as string, 'line');
    
    if (!stateData) {
      logger.error('[OAuth] LINE callback with invalid or expired state', { state });
      return res.redirect(`${process.env.FRONTEND_URL ?? 'http://localhost:4001'}/login?error=session_expired`);
    }

    logger.debug('[OAuth] LINE OAuth state recovered successfully', {
      stateAge: Math.floor((Date.now() - stateData.timestamp) / 1000),
      returnUrl: stateData.returnUrl,
      originalUserAgent: stateData.userAgent
    });

    // Process LINE OAuth with authorization code - bypass passport for stateless operation
    const { oauthService } = await import('../services/oauthService');
    
    // Exchange authorization code for access token
    const lineTokenUrl = 'https://api.line.me/oauth2/v2.1/token';
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code as string,
      redirect_uri: process.env.LINE_CALLBACK_URL ?? 'http://localhost:4001/api/oauth/line/callback',
      client_id: process.env.LINE_CHANNEL_ID ?? '',
      client_secret: process.env.LINE_CHANNEL_SECRET ?? ''
    });

    const tokenResponse = await fetch(lineTokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'loyalty-app/1.0'
      },
      body: tokenParams.toString()
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.error('[OAuth] LINE token exchange failed', { 
        status: tokenResponse.status, 
        error: errorText 
      });
      return res.redirect(`${validateReturnUrl(stateData.returnUrl)}/login?error=oauth_token_failed`);
    }

    const tokenData = await tokenResponse.json() as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token?: string;
    };
    
    // Get LINE profile
    const profileResponse = await fetch('https://api.line.me/v2/profile', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'User-Agent': 'loyalty-app/1.0'
      }
    });

    if (!profileResponse.ok) {
      logger.error('[OAuth] LINE profile fetch failed', { status: profileResponse.status });
      return res.redirect(`${validateReturnUrl(stateData.returnUrl)}/login?error=oauth_profile_failed`);
    }

    const lineProfile = await profileResponse.json() as {
      userId: string;
      displayName: string;
      pictureUrl?: string;
      statusMessage?: string;
    };
    
    logger.debug('[OAuth] LINE profile received via direct API', {
      userId: lineProfile.userId,
      displayName: lineProfile.displayName,
      hasProfilePicture: !!lineProfile.pictureUrl
    });

    // Convert LINE profile to our format and process through OAuth service
    const profile = {
      id: lineProfile.userId,
      displayName: lineProfile.displayName,
      pictureUrl: lineProfile.pictureUrl,
      statusMessage: lineProfile.statusMessage,
      email: undefined // LINE API doesn't provide email in basic profile
    };

    // Process authentication through our OAuth service
    const oauthResult = await oauthService.handleLineAuth(profile);
    
    if (!oauthResult) {
      logger.error('[OAuth] LINE authentication processing failed');
      return res.redirect(`${validateReturnUrl(stateData.returnUrl)}/login?error=oauth_processing_failed`);
    }

    const { user, tokens, isNewUser } = oauthResult;
    logger.debug('[OAuth] LINE OAuth user authenticated', {
      userId: user.id,
      email: user.email,
      isNewUser,
      provider: (user as any).oauthProvider
    });

    // Cleanup state data
    await oauthStateService.deleteState(state as string, 'line');

    // Create success URL with tokens using validated return URL from state
    const validatedReturnUrl = validateReturnUrl(stateData.returnUrl);
    const successUrl = new URL('/oauth/success', validatedReturnUrl);
    successUrl.searchParams.set('token', tokens.accessToken);
    successUrl.searchParams.set('refreshToken', tokens.refreshToken);
    successUrl.searchParams.set('isNewUser', isNewUser.toString());

    logger.info(`[OAuth] LINE OAuth success for user ${sanitizeEmail(user.email ?? '')} (${sanitizeUserId(user.id)}), isNewUser: ${isNewUser}`);
    logger.debug('[OAuth] Redirecting to success URL', { successUrl: successUrl.toString() });
    
    // Enhanced mobile-friendly redirect for Safari iPhone compatibility
    const userAgent = req.get('User-Agent') ?? '';
    const isMobile = /iPhone|iPad|iPod|Android/i.test(userAgent);
    const isSafari = /Safari/i.test(userAgent) && !/Chrome|CriOS/i.test(userAgent);
    
    if (isMobile && isSafari) {
      // Use HTML meta refresh for Safari mobile compatibility
      const htmlRedirect = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Redirecting...</title>
    <meta http-equiv="refresh" content="0;url=${successUrl.toString()}">
</head>
<body>
    <script>
        window.location.href = '${successUrl.toString()}';
    </script>
    <p>Authentication successful! Redirecting...</p>
    <p>If you are not redirected automatically, <a href="${successUrl.toString()}">click here</a>.</p>
</body>
</html>`;
      
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.status(200).send(htmlRedirect);
    } else {
      // Standard redirect for desktop and other mobile browsers
      res.redirect(302, successUrl.toString());
    }
  } catch (error) {
    logger.error('[OAuth] LINE OAuth callback error:', error);
    
    // Try to get return URL from state if available
    let returnUrl = process.env.FRONTEND_URL ?? 'http://localhost:4001';
    try {
      const state = req.query.state as string;
      if (state) {
        const stateData = await oauthStateService.getState(state, 'line');
        if (stateData) {
          returnUrl = validateReturnUrl(stateData.returnUrl);
          await oauthStateService.deleteState(state, 'line');
        }
      }
    } catch (stateError) {
      logger.error('[OAuth] Error cleaning up state after callback failure:', stateError);
    }
    
    // Enhanced mobile-friendly error redirect
    const userAgent = req.get('User-Agent') ?? '';
    const isMobile = /iPhone|iPad|iPod|Android/i.test(userAgent);
    const isSafari = /Safari/i.test(userAgent) && !/Chrome|CriOS/i.test(userAgent);
    const errorUrl = `${returnUrl}/login?error=oauth_error`;
    
    if (isMobile && isSafari) {
      const htmlRedirect = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Redirecting...</title>
    <meta http-equiv="refresh" content="0;url=${errorUrl}">
</head>
<body>
    <script>
        window.location.href = '${errorUrl}';
    </script>
    <p>Authentication failed. Redirecting...</p>
    <p>If you are not redirected automatically, <a href="${errorUrl}">click here</a>.</p>
</body>
</html>`;
      
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.status(200).send(htmlRedirect);
    } else {
      res.redirect(302, errorUrl);
    }
  }
});

// OAuth status endpoint for frontend to get user info after OAuth
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    
    // Use existing auth service to verify token
    const { AuthService } = await import('../services/authService');
    const auth = new AuthService();
    const payload = await auth.verifyToken(token);

    // Get user data with profile information
    const { query } = await import('../config/database');
    const [user] = await query(
      `SELECT u.id, u.email, u.role, u.is_active AS "isActive", u.email_verified AS "emailVerified", 
              u.created_at AS "createdAt", u.updated_at AS "updatedAt",
              u.oauth_provider AS "oauthProvider", u.oauth_provider_id AS "oauthProviderId",
              p.first_name AS "firstName", p.last_name AS "lastName", p.avatar_url AS "avatarUrl"
       FROM users u
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE u.id = $1`,
      [payload.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user });
  } catch (error) {
    logger.error('OAuth me endpoint error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
});

// OAuth state management endpoints for debugging and monitoring
router.get('/state/health', async (_req, res) => {
  try {
    const stats = await oauthStateService.getStateStats();
    
    logger.debug('[OAuth State] Health check requested', stats);
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      stats,
      uptime: process.uptime()
    });
  } catch (error) {
    logger.error('[OAuth State] Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'State service unavailable'
    });
  }
});

// OAuth state cleanup endpoint (for maintenance)
router.post('/state/cleanup', async (_req, res) => {
  try {
    const deletedCount = await oauthStateService.cleanupExpiredStates();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      deletedCount
    });
  } catch (error) {
    logger.error('[OAuth State] Cleanup failed:', error);
    res.status(500).json({
      success: false,
      timestamp: new Date().toISOString(),
      error: 'Cleanup failed'
    });
  }
});

export default router;