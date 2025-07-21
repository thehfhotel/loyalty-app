import { Request, Response } from 'express';
import { couponService } from '../services/couponService';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import {
  CreateCouponRequest,
  UpdateCouponRequest,
  AssignCouponRequest,
  RedeemCouponRequest,
  CouponType,
  CouponStatus
} from '../types/coupon';

export class CouponController {
  // Create new coupon (Admin only)
  async createCoupon(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new AppError(401, 'Authentication required');
      }

      // Check admin permissions
      if (!['admin', 'super_admin'].includes(req.user?.role || '')) {
        throw new AppError(403, 'Admin access required');
      }

      const data: CreateCouponRequest = req.body;

      // Validate required fields
      if (!data.code || !data.name || !data.type) {
        throw new AppError(400, 'Code, name, and type are required');
      }

      // Validate coupon type
      const validTypes: CouponType[] = ['percentage', 'fixed_amount', 'bogo', 'free_upgrade', 'free_service'];
      if (!validTypes.includes(data.type)) {
        throw new AppError(400, 'Invalid coupon type');
      }

      // Validate value for percentage and fixed_amount types
      if (['percentage', 'fixed_amount'].includes(data.type) && (data.value === undefined || data.value <= 0)) {
        throw new AppError(400, 'Value is required for percentage and fixed_amount coupons');
      }

      if (data.type === 'percentage' && data.value! > 100) {
        throw new AppError(400, 'Percentage value cannot exceed 100');
      }

      const coupon = await couponService.createCoupon(data, userId);

