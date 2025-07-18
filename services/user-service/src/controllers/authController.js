const db = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

class AuthController {
  async register(req, res) {
    try {
      const { 
        email, 
        password, 
        firstName, 
        lastName, 
        phoneNumber, 
        dateOfBirth, 
        preferences = {} 
      } = req.body;

      // Validate required fields
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({
          success: false,
          message: 'Email, password, first name, and last name are required'
        });
      }

      // Check if user already exists
      const existingUserQuery = 'SELECT id FROM users WHERE email = $1';
      const existingUser = await db.query(existingUserQuery, [email]);
      
      if (existingUser.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Email address is already registered'
        });
      }

      // Hash password
      const saltRounds = 12;
      const password_hash = await bcrypt.hash(password, saltRounds);

      // Create user
      const insertQuery = `
        INSERT INTO users (
          email, password_hash, first_name, last_name, phone_number, 
          date_of_birth, preferences, loyalty_tier, total_points, 
          is_email_verified, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING id, email, first_name, last_name, phone_number, date_of_birth, 
                  preferences, loyalty_tier, total_points, is_email_verified, created_at
      `;

      const result = await db.query(insertQuery, [
        email, password_hash, firstName, lastName, phoneNumber, 
        dateOfBirth, JSON.stringify(preferences), 'bronze', 0, false
      ]);

      const user = result.rows[0];

      // Generate tokens
      const { accessToken, refreshToken } = this.generateTokens(user.id, user.email);

      // Store refresh token
      await this.storeRefreshToken(user.id, refreshToken);

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user,
          accessToken,
          refreshToken
        }
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required'
        });
      }

      // Find user by email
      const userQuery = `
        SELECT id, email, password_hash, first_name, last_name, phone_number, 
               date_of_birth, preferences, loyalty_tier, total_points, 
               is_email_verified, created_at, updated_at
        FROM users 
        WHERE email = $1
      `;
      
      const result = await db.query(userQuery, [email]);
      
      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      const user = result.rows[0];

      // Validate password
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Update last login
      await db.query(
        'UPDATE users SET last_login = NOW() WHERE id = $1',
        [user.id]
      );

      // Generate tokens
      const { accessToken, refreshToken } = this.generateTokens(user.id, user.email);

      // Store refresh token
      await this.storeRefreshToken(user.id, refreshToken);

      // Remove password_hash from response
      delete user.password_hash;

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user,
          accessToken,
          refreshToken
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: 'Refresh token is required'
        });
      }

      // Verify refresh token
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || 'refresh-secret');

      // Check if refresh token exists in storage
      const storedTokenQuery = 'SELECT refresh_token FROM user_tokens WHERE user_id = $1';
      const storedResult = await db.query(storedTokenQuery, [decoded.userId]);
      
      if (storedResult.rows.length === 0 || storedResult.rows[0].refresh_token !== refreshToken) {
        return res.status(401).json({
          success: false,
          message: 'Invalid refresh token'
        });
      }

      // Get user
      const userQuery = 'SELECT id, email FROM users WHERE id = $1';
      const userResult = await db.query(userQuery, [decoded.userId]);
      
      if (userResult.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      const user = userResult.rows[0];

      // Generate new tokens
      const { accessToken, refreshToken: newRefreshToken } = this.generateTokens(user.id, user.email);

      // Store new refresh token
      await this.storeRefreshToken(user.id, newRefreshToken);

      res.json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          accessToken,
          refreshToken: newRefreshToken
        }
      });
    } catch (error) {
      console.error('Token refresh error:', error);
      res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }
  }

  async logout(req, res) {
    try {
      const { user } = req;

      // Revoke refresh token
      await db.query('DELETE FROM user_tokens WHERE user_id = $1', [user.id]);

      res.json({
        success: true,
        message: 'Logout successful'
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      const { user } = req;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password and new password are required'
        });
      }

      // Get current password hash
      const userQuery = 'SELECT password_hash FROM users WHERE id = $1';
      const userResult = await db.query(userQuery, [user.id]);
      
      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Validate current password
      const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
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
      await db.query('DELETE FROM user_tokens WHERE user_id = $1', [user.id]);

      res.json({
        success: true,
        message: 'Password changed successfully. Please log in again.'
      });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async verifyEmail(req, res) {
    try {
      const { user } = req;

      if (user.is_email_verified) {
        return res.status(400).json({
          success: false,
          message: 'Email is already verified'
        });
      }

      // Update email verification status
      await db.query(
        'UPDATE users SET is_email_verified = true, updated_at = NOW() WHERE id = $1',
        [user.id]
      );

      res.json({
        success: true,
        message: 'Email verified successfully'
      });
    } catch (error) {
      console.error('Email verification error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getProfile(req, res) {
    try {
      const { user } = req;

      // Get full user profile
      const userQuery = `
        SELECT id, email, first_name, last_name, phone_number, date_of_birth, 
               preferences, loyalty_tier, total_points, is_email_verified, 
               created_at, updated_at
        FROM users 
        WHERE id = $1
      `;
      
      const result = await db.query(userQuery, [user.id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        data: {
          user: result.rows[0]
        }
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  generateTokens(userId, email) {
    const payload = { userId, email };
    
    const accessToken = jwt.sign(
      payload,
      process.env.JWT_SECRET || 'secret-key',
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      payload,
      process.env.JWT_REFRESH_SECRET || 'refresh-secret',
      { expiresIn: '7d' }
    );

    return { accessToken, refreshToken };
  }

  async storeRefreshToken(userId, refreshToken) {
    const query = `
      INSERT INTO user_tokens (user_id, refresh_token, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET refresh_token = $2, created_at = NOW()
    `;
    
    await db.query(query, [userId, refreshToken]);
  }
}

module.exports = new AuthController();