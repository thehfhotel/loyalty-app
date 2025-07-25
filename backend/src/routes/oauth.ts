import { Router } from 'express';
import passport from 'passport';
import { logger } from '../utils/logger';
import { featureToggleService } from '../services/featureToggleService';
import { oauthDebugger } from '../utils/oauthDebugger';

const router = Router();

// Google OAuth routes
router.get('/google', (req, res, next) => {
  try {
    oauthDebugger.logInitiate('google', req);
    
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
      oauthDebugger.logError('google', 'config_validation', new Error(error), req);
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=google_not_configured`);
    }
    
    logger.debug('[OAuth] Initiating Google OAuth with scopes', { scopes: ['profile', 'email'] });
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  } catch (error) {
    logger.error('[OAuth] Google initiation error:', error);
    oauthDebugger.logError('google', 'initiation', error as Error, req);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=oauth_error`);
  }
});

router.get('/google/callback', 
  (req, res, next) => {
    try {
      // Check for OAuth errors in callback
      if (req.query.error) {
        const error = `Google OAuth error: ${req.query.error} - ${req.query.error_description || 'No description'}`;
        logger.error('[OAuth] ' + error);
        oauthDebugger.logCallback('google', req, false, new Error(error));
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=oauth_provider_error`);
      }

      oauthDebugger.logCallback('google', req, true);
      
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
      oauthDebugger.logError('google', 'callback_preprocessing', error as Error, req);
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=oauth_error`);
    }
  },
  (req, res, next) => {
    // Custom passport authentication with debug logging
    passport.authenticate('google', { session: false }, (err, user, info) => {
      if (err) {
        logger.error('[OAuth] Google passport authentication error:', err);
        oauthDebugger.logAuthentication('google', false, undefined, err, req);
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=oauth_auth_error`);
      }
      
      if (!user) {
        const authError = new Error('No user returned from Google authentication');
        logger.error('[OAuth] Google authentication failed - no user:', info);
        oauthDebugger.logAuthentication('google', false, undefined, authError, req);
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=oauth_no_user`);
      }

      req.user = user;
      oauthDebugger.logAuthentication('google', true, user, undefined, req);
      next();
    })(req, res, next);
  },
  async (req, res) => {
    try {
      logger.debug('[OAuth] Google OAuth authenticated, processing result');
      const oauthResult = req.user as any;
      
      if (!oauthResult) {
        const error = new Error('No OAuth result after authentication');
        logger.error('[OAuth] Google OAuth failed - no user data received');
        oauthDebugger.logError('google', 'result_processing', error, req);
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=oauth_failed`);
      }

      const { user, tokens, isNewUser } = oauthResult;
      
      // Validate required data
      if (!user || !tokens || !tokens.accessToken) {
        const error = new Error('Incomplete OAuth result data');
        logger.error('[OAuth] Incomplete OAuth result:', { hasUser: !!user, hasTokens: !!tokens, hasAccessToken: !!tokens?.accessToken });
        oauthDebugger.logError('google', 'incomplete_data', error, req);
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=oauth_incomplete`);
      }

      oauthDebugger.logTokenGeneration('google', true, tokens, undefined, req);
      
      logger.debug('[OAuth] Google OAuth user data', {
        userId: user.id,
        email: user.email,
        isNewUser,
        provider: user.oauthProvider
      });

      // Create success URL with tokens
      const successUrl = new URL('/oauth/success', process.env.FRONTEND_URL || 'http://localhost:4001');
      successUrl.searchParams.set('token', tokens.accessToken);
      successUrl.searchParams.set('refreshToken', tokens.refreshToken);
      successUrl.searchParams.set('isNewUser', isNewUser.toString());

      logger.info(`[OAuth] Google OAuth success for user ${user.email}, isNewUser: ${isNewUser}`);
      logger.debug('[OAuth] Redirecting to success URL', { successUrl: successUrl.toString() });
      
      oauthDebugger.logRedirect('google', true, successUrl.toString(), undefined, req);
      res.redirect(successUrl.toString());
    } catch (error) {
      logger.error('[OAuth] Google OAuth callback error:', error);
      oauthDebugger.logError('google', 'callback_processing', error as Error, req);
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=oauth_error`);
    }
  }
);

// Facebook OAuth routes (keeping for backward compatibility)
router.get('/facebook', async (req, res, next) => {
  try {
    // Check if Facebook OAuth feature is enabled
    const isFacebookOAuthEnabled = await featureToggleService.isFeatureEnabled('facebook_oauth');
    
    if (!isFacebookOAuthEnabled) {
      logger.info('Facebook OAuth access denied - feature disabled');
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=facebook_not_configured`);
    }
    
    // Check if Facebook strategy is configured
    const facebookAppId = process.env.FACEBOOK_APP_ID;
    
    if (!facebookAppId || facebookAppId === 'your-facebook-app-id') {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=facebook_not_configured`);
    }
    
    passport.authenticate('facebook', { scope: ['email'] })(req, res, next);
  } catch (error) {
    logger.error('Facebook OAuth feature check error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=facebook_not_configured`);
  }
});

