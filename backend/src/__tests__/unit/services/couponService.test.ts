// @ts-nocheck - Mock type assertions conflict with TypeScript strict mode
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { CouponService } from '../../../services/couponService';
import { AppError } from '../../../middleware/errorHandler';
import * as database from '../../../config/database';

// Mock dependencies
jest.mock('../../../config/database');
jest.mock('../../../utils/logger');

describe('CouponService', () => {
  let couponService: CouponService;
  let mockQuery: jest.MockedFunction<typeof database.query>;
  let mockGetClient: jest.MockedFunction<typeof database.getClient>;
  let mockClient: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: jest.Mock;
    release: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    couponService = new CouponService();
    mockQuery = database.query as jest.MockedFunction<typeof database.query>;
    mockGetClient = database.getClient as jest.MockedFunction<typeof database.getClient>;

    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };

    mockGetClient.mockResolvedValue(mockClient as never);
    mockQuery.mockResolvedValue([]);
  });

  describe('createCoupon', () => {
    it('should create a new coupon successfully', async () => {
      const couponData = {
        code: 'SUMMER20',
        name: 'Summer Sale',
        description: '20% off summer collection',
        type: 'percentage' as const,
        value: 20,
        currency: 'THB',
        validFrom: new Date('2024-06-01'),
        validUntil: new Date('2024-08-31'),
        usageLimit: 100,
        usageLimitPerUser: 1,
      };

      const createdCoupon = {
        id: 'coupon-123',
        code: 'SUMMER20',
        name: 'Summer Sale',
        type: 'percentage',
        value: 20,
        status: 'draft',
        createdBy: 'admin-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockQuery.mockResolvedValueOnce([]); // Check existing code
      // @ts-expect-error Mock typing
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'BEGIN' } as any) // BEGIN
        .mockResolvedValueOnce({ rows: [createdCoupon], command: 'INSERT' } as any) // INSERT
        .mockResolvedValueOnce({ rows: [], command: 'COMMIT' } as any); // COMMIT

      const result = await couponService.createCoupon(couponData, 'admin-123');

      expect(result).toEqual(createdCoupon);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw error if coupon code already exists', async () => {
      const couponData = {
        code: 'EXISTING',
        name: 'Test Coupon',
        type: 'percentage' as const,
        value: 10,
      };

      // Mock client.query for BEGIN
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'BEGIN' });

      // Mock standalone query() for duplicate check - returns existing coupon
      mockQuery.mockResolvedValueOnce([{ id: 'existing-id' }]);

      // Mock client.query for ROLLBACK
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'ROLLBACK' });

      await expect(couponService.createCoupon(couponData, 'admin-123'))
        .rejects.toMatchObject({
          statusCode: 409,
          message: 'Coupon code already exists',
        });
    });

    it('should rollback transaction on error', async () => {
      const couponData = {
        code: 'TEST',
        name: 'Test',
        type: 'percentage' as const,
        value: 10,
      };

      mockQuery.mockResolvedValueOnce([]); // No existing code
      // @ts-expect-error Mock typing
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'BEGIN' }as any)
        .mockRejectedValueOnce(new Error('Database error'));

      await expect(couponService.createCoupon(couponData, 'admin-123'))
        .rejects.toThrow('Database error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle different coupon types', async () => {
      const types: Array<'percentage' | 'fixed_amount' | 'bogo'> = ['percentage', 'fixed_amount', 'bogo'];

      for (const type of types) {
        jest.clearAllMocks();
        mockGetClient.mockResolvedValue(mockClient as never);

        const couponData = {
          code: `TEST-${type}`,
          name: `Test ${type}`,
          type,
          value: type === 'bogo' ? 0 : 100,
        };

        mockQuery.mockResolvedValueOnce([]);
        // @ts-expect-error Mock typing
        (mockClient.query as unknown as jest.Mock)
          .mockResolvedValueOnce({ rows: [], command: 'BEGIN' }as any)
          .mockResolvedValueOnce({
            rows: [{
              id: 'coupon-123',
              code: couponData.code,
              type,
              status: 'draft'
            }],
            command: 'INSERT'
          })
          .mockResolvedValueOnce({ rows: [], command: 'COMMIT' }) as any;

        const result = await couponService.createCoupon(couponData, 'admin-123');
        expect(result.type).toBe(type);
      }
    });
  });

  describe('getCouponById', () => {
    it('should retrieve coupon by ID', async () => {
      const mockCoupon = {
        id: 'coupon-123',
        code: 'TEST20',
        name: 'Test Coupon',
        type: 'percentage',
        value: 20,
        status: 'active',
      };

      mockQuery.mockResolvedValueOnce([mockCoupon]);

      const result = await couponService.getCouponById('coupon-123');

      expect(result).toEqual(mockCoupon);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['coupon-123']
      );
    });

    it('should return null if coupon not found', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await couponService.getCouponById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getCouponByCode', () => {
    it('should retrieve coupon by code', async () => {
      const mockCoupon = {
        id: 'coupon-123',
        code: 'SUMMER20',
        name: 'Summer Sale',
        type: 'percentage',
        value: 20,
      };

      mockQuery.mockResolvedValueOnce([mockCoupon]);

      const result = await couponService.getCouponByCode('SUMMER20');

      expect(result).toEqual(mockCoupon);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('code = $1'),
        ['SUMMER20']
      );
    });

    it('should return null if code not found', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await couponService.getCouponByCode('NONEXISTENT');

      expect(result).toBeNull();
    });

    it('should be case-sensitive for coupon codes', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await couponService.getCouponByCode('summer20');

      expect(result).toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        ['summer20']
      );
    });
  });

  describe('listCoupons', () => {
    it('should list coupons with pagination', async () => {
      const mockCoupons = [
        { id: 'coupon-1', code: 'CODE1', name: 'Coupon 1', status: 'active' },
        { id: 'coupon-2', code: 'CODE2', name: 'Coupon 2', status: 'active' },
      ];

      mockQuery
        .mockResolvedValueOnce([{ count: 25 }]) // COUNT query first
        .mockResolvedValueOnce(mockCoupons); // SELECT query second

      const result = await couponService.listCoupons(1, 10);

      expect(result.coupons).toEqual(mockCoupons);
      expect(result.total).toBe(25);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(3);
    });

    it('should filter by status', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: 0 }]) // COUNT query first
        .mockResolvedValueOnce([]); // SELECT query second

      await couponService.listCoupons(1, 10, { status: 'active' });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('status = $1'),
        expect.any(Array)
      );
    });

    it('should filter by type', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: 0 }]) // COUNT query first
        .mockResolvedValueOnce([]); // SELECT query second

      await couponService.listCoupons(1, 10, { type: 'percentage' });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('type = $1'),
        expect.any(Array)
      );
    });

    it('should search by code or name', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: 0 }]) // COUNT query first
        .mockResolvedValueOnce([]); // SELECT query second

      await couponService.listCoupons(1, 10, { search: 'SUMMER' });

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('assignCouponToUsers', () => {
    it('should assign coupon to multiple users', async () => {
      const assignData = {
        couponId: 'coupon-123',
        userIds: ['user-1', 'user-2', 'user-3'],
        customExpiry: new Date('2024-12-31'),
        assignedReason: 'Loyalty reward',
      };

      // Mock transaction BEGIN
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'BEGIN' })
        // For user-1: call assign_coupon_to_user stored procedure
        .mockResolvedValueOnce({ rows: [{ assign_coupon_to_user: 'uc-1' }], command: 'SELECT' })
        // For user-1: get assigned user coupon
        .mockResolvedValueOnce({
          rows: [{ id: 'uc-1', userId: 'user-1', couponId: 'coupon-123', qrCode: 'QR1', status: 'available' }],
          command: 'SELECT'
        })
        // For user-2: call assign_coupon_to_user stored procedure
        .mockResolvedValueOnce({ rows: [{ assign_coupon_to_user: 'uc-2' }], command: 'SELECT' })
        // For user-2: get assigned user coupon
        .mockResolvedValueOnce({
          rows: [{ id: 'uc-2', userId: 'user-2', couponId: 'coupon-123', qrCode: 'QR2', status: 'available' }],
          command: 'SELECT'
        })
        // For user-3: call assign_coupon_to_user stored procedure
        .mockResolvedValueOnce({ rows: [{ assign_coupon_to_user: 'uc-3' }], command: 'SELECT' })
        // For user-3: get assigned user coupon
        .mockResolvedValueOnce({
          rows: [{ id: 'uc-3', userId: 'user-3', couponId: 'coupon-123', qrCode: 'QR3', status: 'available' }],
          command: 'SELECT'
        })
        // COMMIT transaction
        .mockResolvedValueOnce({ rows: [], command: 'COMMIT' });

      const result = await couponService.assignCouponToUsers(assignData, 'admin-123');

      expect(result).toHaveLength(3);
      expect(result[0].couponId).toBe('coupon-123');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should handle error if coupon not found', async () => {
      const assignData = {
        couponId: 'non-existent',
        userIds: ['user-1'],
      };

      // Mock transaction BEGIN
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'BEGIN' })
        // Mock stored procedure throwing error for non-existent coupon
        .mockRejectedValueOnce(new AppError(404, 'Coupon not found'))
        // Mock COMMIT (service continues after error)
        .mockResolvedValueOnce({ rows: [], command: 'COMMIT' });

      const result = await couponService.assignCouponToUsers(assignData, 'admin-123');

      // Service catches individual errors and continues, returns empty array
      expect(result).toEqual([]);
    });

    it('should handle error if coupon not active', async () => {
      const assignData = {
        couponId: 'coupon-123',
        userIds: ['user-1'],
      };

      // Mock transaction BEGIN
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'BEGIN' })
        // Mock stored procedure throwing error for inactive coupon
        .mockRejectedValueOnce(new AppError(400, 'Coupon is not active'))
        // Mock COMMIT (service continues after error)
        .mockResolvedValueOnce({ rows: [], command: 'COMMIT' });

      const result = await couponService.assignCouponToUsers(assignData, 'admin-123');

      // Service catches individual errors and continues, returns empty array
      expect(result).toEqual([]);
    });
  });

  describe('redeemCoupon', () => {
    it('should redeem coupon successfully', async () => {
      const redeemData = {
        qrCode: 'QR-CODE-123',
        originalAmount: 1000,
        transactionReference: 'TXN-123',
        location: 'Bangkok Store',
      };

      // Mock transaction BEGIN
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'BEGIN' })
        // Mock redeem_coupon stored procedure response
        .mockResolvedValueOnce({
          rows: [{
            success: true,
            message: 'Coupon redeemed successfully',
            discountAmount: 200, // 20% of 1000
            finalAmount: 800,
            userCouponId: 'uc-123',
          }],
          command: 'SELECT',
        })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], command: 'COMMIT' });

      const result = await couponService.redeemCoupon(redeemData);

      expect(result.success).toBe(true);
      expect(result.discountAmount).toBe(200); // 20% of 1000
      expect(result.finalAmount).toBe(800);
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw error if user coupon not found', async () => {
      const redeemData = {
        qrCode: 'INVALID',
        originalAmount: 1000,
      };

      // Mock transaction BEGIN
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'BEGIN' })
        // Mock redeem_coupon stored procedure failure (no result)
        .mockResolvedValueOnce({ rows: [], command: 'SELECT' })
        // Mock ROLLBACK after error
        .mockResolvedValueOnce({ rows: [], command: 'ROLLBACK' });

      await expect(couponService.redeemCoupon(redeemData))
        .rejects.toMatchObject({
          statusCode: 500,
          message: 'Failed to redeem coupon',
        });
    });

    it('should throw error if coupon already used', async () => {
      const redeemData = {
        qrCode: 'QR-CODE-123',
        originalAmount: 1000,
      };

      // Mock transaction BEGIN
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'BEGIN' })
        // Mock redeem_coupon stored procedure response with failure
        .mockResolvedValueOnce({
          rows: [{
            success: false,
            message: 'Coupon has already been used',
            discountAmount: null,
            finalAmount: null,
            userCouponId: null,
          }],
          command: 'SELECT',
        })
        // Mock COMMIT (stored procedure completed, but returned failure)
        .mockResolvedValueOnce({ rows: [], command: 'COMMIT' });

      const result = await couponService.redeemCoupon(redeemData);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Coupon has already been used');
    });

    it('should handle fixed amount discount', async () => {
      const redeemData = {
        qrCode: 'QR-CODE-123',
        originalAmount: 1000,
      };

      // Mock transaction BEGIN
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'BEGIN' })
        // Mock redeem_coupon stored procedure with fixed amount discount
        .mockResolvedValueOnce({
          rows: [{
            success: true,
            message: 'Coupon redeemed successfully',
            discountAmount: 100, // Fixed amount
            finalAmount: 900,
            userCouponId: 'uc-123',
          }],
          command: 'SELECT',
        })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], command: 'COMMIT' });

      const result = await couponService.redeemCoupon(redeemData);

      expect(result.discountAmount).toBe(100);
      expect(result.finalAmount).toBe(900);
    });
  });

  describe('getUserActiveCoupons', () => {
    it('should get user active coupons', async () => {
      const mockCoupons = [
        {
          id: 'uc-1',
          couponId: 'coupon-1',
          status: 'available',
          qrCode: 'QR1',
          code: 'CODE1',
          name: 'Coupon 1',
        },
        {
          id: 'uc-2',
          couponId: 'coupon-2',
          status: 'available',
          qrCode: 'QR2',
          code: 'CODE2',
          name: 'Coupon 2',
        },
      ];

      mockQuery
        .mockResolvedValueOnce([{ count: 2 }]) // COUNT query first
        .mockResolvedValueOnce(mockCoupons); // SELECT query second

      const result = await couponService.getUserActiveCoupons('user-123', 1, 10);

      expect(result.coupons).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = $1'),
        expect.arrayContaining(['user-123'])
      );
    });

    it('should return empty array if no active coupons', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: 0 }]) // COUNT query first
        .mockResolvedValueOnce([]); // SELECT query second

      const result = await couponService.getUserActiveCoupons('user-123', 1, 10);

      expect(result.coupons).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('getCouponStats', () => {
    it('should return coupon statistics', async () => {
      const mockOverallStats = {
        totalCoupons: 50,
        activeCoupons: 30,
        totalAssigned: 500,
        totalRedeemed: 250,
      };

      const mockRevenueResult = {
        totalRevenueImpact: 50000,
      };

      const mockTopCoupons = [
        {
          couponId: 'c1',
          name: 'Top Coupon 1',
          code: 'TOP1',
          redemptionCount: 100,
          conversionRate: 80.5,
        },
        {
          couponId: 'c2',
          name: 'Top Coupon 2',
          code: 'TOP2',
          redemptionCount: 75,
          conversionRate: 60.0,
        },
      ];

      // Mock the 3 queries that getCouponStats makes
      mockQuery
        .mockResolvedValueOnce([mockOverallStats]) // Overall stats query
        .mockResolvedValueOnce([mockRevenueResult]) // Revenue impact query
        .mockResolvedValueOnce(mockTopCoupons); // Top coupons query

      const result = await couponService.getCouponStats();

      expect(result.totalCoupons).toBe(50);
      expect(result.activeCoupons).toBe(30);
      expect(result.totalAssigned).toBe(500);
      expect(result.totalRedeemed).toBe(250);
      expect(result.totalRevenueImpact).toBe(50000);
      expect(result.conversionRate).toBe(50); // 250/500 * 100
      expect(result.topCoupons).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });
  });

  describe('deleteCoupon', () => {
    it('should soft delete a coupon', async () => {
      mockQuery.mockResolvedValueOnce([{ updated: true }]);

      const result = await couponService.deleteCoupon('coupon-123', 'admin-123');

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE coupons'),
        expect.any(Array)
      );
    });

    it('should return false if coupon not found', async () => {
      mockQuery.mockResolvedValueOnce([]); // No rows returned, coupon not found

      const result = await couponService.deleteCoupon('non-existent', 'admin-123');

      expect(result).toBe(false); // Service returns false, doesn't throw
    });
  });

  describe('revokeUserCoupon', () => {
    it('should revoke user coupon successfully', async () => {
      mockQuery.mockResolvedValueOnce([{ updated: true }]);

      const result = await couponService.revokeUserCoupon('uc-123', 'admin-123', 'Policy violation');

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE user_coupons'),
        expect.arrayContaining(['uc-123'])
      );
    });

    it('should return false if user coupon not found', async () => {
      mockQuery.mockResolvedValueOnce([]); // No rows returned

      const result = await couponService.revokeUserCoupon('non-existent', 'admin-123');

      expect(result).toBe(false); // Service returns false, doesn't throw
    });

    it('should return false if coupon already used', async () => {
      mockQuery.mockResolvedValueOnce([]); // UPDATE returns no rows (status != 'available')

      const result = await couponService.revokeUserCoupon('uc-123', 'admin-123');

      expect(result).toBe(false); // Service returns false, doesn't throw
    });
  });

  describe('error handling', () => {
    it('should handle database connection errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(couponService.getCouponById('coupon-123'))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle transaction errors with rollback', async () => {
      const couponData = {
        code: 'TEST',
        name: 'Test',
        type: 'percentage' as const,
        value: 10,
      };

      mockQuery.mockResolvedValueOnce([]);
      // @ts-expect-error Mock typing
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'BEGIN' }as any)
        .mockRejectedValueOnce(new Error('Insert failed'));

      await expect(couponService.createCoupon(couponData, 'admin-123'))
        .rejects.toThrow();

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('business logic validation', () => {
    it('should validate coupon expiry dates', async () => {
      const redeemData = {
        qrCode: 'QR-CODE-123',
        originalAmount: 1000,
      };

      // Mock transaction BEGIN
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'BEGIN' })
        // Mock redeem_coupon stored procedure returning failure for expired coupon
        .mockResolvedValueOnce({
          rows: [{
            success: false,
            message: 'Coupon has expired',
            discountAmount: null,
            finalAmount: null,
            userCouponId: null,
          }],
          command: 'SELECT',
        })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], command: 'COMMIT' });

      const result = await couponService.redeemCoupon(redeemData);

      // Stored procedure handles validation and returns failure
      expect(result.success).toBe(false);
      expect(result.message).toBe('Coupon has expired');
    });

    it('should validate usage limits', async () => {
      const redeemData = {
        qrCode: 'QR-CODE-123',
        originalAmount: 1000,
      };

      // Mock transaction BEGIN
      (mockClient.query as unknown as jest.Mock)
        .mockResolvedValueOnce({ rows: [], command: 'BEGIN' })
        // Mock redeem_coupon stored procedure returning failure for exhausted coupon
        .mockResolvedValueOnce({
          rows: [{
            success: false,
            message: 'Coupon usage limit reached',
            discountAmount: null,
            finalAmount: null,
            userCouponId: null,
          }],
          command: 'SELECT',
        })
        // Mock COMMIT
        .mockResolvedValueOnce({ rows: [], command: 'COMMIT' });

      const result = await couponService.redeemCoupon(redeemData);

      // Stored procedure handles validation and returns failure
      expect(result.success).toBe(false);
      expect(result.message).toBe('Coupon usage limit reached');
    });
  });
});
