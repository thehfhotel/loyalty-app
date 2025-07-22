import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { UserService } from '../services/userService';
import { validateRequest } from '../middleware/validateRequest';
import { updateProfileSchema } from '../types/user';
import { uploadAvatar, handleMulterError } from '../config/multer';
import { ImageProcessor } from '../utils/imageProcessor';
import { AppError } from '../middleware/errorHandler';

// Middleware to check if user is admin
const requireAdmin = (req: any, res: any, next: any) => {
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

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
    const profile = await userService.getProfile(req.user.id);
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
      const profile = await userService.updateProfile(req.user.id, req.body);
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
      const currentProfile = await userService.getProfile(req.user.id);
      
      // Process and save new avatar
      const avatarPath = await ImageProcessor.processAvatar(
        req.file.buffer,
        req.file.originalname
      );

      // Update user profile with new avatar URL
      await userService.updateAvatar(req.user.id, avatarPath);

      // Delete old avatar file if it exists
      if (currentProfile?.avatarUrl && !currentProfile.avatarUrl.includes('http')) {
        await ImageProcessor.deleteAvatar(currentProfile.avatarUrl);
      }

      // Get updated profile
      const updatedProfile = await userService.getProfile(req.user.id);

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
    const currentProfile = await userService.getProfile(req.user.id);
    
    // Delete from database
    await userService.deleteAvatar(req.user.id);
    
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

// Admin routes
// Get all users with pagination and search
router.get('/admin/users', requireAdmin, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || '';

    const result = await userService.getAllUsers(page, limit, search);
    
    res.json({
      success: true,
      data: result.users,
      pagination: {
        page,
        limit,
        total: result.total,
        pages: Math.ceil(result.total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get user statistics
router.get('/admin/stats', requireAdmin, async (req, res, next) => {
  try {
    const stats = await userService.getUserStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

// Get specific user details
router.get('/admin/users/:userId', requireAdmin, async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.params.userId);
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// Update user status (activate/deactivate)
router.patch('/admin/users/:userId/status', requireAdmin, async (req, res, next) => {
  try {
    const { isActive } = req.body;
    
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    await userService.updateUserStatus(req.params.userId, isActive);
    
    res.json({ 
      success: true, 
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully` 
    });
  } catch (error) {
    next(error);
  }
});

// Update user role
router.patch('/admin/users/:userId/role', requireAdmin, async (req, res, next) => {
  try {
    const { role } = req.body;
    
    if (!role || typeof role !== 'string') {
      return res.status(400).json({ error: 'Role is required' });
    }

    await userService.updateUserRole(req.params.userId, role);
    
    res.json({ 
      success: true, 
      message: 'User role updated successfully' 
    });
  } catch (error) {
    next(error);
  }
});

// Delete user (super admin only)
router.delete('/admin/users/:userId', requireAdmin, async (req, res, next) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Super admin access required' });
    }

    // Prevent self-deletion
    if (req.params.userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await userService.deleteUser(req.params.userId);
    
    res.json({ 
      success: true, 
      message: 'User deleted successfully' 
    });
  } catch (error) {
    next(error);
  }
});

export default router;