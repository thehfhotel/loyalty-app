import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { AuthResponse } from '@hotel-loyalty/shared/types/auth';
import { userService } from './userService.js';
import { authService } from './authService.js';
import { redisClient } from '../config/redis.js';
import { logger, securityLogger } from '../utils/logger.js';

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
}

interface FacebookTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface FacebookUserInfo {
  id: string;
  email: string;
  name: string;
  first_name: string;
  last_name: string;
  picture: {
    data: {
      url: string;
    };
  };
}

export class OAuthService {
  private readonly googleClientId = process.env.GOOGLE_CLIENT_ID;
  private readonly googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  private readonly googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';
  
  private readonly facebookClientId = process.env.FACEBOOK_CLIENT_ID;
  private readonly facebookClientSecret = process.env.FACEBOOK_CLIENT_SECRET;
  private readonly facebookRedirectUri = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3000/auth/facebook/callback';

  constructor() {
    if (!this.googleClientId || !this.googleClientSecret) {
      logger.warn('Google OAuth credentials not configured');
    }
    
    if (!this.facebookClientId || !this.facebookClientSecret) {
      logger.warn('Facebook OAuth credentials not configured');
    }
  }

  /**
   * Generate Google OAuth URL
   */
  getGoogleAuthUrl(): string {
    if (!this.googleClientId) {
      throw new Error('Google OAuth not configured');
    }

    const state = this.generateState();
    const params = new URLSearchParams({
      client_id: this.googleClientId,
      redirect_uri: this.googleRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Generate Facebook OAuth URL
   */
  getFacebookAuthUrl(): string {
    if (!this.facebookClientId) {
      throw new Error('Facebook OAuth not configured');
    }

    const state = this.generateState();
    const params = new URLSearchParams({
      client_id: this.facebookClientId,
      redirect_uri: this.facebookRedirectUri,
      response_type: 'code',
      scope: 'email,public_profile',
      state,
    });

    return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
  }

  /**
   * Handle Google OAuth callback
   */
  async handleGoogleCallback(code: string, state?: string): Promise<AuthResponse> {
    try {
      if (!this.googleClientId || !this.googleClientSecret) {
        throw new Error('Google OAuth not configured');
      }

      // Validate state parameter
      if (state && !(await this.validateState(state))) {
        throw new Error('Invalid state parameter');
      }

      // Exchange code for access token
      const tokenResponse = await this.exchangeGoogleCode(code);
      
      // Get user info from Google
      const userInfo = await this.getGoogleUserInfo(tokenResponse.access_token);
      
      // Find or create user
      const authResponse = await this.findOrCreateUser({
        email: userInfo.email,
        firstName: userInfo.given_name,
        lastName: userInfo.family_name,
        emailVerified: userInfo.verified_email,
        provider: 'google',
        providerId: userInfo.id,
      });

      securityLogger.info('Google OAuth successful', {
        userId: authResponse.user.id,
        email: userInfo.email,
      });

      return authResponse;

    } catch (error) {
      logger.error('Google OAuth error:', error);
      throw error;
    }
  }

  /**
   * Handle Facebook OAuth callback
   */
  async handleFacebookCallback(code: string, state?: string): Promise<AuthResponse> {
    try {
      if (!this.facebookClientId || !this.facebookClientSecret) {
        throw new Error('Facebook OAuth not configured');
      }

      // Validate state parameter
      if (state && !(await this.validateState(state))) {
        throw new Error('Invalid state parameter');
      }

      // Exchange code for access token
      const tokenResponse = await this.exchangeFacebookCode(code);
      
      // Get user info from Facebook
      const userInfo = await this.getFacebookUserInfo(tokenResponse.access_token);
      
      // Find or create user
      const authResponse = await this.findOrCreateUser({
        email: userInfo.email,
        firstName: userInfo.first_name,
        lastName: userInfo.last_name,
        emailVerified: true, // Facebook emails are verified
        provider: 'facebook',
        providerId: userInfo.id,
      });

      securityLogger.info('Facebook OAuth successful', {
        userId: authResponse.user.id,
        email: userInfo.email,
      });

      return authResponse;

    } catch (error) {
      logger.error('Facebook OAuth error:', error);
      throw error;
    }
  }

  /**
   * Exchange Google authorization code for access token
   */
  private async exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
    try {
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: this.googleClientId,
        client_secret: this.googleClientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.googleRedirectUri,
      });

      return response.data as GoogleTokenResponse;
    } catch (error) {
      logger.error('Google token exchange error:', error);
      throw new Error('Failed to exchange Google authorization code');
    }
  }

