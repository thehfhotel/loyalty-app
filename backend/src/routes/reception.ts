import express from 'express';
import { z } from 'zod';
import { receptionIdService } from '../services/receptionIdService';
import { authenticate, authorize } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import { AppError } from '../middleware/errorHandler';

const router = express.Router();

// Schema for reception ID lookup
const receptionIdSchema = z.object({
  receptionId: z.string().regex(/^269\d{5}$/, 'Reception ID must be 8 digits starting with 269')
});

/**
 * GET /api/reception/lookup/:receptionId
 * Look up user information by reception ID (for reception staff)
 */
router.get('/lookup/:receptionId', 
  authenticate,
  authorize('admin', 'super_admin'),
  validateRequest({ params: receptionIdSchema }),
  async (req, res, next) => {
    try {
      const { receptionId } = req.params;
      
      const userInfo = await receptionIdService.getUserByReceptionId(receptionId);
      
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
 * GET /api/reception/stats
 * Get reception ID statistics (admin only)
 */
router.get('/stats',
  authenticate,
  authorize('admin', 'super_admin'),
  async (req, res, next) => {
    try {
      const stats = await receptionIdService.getReceptionIdStats();
      
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
 * POST /api/reception/regenerate/:userId
 * Regenerate reception ID for a user (super admin only)
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
      
      const newReceptionId = await receptionIdService.regenerateReceptionId(userId);
      
      res.json({
        success: true,
        data: {
          userId,
          newReceptionId
        },
        message: 'Reception ID regenerated successfully'
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/reception/my-id
 * Get current user's reception ID
 */
router.get('/my-id',
  authenticate,
  async (req, res, next) => {
    try {
      const userId = req.user!.id;
      
      const receptionId = await receptionIdService.getReceptionIdByUserId(userId);
      
      res.json({
        success: true,
        data: {
          receptionId
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;