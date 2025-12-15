/**
 * Coupon Routes Integration Tests
 * Tests coupon creation, validation, redemption, and management
 *
 * Week 2 Priority - 20-25 tests
 * Coverage Target: ~2-3% contribution
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test mocks require flexible typing */

import request from 'supertest';
import { Express, Request, Response, NextFunction } from 'express';
import couponRoutes from '../../../routes/coupon';
import { createTestApp } from '../../fixtures';

// Mock dependencies - Service-based mocking
jest.mock('../../../services/couponService', () => ({
  couponService: {
    createCoupon: jest.fn(),
    updateCoupon: jest.fn(),
    getCouponById: jest.fn(),
    getCouponWithTranslations: jest.fn(),
    getCouponByCode: jest.fn(),
    listCoupons: jest.fn(),
    assignCouponToUsers: jest.fn(),
    redeemCoupon: jest.fn(),
    getUserCouponByQR: jest.fn(),
    getUserActiveCoupons: jest.fn(),
    getUserCouponsByStatus: jest.fn(),
    getCouponRedemptions: jest.fn(),
    getCouponAnalytics: jest.fn(),
    getCouponStats: jest.fn(),
    updateDailyAnalytics: jest.fn(),
    deleteCoupon: jest.fn(),
    getCouponAssignments: jest.fn(),
    revokeUserCouponsForCoupon: jest.fn(),
    revokeUserCoupon: jest.fn(),
  },
}));

jest.mock('../../../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    // Admin routes: POST /, PUT, DELETE, GET /analytics, GET /admin paths, POST /assign, POST /user-coupons
    const adminPaths = ['/analytics', '/assign', '/admin', '/user-coupons', '/redemptions', '/assignments'];
    const isPOST = req.method === 'POST' && (req.path === '/' || adminPaths.some(p => req.path.includes(p)));
    const isPUT = req.method === 'PUT';
    const isDELETE = req.method === 'DELETE';
    const isAdminGet = adminPaths.some(p => req.path.includes(p));

    const isAdminRoute = isPOST || isPUT || isDELETE || isAdminGet;

    req.user = isAdminRoute ? {
      id: 'admin-user-id',
      email: 'admin@example.com',
      role: 'admin',
    } : {
      id: 'test-user-id',
      email: 'test@example.com',
      role: 'customer',
    };
    next();
  },
  // requireAdmin is a factory function that returns middleware
  requireAdmin: () => (req: Request, _res: Response, next: NextFunction) => {
    req.user = {
      id: 'admin-user-id',
      email: 'admin@example.com',
      role: 'admin',
    };
    next();
  },
}));

// Import mocked service
import { couponService } from '../../../services/couponService';

