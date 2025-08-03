import express from 'express';
import { z } from 'zod';
import { membershipIdService } from '../services/membershipIdService';
import { authenticate, authorize } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import { AppError } from '../middleware/errorHandler';

const router = express.Router();

// Schema for membership ID lookup
const membershipIdSchema = z.object({
  membershipId: z.string().regex(/^269\d{5}$/, 'Membership ID must be 8 digits starting with 269')
});

/**
 * GET /api/membership/lookup/:membershipId
 * Look up user information by membership ID (for membership staff)
 */
router.get('/lookup/:membershipId', 
  authenticate,
  authorize('admin', 'super_admin'),
  validateRequest({ params: membershipIdSchema }),
  async (req, res, next) => {
    try {
      const { membershipId } = req.params;
      
      const userInfo = await membershipIdService.getUserByMembershipId(membershipId);
      
      res.json({
        success: true,
        data: userInfo
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/membership/stats
 * Get membership ID statistics (admin only)
 */
router.get('/stats',
  authenticate,
  authorize('admin', 'super_admin'),
  async (_req, res, next) => {
    try {
      const stats = await membershipIdService.getMembershipIdStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/membership/regenerate/:userId
 * Regenerate membership ID for a user (super admin only)
 */
router.post('/regenerate/:userId',
  authenticate,
  authorize('super_admin'),
  async (req, res, next) => {
    try {
      const { userId } = req.params;
      
      if (!userId || typeof userId !== 'string') {
        throw new AppError(400, 'Valid user ID is required');
      }
      
      const newMembershipId = await membershipIdService.regenerateMembershipId(userId);
      
      res.json({
        success: true,
        data: {
          userId,
          newMembershipId
        },
        message: 'Membership ID regenerated successfully'
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/membership/my-id
 * Get current user's membership ID
 */
router.get('/my-id',
  authenticate,
  async (req, res, next) => {
    try {
      const userId = req.user!.id;
      
      const membershipId = await membershipIdService.getMembershipIdByUserId(userId);
      
      res.json({
        success: true,
        data: {
          membershipId
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;