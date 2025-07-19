import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { UserService } from '../services/userService';
import { validateRequest } from '../middleware/validateRequest';
import { updateProfileSchema } from '../types/user';

const router = Router();
const userService = new UserService();

// All routes require authentication
router.use(authenticate);

// Get user profile
router.get('/profile', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const profile = await userService.getProfile(req.user.userId);
    res.json({ profile });
  } catch (error) {
    next(error);
  }
});

// Update user profile
router.put(
  '/profile',
  validateRequest(updateProfileSchema),
  async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const profile = await userService.updateProfile(req.user.userId, req.body);
      res.json({ profile });
    } catch (error) {
      next(error);
    }
  }
);

// Upload avatar
router.post('/avatar', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    // TODO: Implement file upload with multer
    res.json({ message: 'Avatar upload endpoint - implementation pending' });
  } catch (error) {
    next(error);
  }
});

// Delete avatar
router.delete('/avatar', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    await userService.deleteAvatar(req.user.userId);
    res.json({ message: 'Avatar deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;