describe('Coupon Routes Integration Tests', () => {
  let app: Express;
  const mockCouponService = couponService as jest.Mocked<typeof couponService>;

  beforeAll(() => {
    app = createTestApp(couponRoutes, '/api/coupons');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/coupons/validate/:qrCode', () => {
    it('should validate coupon by QR code (public route)', async () => {
      mockCouponService.getUserCouponByQR.mockResolvedValue({
        userCouponId: 'uc-123',
        userId: 'user-123',
        couponId: 'coupon-123',
        qrCode: 'QR-WELCOME10-ABC123',
        code: 'WELCOME10',
        name: 'Welcome Discount',
        description: '10% off your first purchase',
        type: 'percentage',
        value: 10,
        currency: 'THB',
        status: 'available',
        expiresAt: undefined,
        assignedAt: new Date(),
        effectiveExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        expiringSoon: false,
      } as Awaited<ReturnType<typeof mockCouponService.getUserCouponByQR>>);

      const response = await request(app)
        .get('/api/coupons/validate/QR-WELCOME10-ABC123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.valid).toBe(true);
      expect(response.body.data.name).toBe('Welcome Discount');
    });

    it('should return invalid for expired coupon', async () => {
      mockCouponService.getUserCouponByQR.mockResolvedValue({
        userCouponId: 'uc-456',
        userId: 'user-123',
        couponId: 'coupon-456',
        qrCode: 'QR-EXPIRED-XYZ789',
        code: 'EXPIRED10',
        name: 'Expired Discount',
        type: 'percentage',
        value: 10,
        currency: 'THB',
        status: 'available',
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        assignedAt: new Date(),
        effectiveExpiry: new Date(Date.now() - 24 * 60 * 60 * 1000),
        expiringSoon: false,
      } as Awaited<ReturnType<typeof mockCouponService.getUserCouponByQR>>);

      const response = await request(app)
        .get('/api/coupons/validate/QR-EXPIRED-XYZ789');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.valid).toBe(false);
      expect(response.body.message).toContain('not available');
    });

    it('should return invalid for already used coupon', async () => {
      mockCouponService.getUserCouponByQR.mockResolvedValue({
        userCouponId: 'uc-789',
        userId: 'user-123',
        couponId: 'coupon-789',
        qrCode: 'QR-USED-COUPON',
        code: 'USED10',
        name: 'Used Discount',
        type: 'percentage',
        value: 10,
        currency: 'THB',
        status: 'used',
        expiresAt: undefined,
        assignedAt: new Date(),
        effectiveExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        expiringSoon: false,
      } as Awaited<ReturnType<typeof mockCouponService.getUserCouponByQR>>);

      const response = await request(app)
        .get('/api/coupons/validate/QR-USED-COUPON');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.valid).toBe(false);
    });

    it('should return 404 for non-existent QR code', async () => {
      mockCouponService.getUserCouponByQR.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/coupons/validate/QR-NONEXISTENT-123');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid QR code');
    });
  });

  describe('GET /api/coupons/my-coupons', () => {
    it('should get user coupons', async () => {
      mockCouponService.getUserActiveCoupons.mockResolvedValue({
        coupons: [
          {
            userCouponId: 'uc-1',
            userId: 'test-user-id',
            couponId: 'coupon-1',
            code: 'WELCOME10',
            qrCode: 'QR-WELCOME-123',
            name: 'Welcome Discount',
            type: 'percentage',
            value: 10,
            currency: 'THB',
            status: 'available',
            expiresAt: new Date('2024-12-31').toISOString(),
            assignedAt: new Date().toISOString(),
            effectiveExpiry: new Date('2024-12-31').toISOString(),
            expiringSoon: false,
          },
          {
            userCouponId: 'uc-2',
            userId: 'test-user-id',
            couponId: 'coupon-2',
            code: 'BIRTHDAY15',
            qrCode: 'QR-BIRTHDAY-456',
            name: 'Birthday Discount',
            type: 'percentage',
            value: 15,
            currency: 'THB',
            status: 'available',
            expiresAt: new Date('2024-06-15').toISOString(),
            assignedAt: new Date().toISOString(),
            effectiveExpiry: new Date('2024-06-15').toISOString(),
            expiringSoon: false,
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      } as any);

      const response = await request(app)
        .get('/api/coupons/my-coupons');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.coupons).toHaveLength(2);
      expect(response.body.data.coupons[0].code).toBe('WELCOME10');
    });

    it('should return empty array for user with no coupons', async () => {
      mockCouponService.getUserActiveCoupons.mockResolvedValue({
        coupons: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });

      const response = await request(app)
        .get('/api/coupons/my-coupons');

      expect(response.status).toBe(200);
      expect(response.body.data.coupons).toEqual([]);
    });
  });

  describe('POST /api/coupons/redeem', () => {
    it('should redeem coupon with valid QR code', async () => {
      mockCouponService.redeemCoupon.mockResolvedValue({
        success: true,
        message: 'Coupon redeemed successfully',
        discountAmount: 50,
        finalAmount: 450,
        userCouponId: 'uc-123',
      });

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
      mockCouponService.redeemCoupon.mockResolvedValue({
        success: true,
        message: 'Coupon redeemed successfully',
        discountAmount: 100,
        finalAmount: 900,
        userCouponId: 'uc-456',
      });

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
      mockCouponService.listCoupons.mockResolvedValue({
        coupons: [
          {
            id: '1',
            code: 'SUMMER20',
            name: 'Summer Sale',
            type: 'percentage',
            value: 20,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: '2',
            code: 'WELCOME10',
            name: 'Welcome Offer',
            type: 'percentage',
            value: 10,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      } as any);

      const response = await request(app)
        .get('/api/coupons');

      expect(response.status).toBe(200);
      expect(response.body.data.coupons).toHaveLength(2);
    });

    it('should support pagination for coupon list', async () => {
      mockCouponService.listCoupons.mockResolvedValue({
        coupons: [],
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
      });

      const response = await request(app)
        .get('/api/coupons')
        .query({ page: 2, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.data.page).toBe(2);
      expect(response.body.data.limit).toBe(10);
    });
  });

  describe('GET /api/coupons/:couponId', () => {
    it('should get specific coupon details', async () => {
      mockCouponService.getCouponById.mockResolvedValue({
        id: 'coupon-123',
        code: 'SPECIAL50',
        name: 'Special Discount',
        type: 'fixed_amount',
        value: 50,
        currency: 'THB',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any);

      const response = await request(app)
        .get('/api/coupons/coupon-123');

      expect(response.status).toBe(200);
      expect(response.body.data.code).toBe('SPECIAL50');
    });

    it('should handle coupon not found', async () => {
      mockCouponService.getCouponById.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/coupons/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('not found');
    });
  });

  describe('POST /api/coupons (Admin)', () => {
    it('should create coupon with valid data', async () => {
      mockCouponService.createCoupon.mockResolvedValue({
        id: 'new-coupon-id',
        code: 'NEWDISCOUNT',
        name: 'New Discount',
        type: 'percentage',
        value: 15,
        currency: 'THB',
        status: 'draft',
        validFrom: new Date('2024-01-01T00:00:00Z').toISOString(),
        validUntil: new Date('2024-12-31T23:59:59Z').toISOString(),
        createdBy: 'admin-user-id',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any);

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
      mockCouponService.updateCoupon.mockResolvedValue({
        id: 'coupon-123',
        code: 'UPDATED20',
        name: 'Updated Discount',
        type: 'percentage',
        value: 20,
        currency: 'THB',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any);

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
      mockCouponService.deleteCoupon.mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/coupons/coupon-to-delete');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Coupon deleted successfully');
    });

    it('should handle deletion of non-existent coupon', async () => {
      mockCouponService.deleteCoupon.mockResolvedValue(false);

      const response = await request(app)
        .delete('/api/coupons/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('not found');
    });
  });

  describe('POST /api/coupons/assign (Admin)', () => {
    it('should assign coupon to users', async () => {
      mockCouponService.assignCouponToUsers.mockResolvedValue([
        {
          id: 'uc-1',
          userId: 'user-1',
          couponId: 'coupon-uuid',
          status: 'available',
          qrCode: 'QR-CODE-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'uc-2',
          userId: 'user-2',
          couponId: 'coupon-uuid',
          status: 'available',
          qrCode: 'QR-CODE-2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'uc-3',
          userId: 'user-3',
          couponId: 'coupon-uuid',
          status: 'available',
          qrCode: 'QR-CODE-3',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ] as any);

      const response = await request(app)
        .post('/api/coupons/assign')
        .send({
          couponId: '550e8400-e29b-41d4-a716-446655440000',
          userIds: [
            '550e8400-e29b-41d4-a716-446655440001',
            '550e8400-e29b-41d4-a716-446655440002',
            '550e8400-e29b-41d4-a716-446655440003'
          ],
          assignedReason: 'Loyalty reward',
        });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.message).toContain('3 users');
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
      mockCouponService.revokeUserCoupon.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/coupons/user-coupons/user-coupon-123/revoke')
        .send({
          reason: 'Policy violation',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('User coupon revoked successfully');
    });

    it('should revoke coupon without reason', async () => {
      mockCouponService.revokeUserCoupon.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/coupons/user-coupons/user-coupon-123/revoke')
        .send({});

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/coupons/analytics/stats (Admin)', () => {
    it('should get coupon statistics', async () => {
      mockCouponService.getCouponStats.mockResolvedValue({
        totalCoupons: 50,
        activeCoupons: 30,
        totalAssigned: 500,
        totalRedeemed: 150,
        totalRevenueImpact: 15000,
        conversionRate: 30,
        topCoupons: [
          {
            couponId: 'c-1',
            name: 'Welcome Coupon',
            code: 'WELCOME10',
            redemptionCount: 500,
            conversionRate: 35.5,
          },
          {
            couponId: 'c-2',
            name: 'Summer Sale',
            code: 'SUMMER20',
            redemptionCount: 350,
            conversionRate: 28.2,
          },
        ],
      });

      const response = await request(app)
        .get('/api/coupons/analytics/stats');

      expect(response.status).toBe(200);
      expect(response.body.data.totalCoupons).toBe(50);
      expect(response.body.data.totalRedeemed).toBe(150);
    });
  });

  describe('GET /api/coupons/analytics/data (Admin)', () => {
    it('should get coupon analytics data', async () => {
      mockCouponService.getCouponAnalytics.mockResolvedValue({
        analytics: [
          {
            id: 'analytics-1',
            couponId: 'coupon-1',
            analyticsDate: new Date('2024-01-15'),
            totalAssigned: 100,
            totalUsed: 50,
            totalExpired: 10,
            totalRevenueImpact: 5000,
            uniqueUsersAssigned: 90,
            uniqueUsersRedeemed: 45,
            conversionRate: 0.5,
            createdAt: new Date(),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      const response = await request(app)
        .get('/api/coupons/analytics/data');

      expect(response.status).toBe(200);
      expect(response.body.data.analytics).toHaveLength(1);
    });
  });

  describe('GET /api/coupons/:couponId/redemptions (Admin)', () => {
    it('should get coupon redemption history', async () => {
      mockCouponService.getCouponRedemptions.mockResolvedValue({
        redemptions: [
          {
            id: 'redemption-1',
            userCouponId: 'uc-1',
            originalAmount: 500,
            discountAmount: 50,
            finalAmount: 450,
            currency: 'THB',
            createdAt: new Date('2024-01-15').toISOString(),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      } as any);

      const response = await request(app)
        .get('/api/coupons/coupon-123/redemptions');

      expect(response.status).toBe(200);
      expect(response.body.data.redemptions).toHaveLength(1);
    });
  });

  describe('GET /api/coupons/:couponId/assignments (Admin)', () => {
    it('should get coupon assignment history', async () => {
      mockCouponService.getCouponAssignments.mockResolvedValue({
        assignments: [
          {
            userId: 'user-1',
            firstName: 'John',
            lastName: 'Doe',
            email: 'john@example.com',
            assignedCount: 2,
            usedCount: 1,
            availableCount: 1,
            latestAssignment: new Date('2024-01-10').toISOString(),
          },
          {
            userId: 'user-2',
            firstName: 'Jane',
            lastName: 'Smith',
            email: 'jane@example.com',
            assignedCount: 1,
            usedCount: 1,
            availableCount: 0,
            latestAssignment: new Date('2024-01-11').toISOString(),
          },
        ],
        summary: {
          totalUsers: 2,
          totalAssigned: 3,
          totalUsed: 2,
          totalAvailable: 1,
        },
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      } as any);

      const response = await request(app)
        .get('/api/coupons/coupon-123/assignments');

      expect(response.status).toBe(200);
      expect(response.body.data.assignments).toHaveLength(2);
      expect(response.body.data.summary.totalUsers).toBe(2);
    });
  });
});