      res.status(201).json({
        success: true,
        data: coupon,
        message: 'Coupon created successfully'
      });
    } catch (error) {
      logger.error('Error creating coupon:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    }
  }

  // Update coupon (Admin only)
  async updateCoupon(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new AppError(401, 'Authentication required');
      }

      // Check admin permissions
      if (!['admin', 'super_admin'].includes(req.user?.role || '')) {
        throw new AppError(403, 'Admin access required');
      }

      const { couponId } = req.params;
      const data: UpdateCouponRequest = req.body;

      // Validate coupon type if provided
      if (data.type) {
        const validTypes: CouponType[] = ['percentage', 'fixed_amount', 'bogo', 'free_upgrade', 'free_service'];
        if (!validTypes.includes(data.type)) {
          throw new AppError(400, 'Invalid coupon type');
        }
      }

      // Validate status if provided
      if (data.status) {
        const validStatuses: CouponStatus[] = ['draft', 'active', 'paused', 'expired', 'exhausted'];
        if (!validStatuses.includes(data.status)) {
          throw new AppError(400, 'Invalid coupon status');
        }
      }

      // Validate percentage value
      if (data.type === 'percentage' && data.value !== undefined && data.value > 100) {
        throw new AppError(400, 'Percentage value cannot exceed 100');
      }

      const coupon = await couponService.updateCoupon(couponId, data, userId);

      res.json({
        success: true,
        data: coupon,
        message: 'Coupon updated successfully'
      });
    } catch (error) {
      logger.error('Error updating coupon:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    }
  }

  // Get coupon by ID
  async getCoupon(req: Request, res: Response): Promise<void> {
    try {
      const { couponId } = req.params;
      const coupon = await couponService.getCouponById(couponId);

      if (!coupon) {
        throw new AppError(404, 'Coupon not found');
      }

      // Non-admin users can only see active coupons
      if (!['admin', 'super_admin'].includes(req.user?.role || '') && coupon.status !== 'active') {
        throw new AppError(404, 'Coupon not found');
      }

      res.json({
        success: true,
        data: coupon
      });
    } catch (error) {
      logger.error('Error getting coupon:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    }
  }

  // List coupons with filtering
  async listCoupons(req: Request, res: Response): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      
      const filters: any = {};

      // Admin users can filter by all fields
      if (['admin', 'super_admin'].includes(req.user?.role || '')) {
        if (req.query.status) filters.status = req.query.status;
        if (req.query.type) filters.type = req.query.type;
        if (req.query.search) filters.search = req.query.search;
        if (req.query.createdBy) filters.createdBy = req.query.createdBy;
      } else {
        // Non-admin users can only see active coupons
        filters.status = 'active';
        if (req.query.type) filters.type = req.query.type;
        if (req.query.search) filters.search = req.query.search;
      }

      const result = await couponService.listCoupons(page, limit, filters);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error listing coupons:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Assign coupon to users (Admin only)
  async assignCoupon(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new AppError(401, 'Authentication required');
      }

      // Check admin permissions
      if (!['admin', 'super_admin'].includes(req.user?.role || '')) {
        throw new AppError(403, 'Admin access required');
      }

      const data: AssignCouponRequest = req.body;

      // Validate required fields
      if (!data.couponId || !data.userIds || data.userIds.length === 0) {
        throw new AppError(400, 'Coupon ID and user IDs are required');
      }

      // Validate user IDs array
      if (data.userIds.length > 100) {
        throw new AppError(400, 'Cannot assign to more than 100 users at once');
      }

      const userCoupons = await couponService.assignCouponToUsers(data, userId);

      res.json({
        success: true,
        data: userCoupons,
        message: `Coupon assigned to ${userCoupons.length} users successfully`
      });
    } catch (error) {
      logger.error('Error assigning coupon:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    }
  }

  // Redeem coupon by QR code
  async redeemCoupon(req: Request, res: Response): Promise<void> {
    try {
      const data: RedeemCouponRequest = req.body;

      // Validate required fields
      if (!data.qrCode || data.originalAmount === undefined || data.originalAmount <= 0) {
        throw new AppError(400, 'QR code and valid original amount are required');
      }

      const redeemedBy = req.user?.userId;
      const result = await couponService.redeemCoupon(data, redeemedBy);

      const statusCode = result.success ? 200 : 400;
      res.status(statusCode).json({
        success: result.success,
        data: result,
        message: result.message
      });
    } catch (error) {
      logger.error('Error redeeming coupon:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    }
  }

  // Get user's active coupons
  async getUserCoupons(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new AppError(401, 'Authentication required');
      }

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

      // Admin can view any user's coupons
      let targetUserId = userId;
      if (['admin', 'super_admin'].includes(req.user?.role || '') && req.query.userId) {
        targetUserId = req.query.userId as string;
      }

      const result = await couponService.getUserActiveCoupons(targetUserId, page, limit);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error getting user coupons:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    }
  }

  // Get coupon redemption history (Admin only)
  async getCouponRedemptions(req: Request, res: Response): Promise<void> {
    try {
      // Check admin permissions
      if (!['admin', 'super_admin'].includes(req.user?.role || '')) {
        throw new AppError(403, 'Admin access required');
      }

      const { couponId } = req.params;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

      const result = await couponService.getCouponRedemptions(couponId, page, limit);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error getting coupon redemptions:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    }
  }

  // Get coupon analytics (Admin only)
  async getCouponAnalytics(req: Request, res: Response): Promise<void> {
    try {
      // Check admin permissions
      if (!['admin', 'super_admin'].includes(req.user?.role || '')) {
        throw new AppError(403, 'Admin access required');
      }

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

      const couponId = req.query.couponId as string | undefined;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const result = await couponService.getCouponAnalytics(couponId, startDate, endDate, page, limit);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error getting coupon analytics:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    }
  }

  // Get coupon statistics dashboard (Admin only)
  async getCouponStats(req: Request, res: Response): Promise<void> {
    try {
      // Check admin permissions
      if (!['admin', 'super_admin'].includes(req.user?.role || '')) {
        throw new AppError(403, 'Admin access required');
      }

      const stats = await couponService.getCouponStats();

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Error getting coupon stats:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Delete coupon (Admin only)
  async deleteCoupon(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new AppError(401, 'Authentication required');
      }

      // Check admin permissions
      if (!['admin', 'super_admin'].includes(req.user?.role || '')) {
        throw new AppError(403, 'Admin access required');
      }

      const { couponId } = req.params;
      const success = await couponService.deleteCoupon(couponId, userId);

      if (!success) {
        throw new AppError(404, 'Coupon not found or already deleted');
      }

      res.json({
        success: true,
        message: 'Coupon deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting coupon:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    }
  }

  // Revoke user coupon (Admin only)
  async revokeUserCoupon(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new AppError(401, 'Authentication required');
      }

      // Check admin permissions
      if (!['admin', 'super_admin'].includes(req.user?.role || '')) {
        throw new AppError(403, 'Admin access required');
      }

      const { userCouponId } = req.params;
      const { reason } = req.body;

      const success = await couponService.revokeUserCoupon(userCouponId, userId, reason);

      if (!success) {
        throw new AppError(404, 'User coupon not found or not available for revocation');
      }

      res.json({
        success: true,
        message: 'User coupon revoked successfully'
      });
    } catch (error) {
      logger.error('Error revoking user coupon:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    }
  }

  // Validate coupon by QR code (for checking before redemption)
  async validateCoupon(req: Request, res: Response): Promise<void> {
    try {
      const { qrCode } = req.params;
      
      if (!qrCode) {
        throw new AppError(400, 'QR code is required');
      }

      // Get user coupon by QR code
      const userCoupon = await couponService.getUserCouponByQR(qrCode);

      if (!userCoupon) {
        res.json({
          success: false,
          valid: false,
          message: 'Invalid QR code'
        });
        return;
      }

      // Check if coupon is available for use
      const isValid = userCoupon.status === 'available' && 
                     (!userCoupon.effectiveExpiry || userCoupon.effectiveExpiry > new Date());

      res.json({
        success: true,
        valid: isValid,
        data: isValid ? {
          name: userCoupon.name,
          description: userCoupon.description,
          type: userCoupon.type,
          value: userCoupon.value,
          currency: userCoupon.currency,
          minimumSpend: userCoupon.minimumSpend,
          maximumDiscount: userCoupon.maximumDiscount,
          validUntil: userCoupon.validUntil
        } : null,
        message: isValid ? 'Coupon is valid' : 'Coupon is not available for use'
      });
    } catch (error) {
      logger.error('Error validating coupon:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          success: false,
          message: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    }
  }
}

export const couponController = new CouponController();