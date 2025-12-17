import { TRPCError } from '@trpc/server';

// Create mock couponService instance
const mockCouponService = {
  listCoupons: jest.fn(),
  getUserActiveCoupons: jest.fn(),
  getUserCouponsByStatus: jest.fn(),
  getCouponById: jest.fn(),
  getUserCouponByQR: jest.fn(),
  redeemCoupon: jest.fn(),
  revokeUserCoupon: jest.fn(),
};

// Mock the couponService before importing the router
jest.mock('../../../services/couponService', () => ({
  couponService: mockCouponService,
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import router and tRPC test caller after mocks are set up
import { couponRouter } from '../../../trpc/routers/coupon';
import type { Context } from '../../../trpc/context';

/**
 * Helper to create a tRPC caller with context
 */
const createCaller = (ctx: Context) => {
  return couponRouter.createCaller(ctx);
};

describe('tRPC Coupon Router', () => {
  const adminUser = { id: 'admin-1', role: 'admin' as const, email: 'admin@test.com' };
  const customerUser = { id: 'customer-1', role: 'customer' as const, email: 'customer@test.com' };

  const mockCoupon = {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'SAVE20',
    name: 'Save 20%',
    description: 'Get 20% off your next booking',
    termsAndConditions: 'Valid for 30 days',
    type: 'percentage' as const,
    value: 20,
    currency: 'THB',
    minimumSpend: 1000,
    maximumDiscount: 500,
    validFrom: new Date('2025-01-01'),
    validUntil: new Date('2025-12-31'),
    usageLimit: 100,
    usageLimitPerUser: 1,
    usedCount: 10,
    tierRestrictions: ['gold', 'platinum'],
    customerSegment: {},
    status: 'active' as const,
    createdBy: 'admin-1',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  const mockUserActiveCoupon = {
    userCouponId: '22222222-2222-2222-2222-222222222222',
    userId: 'customer-1',
    status: 'available' as const,
    qrCode: 'QR123456',
    expiresAt: new Date('2025-12-31'),
    assignedAt: new Date('2025-01-01'),
    couponId: '11111111-1111-1111-1111-111111111111',
    code: 'SAVE20',
    name: 'Save 20%',
    description: 'Get 20% off your next booking',
    termsAndConditions: 'Valid for 30 days',
    type: 'percentage' as const,
    value: 20,
    currency: 'THB',
    minimumSpend: 1000,
    maximumDiscount: 500,
    couponExpiresAt: new Date('2025-12-31'),
    effectiveExpiry: new Date('2025-12-31'),
    expiringSoon: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== getAvailableCoupons Tests ==========
  describe('getAvailableCoupons', () => {
    it('should return active coupons for authenticated user with default pagination', async () => {
      const caller = createCaller({ user: customerUser });
      const mockResponse = {
        coupons: [mockCoupon],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      mockCouponService.listCoupons.mockResolvedValue(mockResponse);

      const result = await caller.getAvailableCoupons({});

      expect(mockCouponService.listCoupons).toHaveBeenCalledWith(1, 20, {
        status: 'active',
        type: undefined,
        search: undefined,
      });
      expect(result).toEqual(mockResponse);
    });

    it('should return coupons with custom pagination', async () => {
      const caller = createCaller({ user: customerUser });
      const mockResponse = {
        coupons: [mockCoupon],
        total: 1,
        page: 2,
        limit: 50,
        totalPages: 1,
      };
      mockCouponService.listCoupons.mockResolvedValue(mockResponse);

      const result = await caller.getAvailableCoupons({ page: 2, limit: 50 });

      expect(mockCouponService.listCoupons).toHaveBeenCalledWith(2, 50, {
        status: 'active',
        type: undefined,
        search: undefined,
      });
      expect(result).toEqual(mockResponse);
    });

    it('should filter by type', async () => {
      const caller = createCaller({ user: customerUser });
      const mockResponse = {
        coupons: [mockCoupon],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      mockCouponService.listCoupons.mockResolvedValue(mockResponse);

      await caller.getAvailableCoupons({ type: 'percentage' });

      expect(mockCouponService.listCoupons).toHaveBeenCalledWith(1, 20, {
        status: 'active',
        type: 'percentage',
        search: undefined,
      });
    });

    it('should filter by search term', async () => {
      const caller = createCaller({ user: customerUser });
      const mockResponse = {
        coupons: [mockCoupon],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      mockCouponService.listCoupons.mockResolvedValue(mockResponse);

      await caller.getAvailableCoupons({ search: 'SAVE' });

      expect(mockCouponService.listCoupons).toHaveBeenCalledWith(1, 20, {
        status: 'active',
        type: undefined,
        search: 'SAVE',
      });
    });

    it('should enforce maximum limit of 100', async () => {
      const caller = createCaller({ user: customerUser });
      mockCouponService.listCoupons.mockResolvedValue({
        coupons: [],
        total: 0,
        page: 1,
        limit: 100,
        totalPages: 0,
      });

      await caller.getAvailableCoupons({ page: 1, limit: 100 });

      expect(mockCouponService.listCoupons).toHaveBeenCalledWith(1, 100, {
        status: 'active',
        type: undefined,
        search: undefined,
      });
    });

    it('should reject limit greater than 100', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getAvailableCoupons({ page: 1, limit: 101 })
      ).rejects.toThrow();
    });

    it('should reject negative page number', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getAvailableCoupons({ page: -1, limit: 20 })
      ).rejects.toThrow();
    });

    it('should reject zero page number', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getAvailableCoupons({ page: 0, limit: 20 })
      ).rejects.toThrow();
    });

    it('should reject invalid coupon type', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getAvailableCoupons({ type: 'invalid_type' as any })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.getAvailableCoupons({})).rejects.toThrow(TRPCError);
      await expect(caller.getAvailableCoupons({})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockCouponService.listCoupons.mockRejectedValue(new Error('Database error'));

      await expect(caller.getAvailableCoupons({})).rejects.toThrow('Database error');
    });
  });

  // ========== getMyCoupons Tests ==========
  describe('getMyCoupons', () => {
    it('should return user active coupons without status filter', async () => {
      const caller = createCaller({ user: customerUser });
      const mockResponse = {
        coupons: [mockUserActiveCoupon],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      mockCouponService.getUserActiveCoupons.mockResolvedValue(mockResponse);

      const result = await caller.getMyCoupons({});

      expect(mockCouponService.getUserActiveCoupons).toHaveBeenCalledWith('customer-1', 1, 20);
      expect(result).toEqual(mockResponse);
    });

    it('should return user coupons with status filter', async () => {
      const caller = createCaller({ user: customerUser });
      const mockResponse = {
        coupons: [mockUserActiveCoupon],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      mockCouponService.getUserCouponsByStatus.mockResolvedValue(mockResponse);

      const result = await caller.getMyCoupons({ status: 'available' });

      expect(mockCouponService.getUserCouponsByStatus).toHaveBeenCalledWith(
        'customer-1',
        'available',
        1,
        20
      );
      expect(result).toEqual(mockResponse);
    });

    it('should return used coupons with status filter', async () => {
      const caller = createCaller({ user: customerUser });
      const mockResponse = {
        coupons: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      };
      mockCouponService.getUserCouponsByStatus.mockResolvedValue(mockResponse);

      await caller.getMyCoupons({ status: 'used' });

      expect(mockCouponService.getUserCouponsByStatus).toHaveBeenCalledWith(
        'customer-1',
        'used',
        1,
        20
      );
    });

    it('should accept all valid status values', async () => {
      const caller = createCaller({ user: customerUser });
      mockCouponService.getUserCouponsByStatus.mockResolvedValue({
        coupons: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });

      const validStatuses = ['available', 'used', 'expired', 'revoked'] as const;

      for (const status of validStatuses) {
        await caller.getMyCoupons({ status });
      }

      expect(mockCouponService.getUserCouponsByStatus).toHaveBeenCalledTimes(4);
    });

    it('should reject invalid status', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getMyCoupons({ status: 'invalid_status' as any })
      ).rejects.toThrow();
    });

    it('should support custom pagination', async () => {
      const caller = createCaller({ user: customerUser });
      mockCouponService.getUserActiveCoupons.mockResolvedValue({
        coupons: [],
        total: 0,
        page: 2,
        limit: 50,
        totalPages: 0,
      });

      await caller.getMyCoupons({ page: 2, limit: 50 });

      expect(mockCouponService.getUserActiveCoupons).toHaveBeenCalledWith('customer-1', 2, 50);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.getMyCoupons({})).rejects.toThrow(TRPCError);
      await expect(caller.getMyCoupons({})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw error when customer tries to view another user coupons', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getMyCoupons({ userId: 'other-user' })
      ).rejects.toThrow("Forbidden: Cannot view other user's coupons");
    });

    it('should allow admin to view other user coupons', async () => {
      const caller = createCaller({ user: adminUser });
      const mockResponse = {
        coupons: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      };
      mockCouponService.getUserActiveCoupons.mockResolvedValue(mockResponse);

      await caller.getMyCoupons({ userId: 'other-user' });

      expect(mockCouponService.getUserActiveCoupons).toHaveBeenCalledWith('other-user', 1, 20);
    });

    it('should allow customer to view own coupons with explicit userId', async () => {
      const caller = createCaller({ user: customerUser });
      mockCouponService.getUserActiveCoupons.mockResolvedValue({
        coupons: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });

      await caller.getMyCoupons({ userId: 'customer-1' });

      expect(mockCouponService.getUserActiveCoupons).toHaveBeenCalledWith('customer-1', 1, 20);
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockCouponService.getUserActiveCoupons.mockRejectedValue(new Error('Database error'));

      await expect(caller.getMyCoupons({})).rejects.toThrow('Database error');
    });
  });

  // ========== getCouponDetails Tests ==========
  describe('getCouponDetails', () => {
    it('should return coupon details for active coupon', async () => {
      const caller = createCaller({ user: customerUser });
      mockCouponService.getCouponById.mockResolvedValue(mockCoupon);

      const result = await caller.getCouponDetails({ couponId: '11111111-1111-1111-1111-111111111111' });

      expect(mockCouponService.getCouponById).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
      expect(result).toEqual(mockCoupon);
    });

    it('should throw error when coupon not found', async () => {
      const caller = createCaller({ user: customerUser });
      mockCouponService.getCouponById.mockResolvedValue(null);

      await expect(
        caller.getCouponDetails({ couponId: '33333333-3333-3333-3333-333333333333' })
      ).rejects.toThrow('Coupon not found');
    });

    it('should hide inactive coupons from non-admin users', async () => {
      const caller = createCaller({ user: customerUser });
      const inactiveCoupon = { ...mockCoupon, status: 'paused' as const };
      mockCouponService.getCouponById.mockResolvedValue(inactiveCoupon);

      await expect(
        caller.getCouponDetails({ couponId: '11111111-1111-1111-1111-111111111111' })
      ).rejects.toThrow('Coupon not found');
    });

    it('should allow admin to view inactive coupons', async () => {
      const caller = createCaller({ user: adminUser });
      const inactiveCoupon = { ...mockCoupon, status: 'paused' as const };
      mockCouponService.getCouponById.mockResolvedValue(inactiveCoupon);

      const result = await caller.getCouponDetails({ couponId: '11111111-1111-1111-1111-111111111111' });

      expect(result).toEqual(inactiveCoupon);
    });

    it('should require valid UUID for couponId', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getCouponDetails({ couponId: 'not-a-uuid' })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.getCouponDetails({ couponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.getCouponDetails({ couponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockCouponService.getCouponById.mockRejectedValue(new Error('Database error'));

      await expect(
        caller.getCouponDetails({ couponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
      ).rejects.toThrow('Database error');
    });
  });

  // ========== claimCoupon Tests ==========
  describe('claimCoupon', () => {
    it('should throw not implemented error', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.claimCoupon({ couponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
      ).rejects.toThrow('Coupon claiming is not yet implemented');
    });

    it('should require valid UUID for couponId', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.claimCoupon({ couponId: 'not-a-uuid' })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.claimCoupon({ couponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.claimCoupon({ couponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  // ========== getUserCouponByQR Tests ==========
  describe('getUserCouponByQR', () => {
    it('should return user coupon by QR code', async () => {
      const caller = createCaller({ user: customerUser });
      mockCouponService.getUserCouponByQR.mockResolvedValue(mockUserActiveCoupon);

      const result = await caller.getUserCouponByQR({ qrCode: 'QR123456' });

      expect(mockCouponService.getUserCouponByQR).toHaveBeenCalledWith('QR123456');
      expect(result).toEqual(mockUserActiveCoupon);
    });

    it('should throw error when QR code is invalid', async () => {
      const caller = createCaller({ user: customerUser });
      mockCouponService.getUserCouponByQR.mockResolvedValue(null);

      await expect(
        caller.getUserCouponByQR({ qrCode: 'INVALID' })
      ).rejects.toThrow('Invalid QR code');
    });

    it('should reject empty QR code', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getUserCouponByQR({ qrCode: '' })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.getUserCouponByQR({ qrCode: 'QR123456' })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.getUserCouponByQR({ qrCode: 'QR123456' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockCouponService.getUserCouponByQR.mockRejectedValue(new Error('Database error'));

      await expect(
        caller.getUserCouponByQR({ qrCode: 'QR123456' })
      ).rejects.toThrow('Database error');
    });
  });

  // ========== redeemCoupon Tests (Admin Only) ==========
  describe('redeemCoupon', () => {
    it('should redeem coupon successfully as admin', async () => {
      const caller = createCaller({ user: adminUser });
      const mockResult = {
        success: true,
        message: 'Coupon redeemed successfully',
        discountAmount: 200,
        finalAmount: 800,
        userCouponId: 'user-coupon-1',
      };
      mockCouponService.redeemCoupon.mockResolvedValue(mockResult);

      const result = await caller.redeemCoupon({
        qrCode: 'QR123456',
        originalAmount: 1000,
      });

      expect(mockCouponService.redeemCoupon).toHaveBeenCalledWith(
        {
          qrCode: 'QR123456',
          originalAmount: 1000,
          transactionReference: undefined,
          location: undefined,
          metadata: undefined,
        },
        'admin-1'
      );
      expect(result).toEqual(mockResult);
    });

    it('should redeem coupon with all optional parameters', async () => {
      const caller = createCaller({ user: adminUser });
      const mockResult = {
        success: true,
        message: 'Coupon redeemed successfully',
        discountAmount: 200,
        finalAmount: 800,
        userCouponId: 'user-coupon-1',
      };
      mockCouponService.redeemCoupon.mockResolvedValue(mockResult);

      await caller.redeemCoupon({
        qrCode: 'QR123456',
        originalAmount: 1000,
        transactionReference: 'TXN-12345',
        location: 'Hotel Lobby',
        metadata: { source: 'mobile-app' },
      });

      expect(mockCouponService.redeemCoupon).toHaveBeenCalledWith(
        {
          qrCode: 'QR123456',
          originalAmount: 1000,
          transactionReference: 'TXN-12345',
          location: 'Hotel Lobby',
          metadata: { source: 'mobile-app' },
        },
        'admin-1'
      );
    });

    it('should reject zero amount', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.redeemCoupon({
          qrCode: 'QR123456',
          originalAmount: 0,
        })
      ).rejects.toThrow();
    });

    it('should reject negative amount', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.redeemCoupon({
          qrCode: 'QR123456',
          originalAmount: -100,
        })
      ).rejects.toThrow();
    });

    it('should reject empty QR code', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.redeemCoupon({
          qrCode: '',
          originalAmount: 1000,
        })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.redeemCoupon({
          qrCode: 'QR123456',
          originalAmount: 1000,
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.redeemCoupon({
          qrCode: 'QR123456',
          originalAmount: 1000,
        })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw FORBIDDEN when customer tries to redeem coupon', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.redeemCoupon({
          qrCode: 'QR123456',
          originalAmount: 1000,
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.redeemCoupon({
          qrCode: 'QR123456',
          originalAmount: 1000,
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should handle redemption failures from service', async () => {
      const caller = createCaller({ user: adminUser });
      const mockResult = {
        success: false,
        message: 'Coupon has already been used',
        discountAmount: 0,
        finalAmount: 1000,
      };
      mockCouponService.redeemCoupon.mockResolvedValue(mockResult);

      const result = await caller.redeemCoupon({
        qrCode: 'QR123456',
        originalAmount: 1000,
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Coupon has already been used');
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: adminUser });
      mockCouponService.redeemCoupon.mockRejectedValue(new Error('Database error'));

      await expect(
        caller.redeemCoupon({
          qrCode: 'QR123456',
          originalAmount: 1000,
        })
      ).rejects.toThrow('Database error');
    });
  });

  // ========== revokeCoupon Tests (Admin Only) ==========
  describe('revokeCoupon', () => {
    it('should revoke coupon successfully as admin', async () => {
      const caller = createCaller({ user: adminUser });
      mockCouponService.revokeUserCoupon.mockResolvedValue(true);

      const result = await caller.revokeCoupon({
        userCouponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      });

      expect(mockCouponService.revokeUserCoupon).toHaveBeenCalledWith(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'admin-1',
        undefined
      );
      expect(result).toEqual({
        success: true,
        message: 'User coupon revoked successfully',
      });
    });

    it('should revoke coupon with reason', async () => {
      const caller = createCaller({ user: adminUser });
      mockCouponService.revokeUserCoupon.mockResolvedValue(true);

      await caller.revokeCoupon({
        userCouponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        reason: 'Customer request',
      });

      expect(mockCouponService.revokeUserCoupon).toHaveBeenCalledWith(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'admin-1',
        'Customer request'
      );
    });

    it('should throw error when coupon not found or not available for revocation', async () => {
      const caller = createCaller({ user: adminUser });
      mockCouponService.revokeUserCoupon.mockResolvedValue(false);

      await expect(
        caller.revokeCoupon({
          userCouponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        })
      ).rejects.toThrow('User coupon not found or not available for revocation');
    });

    it('should require valid UUID for userCouponId', async () => {
      const caller = createCaller({ user: adminUser });

      await expect(
        caller.revokeCoupon({
          userCouponId: 'not-a-uuid',
        })
      ).rejects.toThrow();
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.revokeCoupon({
          userCouponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.revokeCoupon({
          userCouponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should throw FORBIDDEN when customer tries to revoke coupon', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.revokeCoupon({
          userCouponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.revokeCoupon({
          userCouponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: adminUser });
      mockCouponService.revokeUserCoupon.mockRejectedValue(new Error('Database error'));

      await expect(
        caller.revokeCoupon({
          userCouponId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        })
      ).rejects.toThrow('Database error');
    });
  });
});
