import { Router } from 'express';
import { AuthService } from '../services/authService';
import { authenticate } from '../middleware/auth';
import {
  registerSchema,
  loginSchema,
  resetPasswordRequestSchema,
  resetPasswordSchema,
} from '../types/auth';
import { validateRequest } from '../middleware/validateRequest';

const router = Router();
const authService = new AuthService();

// Register new user
router.post('/register', validateRequest(registerSchema), async (req, res, next) => {
  try {
    const result = await authService.register(req.body);
    res.status(201).json({
      user: result.user,
      tokens: result.tokens,
    });
  } catch (error) {
    next(error);
  }
});

// Login
router.post('/login', validateRequest(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    res.json({
      user: result.user,
      tokens: result.tokens,
    });
  } catch (error) {
    next(error);
  }
});

// Refresh token
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }
    const tokens = await authService.refreshToken(refreshToken);
    res.json({ tokens });
  } catch (error) {
    next(error);
  }
});

// Logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken && req.user) {
      await authService.logout(req.user.id, refreshToken);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
});

// Request password reset
router.post(
  '/reset-password/request',
  validateRequest(resetPasswordRequestSchema),
  async (req, res, next) => {
    try {
      await authService.resetPasswordRequest(req.body.email);
      res.json({
        message: 'If the email exists, a password reset link has been sent',
      });
    } catch (error) {
      next(error);
    }
  }
);

// Reset password
router.post(
  '/reset-password',
  validateRequest(resetPasswordSchema),
  async (req, res, next) => {
    try {
      const { token, password } = req.body;
      await authService.resetPassword(token, password);
      res.json({ message: 'Password reset successfully' });
    } catch (error) {
      next(error);
    }
  }
);

// Get current user
router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user });
});

export default router;