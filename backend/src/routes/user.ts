import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { UserService } from '../services/userService';
import { validateRequest } from '../middleware/validateRequest';
import { updateProfileSchema } from '../types/user';
import { uploadAvatar, handleMulterError } from '../config/multer';
import { ImageProcessor } from '../utils/imageProcessor';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

// Middleware to check if user is admin
const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authReq = req as any; // Type assertion for user property
  if (!authReq.user || !['admin', 'super_admin'].includes(authReq.user.role)) {
    res.status(403).json({ error: 'Admin access required' });
    return;
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
    return res.json({ profile });
  } catch (error) {
    return next(error);
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
      return res.json({ profile });
    } catch (error) {
      return next(error);
    }
  }
);

// Get profile completion status
router.get('/profile-completion-status', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const status = await userService.getProfileCompletionStatus(req.user.id);
    return res.json({ 
      success: true,
      data: status 
    });
  } catch (error) {
    return next(error);
  }
});

// Complete user profile with potential coupon reward
router.put('/complete-profile', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const result = await userService.completeProfile(req.user.id, req.body);
    return res.json({ 
      success: true,
      data: result 
    });
  } catch (error) {
    return next(error);
  }
});

// Upload avatar
router.post('/avatar', uploadAvatar, async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!req.file) {
      throw new AppError(400, 'No file uploaded');
    }

    logger.info('Processing avatar upload', {
      userId: req.user.id,
      userEmail: req.user.email,
      filename: req.file.originalname,
      fileSize: req.file.size
    });

    try {
      // Get current avatar URL before update (for logging)
      const currentProfile = await userService.getProfile(req.user.id);
      logger.debug('Current avatar status', {
        userId: req.user.id,
        currentAvatar: currentProfile?.avatarUrl ?? 'None'
      });

      // Process and save new avatar (automatically deletes old one)
      const avatarUrl = await ImageProcessor.processAvatar(
        req.file.buffer,
        req.user.id
      );

      logger.debug('Avatar processed', {
        userId: req.user.id,
        newAvatarUrl: avatarUrl
      });

      // Update user profile with new avatar URL
      await userService.updateAvatar(req.user.id, avatarUrl);

      // Get updated profile
      const updatedProfile = await userService.getProfile(req.user.id);

      logger.info('Avatar upload completed', {
        userId: req.user.id,
        finalAvatarUrl: updatedProfile?.avatarUrl
      });

      return res.json({
        success: true,
        message: 'Avatar uploaded successfully',
        data: {
          avatarUrl: updatedProfile?.avatarUrl
        }
      });
    } catch (error) {
      logger.error('Avatar upload failed', {
        userId: req.user.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      handleMulterError(error);
    }
  } catch (error) {
    return next(error);
  }
});

// Update emoji avatar
router.put('/avatar/emoji', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { emoji } = req.body;
    
    if (!emoji || typeof emoji !== 'string') {
      return res.status(400).json({ error: 'Emoji is required' });
    }

    logger.info('Updating emoji avatar', {
      userId: req.user.id,
      emoji
    });

    // Update emoji avatar
    const updatedProfile = await userService.updateEmojiAvatar(req.user.id, emoji);

    logger.info('Emoji avatar updated successfully', {
      userId: req.user.id
    });

    return res.json({
      success: true,
      message: 'Emoji avatar updated successfully',
      data: {
        profile: updatedProfile
      }
    });
  } catch (error) {
    return next(error);
  }
});

// Update email - now initiates verification
router.put('/email', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    await userService.initiateEmailChange(req.user.id, email);

    return res.json({
      success: true,
      message: 'Verification code sent to new email address',
      pendingVerification: true
    });
  } catch (error) {
    return next(error);
  }
});

// Verify email change
router.post('/email/verify', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Verification code is required' });
    }

    // Validate code format: xxxx-xxxx
    const codeRegex = /^[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}$/;
    if (!codeRegex.test(code)) {
      return res.status(400).json({ error: 'Invalid code format' });
    }

    const newEmail = await userService.verifyEmailChange(req.user.id, code);

    return res.json({
      success: true,
      message: 'Email verified successfully',
      email: newEmail
    });
  } catch (error) {
    return next(error);
  }
});

// Resend verification code
router.post('/email/resend', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    await userService.resendVerificationCode(req.user.id);

    return res.json({
      success: true,
      message: 'Verification code resent'
    });
  } catch (error) {
    return next(error);
  }
});

// Get pending email verification status
router.get('/email/pending', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const pending = await userService.getPendingEmailChange(req.user.id);

    return res.json(pending);
  } catch (error) {
    return next(error);
  }
});

// Delete avatar
router.delete('/avatar', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Delete avatar file using simplified API
    await ImageProcessor.deleteUserAvatar(req.user.id);
    
    // Delete from database
    await userService.deleteAvatar(req.user.id);

    res.json({ 
      success: true,
      message: 'Avatar deleted successfully' 
    });
  } catch (error) {
    return next(error);
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
    return next(error);
  }
});

// Get user statistics
router.get('/admin/stats', requireAdmin, async (_req, res, next) => {
  try {
    const stats = await userService.getUserStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    return next(error);
  }
});

// Get specific user details
router.get('/admin/users/:userId', requireAdmin, async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    if (!userId || userId === 'undefined') {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const user = await userService.getUserById(userId);
    res.json({ success: true, data: user });
  } catch (error) {
    return next(error);
  }
});

// Update user status (activate/deactivate)
router.patch('/admin/users/:userId/status', requireAdmin, async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    const { isActive } = req.body;

    if (!userId || userId === 'undefined') {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    await userService.updateUserStatus(userId, isActive);

    res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    return next(error);
  }
});

// Update user role
router.patch('/admin/users/:userId/role', requireAdmin, async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    const { role } = req.body;

    if (!userId || userId === 'undefined') {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (!role || typeof role !== 'string') {
      return res.status(400).json({ error: 'Role is required' });
    }

    await userService.updateUserRole(userId, role);
    
    res.json({ 
      success: true, 
      message: 'User role updated successfully' 
    });
  } catch (error) {
    return next(error);
  }
});

// Delete user (super admin only)
router.delete('/admin/users/:userId', requireAdmin, async (req, res, next) => {
  try {
    const userId = String(req.params.userId);

    if (!userId || userId === 'undefined') {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Super admin access required' });
    }

    // Prevent self-deletion
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await userService.deleteUser(userId);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    return next(error);
  }
});

// Get new member coupon settings
router.get('/admin/new-member-coupon-settings', requireAdmin, async (_req, res, next) => {
  try {
    const settings = await userService.getNewMemberCouponSettings();
    res.json({ 
      success: true, 
      data: settings 
    });
  } catch (error) {
    return next(error);
  }
});

// Update new member coupon settings
router.put('/admin/new-member-coupon-settings', requireAdmin, async (req, res, next) => {
  try {
    const settings = await userService.updateNewMemberCouponSettings(req.body);
    res.json({ 
      success: true, 
      data: settings 
    });
  } catch (error) {
    return next(error);
  }
});

// Get coupon status for admin validation
router.get('/admin/coupon-status/:couponId', requireAdmin, async (req, res, next) => {
  try {
    const couponId = String(req.params.couponId);

    if (!couponId || couponId === 'undefined') {
      return res.status(400).json({ error: 'Coupon ID is required' });
    }

    const couponStatus = await userService.getCouponStatusForAdmin(couponId);
    res.json({
      success: true,
      data: couponStatus
    });
  } catch (error) {
    return next(error);
  }
});

export default router;