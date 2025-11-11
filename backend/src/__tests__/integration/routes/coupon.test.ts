/**
 * Coupon Routes Integration Tests
 * Tests coupon creation, validation, redemption, and management
 *
 * Week 2 Priority - 20-25 tests
 * Coverage Target: ~2-3% contribution
 */

import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import couponRoutes from '../../../routes/coupon';
import { errorHandler } from '../../../middleware/errorHandler';
import { couponController } from '../../../controllers/couponController';

// Mock dependencies
jest.mock('../../../controllers/couponController');

describe('Coupon Routes Integration Tests', () => {
  let app: Express;
  let mockCouponController: jest.Mocked<typeof couponController>;

  // Mock authenticate middleware
  const mockAuthenticate = (role: 'customer' | 'admin' | 'super_admin' = 'customer') => (
    req: Request,
    _res: Response,
    next: NextFunction
  ) => {
    req.user = {
      id: 'test-user-id',
      email: 'test@example.com',
      role: role,
    };
    next();
  };

  beforeAll(() => {
    // Create Express app with routes
    app = express();
    app.use(express.json());

    // Mock authentication middleware
    jest.mock('../../../middleware/auth', () => ({
      authenticate: mockAuthenticate('customer'),
    }));

    app.use('/api/coupons', couponRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    mockCouponController = couponController as jest.Mocked<typeof couponController>;
    jest.clearAllMocks();
  });

  describe('GET /api/coupons/validate/:qrCode', () => {
    it('should validate coupon by QR code (public route)', async () => {
      mockCouponController.validateCoupon = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            valid: true,
            coupon: {
              code: 'WELCOME10',
              name: 'Welcome Discount',
              type: 'percentage',
              value: 10,
            },
          },
        });
      }) as unknown as typeof mockCouponController.validateCoupon;

      const response = await request(app)
        .get('/api/coupons/validate/QR-WELCOME10-ABC123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.valid).toBe(true);
      expect(response.body.data.coupon.code).toBe('WELCOME10');
    });

    it('should return invalid for expired coupon', async () => {
      mockCouponController.validateCoupon = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            valid: false,
            reason: 'Coupon has expired',
          },
        });
      }) as unknown as typeof mockCouponController.validateCoupon;

      const response = await request(app)
        .get('/api/coupons/validate/QR-EXPIRED-XYZ789');

      expect(response.status).toBe(200);
      expect(response.body.data.valid).toBe(false);
      expect(response.body.data.reason).toContain('expired');
    });

    it('should return invalid for already used coupon', async () => {
      mockCouponController.validateCoupon = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            valid: false,
            reason: 'Coupon already used',
          },
        });
      }) as unknown as typeof mockCouponController.validateCoupon;

      const response = await request(app)
        .get('/api/coupons/validate/QR-USED-COUPON');

      expect(response.status).toBe(200);
      expect(response.body.data.valid).toBe(false);
    });
  });

  describe('GET /api/coupons/my-coupons', () => {
    it('should get user coupons', async () => {
      mockCouponController.getUserCoupons = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [
            {
              id: 'coupon-1',
              code: 'WELCOME10',
              qrCode: 'QR-WELCOME-123',
              status: 'available',
              expiresAt: '2024-12-31',
            },
            {
              id: 'coupon-2',
              code: 'BIRTHDAY15',
              qrCode: 'QR-BIRTHDAY-456',
              status: 'available',
              expiresAt: '2024-06-15',
            },
          ],
        });
      }) as unknown as typeof mockCouponController.getUserCoupons;

      const response = await request(app)
        .get('/api/coupons/my-coupons');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].code).toBe('WELCOME10');
    });

    it('should return empty array for user with no coupons', async () => {
      mockCouponController.getUserCoupons = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: [] });
      }) as unknown as typeof mockCouponController.getUserCoupons;

      const response = await request(app)
        .get('/api/coupons/my-coupons');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });

  describe('POST /api/coupons/redeem', () => {
    it('should redeem coupon with valid QR code', async () => {
      mockCouponController.redeemCoupon = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          message: 'Coupon redeemed successfully',
          data: {
            discountAmount: 50,
            finalAmount: 450,
            coupon: {
              code: 'SAVE50',
              type: 'fixed_amount',
              value: 50,
            },
          },
        });
      }) as unknown as typeof mockCouponController.redeemCoupon;

      const response = await request(app)
        .post('/api/coupons/redeem')
        .send({
          qrCode: 'QR-SAVE50-ABC',
          originalAmount: 500,
          transactionReference: 'TXN-001',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.discountAmount).toBe(50);
      expect(response.body.data.finalAmount).toBe(450);
    });

    it('should reject redemption with missing required fields', async () => {
      const response = await request(app)
        .post('/api/coupons/redeem')
        .send({
          qrCode: 'QR-CODE-123',
          // Missing originalAmount
        });

      expect(response.status).toBe(400);
    });

    it('should reject redemption with invalid amount', async () => {
      const response = await request(app)
        .post('/api/coupons/redeem')
        .send({
          qrCode: 'QR-CODE-123',
          originalAmount: 0, // Invalid: must be > 0
        });

      expect(response.status).toBe(400);
    });

    it('should handle redemption of percentage discount coupon', async () => {
      mockCouponController.redeemCoupon = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            discountAmount: 100,
            finalAmount: 900,
            coupon: {
              code: 'PERCENT10',
              type: 'percentage',
              value: 10,
            },
          },
        });
      }) as unknown as typeof mockCouponController.redeemCoupon;

      const response = await request(app)
        .post('/api/coupons/redeem')
        .send({
          qrCode: 'QR-PERCENT10',
          originalAmount: 1000,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.discountAmount).toBe(100);
    });
  });

  describe('GET /api/coupons', () => {
    it('should list all active coupons', async () => {
      mockCouponController.listCoupons = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [
            { id: '1', code: 'SUMMER20', status: 'active' },
            { id: '2', code: 'WELCOME10', status: 'active' },
          ],
        });
      }) as unknown as typeof mockCouponController.listCoupons;

      const response = await request(app)
        .get('/api/coupons');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });

    it('should support pagination for coupon list', async () => {
      mockCouponController.listCoupons = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [],
          pagination: { page: 2, limit: 10, total: 25 },
        });
      }) as unknown as typeof mockCouponController.listCoupons;

      const response = await request(app)
        .get('/api/coupons')
        .query({ page: 2, limit: 10 });

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/coupons/:couponId', () => {
    it('should get specific coupon details', async () => {
      mockCouponController.getCoupon = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            id: 'coupon-123',
            code: 'SPECIAL50',
            name: 'Special Discount',
            type: 'fixed_amount',
            value: 50,
            status: 'active',
          },
        });
      }) as unknown as typeof mockCouponController.getCoupon;

      const response = await request(app)
        .get('/api/coupons/coupon-123');

      expect(response.status).toBe(200);
      expect(response.body.data.code).toBe('SPECIAL50');
    });

    it('should handle coupon not found', async () => {
      mockCouponController.getCoupon = jest.fn((
        _req: Request,
        _res: Response,
        next: NextFunction
      ) => {
        next(new Error('Coupon not found'));
      }) as unknown as typeof mockCouponController.getCoupon;

      const response = await request(app)
        .get('/api/coupons/nonexistent');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/coupons (Admin)', () => {
    it('should create coupon with valid data', async () => {
      mockCouponController.createCoupon = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.status(201).json({
          success: true,
          message: 'Coupon created successfully',
          data: {
            id: 'new-coupon-id',
            code: 'NEWDISCOUNT',
            type: 'percentage',
            value: 15,
          },
        });
      }) as unknown as typeof mockCouponController.createCoupon;

      const response = await request(app)
        .post('/api/coupons')
        .send({
          code: 'NEWDISCOUNT',
          name: 'New Discount',
          type: 'percentage',
          value: 15,
          validFrom: '2024-01-01T00:00:00Z',
          validUntil: '2024-12-31T23:59:59Z',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.code).toBe('NEWDISCOUNT');
    });

    it('should reject invalid coupon code format', async () => {
      const response = await request(app)
        .post('/api/coupons')
        .send({
          code: 'invalid code', // Contains space
          name: 'Invalid Coupon',
          type: 'percentage',
          value: 10,
        });

      expect(response.status).toBe(400);
    });

    it('should reject missing required fields', async () => {
      const response = await request(app)
        .post('/api/coupons')
        .send({
          code: 'INCOMPLETE',
          // Missing name and type
        });

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/coupons/:couponId (Admin)', () => {
    it('should update coupon', async () => {
      mockCouponController.updateCoupon = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          message: 'Coupon updated successfully',
          data: {
            id: 'coupon-123',
            code: 'UPDATED20',
            value: 20,
          },
        });
      }) as unknown as typeof mockCouponController.updateCoupon;

      const response = await request(app)
        .put('/api/coupons/coupon-123')
        .send({
          value: 20,
          status: 'active',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.value).toBe(20);
    });

    it('should reject invalid update data', async () => {
      const response = await request(app)
        .put('/api/coupons/coupon-123')
        .send({
          code: 'invalid code', // Invalid format
        });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/coupons/:couponId (Admin)', () => {
    it('should delete coupon', async () => {
      mockCouponController.deleteCoupon = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          message: 'Coupon deleted successfully',
        });
      }) as unknown as typeof mockCouponController.deleteCoupon;

      const response = await request(app)
        .delete('/api/coupons/coupon-to-delete');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should handle deletion of non-existent coupon', async () => {
      mockCouponController.deleteCoupon = jest.fn((
        _req: Request,
        _res: Response,
        next: NextFunction
      ) => {
        next(new Error('Coupon not found'));
      }) as unknown as typeof mockCouponController.deleteCoupon;

      const response = await request(app)
        .delete('/api/coupons/nonexistent');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/coupons/assign (Admin)', () => {
    it('should assign coupon to users', async () => {
      mockCouponController.assignCoupon = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          message: 'Coupon assigned to 3 users',
          data: {
            assigned: 3,
            failed: 0,
          },
        });
      }) as unknown as typeof mockCouponController.assignCoupon;

      const response = await request(app)
        .post('/api/coupons/assign')
        .send({
          couponId: 'coupon-uuid',
          userIds: ['user-1', 'user-2', 'user-3'],
          assignedReason: 'Loyalty reward',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.assigned).toBe(3);
    });

    it('should reject assignment with invalid coupon ID', async () => {
      const response = await request(app)
        .post('/api/coupons/assign')
        .send({
          couponId: 'not-a-uuid',
          userIds: ['user-1'],
        });

      expect(response.status).toBe(400);
    });

    it('should reject assignment with too many users', async () => {
      const userIds = Array.from({ length: 101 }, (_, i) => `user-${i}`);

      const response = await request(app)
        .post('/api/coupons/assign')
        .send({
          couponId: '550e8400-e29b-41d4-a716-446655440000',
          userIds: userIds,
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/coupons/user-coupons/:userCouponId/revoke (Admin)', () => {
    it('should revoke user coupon', async () => {
      mockCouponController.revokeUserCoupon = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          message: 'Coupon revoked successfully',
        });
      }) as unknown as typeof mockCouponController.revokeUserCoupon;

      const response = await request(app)
        .post('/api/coupons/user-coupons/user-coupon-123/revoke')
        .send({
          reason: 'Policy violation',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should revoke coupon without reason', async () => {
      mockCouponController.revokeUserCoupon = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true });
      }) as unknown as typeof mockCouponController.revokeUserCoupon;

      const response = await request(app)
        .post('/api/coupons/user-coupons/user-coupon-123/revoke')
        .send({});

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/coupons/analytics/stats (Admin)', () => {
    it('should get coupon statistics', async () => {
      mockCouponController.getCouponStats = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            totalCoupons: 50,
            activeCoupons: 30,
            redeemedCoupons: 150,
            totalDiscountGiven: 15000,
          },
        });
      }) as unknown as typeof mockCouponController.getCouponStats;

      const response = await request(app)
        .get('/api/coupons/analytics/stats');

      expect(response.status).toBe(200);
      expect(response.body.data.totalCoupons).toBe(50);
      expect(response.body.data.redeemedCoupons).toBe(150);
    });
  });

  describe('GET /api/coupons/analytics/data (Admin)', () => {
    it('should get coupon analytics data', async () => {
      mockCouponController.getCouponAnalytics = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            topCoupons: [
              { code: 'WELCOME10', redemptions: 500 },
              { code: 'SUMMER20', redemptions: 350 },
            ],
            redemptionTrend: [],
          },
        });
      }) as unknown as typeof mockCouponController.getCouponAnalytics;

      const response = await request(app)
        .get('/api/coupons/analytics/data');

      expect(response.status).toBe(200);
      expect(response.body.data.topCoupons).toHaveLength(2);
    });
  });

  describe('GET /api/coupons/:couponId/redemptions (Admin)', () => {
    it('should get coupon redemption history', async () => {
      mockCouponController.getCouponRedemptions = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [
            {
              id: 'redemption-1',
              userId: 'user-1',
              redeemedAt: '2024-01-15',
              discountAmount: 50,
            },
          ],
        });
      }) as unknown as typeof mockCouponController.getCouponRedemptions;

      const response = await request(app)
        .get('/api/coupons/coupon-123/redemptions');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
    });
  });

  describe('GET /api/coupons/:couponId/assignments (Admin)', () => {
    it('should get coupon assignment history', async () => {
      mockCouponController.getCouponAssignments = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [
            {
              userId: 'user-1',
              assignedAt: '2024-01-10',
              status: 'available',
            },
            {
              userId: 'user-2',
              assignedAt: '2024-01-11',
              status: 'used',
            },
          ],
        });
      }) as unknown as typeof mockCouponController.getCouponAssignments;

      const response = await request(app)
        .get('/api/coupons/coupon-123/assignments');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });
  });
});
