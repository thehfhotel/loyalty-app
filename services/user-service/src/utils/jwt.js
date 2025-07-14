const jwt = require('jsonwebtoken');
const redis = require('../config/redis');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

class JWTUtils {
  static generateTokens(userId, email) {
    const payload = {
      userId,
      email,
      iat: Math.floor(Date.now() / 1000)
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
      issuer: 'loyalty-app-user-service'
    });

    const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, {
      expiresIn: JWT_REFRESH_EXPIRES_IN,
      issuer: 'loyalty-app-user-service'
    });

    return { accessToken, refreshToken };
  }

  static verifyAccessToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      throw new Error('Invalid or expired access token');
    }
  }

  static verifyRefreshToken(token) {
    try {
      return jwt.verify(token, JWT_REFRESH_SECRET);
    } catch (error) {
      throw new Error('Invalid or expired refresh token');
    }
  }

  static async storeRefreshToken(userId, refreshToken) {
    const key = `refresh_token:${userId}`;
    const expiration = 7 * 24 * 60 * 60; // 7 days in seconds
    
    try {
      await redis.setEx(key, expiration, refreshToken);
    } catch (error) {
      console.error('Error storing refresh token:', error);
      throw new Error('Failed to store refresh token');
    }
  }

  static async getStoredRefreshToken(userId) {
    const key = `refresh_token:${userId}`;
    
    try {
      return await redis.get(key);
    } catch (error) {
      console.error('Error retrieving refresh token:', error);
      return null;
    }
  }

  static async revokeRefreshToken(userId) {
    const key = `refresh_token:${userId}`;
    
    try {
      await redis.del(key);
    } catch (error) {
      console.error('Error revoking refresh token:', error);
    }
  }

  static async blacklistToken(token) {
    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.exp) {
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await redis.setEx(`blacklist:${token}`, ttl, 'true');
        }
      }
    } catch (error) {
      console.error('Error blacklisting token:', error);
    }
  }

  static async isTokenBlacklisted(token) {
    try {
      const result = await redis.get(`blacklist:${token}`);
      return result === 'true';
    } catch (error) {
      console.error('Error checking token blacklist:', error);
      return false;
    }
  }
}

module.exports = JWTUtils;