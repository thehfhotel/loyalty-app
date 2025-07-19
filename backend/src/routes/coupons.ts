import { Router } from 'express';
import { Pool } from 'pg';
import { CouponController, couponValidation } from '../controllers/couponController.js';
import { CouponService } from '../services/couponService.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

export function createCouponRoutes(db: Pool): Router {
  const router = Router();
  const couponService = new CouponService(db);
  const couponController = new CouponController(couponService);

  // Public routes (no authentication required)
  
  /**
   * @route POST /api/coupons/validate-qr
   * @desc Validate QR code data
   * @access Public
   */
  router.post('/validate-qr', couponController.validateQRCode);

  // Customer routes (require authentication)
  
  /**
   * @route GET /api/coupons/available
   * @desc Get available coupons for authenticated customer
   * @access Private (Customer)
   */
  router.get('/available', 
    authenticateToken, 
    couponController.getAvailableCoupons
  );

  /**
   * @route GET /api/coupons/my-coupons
   * @desc Get customer's coupons
   * @access Private (Customer)
   */
  router.get('/my-coupons', 
    authenticateToken, 
    couponController.getCustomerCoupons
  );

  /**
   * @route POST /api/coupons/redeem
   * @desc Redeem a coupon
   * @access Private (Customer)
   */
  router.post('/redeem',
    authenticateToken,
    couponValidation.redeemCoupon,
    couponController.redeemCoupon
  );

  // Admin routes (require admin role)
  
  /**
   * @route POST /api/coupons
   * @desc Create a new coupon
   * @access Private (Admin)
   */
  router.post('/',
    authenticateToken,
    requireRole('admin'),
    couponValidation.createCoupon,
    couponController.createCoupon
  );

  /**
   * @route GET /api/coupons/:id
   * @desc Get coupon by ID
   * @access Private (Admin)
   */
  router.get('/:id',
    authenticateToken,
    requireRole('admin'),
    couponValidation.getCoupon,
    couponController.getCoupon
  );

  /**
   * @route POST /api/coupons/distribute
   * @desc Distribute coupon to customer
   * @access Private (Admin)
   */
  router.post('/distribute',
    authenticateToken,
    requireRole('admin'),
    couponValidation.distributeCoupon,
    couponController.distributeCoupon
  );

  /**
   * @route POST /api/coupons/batch-distribute
   * @desc Batch distribute coupons
   * @access Private (Admin)
   */
  router.post('/batch-distribute',
    authenticateToken,
    requireRole('admin'),
    couponValidation.batchDistribute,
    couponController.batchDistribute
  );

  /**
   * @route GET /api/coupons/:id/analytics
   * @desc Get coupon analytics
   * @access Private (Admin)
   */
  router.get('/:id/analytics',
    authenticateToken,
    requireRole('admin'),
    couponValidation.getCoupon,
    couponController.getCouponAnalytics
  );


  return router;
}

export default createCouponRoutes;