import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as LineStrategy } from 'passport-line-auth';
import { query } from '../config/database';
import { AuthService } from './authService';
import { User, AuthTokens } from '../types/auth';
import { logger } from '../utils/logger';
import { adminConfigService } from './adminConfigService';
import { loyaltyService } from './loyaltyService';
import { receptionIdService } from './receptionIdService';

const authService = new AuthService();


interface GoogleProfile {
  id: string;
  displayName: string;
  name: {
    familyName?: string;
    givenName?: string;
  };
  emails?: Array<{
    value: string;
    verified?: boolean;
  }>;
  photos?: Array<{
    value: string;
  }>;
}

interface LineProfile {
  id: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}

export class OAuthService {
  constructor() {
    this.initializePassport();
  }

  private initializePassport(): void {
    // Initialize Google Strategy if credentials are provided
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (googleClientId && googleClientSecret && googleClientId !== 'your-google-client-id') {
      logger.info('Initializing Google OAuth strategy');
      
      passport.use(new GoogleStrategy({
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4001/api/oauth/google/callback',
        passReqToCallback: false
      }, async (_accessToken: string, _refreshToken: string, profile: GoogleProfile, done: any) => {
        try {
          logger.debug('[OAuth Service] Google profile received', {
            id: profile.id,
            displayName: profile.displayName,
            email: profile.emails?.[0]?.value,
            verified: profile.emails?.[0]?.verified
          });
          const result = await this.handleGoogleAuth(profile);
          return done(null, result);
        } catch (error) {
          logger.error('[OAuth Service] Google OAuth error:', error);
          return done(error, null);
        }
      }));
    } else {
      logger.warn('Google OAuth not configured - Google Client ID and Secret required');
    }


    // Initialize LINE Strategy if credentials are provided
    const lineChannelId = process.env.LINE_CHANNEL_ID;
    const lineChannelSecret = process.env.LINE_CHANNEL_SECRET;

    if (lineChannelId && lineChannelSecret && lineChannelId !== 'your-line-channel-id') {
      logger.info('Initializing LINE OAuth strategy');
      
      passport.use(new LineStrategy({
        channelID: lineChannelId,
        channelSecret: lineChannelSecret,
        callbackURL: process.env.LINE_CALLBACK_URL || 'http://localhost:4001/api/oauth/line/callback'
      }, async (_accessToken: string, _refreshToken: string, profile: LineProfile, done: any) => {
        try {
          logger.debug('[OAuth Service] LINE profile received', {
            id: profile.id,
            displayName: profile.displayName,
            pictureUrl: profile.pictureUrl,
            statusMessage: profile.statusMessage
          });
          const result = await this.handleLineAuth(profile);
          return done(null, result);
        } catch (error) {
          logger.error('[OAuth Service] LINE OAuth error:', error);
          return done(error, null);
        }
      }));
    } else {
      logger.warn('LINE OAuth not configured - LINE Channel ID and Secret required');
    }

    // Serialize user for session
    passport.serializeUser((user: any, done) => {
      done(null, user.id);
    });

    // Deserialize user from session
    passport.deserializeUser(async (id: string, done) => {
      try {
        const [user] = await query<User>(
          'SELECT id, email, role, is_active AS "isActive" FROM users WHERE id = $1',
          [id]
        );
        done(null, user || null);
      } catch (error) {
        done(error, null);
      }
    });
  }