router.get('/facebook/callback', 
  passport.authenticate('facebook', { session: false }),
  async (req, res) => {
    try {
      // Check if Facebook OAuth feature is enabled
      const isFacebookOAuthEnabled = await featureToggleService.isFeatureEnabled('facebook_oauth');
      
      if (!isFacebookOAuthEnabled) {
        logger.info('Facebook OAuth callback denied - feature disabled');
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=facebook_not_configured`);
      }
      
      const oauthResult = req.user as any;
      
      if (!oauthResult) {
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=oauth_failed`);
      }

      const { user, tokens, isNewUser } = oauthResult;

      // Create success URL with tokens
      const successUrl = new URL('/oauth/success', process.env.FRONTEND_URL || 'http://localhost:4001');
      successUrl.searchParams.set('token', tokens.accessToken);
      successUrl.searchParams.set('refreshToken', tokens.refreshToken);
      successUrl.searchParams.set('isNewUser', isNewUser.toString());

      logger.info(`Facebook OAuth success for user ${user.email}, isNewUser: ${isNewUser}`);
      
      res.redirect(successUrl.toString());
    } catch (error) {
      logger.error('Facebook OAuth callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=oauth_error`);
    }
  }
);

// LINE OAuth routes
router.get('/line', (req, res, next) => {
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
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=line_not_configured`);
  }
  
  logger.debug('[OAuth] Initiating LINE OAuth', { channelId: lineChannelId });
  passport.authenticate('line')(req, res, next);
});

router.get('/line/callback', 
  (req, res, next) => {
    logger.debug('[OAuth] LINE OAuth callback received', {
      query: req.query,
      headers: req.headers,
      cookies: req.cookies,
      sessionID: req.sessionID,
      session: req.session
    });
    next();
  },
  passport.authenticate('line', { session: false }),
  async (req, res) => {
    try {
      logger.debug('[OAuth] LINE OAuth authenticated, processing result');
      const oauthResult = req.user as any;
      
      if (!oauthResult) {
        logger.error('[OAuth] LINE OAuth failed - no user data received');
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=oauth_failed`);
      }

      const { user, tokens, isNewUser } = oauthResult;
      logger.debug('[OAuth] LINE OAuth user data', {
        userId: user.id,
        email: user.email,
        isNewUser,
        provider: user.oauthProvider
      });

      // Create success URL with tokens
      const successUrl = new URL('/oauth/success', process.env.FRONTEND_URL || 'http://localhost:4001');
      successUrl.searchParams.set('token', tokens.accessToken);
      successUrl.searchParams.set('refreshToken', tokens.refreshToken);
      successUrl.searchParams.set('isNewUser', isNewUser.toString());

      logger.info(`[OAuth] LINE OAuth success for user ${user.email}, isNewUser: ${isNewUser}`);
      logger.debug('[OAuth] Redirecting to success URL', { successUrl: successUrl.toString() });
      
      res.redirect(successUrl.toString());
    } catch (error) {
      logger.error('[OAuth] LINE OAuth callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:4001'}/login?error=oauth_error`);
    }
  }
);

// OAuth status endpoint for frontend to get user info after OAuth
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
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

    res.json({ user });
  } catch (error) {
    logger.error('OAuth me endpoint error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;