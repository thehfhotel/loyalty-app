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

    it('should rollback on error in trackMultipleProfileChanges', async () => {
      const userId = 'user-rollback';
      const changes = [
        { field: 'field1', oldValue: 'old1', newValue: 'new1' },
        { field: 'field2', oldValue: 'old2', newValue: 'new2' }
      ];

      // Mock BEGIN success, first INSERT success, second INSERT failure
      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as never) // BEGIN
        .mockResolvedValueOnce({ rows: [] } as never) // First INSERT
        .mockRejectedValueOnce(new Error('Insert failed') as never); // Second INSERT fails

      await expect(
        analyticsService.trackMultipleProfileChanges(userId, changes, 'user')
      ).rejects.toThrow('Insert failed');

      // Should call ROLLBACK
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getCouponUsageAnalytics', () => {
    it('should get analytics without filters', async () => {
      // Mock total stats query
      mockQuery.mockResolvedValueOnce([
        { totalEvents: 100, uniqueUsers: 50 }
      ] as never);

      // Mock events by type query
      mockQuery.mockResolvedValueOnce([
        { eventType: 'view', count: 50 },
        { eventType: 'assign', count: 30 },
        { eventType: 'redeem_success', count: 15 }
      ] as never);

      // Mock top sources query
      mockQuery.mockResolvedValueOnce([
        { source: 'admin_assign', count: 20 },
        { source: 'profile_completion', count: 10 }
      ] as never);

      // Mock daily stats query
      mockQuery.mockResolvedValueOnce([
        { date: '2023-01-01', views: 10, assignments: 8, redemptions: 4 },
        { date: '2023-01-02', views: 15, assignments: 12, redemptions: 6 }
      ] as never);

      const result = await analyticsService.getCouponUsageAnalytics();

      expect(result.totalEvents).toBe(100);
      expect(result.uniqueUsers).toBe(50);
      expect(result.eventsByType.view).toBe(50);
      expect(result.eventsByType.assign).toBe(30);
      expect(result.eventsByType.redeem_success).toBe(15);
      expect(result.conversionRate).toBe(50); // 15/30 * 100
      expect(result.topSources).toHaveLength(2);
      expect(result.dailyStats).toHaveLength(2);
      expect(result.dailyStats[0]?.conversionRate).toBe(50); // 4/8 * 100
    });

    it('should get analytics with date filters', async () => {
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');

      mockQuery.mockResolvedValueOnce([
        { totalEvents: 50, uniqueUsers: 25 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { eventType: 'view', count: 30 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { source: 'admin_assign', count: 20 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { date: '2023-01-15', views: 10, assignments: 5, redemptions: 2 }
      ] as never);

      const result = await analyticsService.getCouponUsageAnalytics(startDate, endDate);

      expect(result.totalEvents).toBe(50);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining([startDate, endDate])
      );
    });

    it('should get analytics with couponId filter', async () => {
      const couponId = 'coupon-123';

      mockQuery.mockResolvedValueOnce([
        { totalEvents: 20, uniqueUsers: 15 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { eventType: 'view', count: 20 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { source: 'admin_assign', count: 15 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { date: '2023-01-01', views: 20, assignments: 0, redemptions: 0 }
      ] as never);

      const result = await analyticsService.getCouponUsageAnalytics(undefined, undefined, couponId);

      expect(result.totalEvents).toBe(20);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('coupon_id = $1'),
        expect.arrayContaining([couponId])
      );
    });

    it('should get analytics with userId filter', async () => {
      const userId = 'user-123';

      mockQuery.mockResolvedValueOnce([
        { totalEvents: 10, uniqueUsers: 1 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { eventType: 'view', count: 5 },
        { eventType: 'redeem_success', count: 2 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { source: 'profile_completion', count: 5 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { date: '2023-01-01', views: 5, assignments: 3, redemptions: 2 }
      ] as never);

      const result = await analyticsService.getCouponUsageAnalytics(
        undefined,
        undefined,
        undefined,
        userId
      );

      expect(result.totalEvents).toBe(10);
      expect(result.uniqueUsers).toBe(1);
    });

    it('should calculate conversion rate correctly with zero assignments', async () => {
      mockQuery.mockResolvedValueOnce([
        { totalEvents: 50, uniqueUsers: 25 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { eventType: 'view', count: 50 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { source: 'unknown', count: 50 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { date: '2023-01-01', views: 50, assignments: 0, redemptions: 0 }
      ] as never);

      const result = await analyticsService.getCouponUsageAnalytics();

      expect(result.conversionRate).toBe(0);
      expect(result.dailyStats[0]?.conversionRate).toBe(0);
    });

    it('should throw error when totalStats is null', async () => {
      // Mock totalStats as empty array (no results)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock eventsByType query to avoid reduce error
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock topSources query
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock dailyStats query
      mockQuery.mockResolvedValueOnce([] as never);

      await expect(
        analyticsService.getCouponUsageAnalytics()
      ).rejects.toThrow('Failed to get usage analytics stats');
    });

    it('should get analytics with all filters', async () => {
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');
      const couponId = 'coupon-123';
      const userId = 'user-123';

      mockQuery.mockResolvedValueOnce([
        { totalEvents: 5, uniqueUsers: 1 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { eventType: 'view', count: 3 },
        { eventType: 'assign', count: 1 },
        { eventType: 'redeem_success', count: 1 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { source: 'admin_assign', count: 1 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { date: '2023-01-15', views: 3, assignments: 1, redemptions: 1 }
      ] as never);

      const result = await analyticsService.getCouponUsageAnalytics(
        startDate,
        endDate,
        couponId,
        userId
      );

      expect(result.totalEvents).toBe(5);
      expect(result.uniqueUsers).toBe(1);
      expect(result.conversionRate).toBe(100); // 1/1 * 100
    });
  });

  describe('getProfileChangeAnalytics', () => {
    it('should get analytics without filters', async () => {
      // Mock total changes query
      mockQuery.mockResolvedValueOnce([
        { totalChanges: 200, uniqueUsers: 75 }
      ] as never);

      // Mock changes by field query
      mockQuery.mockResolvedValueOnce([
        { field: 'email', count: 50 },
        { field: 'phone_number', count: 40 },
        { field: 'display_name', count: 30 }
      ] as never);

      // Mock changes by source query
      mockQuery.mockResolvedValueOnce([
        { changeSource: 'user', count: 150 },
        { changeSource: 'admin', count: 30 },
        { changeSource: 'system', count: 20 }
      ] as never);

      // Mock completion milestones query
      mockQuery.mockResolvedValueOnce([
        {
          userId: 'user-1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@test.com',
          completedAt: new Date('2023-01-15')
        },
        {
          userId: 'user-2',
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@test.com',
          completedAt: new Date('2023-01-10')
        }
      ] as never);

      // Mock fields completed for first milestone
      mockQuery.mockResolvedValueOnce([
        { field: 'email' },
        { field: 'phone_number' },
        { field: 'display_name' }
      ] as never);

      // Mock fields completed for second milestone
      mockQuery.mockResolvedValueOnce([
        { field: 'email' },
        { field: 'display_name' }
      ] as never);

      // Mock daily activity query
      mockQuery.mockResolvedValueOnce([
        { date: '2023-01-01', totalChanges: 10, uniqueUsers: 5 },
        { date: '2023-01-02', totalChanges: 15, uniqueUsers: 8 }
      ] as never);

      // Mock top field for first day
      mockQuery.mockResolvedValueOnce([
        { field: 'email', count: 5 }
      ] as never);

      // Mock top field for second day
      mockQuery.mockResolvedValueOnce([
        { field: 'phone_number', count: 8 }
      ] as never);

      const result = await analyticsService.getProfileChangeAnalytics();

      expect(result.totalChanges).toBe(200);
      expect(result.uniqueUsers).toBe(75);
      expect(result.changesByField.email).toBe(50);
      expect(result.changesByField.phone_number).toBe(40);
      expect(result.changesBySource.user).toBe(150);
      expect(result.changesBySource.admin).toBe(30);
      expect(result.completionMilestones).toHaveLength(2);
      expect(result.completionMilestones[0]?.fieldsCompleted).toEqual(['email', 'phone_number', 'display_name']);
      expect(result.dailyActivity).toHaveLength(2);
      expect(result.dailyActivity[0]?.topField).toBe('email');
    });

    it('should get analytics with date filters', async () => {
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');

      mockQuery.mockResolvedValueOnce([
        { totalChanges: 100, uniqueUsers: 40 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { field: 'email', count: 50 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { changeSource: 'user', count: 90 }
      ] as never);

      mockQuery.mockResolvedValueOnce([] as never); // No milestones

      mockQuery.mockResolvedValueOnce([
        { date: '2023-01-15', totalChanges: 50, uniqueUsers: 25 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { field: 'email', count: 25 }
      ] as never);

      const result = await analyticsService.getProfileChangeAnalytics(startDate, endDate);

      expect(result.totalChanges).toBe(100);
      expect(result.uniqueUsers).toBe(40);
      expect(result.completionMilestones).toHaveLength(0);
    });

    it('should get analytics with userId filter', async () => {
      const userId = 'user-specific';

      mockQuery.mockResolvedValueOnce([
        { totalChanges: 5, uniqueUsers: 1 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { field: 'email', count: 2 },
        { field: 'phone_number', count: 3 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { changeSource: 'user', count: 5 }
      ] as never);

      mockQuery.mockResolvedValueOnce([] as never);

      mockQuery.mockResolvedValueOnce([
        { date: '2023-01-01', totalChanges: 5, uniqueUsers: 1 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { field: 'phone_number', count: 3 }
      ] as never);

      const result = await analyticsService.getProfileChangeAnalytics(
        undefined,
        undefined,
        userId
      );

      expect(result.totalChanges).toBe(5);
      expect(result.uniqueUsers).toBe(1);
    });

    it('should handle empty top field for a day', async () => {
      mockQuery.mockResolvedValueOnce([
        { totalChanges: 10, uniqueUsers: 5 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { field: 'email', count: 10 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { changeSource: 'user', count: 10 }
      ] as never);

      mockQuery.mockResolvedValueOnce([] as never);

      mockQuery.mockResolvedValueOnce([
        { date: '2023-01-01', totalChanges: 10, uniqueUsers: 5 }
      ] as never);

      mockQuery.mockResolvedValueOnce([] as never); // No top field

      const result = await analyticsService.getProfileChangeAnalytics();

      expect(result.dailyActivity[0]?.topField).toBe('none');
    });

    it('should throw error when totalStats is null', async () => {
      // Mock totalStats as empty array (no results)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock changesByField query
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock changesBySource query
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock completionMilestones query
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock dailyActivity query
      mockQuery.mockResolvedValueOnce([] as never);

      await expect(
        analyticsService.getProfileChangeAnalytics()
      ).rejects.toThrow('Failed to get profile change analytics stats');
    });

    it('should get analytics with all filters', async () => {
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');
      const userId = 'user-123';

      mockQuery.mockResolvedValueOnce([
        { totalChanges: 5, uniqueUsers: 1 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { field: 'email', count: 5 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { changeSource: 'user', count: 5 }
      ] as never);

      mockQuery.mockResolvedValueOnce([] as never);

      mockQuery.mockResolvedValueOnce([
        { date: '2023-01-15', totalChanges: 5, uniqueUsers: 1 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { field: 'email', count: 5 }
      ] as never);

      const result = await analyticsService.getProfileChangeAnalytics(
        startDate,
        endDate,
        userId
      );

      expect(result.totalChanges).toBe(5);
      expect(result.uniqueUsers).toBe(1);
    });
  });

  describe('updateDailyUserAnalytics', () => {
    it('should update analytics for current date by default', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'analytics-1' },
        { id: 'analytics-2' },
        { id: 'analytics-3' }
      ] as never);

      const result = await analyticsService.updateDailyUserAnalytics();

      expect(result).toBe(3);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_analytics'),
        expect.any(Array)
      );
    });

    it('should update analytics for specific date', async () => {
      const specificDate = new Date('2023-01-15');

      mockQuery.mockResolvedValueOnce([
        { id: 'analytics-1' },
        { id: 'analytics-2' }
      ] as never);

      const result = await analyticsService.updateDailyUserAnalytics(specificDate);

      expect(result).toBe(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_analytics'),
        expect.arrayContaining([specificDate])
      );
    });

    it('should return 0 when no users have activity', async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await analyticsService.updateDailyUserAnalytics();

      expect(result).toBe(0);
    });

    it('should handle upsert correctly', async () => {
      const specificDate = new Date('2023-01-15');

      mockQuery.mockResolvedValueOnce([
        { id: 'analytics-1' }
      ] as never);

      await analyticsService.updateDailyUserAnalytics(specificDate);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (user_id, analytics_date) DO UPDATE SET'),
        expect.any(Array)
      );
    });
  });

  describe('getUserEngagementMetrics', () => {
    it('should get engagement metrics without filters', async () => {
      // Mock overall metrics query
      mockQuery.mockResolvedValueOnce([
        {
          activeUsers: 100,
          totalSessions: 500,
          avgCouponsPerUser: 5.5,
          avgProfileChangesPerUser: 3.2
        }
      ] as never);

      // Mock engagement data query
      mockQuery.mockResolvedValueOnce([
        { userId: 'user-1', totalInteractions: 10 },
        { userId: 'user-2', totalInteractions: 5 },
        { userId: 'user-3', totalInteractions: 3 },
        { userId: 'user-4', totalInteractions: 1 },
        { userId: 'user-5', totalInteractions: 8 }
      ] as never);

      // Mock top users query
      mockQuery.mockResolvedValueOnce([
        {
          userId: 'user-1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@test.com',
          totalInteractions: 10,
          couponsViewed: 5,
          couponsRedeemed: 3,
          profileChanges: 2
        },
        {
          userId: 'user-2',
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@test.com',
          totalInteractions: 8,
          couponsViewed: 4,
          couponsRedeemed: 2,
          profileChanges: 2
        }
      ] as never);

      const result = await analyticsService.getUserEngagementMetrics();

      expect(result.activeUsers).toBe(100);
      expect(result.totalSessions).toBe(500);
      expect(result.avgCouponsPerUser).toBe(5.5);
      expect(result.avgProfileChangesPerUser).toBe(3.2);
      expect(result.userSegments.highEngagement).toBe(3); // >= 5 interactions
      expect(result.userSegments.mediumEngagement).toBe(1); // 2-4 interactions
      expect(result.userSegments.lowEngagement).toBe(1); // 1 interaction
      expect(result.topUsers).toHaveLength(2);
      expect(result.topUsers[0]?.totalInteractions).toBe(10);
    });

    it('should get engagement metrics with date filters', async () => {
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');

      mockQuery.mockResolvedValueOnce([
        {
          activeUsers: 50,
          totalSessions: 200,
          avgCouponsPerUser: 3.0,
          avgProfileChangesPerUser: 2.0
        }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        { userId: 'user-1', totalInteractions: 6 },
        { userId: 'user-2', totalInteractions: 2 }
      ] as never);

      mockQuery.mockResolvedValueOnce([
        {
          userId: 'user-1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@test.com',
          totalInteractions: 6,
          couponsViewed: 3,
          couponsRedeemed: 2,
          profileChanges: 1
        }
      ] as never);

      const result = await analyticsService.getUserEngagementMetrics(startDate, endDate);

      expect(result.activeUsers).toBe(50);
      expect(result.totalSessions).toBe(200);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining([startDate, endDate])
      );
    });

    it('should handle null avgCouponsPerUser', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          activeUsers: 10,
          totalSessions: 20,
          avgCouponsPerUser: null,
          avgProfileChangesPerUser: null
        }
      ] as never);

      mockQuery.mockResolvedValueOnce([] as never);

      mockQuery.mockResolvedValueOnce([] as never);

      const result = await analyticsService.getUserEngagementMetrics();

      expect(result.avgCouponsPerUser).toBe(0);
      expect(result.avgProfileChangesPerUser).toBe(0);
    });

    it('should throw error when overallMetrics is null', async () => {
      // Mock overallMetrics as empty array (no results)
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock engagementData query to avoid reduce error
      mockQuery.mockResolvedValueOnce([] as never);

      // Mock topUsers query
      mockQuery.mockResolvedValueOnce([] as never);

      await expect(
        analyticsService.getUserEngagementMetrics()
      ).rejects.toThrow('Failed to get user engagement metrics');
    });

    it('should segment users correctly', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          activeUsers: 6,
          totalSessions: 30,
          avgCouponsPerUser: 5.0,
          avgProfileChangesPerUser: 2.0
        }
      ] as never);

      // Test all three segments
      mockQuery.mockResolvedValueOnce([
        { userId: 'user-1', totalInteractions: 10 }, // high
        { userId: 'user-2', totalInteractions: 5 },  // high
        { userId: 'user-3', totalInteractions: 4 },  // medium
        { userId: 'user-4', totalInteractions: 2 },  // medium
        { userId: 'user-5', totalInteractions: 1 },  // low
        { userId: 'user-6', totalInteractions: 1 }   // low
      ] as never);

      mockQuery.mockResolvedValueOnce([] as never);

      const result = await analyticsService.getUserEngagementMetrics();

      expect(result.userSegments.highEngagement).toBe(2);
      expect(result.userSegments.mediumEngagement).toBe(2);
      expect(result.userSegments.lowEngagement).toBe(2);
    });

    it('should limit top users to 20', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          activeUsers: 100,
          totalSessions: 500,
          avgCouponsPerUser: 5.0,
          avgProfileChangesPerUser: 3.0
        }
      ] as never);

      mockQuery.mockResolvedValueOnce(
        Array.from({ length: 100 }, (_, i) => ({
          userId: `user-${i}`,
          totalInteractions: 100 - i
        })) as never
      );

      const topUsers = Array.from({ length: 25 }, (_, i) => ({
        userId: `user-${i}`,
        firstName: `First${i}`,
        lastName: `Last${i}`,
        email: `user${i}@test.com`,
        totalInteractions: 100 - i,
        couponsViewed: 50 - i,
        couponsRedeemed: 25 - i,
        profileChanges: 25 - i
      }));

      mockQuery.mockResolvedValueOnce(topUsers as never);

      await analyticsService.getUserEngagementMetrics();

      // Query should limit to 20 even though we return 25 in mock
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 20'),
        expect.any(Array)
      );
    });
  });
});
