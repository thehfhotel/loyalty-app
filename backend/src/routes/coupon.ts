import { Router } from 'express';
import { couponController } from '../controllers/couponController';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import { z } from 'zod';

const router = Router();

// Validation schemas
const createCouponSchema = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Z0-9_-]+$/, 'Code must contain only uppercase letters, numbers, underscores, and hyphens'),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  termsAndConditions: z.string().optional(),
  type: z.enum(['percentage', 'fixed_amount', 'bogo', 'free_upgrade', 'free_service']),
  value: z.number().min(0).optional(),
  currency: z.string().length(3).optional().default('THB'),
  minimumSpend: z.number().min(0).optional(),
  maximumDiscount: z.number().min(0).optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  usageLimit: z.number().int().min(1).optional(),
  usageLimitPerUser: z.number().int().min(1).optional().default(1),
  tierRestrictions: z.array(z.string()).optional(),
  customerSegment: z.record(z.any()).optional()
});

const updateCouponSchema = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Z0-9_-]+$/).optional(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  termsAndConditions: z.string().optional(),
  type: z.enum(['percentage', 'fixed_amount', 'bogo', 'free_upgrade', 'free_service']).optional(),
  value: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  minimumSpend: z.number().min(0).optional(),
  maximumDiscount: z.number().min(0).optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  usageLimit: z.number().int().min(1).optional(),
  usageLimitPerUser: z.number().int().min(1).optional(),
  tierRestrictions: z.array(z.string()).optional(),
  customerSegment: z.record(z.any()).optional(),
  status: z.enum(['draft', 'active', 'paused', 'expired', 'exhausted']).optional()
});

const assignCouponSchema = z.object({
  couponId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).min(1).max(100),
  assignedReason: z.string().optional(),
  customExpiry: z.string().datetime().optional()
});

const redeemCouponSchema = z.object({
  qrCode: z.string().min(1),
  originalAmount: z.number().min(0.01),
  transactionReference: z.string().optional(),
  location: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

const revokeUserCouponSchema = z.object({
  reason: z.string().optional()
});

const revokeUserCouponsForCouponSchema = z.object({
  reason: z.string().optional()
});

// Public routes (for QR code validation)
router.get('/validate/:qrCode', couponController.validateCoupon);

// Authentication required for all other routes
router.use(authenticate);

// Customer routes
router.get('/my-coupons', couponController.getUserCoupons);
router.post('/redeem', validateRequest(redeemCouponSchema), couponController.redeemCoupon);

// Public coupon listing (active coupons only for non-admin users)
router.get('/', couponController.listCoupons);
router.get('/:couponId', couponController.getCoupon);

// Admin routes - Create and manage coupons
router.post('/', validateRequest(createCouponSchema), couponController.createCoupon);
router.put('/:couponId', validateRequest(updateCouponSchema), couponController.updateCoupon);
router.delete('/:couponId', couponController.deleteCoupon);

// Admin routes - Coupon assignment and management
router.post('/assign', validateRequest(assignCouponSchema), couponController.assignCoupon);
router.post('/user-coupons/:userCouponId/revoke', validateRequest(revokeUserCouponSchema), couponController.revokeUserCoupon);
router.post('/:couponId/users/:targetUserId/revoke', validateRequest(revokeUserCouponsForCouponSchema), couponController.revokeUserCouponsForCoupon);

// Admin routes - Analytics and reporting
router.get('/analytics/stats', couponController.getCouponStats);
router.get('/analytics/data', couponController.getCouponAnalytics);
router.get('/:couponId/redemptions', couponController.getCouponRedemptions);
router.get('/:couponId/assignments', couponController.getCouponAssignments);

export default router;