  private async handleGoogleAuth(profile: GoogleProfile): Promise<{ user: User; tokens: AuthTokens; isNewUser: boolean }> {
    const email = profile.emails?.[0]?.value;
    
    logger.debug('[OAuth Service] Processing Google auth', { email, profileId: profile.id });
    
    if (!email) {
      logger.error('[OAuth Service] No email provided by Google');
      throw new Error('No email provided by Google');
    }

    // Check if user exists
    const [existingUser] = await query<User>(
      `SELECT id, email, role, is_active AS "isActive", email_verified AS "emailVerified", 
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users WHERE email = $1`,
      [email]
    );

    let user: User;
    let isNewUser = false;

    if (existingUser) {
      // Update existing user's profile if needed
      user = existingUser;
      logger.debug('[OAuth Service] Existing Google user found', { userId: user.id, email: user.email });
      
      // Update Google-specific data if available
      const firstName = profile.name?.givenName || profile.displayName?.split(' ')[0] || '';
      const lastName = profile.name?.familyName || profile.displayName?.split(' ').slice(1).join(' ') || '';
      const avatarUrl = profile.photos?.[0]?.value;

      if (firstName || lastName || avatarUrl) {
        // Only update avatar_url if there's no existing local avatar (doesn't start with /storage/)
        await query(
          `UPDATE user_profiles 
           SET first_name = COALESCE(NULLIF($2, ''), first_name),
               last_name = COALESCE(NULLIF($3, ''), last_name),
               avatar_url = CASE 
                 WHEN avatar_url IS NULL OR NOT avatar_url LIKE '/storage/%' 
                 THEN COALESCE(NULLIF($4, ''), avatar_url)
                 ELSE avatar_url 
               END,
               updated_at = NOW()
           WHERE user_id = $1`,
          [user.id, firstName, lastName, avatarUrl]
        );
      }

      // Mark email as verified since it's from Google
      if (!user.emailVerified) {
        await query(
          'UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = $1',
          [user.id]
        );
        user.emailVerified = true;
      }
    } else {
      // Check for existing email-based account to auto-link
      const [emailUser] = await query<User>(
        `SELECT id, email, role, is_active AS "isActive", email_verified AS "emailVerified", 
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM users WHERE email = $1 AND oauth_provider IS NULL`,
        [email]
      );

      if (emailUser) {
        // Auto-link to existing email account
        logger.info(`Auto-linking Google OAuth to existing email account: ${email}`);
        
        // Create new OAuth user
        isNewUser = true;
        const firstName = profile.name?.givenName || profile.displayName?.split(' ')[0] || '';
        const lastName = profile.name?.familyName || profile.displayName?.split(' ').slice(1).join(' ') || '';
        const avatarUrl = profile.photos?.[0]?.value;

        const [newOAuthUser] = await query<User>(
          `INSERT INTO users (email, password_hash, email_verified, oauth_provider, oauth_provider_id) 
           VALUES ($1, '', true, 'google', $2) 
           RETURNING id, email, role, is_active AS "isActive", email_verified AS "emailVerified", 
                     created_at AS "createdAt", updated_at AS "updatedAt"`,
          [`google_${profile.id}@google.oauth`, profile.id]
        );

        // Generate reception ID for new OAuth user
        const receptionId = await receptionIdService.generateUniqueReceptionId();

        // Create user profile with reception ID
        await query(
          `INSERT INTO user_profiles (user_id, first_name, last_name, avatar_url, reception_id) 
           VALUES ($1, $2, $3, $4, $5)`,
          [newOAuthUser.id, firstName, lastName, avatarUrl, receptionId]
        );

        
        user = newOAuthUser;
      } else {
        // Create new user
        isNewUser = true;
        
        const firstName = profile.name?.givenName || profile.displayName?.split(' ')[0] || '';
        const lastName = profile.name?.familyName || profile.displayName?.split(' ').slice(1).join(' ') || '';
        const avatarUrl = profile.photos?.[0]?.value;

        // Create user account (no password needed for OAuth)
        const [newUser] = await query<User>(
          `INSERT INTO users (email, password_hash, email_verified, oauth_provider, oauth_provider_id) 
           VALUES ($1, '', true, 'google', $2) 
           RETURNING id, email, role, is_active AS "isActive", email_verified AS "emailVerified", 
                     created_at AS "createdAt", updated_at AS "updatedAt"`,
          [email, profile.id]
        );

        // Generate reception ID for new user
        const receptionId = await receptionIdService.generateUniqueReceptionId();

        // Create user profile with reception ID
        await query(
          `INSERT INTO user_profiles (user_id, first_name, last_name, avatar_url, reception_id) 
           VALUES ($1, $2, $3, $4, $5)`,
          [newUser.id, firstName, lastName, avatarUrl, receptionId]
        );

        user = newUser;
      }
    }

    // Check if user should have elevated role
    const requiredRole = adminConfigService.getRequiredRole(email);
    if (requiredRole && user.role === 'customer') {
      logger.info(`Upgrading Google user ${email} to ${requiredRole} role based on admin config`);
      
      const [upgradedUser] = await query<User>(
        `UPDATE users SET role = $1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING id, email, role, is_active AS "isActive", email_verified AS "emailVerified", 
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [requiredRole, user.id]
      );
      
      user = upgradedUser;
    } else if (requiredRole && user.role === 'admin' && requiredRole === 'super_admin') {
      logger.info(`Upgrading Google user ${email} from admin to super_admin role based on admin config`);
      
      const [upgradedUser] = await query<User>(
        `UPDATE users SET role = 'super_admin', updated_at = NOW() 
         WHERE id = $1 
         RETURNING id, email, role, is_active AS "isActive", email_verified AS "emailVerified", 
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [user.id]
      );
      
      user = upgradedUser;
    }

    // Generate JWT tokens
    const tokens = await authService.generateTokens(user);

    // Log OAuth login
    await query(
      'INSERT INTO user_audit_log (user_id, action, details) VALUES ($1, $2, $3)',
      [user.id, 'oauth_login', { provider: 'google', isNewUser }]
    );

    // Auto-enroll in loyalty program (ensure enrollment on every OAuth login)
    await loyaltyService.ensureUserLoyaltyEnrollment(user.id);

    return { user, tokens, isNewUser };
  }


