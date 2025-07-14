const User = require('../models/User');
const JWTUtils = require('../utils/jwt');
const bcrypt = require('bcryptjs');

class AuthController {
  static async register(req, res, next) {
    try {
      const { email, password, firstName, lastName, phoneNumber, dateOfBirth, preferences } = req.body;

      // Check if user already exists
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Email address is already registered'
        });
      }

      // Create new user
      const user = await User.create({
        email,
        password,
        firstName,
        lastName,
        phoneNumber,
        dateOfBirth,
        preferences
      });

      // Generate tokens
      const { accessToken, refreshToken } = JWTUtils.generateTokens(user.id, user.email);

      // Store refresh token
      await JWTUtils.storeRefreshToken(user.id, refreshToken);

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: user.toJSON(),
          accessToken,
          refreshToken
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async login(req, res, next) {
    try {
      const { email, password } = req.body;

      // Find user by email
      const user = await User.findByEmail(email);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Validate password
      const isValidPassword = await user.validatePassword(password);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Generate tokens
      const { accessToken, refreshToken } = JWTUtils.generateTokens(user.id, user.email);

      // Store refresh token
      await JWTUtils.storeRefreshToken(user.id, refreshToken);

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: user.toJSON(),
          accessToken,
          refreshToken
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;

      // Verify refresh token
      const decoded = JWTUtils.verifyRefreshToken(refreshToken);

      // Check if refresh token exists in storage
      const storedToken = await JWTUtils.getStoredRefreshToken(decoded.userId);
      if (storedToken !== refreshToken) {
        return res.status(401).json({
          success: false,
          message: 'Invalid refresh token'
        });
      }

      // Get user
      const user = await User.findById(decoded.userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      // Generate new tokens
      const { accessToken, refreshToken: newRefreshToken } = JWTUtils.generateTokens(user.id, user.email);

      // Store new refresh token and revoke old one
      await JWTUtils.storeRefreshToken(user.id, newRefreshToken);

      res.json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          accessToken,
          refreshToken: newRefreshToken
        }
      });

    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }
  }

  static async logout(req, res, next) {
    try {
      const { user, token } = req;

      // Blacklist current access token
      await JWTUtils.blacklistToken(token);

      // Revoke refresh token
      await JWTUtils.revokeRefreshToken(user.id);

      res.json({
        success: true,
        message: 'Logout successful'
      });

    } catch (error) {
      next(error);
    }
  }

  static async changePassword(req, res, next) {
    try {
      const { currentPassword, newPassword } = req.body;
      const { user } = req;

      // Validate current password
      const isValidPassword = await user.validatePassword(currentPassword);
      if (!isValidPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Hash new password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update password in database
      await db.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [hashedPassword, user.id]
      );

      // Revoke all refresh tokens to force re-login
      await JWTUtils.revokeRefreshToken(user.id);

      res.json({
        success: true,
        message: 'Password changed successfully. Please log in again.'
      });

    } catch (error) {
      next(error);
    }
  }

  static async verifyEmail(req, res, next) {
    try {
      const { user } = req;

      if (user.isEmailVerified) {
        return res.status(400).json({
          success: false,
          message: 'Email is already verified'
        });
      }

      const updatedUser = await user.verifyEmail();

      res.json({
        success: true,
        message: 'Email verified successfully',
        data: {
          user: updatedUser.toJSON()
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async getProfile(req, res, next) {
    try {
      const { user } = req;

      res.json({
        success: true,
        data: {
          user: user.toJSON()
        }
      });

    } catch (error) {
      next(error);
    }
  }
}

module.exports = AuthController;