  /**
   * Get user info from Google
   */
  private async getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    try {
      const response = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data as GoogleUserInfo;
    } catch (error) {
      logger.error('Google user info error:', error);
      throw new Error('Failed to get Google user info');
    }
  }

  /**
   * Exchange Facebook authorization code for access token
   */
  private async exchangeFacebookCode(code: string): Promise<FacebookTokenResponse> {
    try {
      const params = new URLSearchParams({
        client_id: this.facebookClientId!,
        client_secret: this.facebookClientSecret!,
        code,
        redirect_uri: this.facebookRedirectUri,
      });

      const response = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token?${params.toString()}`);

      return response.data as FacebookTokenResponse;
    } catch (error) {
      logger.error('Facebook token exchange error:', error);
      throw new Error('Failed to exchange Facebook authorization code');
    }
  }

  /**
   * Get user info from Facebook
   */
  private async getFacebookUserInfo(accessToken: string): Promise<FacebookUserInfo> {
    try {
      const params = new URLSearchParams({
        fields: 'id,email,name,first_name,last_name,picture',
        access_token: accessToken,
      });

      const response = await axios.get(`https://graph.facebook.com/v18.0/me?${params.toString()}`);

      return response.data as FacebookUserInfo;
    } catch (error) {
      logger.error('Facebook user info error:', error);
      throw new Error('Failed to get Facebook user info');
    }
  }

  /**
   * Find or create user from OAuth data
   */
  private async findOrCreateUser(userData: {
    email: string;
    firstName: string;
    lastName: string;
    emailVerified: boolean;
    provider: string;
    providerId: string;
  }): Promise<AuthResponse> {
    try {
      // Check if user exists
      const existingUser = await userService.findUserByEmail(userData.email);
      
      if (existingUser) {
        // User exists, update OAuth info and login
        await userService.updateOAuthInfo(existingUser.id, userData.provider, userData.providerId);
        
        // Generate tokens
        const accessToken = authService.generateAccessToken(existingUser, 'customer');
        const refreshToken = authService.generateRefreshToken(existingUser.id);
        
        // Store refresh token
        await authService.storeRefreshToken(existingUser.id, refreshToken);

        return {
          user: existingUser,
          token: accessToken,
          refreshToken,
          expiresIn: 15 * 60, // 15 minutes
        };
      } else {
        // Create new user
        const newUser = await userService.createOAuthUser({
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          emailVerified: userData.emailVerified,
          provider: userData.provider,
          providerId: userData.providerId,
        });

        // Generate tokens
        const accessToken = authService.generateAccessToken(newUser, 'customer');
        const refreshToken = authService.generateRefreshToken(newUser.id);
        
        // Store refresh token
        await authService.storeRefreshToken(newUser.id, refreshToken);

        return {
          user: newUser,
          token: accessToken,
          refreshToken,
          expiresIn: 15 * 60, // 15 minutes
        };
      }
    } catch (error) {
      logger.error('Find or create OAuth user error:', error);
      throw error;
    }
  }

  /**
   * Generate and store state parameter for OAuth
   */
  private generateState(): string {
    const state = uuidv4();
    
    // Store state in Redis with 10 minute expiration
    redisClient.setex(`oauth_state:${state}`, 600, 'valid');
    
    return state;
  }

  /**
   * Validate OAuth state parameter
   */
  private async validateState(state: string): Promise<boolean> {
    try {
      const result = await redisClient.get(`oauth_state:${state}`);
      
      if (result) {
        // Remove state after validation
        await redisClient.del(`oauth_state:${state}`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('State validation error:', error);
      return false;
    }
  }
}

export const oauthService = new OAuthService();