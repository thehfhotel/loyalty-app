import { Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { body, query, param, validationResult } from 'express-validator';
import { CouponService } from '../services/couponService.js';
import { logger } from '../utils/logger.js';
import { 
  HttpStatus, 
  ERROR_CODES 
} from '@hotel-loyalty/shared';

export class CouponController {
  constructor(private couponService: CouponService) {}

  /**
   * Create a new coupon
   */
  createCoupon = asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    try {
      const coupon = await this.couponService.createCoupon(req.body);
      
      res.status(HttpStatus.CREATED).json({
        success: true,
        data: coupon,
        message: 'Coupon created successfully'
      });
    } catch (error) {
      logger.error('Error creating coupon:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error.message || 'Failed to create coupon'
      });
    }
  });

  /**
   * Get coupon by ID
   */
  getCoupon = asyncHandler(async (req: Request, res: Response) => {
    try {
      const coupon = await this.couponService.getCouponById(req.params.id);
      
      if (!coupon) {
        return res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: 'Coupon not found'
        });
      }
      
      res.json({
        success: true,
        data: coupon
      });
    } catch (error) {
      logger.error('Error getting coupon:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve coupon'
      });
    }
  });

  /**
   * Get available coupons for customer
   */
  getAvailableCoupons = asyncHandler(async (req: Request, res: Response) => {
    try {
      const customerId = req.user?.id;
      if (!customerId) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          message: 'Customer not authenticated'
        });
      }

      const coupons = await this.couponService.getAvailableCoupons(customerId);
      
      res.json({
        success: true,
        data: coupons
      });
    } catch (error) {
      logger.error('Error getting available coupons:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve available coupons'
      });
    }
  });

  /**
   * Get customer's coupons
   */
  getCustomerCoupons = asyncHandler(async (req: Request, res: Response) => {
    try {
      const customerId = req.user?.id;
      if (!customerId) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          message: 'Customer not authenticated'
        });
      }

      const coupons = await this.couponService.getCustomerCoupons(customerId);
      
      res.json({
        success: true,
        data: coupons
      });
    } catch (error) {
      logger.error('Error getting customer coupons:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve customer coupons'
      });
    }
  });

  /**
   * Distribute coupon to customer
   */
  distributeCoupon = asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    try {
      const { couponId, customerId } = req.body;
      
      const customerCoupon = await this.couponService.distributeCoupon(
        couponId, 
        customerId
      );
      
      res.status(HttpStatus.CREATED).json({
        success: true,
        data: customerCoupon,
        message: 'Coupon distributed successfully'
      });
    } catch (error) {
      logger.error('Error distributing coupon:', error);
      
      let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      if (error.message === ERROR_CODES.RESOURCE_NOT_FOUND) {
        statusCode = HttpStatus.NOT_FOUND;
      } else if (error.message === ERROR_CODES.RESOURCE_ALREADY_EXISTS) {
        statusCode = HttpStatus.CONFLICT;
      }
      
      res.status(statusCode).json({
        success: false,
        message: error.message || 'Failed to distribute coupon'
      });
    }
  });

  /**
   * Redeem coupon
   */
  redeemCoupon = asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    try {
      const customerId = req.user?.id;
      if (!customerId) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          message: 'Customer not authenticated'
        });
      }

      const result = await this.couponService.redeemCoupon(
        req.body,
        customerId
      );
      
      res.json({
        success: true,
        data: result,
        message: 'Coupon redeemed successfully'
      });
    } catch (error) {
      logger.error('Error redeeming coupon:', error);
      
      let statusCode = HttpStatus.BAD_REQUEST;
      if (error.message === ERROR_CODES.RESOURCE_NOT_FOUND) {
        statusCode = HttpStatus.NOT_FOUND;
      }
      
      res.status(statusCode).json({
        success: false,
        message: error.message || 'Failed to redeem coupon'
      });
    }
  });

  /**
   * Validate coupon by QR code
   */
  validateQRCode = asyncHandler(async (req: Request, res: Response) => {
    try {
      const { qrData } = req.body;
      
      const result = await this.couponService.validateQRCode(qrData);
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error validating QR code:', error);
      res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Invalid QR code'
      });
    }
  });

  /**
   * Batch distribute coupons
   */
  batchDistribute = asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    try {
      const { couponId, targetType, targetValue } = req.body;
      
      const result = await this.couponService.batchDistributeCoupons(
        couponId,
        targetType,
        targetValue
      );
      
      res.json({
        success: true,
        data: result,
        message: `Batch distribution completed: ${result.distributed} coupons distributed`
      });
    } catch (error) {
      logger.error('Error in batch distribution:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to distribute coupons'
      });
    }
  });

  /**
   * Get coupon analytics
   */
  getCouponAnalytics = asyncHandler(async (req: Request, res: Response) => {
    try {
      const analytics = await this.couponService.getCouponAnalytics(req.params.id);
      
      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error('Error getting coupon analytics:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve analytics'
      });
    }
  });

}

// Validation middleware
export const couponValidation = {
  createCoupon: [
    body('title').trim().isLength({ min: 1, max: 100 }).withMessage('Title is required and must be less than 100 characters'),
    body('description').trim().isLength({ min: 1, max: 500 }).withMessage('Description is required and must be less than 500 characters'),
    body('type').isIn(['percentage', 'fixed_amount', 'free_item']).withMessage('Invalid coupon type'),
    body('category').isIn(['room', 'dining', 'spa', 'experience', 'general']).withMessage('Invalid coupon category'),
    body('value').isFloat({ min: 0 }).withMessage('Value must be a positive number'),
    body('minSpend').optional().isFloat({ min: 0 }).withMessage('Minimum spend must be a positive number'),
    body('maxDiscount').optional().isFloat({ min: 0 }).withMessage('Maximum discount must be a positive number'),
    body('validFrom').isISO8601().withMessage('Valid from date is required'),
    body('validUntil').isISO8601().withMessage('Valid until date is required'),
    body('usageLimit').optional().isInt({ min: 1 }).withMessage('Usage limit must be a positive integer'),
    body('terms').optional().trim().isLength({ max: 1000 }).withMessage('Terms must be less than 1000 characters')
  ],

  distributeCoupon: [
    body('couponId').isUUID().withMessage('Valid coupon ID is required'),
    body('customerId').isUUID().withMessage('Valid customer ID is required')
  ],

  redeemCoupon: [
    body('code').trim().isLength({ min: 6, max: 12 }).withMessage('Valid coupon code is required'),
    body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
    body('location').optional().trim().isLength({ max: 100 }).withMessage('Location must be less than 100 characters')
  ],

  batchDistribute: [
    body('couponId').isUUID().withMessage('Valid coupon ID is required'),
    body('targetType').isIn(['all', 'tier', 'segment']).withMessage('Invalid target type'),
    body('targetValue').optional().trim().notEmpty().withMessage('Target value is required for specific targeting')
  ],

  getCoupon: [
    param('id').isUUID().withMessage('Valid coupon ID is required')
  ]
};