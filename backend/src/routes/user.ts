import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { UserService } from '../services/userService';
import { validateRequest } from '../middleware/validateRequest';
import { updateProfileSchema } from '../types/user';
import { uploadAvatar, handleMulterError } from '../config/multer';
import { ImageProcessor } from '../utils/imageProcessor';
import { AppError } from '../middleware/errorHandler';

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
router.post('/avatar', uploadAvatar, async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!req.file) {
      throw new AppError(400, 'No file uploaded');
    }

    try {
      // Get current user profile to delete old avatar if exists
      const currentProfile = await userService.getProfile(req.user.userId);
      
      // Process and save new avatar
      const avatarPath = await ImageProcessor.processAvatar(
        req.file.buffer,
        req.file.originalname
      );

      // Update user profile with new avatar URL
      await userService.updateAvatar(req.user.userId, avatarPath);

      // Delete old avatar file if it exists
      if (currentProfile?.avatarUrl && !currentProfile.avatarUrl.includes('http')) {
        await ImageProcessor.deleteAvatar(currentProfile.avatarUrl);
      }

      // Get updated profile
      const updatedProfile = await userService.getProfile(req.user.userId);

      res.json({
        success: true,
        message: 'Avatar uploaded successfully',
        data: {
          avatarUrl: updatedProfile?.avatarUrl
        }
      });
    } catch (error) {
      handleMulterError(error);
    }
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

    // Get current profile to delete avatar file
    const currentProfile = await userService.getProfile(req.user.userId);
    
    // Delete from database
    await userService.deleteAvatar(req.user.userId);
    
    // Delete file if it exists and is not an external URL
    if (currentProfile?.avatarUrl && !currentProfile.avatarUrl.includes('http')) {
      await ImageProcessor.deleteAvatar(currentProfile.avatarUrl);
    }

    res.json({ 
      success: true,
      message: 'Avatar deleted successfully' 
    });
  } catch (error) {
    next(error);
  }
});

export default router;