  private async handleLineAuth(profile: LineProfile): Promise<{ user: User; tokens: AuthTokens; isNewUser: boolean }> {
    const lineId = profile.id;
    
    logger.debug('[OAuth Service] Processing LINE auth', { lineId, displayName: profile.displayName });
    
    if (!lineId) {
      logger.error('[OAuth Service] No LINE ID provided');
      throw new Error('No LINE ID provided');
    }

    // For LINE, we'll use a special email format since LINE doesn't provide email by default
    const lineEmail = `line_${lineId}@line.oauth`;
    logger.debug('[OAuth Service] Using LINE email format', { lineEmail });
    
    // Check if user exists by LINE ID or LINE email
    const [existingUser] = await query<User>(
      `SELECT id, email, role, is_active AS "isActive", email_verified AS "emailVerified", 
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users WHERE email = $1 OR oauth_provider_id = $2`,
      [lineEmail, lineId]
    );

    let user: User;
    let isNewUser = false;

    if (existingUser) {
      // Update existing user's profile if needed
      user = existingUser;
      logger.debug('[OAuth Service] Existing LINE user found', { userId: user.id, email: user.email });
      
      // Update LINE-specific data if available
      const displayName = profile.displayName || '';
      const firstName = displayName.split(' ')[0] || '';
      const lastName = displayName.split(' ').slice(1).join(' ') || '';
      const avatarUrl = profile.pictureUrl;

      if (firstName || lastName || avatarUrl) {
        // Only update avatar_url if there's no existing local avatar (doesn't start with /storage/)
        await query(
          `UPDATE user_profiles 
           SET first_name = COALESCE(NULLIF($2, ''), first_name),
               last_name = COALESCE(NULLIF($3, ''), last_name),
               avatar_url = CASE 
                 WHEN avatar_url IS NULL OR NOT avatar_url LIKE '/storage/%' 
                 THEN COALESCE(NULLIF($4, ''), avatar_url)
                 ELSE avatar_url 
               END,
               updated_at = NOW()
           WHERE user_id = $1`,
          [user.id, firstName, lastName, avatarUrl]
        );
      }

      // Update OAuth provider info
      await query(
        'UPDATE users SET oauth_provider = $1, oauth_provider_id = $2, updated_at = NOW() WHERE id = $3',
        ['line', lineId, user.id]
      );
    } else {
      // Create new user for LINE
      isNewUser = true;
      
      const displayName = profile.displayName || '';
      const firstName = displayName.split(' ')[0] || '';
      const lastName = displayName.split(' ').slice(1).join(' ') || '';
      const avatarUrl = profile.pictureUrl;

      // Create user account (no password needed for OAuth, email_verified false since we don't have real email)
      const [newUser] = await query<User>(
        `INSERT INTO users (email, password_hash, email_verified, oauth_provider, oauth_provider_id) 
         VALUES ($1, '', false, 'line', $2) 
         RETURNING id, email, role, is_active AS "isActive", email_verified AS "emailVerified", 
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [lineEmail, lineId]
      );

      user = newUser;

      // Generate reception ID for new LINE user
      const receptionId = await receptionIdService.generateUniqueReceptionId();

      // Create user profile with reception ID
      await query(
        `INSERT INTO user_profiles (user_id, first_name, last_name, avatar_url, reception_id) 
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, firstName, lastName, avatarUrl, receptionId]
      );
    }

    // Check if user should have elevated role (won't apply to LINE users typically, but keeping consistent)
    const requiredRole = adminConfigService.getRequiredRole(user.email);
    if (requiredRole && user.role === 'customer') {
      logger.info(`Upgrading LINE user ${user.email} to ${requiredRole} role based on admin config`);
      
      const [upgradedUser] = await query<User>(
        `UPDATE users SET role = $1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING id, email, role, is_active AS "isActive", email_verified AS "emailVerified", 
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [requiredRole, user.id]
      );
      
      user = upgradedUser;
    } else if (requiredRole && user.role === 'admin' && requiredRole === 'super_admin') {
      logger.info(`Upgrading LINE user ${user.email} from admin to super_admin role based on admin config`);
      
      const [upgradedUser] = await query<User>(
        `UPDATE users SET role = 'super_admin', updated_at = NOW() 
         WHERE id = $1 
         RETURNING id, email, role, is_active AS "isActive", email_verified AS "emailVerified", 
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [user.id]
      );
      
      user = upgradedUser;
    }

    // Generate JWT tokens
    const tokens = await authService.generateTokens(user);

    // Log OAuth login
    await query(
      'INSERT INTO user_audit_log (user_id, action, details) VALUES ($1, $2, $3)',
      [user.id, 'oauth_login', { provider: 'line', isNewUser, lineId: profile.id }]
    );

    // Auto-enroll in loyalty program (ensure enrollment on every OAuth login)
    await loyaltyService.ensureUserLoyaltyEnrollment(user.id);

    return { user, tokens, isNewUser };
  }

  // Add method to make generateTokens accessible
  async generateTokensForUser(user: User): Promise<AuthTokens> {
    return authService.generateTokens(user);
  }
}

export const oauthService = new OAuthService();