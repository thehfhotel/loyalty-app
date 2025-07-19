import { Router } from 'express';
import passport from 'passport';
import { oauthService } from '../services/oauthService';
import { logger } from '../utils/logger';

const router = Router();

// Google OAuth routes
router.get('/google', (req, res, next) => {
  // Check if Google strategy is configured
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  
  if (!googleClientId || googleClientId === 'your-google-client-id') {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=google_not_configured`);
  }
  
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback', 
  passport.authenticate('google', { session: false }),
  async (req, res) => {
    try {
      const oauthResult = req.user as any;
      
      if (!oauthResult) {
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=oauth_failed`);
      }

      const { user, tokens, isNewUser } = oauthResult;

      // Create success URL with tokens
      const successUrl = new URL('/oauth/success', process.env.FRONTEND_URL || 'http://localhost:3000');
      successUrl.searchParams.set('token', tokens.accessToken);
      successUrl.searchParams.set('refreshToken', tokens.refreshToken);
      successUrl.searchParams.set('isNewUser', isNewUser.toString());

      logger.info(`Google OAuth success for user ${user.email}, isNewUser: ${isNewUser}`);
      
      res.redirect(successUrl.toString());
    } catch (error) {
      logger.error('Google OAuth callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=oauth_error`);
    }
  }
);

// Facebook OAuth routes (keeping for backward compatibility)
router.get('/facebook', (req, res, next) => {
  // Check if Facebook strategy is configured
  const facebookAppId = process.env.FACEBOOK_APP_ID;
  
  if (!facebookAppId || facebookAppId === 'your-facebook-app-id') {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=facebook_not_configured`);
  }
  
  passport.authenticate('facebook', { scope: ['email'] })(req, res, next);
});

router.get('/facebook/callback', 
  passport.authenticate('facebook', { session: false }),
  async (req, res) => {
    try {
      const oauthResult = req.user as any;
      
      if (!oauthResult) {
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=oauth_failed`);
      }

      const { user, tokens, isNewUser } = oauthResult;

      // Create success URL with tokens
      const successUrl = new URL('/oauth/success', process.env.FRONTEND_URL || 'http://localhost:3000');
      successUrl.searchParams.set('token', tokens.accessToken);
      successUrl.searchParams.set('refreshToken', tokens.refreshToken);
      successUrl.searchParams.set('isNewUser', isNewUser.toString());

      logger.info(`Facebook OAuth success for user ${user.email}, isNewUser: ${isNewUser}`);
      
      res.redirect(successUrl.toString());
    } catch (error) {
      logger.error('Facebook OAuth callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=oauth_error`);
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

    // Get user data
    const { query } = await import('../config/database');
    const [user] = await query(
      `SELECT id, email, role, is_active AS "isActive", email_verified AS "emailVerified", 
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users WHERE id = $1`,
      [payload.userId]
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