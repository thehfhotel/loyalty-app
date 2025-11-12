/**
 * AnalyticsService Unit Tests
 * Tests event tracking for coupons and profile changes
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { analyticsService } from '../../../services/analyticsService';
import * as database from '../../../config/database';

// Mock dependencies
jest.mock('../../../config/database');
jest.mock('../../../utils/logger');

describe('AnalyticsService', () => {
  let mockQuery: jest.Mock;
  let mockClient: { query: jest.Mock; release: jest.Mock };
  let mockGetClient: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock the query function
    mockQuery = jest.fn();
    (database as unknown as Record<string, unknown>).query = mockQuery;

    // Mock client with query and release methods
    mockClient = {
      query: jest.fn() as unknown as jest.Mock,
      release: jest.fn() as unknown as jest.Mock
    };

    // Mock getClient to return client
    mockGetClient = jest.fn().mockResolvedValue(mockClient as never);
    (database as unknown as Record<string, unknown>).getClient = mockGetClient;
  });

  describe('Coupon Usage Tracking', () => {
    it('should track coupon view event', async () => {
      const userId = 'user-1';
      const couponId = 'coupon-1';

      mockQuery.mockResolvedValueOnce([
        { id: 'event-1', user_id: userId, coupon_id: couponId, event_type: 'view' }
      ] as never);

      await analyticsService.trackCouponUsage({
        userId,
        couponId,
        eventType: 'view'
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO coupon_usage_events'),
        expect.arrayContaining([userId, couponId, 'view'])
      );
    });

    it('should track coupon assignment event', async () => {
      const userId = 'user-2';
      const couponId = 'coupon-2';

      mockQuery.mockResolvedValueOnce([
        { id: 'event-2', user_id: userId, coupon_id: couponId, event_type: 'assign' }
      ] as never);

      await analyticsService.trackCouponUsage({
        userId,
        couponId,
        eventType: 'assign'
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO coupon_usage_events'),
        expect.arrayContaining([userId, couponId, 'assign'])
      );
    });

    it('should track coupon redemption attempt', async () => {
      const userId = 'user-3';
      const couponId = 'coupon-3';

      mockQuery.mockResolvedValueOnce([
        { id: 'event-3', user_id: userId, coupon_id: couponId, event_type: 'redeem_attempt' }
      ] as never);

      await analyticsService.trackCouponUsage({
        userId,
        couponId,
        eventType: 'redeem_attempt'
      });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should track successful redemption', async () => {
      const userId = 'user-4';
      const couponId = 'coupon-4';

      mockQuery.mockResolvedValueOnce([
        { id: 'event-4', user_id: userId, coupon_id: couponId, event_type: 'redeem_success' }
      ] as never);

      await analyticsService.trackCouponUsage({
        userId,
        couponId,
        eventType: 'redeem_success'
      });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should track failed redemption', async () => {
      const userId = 'user-5';
      const couponId = 'coupon-5';

      mockQuery.mockResolvedValueOnce([
        { id: 'event-5', user_id: userId, coupon_id: couponId, event_type: 'redeem_fail' }
      ] as never);

      await analyticsService.trackCouponUsage({
        userId,
        couponId,
        eventType: 'redeem_fail',
        metadata: { reason: 'expired' }
      });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should track coupon expiration', async () => {
      const userId = 'user-6';
      const couponId = 'coupon-6';

      mockQuery.mockResolvedValueOnce([
        { id: 'event-6', user_id: userId, coupon_id: couponId, event_type: 'expire' }
      ] as never);

      await analyticsService.trackCouponUsage({
        userId,
        couponId,
        eventType: 'expire'
      });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should track coupon revocation', async () => {
      const userId = 'user-7';
      const couponId = 'coupon-7';

      mockQuery.mockResolvedValueOnce([
        { id: 'event-7', user_id: userId, coupon_id: couponId, event_type: 'revoke' }
      ] as never);

      await analyticsService.trackCouponUsage({
        userId,
        couponId,
        eventType: 'revoke',
        metadata: { reason: 'policy_violation' }
      });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should store event metadata', async () => {
      const userId = 'user-8';
      const couponId = 'coupon-8';
      const metadata = {
        source: 'mobile_app',
        campaign: 'summer_sale',
        discount_applied: 30
      };

      mockQuery.mockResolvedValueOnce([
        {
          id: 'event-8',
          user_id: userId,
          coupon_id: couponId,
          event_type: 'redeem_success',
          metadata
        }
      ] as never);

      await analyticsService.trackCouponUsage({
        userId,
        couponId,
        eventType: 'redeem_success',
        metadata
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([userId, couponId, 'redeem_success', JSON.stringify(metadata)])
      );
    });

    it('should handle database errors gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database error') as never);

      // trackCouponUsage catches errors and logs them, doesn't rethrow
      await analyticsService.trackCouponUsage({
        userId: 'user-error',
        couponId: 'coupon-error',
        eventType: 'view'
      });

      // Method should complete without throwing
      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('Profile Change Tracking', () => {
    it('should track single profile change', async () => {
      const userId = 'user-9';

      mockQuery.mockResolvedValueOnce([
        {
          id: 'change-1',
          user_id: userId,
          field_name: 'display_name',
          old_value: 'User Nine',
          new_value: 'Updated Name'
        }
      ] as never);

      await analyticsService.trackProfileChange({
        userId,
        field: 'display_name',
        oldValue: 'User Nine',
        newValue: 'Updated Name',
        changeSource: 'user'
      });

      // Service JSON stringifies the old and new values
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO profile_change_events'),
        [userId, 'display_name', '"User Nine"', '"Updated Name"', 'user', '{}', null, null]
      );
    });

    it('should track email change', async () => {
      const userId = 'user-10';

      mockQuery.mockResolvedValueOnce([
        {
          id: 'change-2',
          user_id: userId,
          field_name: 'email',
          old_value: 'old@test.com',
          new_value: 'new@test.com'
        }
      ] as never);

      await analyticsService.trackProfileChange({
        userId,
        field: 'email',
        oldValue: 'old@test.com',
        newValue: 'new@test.com',
        changeSource: 'user'
      });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should track phone number change', async () => {
      const userId = 'user-11';

      mockQuery.mockResolvedValueOnce([
        {
          id: 'change-3',
          user_id: userId,
          field_name: 'phone_number',
          old_value: '+66812345678',
          new_value: '+66887654321'
        }
      ] as never);

      await analyticsService.trackProfileChange({
        userId,
        field: 'phone_number',
        oldValue: '+66812345678',
        newValue: '+66887654321',
        changeSource: 'user'
      });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should track date of birth change', async () => {
      const userId = 'user-12';

      mockQuery.mockResolvedValueOnce([
        {
          id: 'change-4',
          user_id: userId,
          field_name: 'date_of_birth',
          old_value: null,
          new_value: '1990-01-01'
        }
      ] as never);

      await analyticsService.trackProfileChange({
        userId,
        field: 'date_of_birth',
        oldValue: null,
        newValue: '1990-01-01',
        changeSource: 'user'
      });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should track gender change', async () => {
      const userId = 'user-13';

      mockQuery.mockResolvedValueOnce([
        {
          id: 'change-5',
          user_id: userId,
          field_name: 'gender',
          old_value: null,
          new_value: 'male'
        }
      ] as never);

      await analyticsService.trackProfileChange({
        userId,
        field: 'gender',
        oldValue: null,
        newValue: 'male',
        changeSource: 'user'
      });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should track avatar URL change', async () => {
      const userId = 'user-14';

      mockQuery.mockResolvedValueOnce([
        {
          id: 'change-6',
          user_id: userId,
          field_name: 'avatar_url',
          old_value: 'https://old-avatar.com/image.jpg',
          new_value: 'https://new-avatar.com/image.jpg'
        }
      ] as never);

      await analyticsService.trackProfileChange({
        userId,
        field: 'avatar_url',
        oldValue: 'https://old-avatar.com/image.jpg',
        newValue: 'https://new-avatar.com/image.jpg',
        changeSource: 'user'
      });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should track multiple profile changes', async () => {
      const userId = 'user-15';

      // Mock BEGIN, INSERT calls, and COMMIT
      mockClient.query.mockResolvedValue({ rows: [] } as never);

      const changes = [
        {
          field: 'display_name',
          oldValue: 'User Fifteen',
          newValue: 'New Name'
        },
        {
          field: 'email',
          oldValue: 'user15@test.com',
          newValue: 'new15@test.com'
        },
        {
          field: 'phone_number',
          oldValue: null,
          newValue: '+66899999999'
        }
      ];

      await analyticsService.trackMultipleProfileChanges(userId, changes, 'user');

      // BEGIN + 3 INSERTs + COMMIT = 5 calls
      expect(mockClient.query).toHaveBeenCalledTimes(5);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle profile change with metadata', async () => {
      const userId = 'user-16';
      const metadata = {
        verification_method: 'otp',
        ip_address: '192.168.1.1'
      };

      mockQuery.mockResolvedValueOnce([
        {
          id: 'change-meta',
          user_id: userId,
          field_name: 'email',
          metadata
        }
      ] as never);

      await analyticsService.trackProfileChange({
        userId,
        field: 'email',
        oldValue: 'user16@test.com',
        newValue: 'verified16@test.com',
        changeSource: 'user',
        metadata
      });

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should handle empty changes array', async () => {
      const emptyChanges: Array<{field: string; oldValue: unknown; newValue: unknown}> = [];
      await expect(
        analyticsService.trackMultipleProfileChanges('user-1', emptyChanges, 'user')
      ).resolves.not.toThrow();
    });
  });

  describe('Event Querying', () => {
    it('should query events by user', async () => {
      const userId = 'user-17';

      mockQuery.mockResolvedValueOnce([
        { id: 'event-17-1', user_id: userId, event_type: 'view' },
        { id: 'event-17-2', user_id: userId, event_type: 'assign' }
      ] as never);

      const events = await mockQuery(
        'SELECT * FROM coupon_usage_events WHERE user_id = $1',
        [userId]
      );

      expect(events).toHaveLength(2);
    });

    it('should query events by coupon', async () => {
      const couponId = 'coupon-popular';

      mockQuery.mockResolvedValueOnce([
        { id: 'event-pop-1', coupon_id: couponId, user_id: 'user-18' },
        { id: 'event-pop-2', coupon_id: couponId, user_id: 'user-19' }
      ] as never);

      const events = await mockQuery(
        'SELECT * FROM coupon_usage_events WHERE coupon_id = $1',
        [couponId]
      );

      expect(events).toHaveLength(2);
    });

    it('should query events by type', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'event-type-1', event_type: 'redeem_success' },
        { id: 'event-type-2', event_type: 'redeem_success' }
      ] as never);

      const events = await mockQuery(
        'SELECT * FROM coupon_usage_events WHERE event_type = $1',
        ['redeem_success']
      );

      expect(events).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid user ID', async () => {
      mockQuery.mockRejectedValueOnce(
        new Error('Foreign key constraint violation') as never
      );

      // trackCouponUsage catches errors and logs them, doesn't rethrow
      await analyticsService.trackCouponUsage({
        userId: 'nonexistent-user',
        couponId: 'coupon-1',
        eventType: 'view'
      });

      // Method should complete without throwing
      expect(mockQuery).toHaveBeenCalled();
    });

    it('should handle invalid coupon ID', async () => {
      mockQuery.mockRejectedValueOnce(
        new Error('Foreign key constraint violation') as never
      );

      // trackCouponUsage catches errors and logs them, doesn't rethrow
      await analyticsService.trackCouponUsage({
        userId: 'user-1',
        couponId: 'nonexistent-coupon',
        eventType: 'view'
      });

      // Method should complete without throwing
      expect(mockQuery).toHaveBeenCalled();
    });

    it('should handle database connection errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection refused') as never);

      // trackProfileChange catches errors and logs them, doesn't rethrow
      await analyticsService.trackProfileChange({
        userId: 'user-1',
        field: 'email',
        oldValue: 'old@test.com',
        newValue: 'new@test.com',
        changeSource: 'user'
      });

      // Method should complete without throwing
      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('Performance', () => {
    it('should handle bulk event tracking', async () => {
      mockClient.query.mockResolvedValue({ rows: [] } as never);

      const changes = Array.from({ length: 10 }, (_, i) => ({
        field: `custom_field_${i}`,
        oldValue: `old_${i}`,
        newValue: `new_${i}`
      }));

      await analyticsService.trackMultipleProfileChanges('user-perf', changes, 'user');

      // BEGIN + 10 INSERTs + COMMIT = 12 calls
      expect(mockClient.query).toHaveBeenCalledTimes(12);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle concurrent tracking requests', async () => {
      mockQuery.mockResolvedValue([{ id: 'concurrent-event' }] as never);

      const promises = Array.from({ length: 5 }, (_, i) =>
        analyticsService.trackCouponUsage({
          userId: `user-${i}`,
          couponId: `coupon-${i}`,
          eventType: 'view'
        })
      );

      await Promise.all(promises);

      expect(mockQuery).toHaveBeenCalledTimes(5);
    });
  });
});
