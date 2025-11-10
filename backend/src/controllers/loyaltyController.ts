import { Request, Response } from 'express';
import { LoyaltyService } from '../services/loyaltyService';
import { logger } from '../utils/logger';

const loyaltyService = new LoyaltyService();

export class LoyaltyController {
  /**
   * GET /api/loyalty/tiers
   * Get all available loyalty tiers
   */
  async getTiers(_req: Request, res: Response) {
    try {
      const tiers = await loyaltyService.getAllTiers();
      res.json({
        success: true,
        data: tiers
      });
    } catch (error) {
      logger.error('Error in getTiers:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch loyalty tiers'
      });
    }
  }

  /**
   * GET /api/loyalty/status
   * Get current user's loyalty status
   */
  async getUserLoyaltyStatus(req: Request, res: Response): Promise<Response | void> {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const userId = req.user.id;
      const status = await loyaltyService.getUserLoyaltyStatus(userId);
      
      if (!status) {
        return res.status(404).json({
          success: false,
          message: 'Loyalty status not found'
        });
      }

      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      logger.error('Error in getUserLoyaltyStatus:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch loyalty status'
      });
    }
  }

  /**
   * GET /api/loyalty/points/calculation
   * Get detailed points calculation including expiring points
   */
  async getPointsCalculation(req: Request, res: Response): Promise<Response | void> {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const userId = req.user.id;
      const calculation = await loyaltyService.calculateUserPoints(userId);
      
      res.json({
        success: true,
        data: calculation
      });
    } catch (error) {
      logger.error('Error in getPointsCalculation:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to calculate points'
      });
    }
  }

  /**
   * GET /api/loyalty/history
   * Get user's points transaction history
   */
  async getPointsHistory(req: Request, res: Response): Promise<Response | void> {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const userId = req.user.id;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const history = await loyaltyService.getUserPointsHistory(userId, limit, offset);
      
      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      logger.error('Error in getPointsHistory:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch points history'
      });
    }
  }

  /**
   * POST /api/loyalty/simulate-stay
   * Simulate earning points for a hotel stay (for demo purposes)
   */
  async simulateStayEarning(req: Request, res: Response): Promise<Response | void> {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const userId = req.user.id;
      const { amountSpent, stayId } = req.body;

      if (!amountSpent || amountSpent <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid amount spent is required'
        });
      }

      const transactionId = await loyaltyService.earnPointsForStay(
        userId,
        amountSpent,
        stayId
      );

      // Get updated loyalty status
      const updatedStatus = await loyaltyService.getUserLoyaltyStatus(userId);

      res.json({
        success: true,
        message: 'Points earned successfully',
        data: {
          transactionId,
          loyaltyStatus: updatedStatus
        }
      });
    } catch (error) {
      logger.error('Error in simulateStayEarning:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to earn points for stay';
      res.status(500).json({
        success: false,
        message: errorMessage
      });
    }
  }

  // Admin endpoints

  /**
   * GET /api/loyalty/admin/users
   * Get all users' loyalty status (admin only)
   */
  async getAllUsersLoyaltyStatus(req: Request, res: Response) {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const searchTerm = req.query.search as string;

      const result = await loyaltyService.getAllUsersLoyaltyStatus(
        limit,
        offset,
        searchTerm
      );
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error in getAllUsersLoyaltyStatus:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch users loyalty status'
      });
    }
  }

  /**
   * POST /api/loyalty/admin/award-points
   * Award points to a user (admin only)
   */
  async awardPoints(req: Request, res: Response): Promise<Response | void> {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const adminUserId = req.user.id;
      const { userId, points, description, referenceId } = req.body;

      if (!userId || !points) {
        return res.status(400).json({
          success: false,
          message: 'User ID and points are required'
        });
      }

      if (points <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Points must be greater than 0'
        });
      }

      const transactionId = await loyaltyService.awardPoints(
        userId,
        points,
        'admin_award',
        description ?? 'Points awarded by admin',
        referenceId,
        adminUserId,
        `Points awarded by admin user ${adminUserId}` // adminReason
      );

      // Get updated loyalty status
      const updatedStatus = await loyaltyService.getUserLoyaltyStatus(userId);

      res.json({
        success: true,
        message: 'Points awarded successfully',
        data: {
          transactionId,
          loyaltyStatus: updatedStatus
        }
      });
    } catch (error) {
      logger.error('Error in awardPoints:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to award points';
      res.status(500).json({
        success: false,
        message: errorMessage
      });
    }
  }

  /**
   * POST /api/loyalty/admin/deduct-points
   * Deduct points from a user (admin only)
   */
  async deductPoints(req: Request, res: Response): Promise<Response | void> {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const adminUserId = req.user.id;
      const { userId, points, reason } = req.body;

      if (!userId || !points || !reason) {
        return res.status(400).json({
          success: false,
          message: 'User ID, points, and reason are required'
        });
      }

      if (points <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Points must be greater than 0'
        });
      }

      const transactionId = await loyaltyService.deductPoints(
        userId,
        points,
        'admin_deduction',
        `Points deducted by admin: ${reason}`,
        undefined,
        adminUserId,
        reason
      );

      // Get updated loyalty status
      const updatedStatus = await loyaltyService.getUserLoyaltyStatus(userId);

      res.json({
        success: true,
        message: 'Points deducted successfully',
        data: {
          transactionId,
          loyaltyStatus: updatedStatus
        }
      });
    } catch (error) {
      logger.error('Error in deductPoints:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to deduct points';
      res.status(500).json({
        success: false,
        message: errorMessage
      });
    }
  }

  /**
   * GET /api/loyalty/admin/user/:userId/history
   * Get specific user's points history (admin only)
   */
  async getUserPointsHistoryAdmin(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const history = await loyaltyService.getUserPointsHistory(userId!, limit, offset);
      
      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      logger.error('Error in getUserPointsHistoryAdmin:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch user points history'
      });
    }
  }

  /**
   * GET /api/loyalty/admin/earning-rules
   * Get points earning rules (admin only)
   */
  async getEarningRules(_req: Request, res: Response) {
    try {
      const rules = await loyaltyService.getPointsEarningRules();
      
      res.json({
        success: true,
        data: rules
      });
    } catch (error) {
      logger.error('Error in getEarningRules:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch earning rules'
      });
    }
  }

  /**
   * POST /api/loyalty/admin/expire-points
   * Manually trigger points expiration (admin only)
   */
  async expirePoints(_req: Request, res: Response) {
    try {
      const expiredCount = await loyaltyService.expireOldPoints();
      
      res.json({
        success: true,
        message: `Expired points for ${expiredCount} transactions`,
        data: { expiredCount }
      });
    } catch (error) {
      logger.error('Error in expirePoints:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to expire points'
      });
    }
  }

  /**
   * POST /api/loyalty/admin/award-spending-with-nights
   * Award spending points with optional nights stayed (admin only)
   */
  async awardSpendingWithNights(req: Request, res: Response): Promise<Response | void> {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const { userId, amountSpent, nightsStayed, referenceId, description } = req.body;

      if (!userId || !amountSpent) {
        return res.status(400).json({
          success: false,
          message: 'User ID and amount spent are required'
        });
      }

      if (amountSpent < 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount spent must be non-negative'
        });
      }

      if (nightsStayed !== undefined && nightsStayed < 0) {
        return res.status(400).json({
          success: false,
          message: 'Nights stayed must be non-negative'
        });
      }

      const result = await loyaltyService.addStayNightsAndPoints(
        userId,
        nightsStayed ?? 0,
        amountSpent,
        referenceId,
        description ?? 'Spending points with nights awarded by admin'
      );

      // Get updated loyalty status
      const updatedStatus = await loyaltyService.getUserLoyaltyStatus(userId);

      res.json({
        success: true,
        message: 'Spending points and nights awarded successfully',
        data: {
          ...result,
          loyaltyStatus: updatedStatus
        }
      });
    } catch (error) {
      logger.error('Error in awardSpendingWithNights:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to award spending with nights';
      res.status(500).json({
        success: false,
        message: errorMessage
      });
    }
  }
}