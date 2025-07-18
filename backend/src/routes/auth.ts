import { Router } from 'express';
import {
  register,
  login,
  refreshToken,
  logout,
  requestPasswordReset,
  resetPassword,
  getProfile,
  verifyEmail,
  googleCallback,
  facebookCallback,
  getOAuthUrls,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import {
  authLimiter,
  passwordResetLimiter,
  registrationLimiter,
  emailVerificationLimiter,
} from '../middleware/rateLimiter.js';

const router = Router();

// Public authentication routes with rate limiting
router.post('/register', registrationLimiter, register);
router.post('/login', authLimiter, login);
router.post('/refresh', authLimiter, refreshToken);
router.post('/password-reset/request', passwordResetLimiter, requestPasswordReset);
router.post('/password-reset/confirm', passwordResetLimiter, resetPassword);
router.get('/verify-email', emailVerificationLimiter, verifyEmail);

// OAuth routes
router.get('/oauth/urls', getOAuthUrls);
router.post('/oauth/google/callback', authLimiter, googleCallback);
router.post('/oauth/facebook/callback', authLimiter, facebookCallback);

// Protected routes (require authentication)
router.post('/logout', authenticate, logout);
router.get('/profile', authenticate, getProfile);

export default router;