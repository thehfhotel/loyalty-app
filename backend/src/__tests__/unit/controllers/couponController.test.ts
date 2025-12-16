import { Request, Response } from 'express';
import { couponController } from '../../../controllers/couponController';
import { couponService } from '../../../services/couponService';

// Mock couponService
jest.mock('../../../services/couponService', () => ({
  couponService: {
    createCoupon: jest.fn(),
    updateCoupon: jest.fn(),
    getCouponById: jest.fn(),
    listCoupons: jest.fn(),
    assignCouponToUsers: jest.fn(),
    redeemCoupon: jest.fn(),
    getUserActiveCoupons: jest.fn(),
    getUserCouponsByStatus: jest.fn(),
    getCouponRedemptions: jest.fn(),
    getCouponAnalytics: jest.fn(),
    getCouponStats: jest.fn(),
    deleteCoupon: jest.fn(),
    revokeUserCoupon: jest.fn(),
    revokeUserCouponsForCoupon: jest.fn(),
    getCouponAssignments: jest.fn(),
    getUserCouponByQR: jest.fn(),
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockCouponService = couponService as jest.Mocked<typeof couponService>;

describe('CouponController', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  const adminUser = { id: 'admin-1', role: 'admin' as const, email: 'admin@test.com' };
  const customerUser = { id: 'customer-1', role: 'customer' as const, email: 'customer@test.com' };
  const superAdminUser = { id: 'super-1', role: 'super_admin' as const, email: 'super@test.com' };

  const mockCoupon = {
    id: 'coupon-1',
    code: 'SAVE20',
    name: '20% Off',
    description: 'Get 20% off your purchase',
    type: 'percentage' as const,
    value: 20,
    currency: 'USD',
    minimumSpend: 100,
    maximumDiscount: 50,
    validFrom: new Date('2024-01-01'),
    validUntil: new Date('2024-12-31'),
    usageLimit: 100,
    usageLimitPerUser: 1,
    usedCount: 0,
    tierRestrictions: [],
    customerSegment: {},
    status: 'active' as const,
    createdBy: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnThis();
    mockRes = {
      json: jsonMock,
      status: statusMock,
    };
    mockReq = {
      body: {},
      params: {},
      query: {},
      user: adminUser,
    };
  });

  // ========== createCoupon Tests ==========
  describe('createCoupon', () => {
    it('should create a percentage coupon successfully', async () => {
      const couponData = {
        code: 'SAVE20',
        name: '20% Off',
        type: 'percentage' as const,
        value: 20,
      };

      mockReq.body = couponData;
      mockCouponService.createCoupon.mockResolvedValue(mockCoupon);

      await couponController.createCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.createCoupon).toHaveBeenCalledWith(couponData, 'admin-1');
      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockCoupon,
        message: 'Coupon created successfully',
      });
    });

    it('should create a fixed_amount coupon successfully', async () => {
      const couponData = {
        code: 'FIXED10',
        name: '$10 Off',
        type: 'fixed_amount' as const,
        value: 10,
      };

      mockReq.body = couponData;
      const fixedCoupon = { ...mockCoupon, type: 'fixed_amount' as const, value: 10 };
      mockCouponService.createCoupon.mockResolvedValue(fixedCoupon);

      await couponController.createCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.createCoupon).toHaveBeenCalledWith(couponData, 'admin-1');
      expect(statusMock).toHaveBeenCalledWith(201);
    });

    it('should create a BOGO coupon without value requirement', async () => {
      const couponData = {
        code: 'BOGO',
        name: 'Buy One Get One',
        type: 'bogo' as const,
      };

      mockReq.body = couponData;
      const bogoCoupon = { ...mockCoupon, type: 'bogo' as const };
      mockCouponService.createCoupon.mockResolvedValue(bogoCoupon);

      await couponController.createCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.createCoupon).toHaveBeenCalledWith(couponData, 'admin-1');
      expect(statusMock).toHaveBeenCalledWith(201);
    });

    it('should return 401 if user is not authenticated', async () => {
      mockReq.user = undefined;

      await couponController.createCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });

    it('should return 400 if code is missing', async () => {
      mockReq.body = { name: '20% Off', type: 'percentage' };

      await couponController.createCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Code, name, and type are required',
      });
    });

    it('should return 400 if name is missing', async () => {
      mockReq.body = { code: 'SAVE20', type: 'percentage' };

      await couponController.createCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Code, name, and type are required',
      });
    });

    it('should return 400 if type is missing', async () => {
      mockReq.body = { code: 'SAVE20', name: '20% Off' };

      await couponController.createCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Code, name, and type are required',
      });
    });

    it('should return 400 if coupon type is invalid', async () => {
      mockReq.body = {
        code: 'INVALID',
        name: 'Invalid Coupon',
        type: 'invalid_type',
      };

      await couponController.createCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid coupon type',
      });
    });

    it('should return 400 if percentage value is missing', async () => {
      mockReq.body = {
        code: 'SAVE',
        name: 'Discount',
        type: 'percentage',
      };

      await couponController.createCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Value is required for percentage and fixed_amount coupons',
      });
    });

    it('should return 400 if fixed_amount value is missing', async () => {
      mockReq.body = {
        code: 'FIXED',
        name: 'Fixed Discount',
        type: 'fixed_amount',
      };

      await couponController.createCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Value is required for percentage and fixed_amount coupons',
      });
    });

    it('should return 400 if percentage value exceeds 100', async () => {
      mockReq.body = {
        code: 'SAVE150',
        name: '150% Off',
        type: 'percentage',
        value: 150,
      };

      await couponController.createCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Percentage value cannot exceed 100',
      });
    });

    it('should return 400 if percentage value is exactly 101', async () => {
      mockReq.body = {
        code: 'SAVE101',
        name: '101% Off',
        type: 'percentage',
        value: 101,
      };

      await couponController.createCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Percentage value cannot exceed 100',
      });
    });

    it('should return 500 on service error', async () => {
      mockReq.body = {
        code: 'SAVE20',
        name: '20% Off',
        type: 'percentage',
        value: 20,
      };
      mockCouponService.createCoupon.mockRejectedValue(new Error('Database error'));

      await couponController.createCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Internal server error',
      });
    });
  });

  // ========== updateCoupon Tests ==========
  describe('updateCoupon', () => {
    it('should update coupon successfully', async () => {
      const updateData = { name: 'Updated Name', value: 25 };
      mockReq.params = { couponId: 'coupon-1' };
      mockReq.body = updateData;
      mockCouponService.updateCoupon.mockResolvedValue({ ...mockCoupon, ...updateData });

      await couponController.updateCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.updateCoupon).toHaveBeenCalledWith('coupon-1', updateData, 'admin-1');
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining(updateData),
        message: 'Coupon updated successfully',
      });
    });

    it('should return 401 if user is not authenticated', async () => {
      mockReq.user = undefined;
      mockReq.params = { couponId: 'coupon-1' };

      await couponController.updateCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });

    it('should return 400 if type is invalid', async () => {
      mockReq.params = { couponId: 'coupon-1' };
      mockReq.body = { type: 'invalid_type' };

      await couponController.updateCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid coupon type',
      });
    });

    it('should return 400 if status is invalid', async () => {
      mockReq.params = { couponId: 'coupon-1' };
      mockReq.body = { status: 'invalid_status' };

      await couponController.updateCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid coupon status',
      });
    });

    it('should return 400 if percentage value exceeds 100', async () => {
      mockReq.params = { couponId: 'coupon-1' };
      mockReq.body = { type: 'percentage', value: 110 };

      await couponController.updateCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Percentage value cannot exceed 100',
      });
    });

    it('should allow percentage value of exactly 100', async () => {
      mockReq.params = { couponId: 'coupon-1' };
      mockReq.body = { type: 'percentage', value: 100 };
      mockCouponService.updateCoupon.mockResolvedValue({ ...mockCoupon, value: 100 });

      await couponController.updateCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.updateCoupon).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ value: 100 }),
        message: 'Coupon updated successfully',
      });
    });
  });

  // ========== getCoupon Tests ==========
  describe('getCoupon', () => {
    it('should return coupon for admin user', async () => {
      mockReq.params = { couponId: 'coupon-1' };
      mockCouponService.getCouponById.mockResolvedValue(mockCoupon);

      await couponController.getCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.getCouponById).toHaveBeenCalledWith('coupon-1');
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockCoupon,
      });
    });

    it('should return active coupon for customer user', async () => {
      mockReq.user = customerUser;
      mockReq.params = { couponId: 'coupon-1' };
      mockCouponService.getCouponById.mockResolvedValue(mockCoupon);

      await couponController.getCoupon(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockCoupon,
      });
    });

    it('should return 404 for non-active coupon when accessed by customer', async () => {
      mockReq.user = customerUser;
      mockReq.params = { couponId: 'coupon-1' };
      const draftCoupon = { ...mockCoupon, status: 'draft' as const };
      mockCouponService.getCouponById.mockResolvedValue(draftCoupon);

      await couponController.getCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Coupon not found',
      });
    });

    it('should allow super_admin to view any coupon status', async () => {
      mockReq.user = superAdminUser;
      mockReq.params = { couponId: 'coupon-1' };
      const pausedCoupon = { ...mockCoupon, status: 'paused' as const };
      mockCouponService.getCouponById.mockResolvedValue(pausedCoupon);

      await couponController.getCoupon(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: pausedCoupon,
      });
    });

    it('should return 404 if coupon not found', async () => {
      mockReq.params = { couponId: 'nonexistent' };
      mockCouponService.getCouponById.mockResolvedValue(null);

      await couponController.getCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Coupon not found',
      });
    });
  });

  // ========== listCoupons Tests ==========
  describe('listCoupons', () => {
    const mockCouponList = {
      coupons: [mockCoupon],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    };

    it('should list coupons with default pagination', async () => {
      mockCouponService.listCoupons.mockResolvedValue(mockCouponList);

      await couponController.listCoupons(mockReq as Request, mockRes as Response);

      expect(mockCouponService.listCoupons).toHaveBeenCalledWith(1, 20, {});
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockCouponList,
      });
    });

    it('should respect pagination limits (max 50)', async () => {
      mockReq.query = { page: '2', limit: '100' };
      mockCouponService.listCoupons.mockResolvedValue(mockCouponList);

      await couponController.listCoupons(mockReq as Request, mockRes as Response);

      expect(mockCouponService.listCoupons).toHaveBeenCalledWith(2, 50, {});
    });

    it('should enforce minimum page of 1', async () => {
      mockReq.query = { page: '0' };
      mockCouponService.listCoupons.mockResolvedValue(mockCouponList);

      await couponController.listCoupons(mockReq as Request, mockRes as Response);

      expect(mockCouponService.listCoupons).toHaveBeenCalledWith(1, 20, {});
    });

    it('should use default limit when limit is 0', async () => {
      mockReq.query = { limit: '0' };
      mockCouponService.listCoupons.mockResolvedValue(mockCouponList);

      await couponController.listCoupons(mockReq as Request, mockRes as Response);

      // When limit is '0', parseInt returns 0, then 0 || 20 defaults to 20
      expect(mockCouponService.listCoupons).toHaveBeenCalledWith(1, 20, {});
    });

    it('should allow admin to filter by status', async () => {
      mockReq.query = { status: 'draft', type: 'percentage', search: 'save' };
      mockCouponService.listCoupons.mockResolvedValue(mockCouponList);

      await couponController.listCoupons(mockReq as Request, mockRes as Response);

      expect(mockCouponService.listCoupons).toHaveBeenCalledWith(1, 20, {
        status: 'draft',
        type: 'percentage',
        search: 'save',
      });
    });

    it('should force status=active for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.query = { status: 'draft', type: 'percentage' };
      mockCouponService.listCoupons.mockResolvedValue(mockCouponList);

      await couponController.listCoupons(mockReq as Request, mockRes as Response);

      expect(mockCouponService.listCoupons).toHaveBeenCalledWith(1, 20, {
        status: 'active',
        type: 'percentage',
      });
    });

    it('should not allow createdBy filter for non-admin users', async () => {
      mockReq.user = customerUser;
      mockReq.query = { createdBy: 'admin-1' };
      mockCouponService.listCoupons.mockResolvedValue(mockCouponList);

      await couponController.listCoupons(mockReq as Request, mockRes as Response);

      expect(mockCouponService.listCoupons).toHaveBeenCalledWith(1, 20, {
        status: 'active',
      });
    });

    it('should handle service errors gracefully', async () => {
      mockCouponService.listCoupons.mockRejectedValue(new Error('Database error'));

      await couponController.listCoupons(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Internal server error',
      });
    });
  });

  // ========== assignCoupon Tests ==========
  describe('assignCoupon', () => {
    it('should assign coupon to users successfully', async () => {
      const assignData = {
        couponId: 'coupon-1',
        userIds: ['user-1', 'user-2'],
      };
      mockReq.body = assignData;
      const mockUserCoupons = [
        {
          id: 'uc-1',
          userId: 'user-1',
          couponId: 'coupon-1',
          status: 'available' as const,
          qrCode: 'QR1',
          redemptionDetails: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'uc-2',
          userId: 'user-2',
          couponId: 'coupon-1',
          status: 'available' as const,
          qrCode: 'QR2',
          redemptionDetails: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockCouponService.assignCouponToUsers.mockResolvedValue(mockUserCoupons);

      await couponController.assignCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.assignCouponToUsers).toHaveBeenCalledWith(assignData, 'admin-1');
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockUserCoupons,
        message: 'Coupon assigned to 2 users successfully',
      });
    });

    it('should return 401 if user is not authenticated', async () => {
      mockReq.user = undefined;

      await couponController.assignCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });

    it('should return 400 if couponId is missing', async () => {
      mockReq.body = { userIds: ['user-1'] };

      await couponController.assignCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Coupon ID and user IDs are required',
      });
    });

    it('should return 400 if userIds is missing', async () => {
      mockReq.body = { couponId: 'coupon-1' };

      await couponController.assignCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Coupon ID and user IDs are required',
      });
    });

    it('should return 400 if userIds is empty array', async () => {
      mockReq.body = { couponId: 'coupon-1', userIds: [] };

      await couponController.assignCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Coupon ID and user IDs are required',
      });
    });

    it('should return 400 if userIds exceeds 100 users', async () => {
      const userIds = Array.from({ length: 101 }, (_, i) => `user-${i}`);
      mockReq.body = { couponId: 'coupon-1', userIds };

      await couponController.assignCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Cannot assign to more than 100 users at once',
      });
    });

    it('should allow exactly 100 users', async () => {
      const userIds = Array.from({ length: 100 }, (_, i) => `user-${i}`);
      const assignData = { couponId: 'coupon-1', userIds };
      mockReq.body = assignData;
      const mockUserCoupons = userIds.map((userId, i) => ({
        id: `uc-${i}`,
        userId,
        couponId: 'coupon-1',
        status: 'available' as const,
        qrCode: `QR${i}`,
        redemptionDetails: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      mockCouponService.assignCouponToUsers.mockResolvedValue(mockUserCoupons);

      await couponController.assignCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.assignCouponToUsers).toHaveBeenCalledWith(assignData, 'admin-1');
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockUserCoupons,
        message: 'Coupon assigned to 100 users successfully',
      });
    });
  });

  // ========== redeemCoupon Tests ==========
  describe('redeemCoupon', () => {
    it('should redeem coupon successfully', async () => {
      const redeemData = {
        qrCode: 'QR12345',
        originalAmount: 100,
        transactionReference: 'TXN123',
      };
      mockReq.body = redeemData;
      const redeemResult = {
        success: true,
        message: 'Coupon redeemed successfully',
        discountAmount: 20,
        finalAmount: 80,
        userCouponId: 'uc-1',
      };
      mockCouponService.redeemCoupon.mockResolvedValue(redeemResult);

      await couponController.redeemCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.redeemCoupon).toHaveBeenCalledWith(redeemData, 'admin-1');
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: redeemResult,
        message: redeemResult.message,
      });
    });

    it('should allow redemption without authenticated user', async () => {
      mockReq.user = undefined;
      const redeemData = {
        qrCode: 'QR12345',
        originalAmount: 100,
      };
      mockReq.body = redeemData;
      const redeemResult = {
        success: true,
        message: 'Coupon redeemed successfully',
        discountAmount: 20,
        finalAmount: 80,
      };
      mockCouponService.redeemCoupon.mockResolvedValue(redeemResult);

      await couponController.redeemCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.redeemCoupon).toHaveBeenCalledWith(redeemData, undefined);
      expect(statusMock).toHaveBeenCalledWith(200);
    });

    it('should return 400 if qrCode is missing', async () => {
      mockReq.body = { originalAmount: 100 };

      await couponController.redeemCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'QR code and valid original amount are required',
      });
    });

    it('should return 400 if originalAmount is missing', async () => {
      mockReq.body = { qrCode: 'QR12345' };

      await couponController.redeemCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'QR code and valid original amount are required',
      });
    });

    it('should return 400 if originalAmount is zero', async () => {
      mockReq.body = { qrCode: 'QR12345', originalAmount: 0 };

      await couponController.redeemCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'QR code and valid original amount are required',
      });
    });

    it('should return 400 if originalAmount is negative', async () => {
      mockReq.body = { qrCode: 'QR12345', originalAmount: -50 };

      await couponController.redeemCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'QR code and valid original amount are required',
      });
    });

    it('should return 400 when redemption fails', async () => {
      const redeemData = {
        qrCode: 'INVALID',
        originalAmount: 100,
      };
      mockReq.body = redeemData;
      const redeemResult = {
        success: false,
        message: 'Coupon has already been used',
        discountAmount: 0,
        finalAmount: 100,
      };
      mockCouponService.redeemCoupon.mockResolvedValue(redeemResult);

      await couponController.redeemCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        data: redeemResult,
        message: redeemResult.message,
      });
    });
  });

  // ========== getUserCoupons Tests ==========
  describe('getUserCoupons', () => {
    const mockUserCouponList = {
      coupons: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    };

    it('should get user active coupons by default', async () => {
      mockCouponService.getUserActiveCoupons.mockResolvedValue(mockUserCouponList);

      await couponController.getUserCoupons(mockReq as Request, mockRes as Response);

      expect(mockCouponService.getUserActiveCoupons).toHaveBeenCalledWith('admin-1', 1, 20);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockUserCouponList,
      });
    });

    it('should get user coupons by status', async () => {
      mockReq.query = { status: 'used' };
      mockCouponService.getUserCouponsByStatus.mockResolvedValue(mockUserCouponList);

      await couponController.getUserCoupons(mockReq as Request, mockRes as Response);

      expect(mockCouponService.getUserCouponsByStatus).toHaveBeenCalledWith('admin-1', 'used', 1, 20);
    });

    it('should respect pagination limits', async () => {
      mockReq.query = { page: '3', limit: '75' };
      mockCouponService.getUserActiveCoupons.mockResolvedValue(mockUserCouponList);

      await couponController.getUserCoupons(mockReq as Request, mockRes as Response);

      expect(mockCouponService.getUserActiveCoupons).toHaveBeenCalledWith('admin-1', 3, 50);
    });

    it('should allow admin to view other user coupons', async () => {
      mockReq.query = { userId: 'customer-1' };
      mockCouponService.getUserActiveCoupons.mockResolvedValue(mockUserCouponList);

      await couponController.getUserCoupons(mockReq as Request, mockRes as Response);

      expect(mockCouponService.getUserActiveCoupons).toHaveBeenCalledWith('customer-1', 1, 20);
    });

    it('should not allow customer to view other user coupons', async () => {
      mockReq.user = customerUser;
      mockReq.query = { userId: 'admin-1' };
      mockCouponService.getUserActiveCoupons.mockResolvedValue(mockUserCouponList);

      await couponController.getUserCoupons(mockReq as Request, mockRes as Response);

      expect(mockCouponService.getUserActiveCoupons).toHaveBeenCalledWith('customer-1', 1, 20);
    });

    it('should return 401 if user is not authenticated', async () => {
      mockReq.user = undefined;

      await couponController.getUserCoupons(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });
  });

  // ========== validateCoupon Tests ==========
  describe('validateCoupon', () => {
    it('should validate a valid coupon', async () => {
      mockReq.params = { qrCode: 'QR12345' };
      const mockUserCoupon = {
        userCouponId: 'uc-1',
        userId: 'user-1',
        status: 'available' as const,
        qrCode: 'QR12345',
        expiresAt: new Date(Date.now() + 86400000),
        assignedAt: new Date(),
        couponId: 'coupon-1',
        code: 'SAVE20',
        effectiveExpiry: new Date(Date.now() + 86400000), // Tomorrow
        name: '20% Off',
        description: 'Get 20% off',
        type: 'percentage' as const,
        value: 20,
        currency: 'USD',
        minimumSpend: 100,
        maximumDiscount: 50,
        expiringSoon: false,
      };
      mockCouponService.getUserCouponByQR.mockResolvedValue(mockUserCoupon);

      await couponController.validateCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.getUserCouponByQR).toHaveBeenCalledWith('QR12345');
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        valid: true,
        data: {
          name: mockUserCoupon.name,
          description: mockUserCoupon.description,
          type: mockUserCoupon.type,
          value: mockUserCoupon.value,
          currency: mockUserCoupon.currency,
          minimumSpend: mockUserCoupon.minimumSpend,
          maximumDiscount: mockUserCoupon.maximumDiscount,
          validUntil: mockUserCoupon.effectiveExpiry,
        },
        message: 'Coupon is valid',
      });
    });

    it('should mark expired coupon as invalid', async () => {
      mockReq.params = { qrCode: 'QR12345' };
      const mockUserCoupon = {
        userCouponId: 'uc-1',
        userId: 'user-1',
        status: 'available' as const,
        qrCode: 'QR12345',
        assignedAt: new Date(),
        couponId: 'coupon-1',
        code: 'SAVE20',
        effectiveExpiry: new Date(Date.now() - 86400000), // Yesterday
        name: '20% Off',
        type: 'percentage' as const,
        currency: 'USD',
        expiringSoon: false,
      };
      mockCouponService.getUserCouponByQR.mockResolvedValue(mockUserCoupon);

      await couponController.validateCoupon(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        valid: false,
        data: null,
        message: 'Coupon is not available for use',
      });
    });

    it('should mark used coupon as invalid', async () => {
      mockReq.params = { qrCode: 'QR12345' };
      const mockUserCoupon = {
        userCouponId: 'uc-1',
        userId: 'user-1',
        status: 'used' as const,
        qrCode: 'QR12345',
        assignedAt: new Date(),
        couponId: 'coupon-1',
        code: 'SAVE20',
        name: '20% Off',
        type: 'percentage' as const,
        currency: 'USD',
        expiringSoon: false,
      };
      mockCouponService.getUserCouponByQR.mockResolvedValue(mockUserCoupon);

      await couponController.validateCoupon(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        valid: false,
        data: null,
        message: 'Coupon is not available for use',
      });
    });

    it('should return 404 for invalid QR code', async () => {
      mockReq.params = { qrCode: 'INVALID' };
      mockCouponService.getUserCouponByQR.mockResolvedValue(null);

      await couponController.validateCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid QR code',
      });
    });

    it('should return 400 if qrCode parameter is missing', async () => {
      mockReq.params = {};

      await couponController.validateCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'QR code is required',
      });
    });
  });

  // ========== deleteCoupon Tests ==========
  describe('deleteCoupon', () => {
    it('should delete coupon successfully', async () => {
      mockReq.params = { couponId: 'coupon-1' };
      mockCouponService.deleteCoupon.mockResolvedValue(true);

      await couponController.deleteCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.deleteCoupon).toHaveBeenCalledWith('coupon-1', 'admin-1');
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Coupon deleted successfully',
      });
    });

    it('should return 401 if user is not authenticated', async () => {
      mockReq.user = undefined;
      mockReq.params = { couponId: 'coupon-1' };

      await couponController.deleteCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });

    it('should return 404 if coupon not found', async () => {
      mockReq.params = { couponId: 'nonexistent' };
      mockCouponService.deleteCoupon.mockResolvedValue(false);

      await couponController.deleteCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Coupon not found or already deleted',
      });
    });
  });

  // ========== revokeUserCoupon Tests ==========
  describe('revokeUserCoupon', () => {
    it('should revoke user coupon successfully', async () => {
      mockReq.params = { userCouponId: 'uc-1' };
      mockReq.body = { reason: 'Fraud detection' };
      mockCouponService.revokeUserCoupon.mockResolvedValue(true);

      await couponController.revokeUserCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.revokeUserCoupon).toHaveBeenCalledWith('uc-1', 'admin-1', 'Fraud detection');
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'User coupon revoked successfully',
      });
    });

    it('should revoke without reason', async () => {
      mockReq.params = { userCouponId: 'uc-1' };
      mockReq.body = {};
      mockCouponService.revokeUserCoupon.mockResolvedValue(true);

      await couponController.revokeUserCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.revokeUserCoupon).toHaveBeenCalledWith('uc-1', 'admin-1', undefined);
    });

    it('should return 401 if user is not authenticated', async () => {
      mockReq.user = undefined;
      mockReq.params = { userCouponId: 'uc-1' };

      await couponController.revokeUserCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it('should return 404 if user coupon not found', async () => {
      mockReq.params = { userCouponId: 'nonexistent' };
      mockReq.body = {};
      mockCouponService.revokeUserCoupon.mockResolvedValue(false);

      await couponController.revokeUserCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User coupon not found or not available for revocation',
      });
    });
  });

  // ========== getCouponRedemptions Tests ==========
  describe('getCouponRedemptions', () => {
    const mockRedemptions = {
      redemptions: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    };

    it('should get coupon redemptions', async () => {
      mockReq.params = { couponId: 'coupon-1' };
      mockCouponService.getCouponRedemptions.mockResolvedValue(mockRedemptions);

      await couponController.getCouponRedemptions(mockReq as Request, mockRes as Response);

      expect(mockCouponService.getCouponRedemptions).toHaveBeenCalledWith('coupon-1', 1, 20);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockRedemptions,
      });
    });

    it('should respect pagination limits', async () => {
      mockReq.params = { couponId: 'coupon-1' };
      mockReq.query = { page: '2', limit: '60' };
      mockCouponService.getCouponRedemptions.mockResolvedValue(mockRedemptions);

      await couponController.getCouponRedemptions(mockReq as Request, mockRes as Response);

      expect(mockCouponService.getCouponRedemptions).toHaveBeenCalledWith('coupon-1', 2, 50);
    });
  });

  // ========== getCouponAnalytics Tests ==========
  describe('getCouponAnalytics', () => {
    const mockAnalytics = {
      analytics: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    };

    it('should get coupon analytics with filters', async () => {
      mockReq.query = {
        couponId: 'coupon-1',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        page: '1',
        limit: '20',
      };
      mockCouponService.getCouponAnalytics.mockResolvedValue(mockAnalytics);

      await couponController.getCouponAnalytics(mockReq as Request, mockRes as Response);

      expect(mockCouponService.getCouponAnalytics).toHaveBeenCalledWith(
        'coupon-1',
        new Date('2024-01-01'),
        new Date('2024-12-31'),
        1,
        20
      );
    });

    it('should get analytics without filters', async () => {
      mockCouponService.getCouponAnalytics.mockResolvedValue(mockAnalytics);

      await couponController.getCouponAnalytics(mockReq as Request, mockRes as Response);

      expect(mockCouponService.getCouponAnalytics).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        1,
        20
      );
    });
  });

  // ========== getCouponStats Tests ==========
  describe('getCouponStats', () => {
    it('should get coupon statistics', async () => {
      const mockStats = {
        totalCoupons: 10,
        activeCoupons: 5,
        totalAssigned: 100,
        totalRedeemed: 50,
        totalRevenueImpact: 1000,
        conversionRate: 50,
        topCoupons: [],
      };
      mockCouponService.getCouponStats.mockResolvedValue(mockStats);

      await couponController.getCouponStats(mockReq as Request, mockRes as Response);

      expect(mockCouponService.getCouponStats).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockStats,
      });
    });

    it('should handle errors gracefully', async () => {
      mockCouponService.getCouponStats.mockRejectedValue(new Error('Database error'));

      await couponController.getCouponStats(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
    });
  });

  // ========== getCouponAssignments Tests ==========
  describe('getCouponAssignments', () => {
    const mockAssignments = {
      assignments: [],
      summary: {
        totalUsers: 0,
        totalAssigned: 0,
        totalUsed: 0,
        totalAvailable: 0,
        totalExpired: 0,
        totalRevoked: 0,
      },
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    };

    it('should get coupon assignments', async () => {
      mockReq.params = { couponId: 'coupon-1' };
      mockCouponService.getCouponAssignments.mockResolvedValue(mockAssignments);

      await couponController.getCouponAssignments(mockReq as Request, mockRes as Response);

      expect(mockCouponService.getCouponAssignments).toHaveBeenCalledWith('coupon-1', 1, 20);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockAssignments,
      });
    });
  });

  // ========== revokeUserCouponsForCoupon Tests ==========
  describe('revokeUserCouponsForCoupon', () => {
    it('should revoke all user coupons for a coupon', async () => {
      mockReq.params = { couponId: 'coupon-1', targetUserId: 'user-1' };
      mockReq.body = { reason: 'Coupon abuse' };
      mockCouponService.revokeUserCouponsForCoupon.mockResolvedValue(3);

      await couponController.revokeUserCouponsForCoupon(mockReq as Request, mockRes as Response);

      expect(mockCouponService.revokeUserCouponsForCoupon).toHaveBeenCalledWith(
        'user-1',
        'coupon-1',
        'admin-1',
        'Coupon abuse'
      );
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Successfully revoked 3 coupons',
        data: { revokedCount: 3 },
      });
    });

    it('should use singular message for single coupon', async () => {
      mockReq.params = { couponId: 'coupon-1', targetUserId: 'user-1' };
      mockReq.body = {};
      mockCouponService.revokeUserCouponsForCoupon.mockResolvedValue(1);

      await couponController.revokeUserCouponsForCoupon(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Successfully revoked 1 coupon',
        data: { revokedCount: 1 },
      });
    });

    it('should return 404 if no coupons found', async () => {
      mockReq.params = { couponId: 'coupon-1', targetUserId: 'user-1' };
      mockReq.body = {};
      mockCouponService.revokeUserCouponsForCoupon.mockResolvedValue(0);

      await couponController.revokeUserCouponsForCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'No available coupons found for this user',
      });
    });

    it('should return 401 if user is not authenticated', async () => {
      mockReq.user = undefined;
      mockReq.params = { couponId: 'coupon-1', targetUserId: 'user-1' };

      await couponController.revokeUserCouponsForCoupon(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });
  });
});
