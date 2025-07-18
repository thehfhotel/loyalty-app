import { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import asyncHandler from 'express-async-handler';
import { 
  LoginRequestSchema, 
  RegisterRequestSchema,
  PasswordResetRequestSchema,
  PasswordResetSchema,
  OAuthCallbackSchema
} from '@hotel-loyalty/shared/types/auth';
import { userService } from '../services/userService.js';
import { oauthService } from '../services/oauthService.js';
import { logger, securityLogger } from '../utils/logger.js';

/**
 * Register new user
 */
export const register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request body
    const validation = RegisterRequestSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.errors,
      });
      return;
    }

    const userData = validation.data;
    const authResponse = await userService.registerUser(userData);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: authResponse,
    });

  } catch (error) {
    logger.error('Registration error:', error);
    
    const message = error instanceof Error ? error.message : 'Registration failed';
    const statusCode = message.includes('already exists') ? 409 : 400;

    res.status(statusCode).json({
      success: false,
      message,
    });
  }
});

/**
 * Login user
 */
export const login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request body
    const validation = LoginRequestSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.errors,
      });
      return;
    }

    const credentials = validation.data;
    const authResponse = await userService.loginUser(credentials);

    res.json({
      success: true,
      message: 'Login successful',
      data: authResponse,
    });

  } catch (error) {
    logger.error('Login error:', error);
    
    const message = error instanceof Error ? error.message : 'Login failed';
    const statusCode = message.includes('Invalid email or password') || 
                      message.includes('Account is deactivated') ? 401 : 400;

    res.status(statusCode).json({
      success: false,
      message,
    });
  }
});

/**
 * Refresh access token
 */
export const refreshToken = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({
        success: false,
        message: 'Refresh token is required',
      });
      return;
    }

    const tokenResponse = await userService.refreshToken(refreshToken);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: tokenResponse,
    });

  } catch (error) {
    logger.error('Token refresh error:', error);
    
    res.status(401).json({
      success: false,
      message: 'Invalid refresh token',
    });
  }
});

/**
 * Logout user
 */
export const logout = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    await userService.logoutUser(req.user.userId);

    res.json({
      success: true,
      message: 'Logout successful',
    });

  } catch (error) {
    logger.error('Logout error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Logout failed',
    });
  }
});

/**
 * Request password reset
 */
export const requestPasswordReset = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request body
    const validation = PasswordResetRequestSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.errors,
      });
      return;
    }

    const resetRequest = validation.data;
    await userService.requestPasswordReset(resetRequest);

    // Always return success to prevent email enumeration
    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent',
    });

  } catch (error) {
    logger.error('Password reset request error:', error);
    
    // Always return success to prevent email enumeration
    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent',
    });
  }
});

/**
 * Reset password with token
 */
export const resetPassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request body
    const validation = PasswordResetSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.errors,
      });
      return;
    }

    const resetData = validation.data;
    await userService.resetPassword(resetData);

    res.json({
      success: true,
      message: 'Password reset successful',
    });

  } catch (error) {
    logger.error('Password reset error:', error);
    
    const message = error instanceof Error ? error.message : 'Password reset failed';
    const statusCode = message.includes('Invalid or expired') ? 400 : 500;

    res.status(statusCode).json({
      success: false,
      message,
    });
  }
});

/**
 * Get current user profile
 */
export const getProfile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    const user = await userService.getUserProfile(req.user.userId);

    res.json({
      success: true,
      message: 'Profile retrieved successfully',
      data: user,
    });

  } catch (error) {
    logger.error('Get profile error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile',
    });
  }
});

/**
 * Verify email address
 */
export const verifyEmail = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, email } = req.query;

    if (!token || !email || typeof token !== 'string' || typeof email !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Token and email are required',
      });
      return;
    }

    await userService.verifyEmail(email, token);

    res.json({
      success: true,
      message: 'Email verified successfully',
    });

  } catch (error) {
    logger.error('Email verification error:', error);
    
    const message = error instanceof Error ? error.message : 'Email verification failed';
    res.status(400).json({
      success: false,
      message,
    });
  }
});

/**
 * Google OAuth callback
 */
export const googleCallback = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = OAuthCallbackSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.errors,
      });
      return;
    }

    const { code, state } = validation.data;
    const authResponse = await oauthService.handleGoogleCallback(code, state);

    res.json({
      success: true,
      message: 'Google authentication successful',
      data: authResponse,
    });

  } catch (error) {
    logger.error('Google OAuth error:', error);
    
    const message = error instanceof Error ? error.message : 'Google authentication failed';
    res.status(400).json({
      success: false,
      message,
    });
  }
});

/**
 * Facebook OAuth callback
 */
export const facebookCallback = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = OAuthCallbackSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.errors,
      });
      return;
    }

    const { code, state } = validation.data;
    const authResponse = await oauthService.handleFacebookCallback(code, state);

    res.json({
      success: true,
      message: 'Facebook authentication successful',
      data: authResponse,
    });

  } catch (error) {
    logger.error('Facebook OAuth error:', error);
    
    const message = error instanceof Error ? error.message : 'Facebook authentication failed';
    res.status(400).json({
      success: false,
      message,
    });
  }
});

/**
 * Get OAuth URLs for frontend
 */
export const getOAuthUrls = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const googleUrl = oauthService.getGoogleAuthUrl();
    const facebookUrl = oauthService.getFacebookAuthUrl();

    res.json({
      success: true,
      data: {
        google: googleUrl,
        facebook: facebookUrl,
      },
    });

  } catch (error) {
    logger.error('Get OAuth URLs error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to generate OAuth URLs',
    });
  }
});