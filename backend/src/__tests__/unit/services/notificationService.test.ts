// ESLint suppressed for mock type assertions conflicting with strict mode
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotificationService } from '../../../services/notificationService';
import { AppError } from '../../../middleware/errorHandler';
import * as database from '../../../config/database';

// Mock dependencies
jest.mock('../../../config/database');
jest.mock('../../../utils/logger');

describe('NotificationService', () => {
  let notificationService: NotificationService;
  let mockQuery: jest.MockedFunction<typeof database.query>;
  let mockQueryWithMeta: jest.MockedFunction<typeof database.queryWithMeta>;

  beforeEach(() => {
    jest.clearAllMocks();
    notificationService = new NotificationService();
    mockQuery = database.query as jest.MockedFunction<typeof database.query>;
    mockQueryWithMeta = database.queryWithMeta as jest.MockedFunction<typeof database.queryWithMeta>;
    mockQuery.mockResolvedValue([] as never);
    mockQueryWithMeta.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('createNotification', () => {
    it('should create a new notification successfully', async () => {
      const notificationData = {
        userId: 'user-123',
        title: 'Welcome!',
        message: 'Thank you for joining our loyalty program',
        type: 'general' as const,
      };

      const createdNotification = {
        id: 'notif-123',
        userId: 'user-123',
        title: 'Welcome!',
        message: 'Thank you for joining our loyalty program',
        type: 'general',
        data: null,
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };

      mockQuery.mockResolvedValueOnce([createdNotification] as never);

      const result = await notificationService.createNotification(notificationData as never);

      expect(result).toEqual(createdNotification);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        expect.arrayContaining([
          notificationData.userId,
          notificationData.title,
          notificationData.message,
          notificationData.type,
        ] as never)
      );
    });

    it('should create notification with data and expiry', async () => {
      const expiresAt = new Date('2024-12-31');
      const notificationData = {
        userId: 'user-123',
        title: 'Coupon Available',
        message: 'You have a new coupon',
        type: 'coupon' as const,
        data: { couponId: 'coupon-123', code: 'SAVE20' },
        expiresAt,
      };

      const createdNotification = {
        id: 'notif-456',
        ...notificationData,
        data: { couponId: 'coupon-123', code: 'SAVE20' },
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockQuery.mockResolvedValueOnce([createdNotification] as never);

      const result = await notificationService.createNotification(notificationData as never);

      expect(result.type).toBe('coupon');
      expect(result.data).toEqual(notificationData.data);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          notificationData.userId,
          notificationData.title,
          notificationData.message,
          notificationData.type,
          JSON.stringify(notificationData.data),
          expiresAt,
        ] as never)
      );
    });

    it('should throw error if notification creation fails', async () => {
      const notificationData = {
        userId: 'user-123',
        title: 'Test',
        message: 'Test message',
        type: 'general' as const,
      };

      mockQuery.mockResolvedValueOnce([] as never);

      await expect(notificationService.createNotification(notificationData as never))
        .rejects.toThrow(AppError);
      await expect(notificationService.createNotification(notificationData as never))
        .rejects.toMatchObject({
          statusCode: 500,
          message: 'Failed to create notification',
        });
    });
  });

  describe('getUserNotifications', () => {
    it('should get user notifications with pagination', async () => {
      const mockNotifications = [
        {
          id: 'notif-1',
          userId: 'user-123',
          title: 'Welcome',
          message: 'Welcome message',
          type: 'general',
          data: null,
          readAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
        },
        {
          id: 'notif-2',
          userId: 'user-123',
          title: 'Points Earned',
          message: 'You earned 100 points',
          type: 'points',
          data: { points: 100 },
          readAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
        },
      ];

      mockQuery
        .mockResolvedValueOnce([{ total: '10', unread: '3' }] as never) // Count query
        .mockResolvedValueOnce(mockNotifications); // Notifications query

      const result = await notificationService.getUserNotifications('user-123', 1, 20);

      expect(result.total).toBe(10);
      expect(result.unread).toBe(3);
      expect(result.notifications).toEqual(mockNotifications);
      expect(result.notifications).toHaveLength(2);
    });

    it('should filter unread notifications only', async () => {
      mockQuery
        .mockResolvedValueOnce([{ total: '5', unread: '5' }] as never)
        .mockResolvedValueOnce([] as never);

      await notificationService.getUserNotifications('user-123', 1, 20, false);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('read_at IS NULL'),
        expect.any(Array)
      );
    });

    it('should return empty result if no notifications', async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await notificationService.getUserNotifications('user-123');

      expect(result.total).toBe(0);
      expect(result.unread).toBe(0);
      expect(result.notifications).toEqual([] as never);
    });

    it('should handle pagination correctly', async () => {
      mockQuery
        .mockResolvedValueOnce([{ total: '50', unread: '10' }] as never)
        .mockResolvedValueOnce([] as never);

      await notificationService.getUserNotifications('user-123', 2, 10);

      // Should use offset of 10 for page 2
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining(['user-123', 10, 10] as never)
      );
    });
  });

  describe('getUnreadCount', () => {
    it('should get unread notification count', async () => {
      mockQuery.mockResolvedValueOnce([{ count: '5' }] as never);

      const result = await notificationService.getUnreadCount('user-123');

      expect(result).toBe(5);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('get_unread_notification_count'),
        ['user-123']
      );
    });

    it('should return 0 if no result', async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await notificationService.getUnreadCount('user-123');

      expect(result).toBe(0);
    });
  });

  describe('markNotificationsRead', () => {
    it('should mark specific notifications as read', async () => {
      const notificationIds = ['notif-1', 'notif-2', 'notif-3'];

      mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 3 });

      const result = await notificationService.markNotificationsRead('user-123', notificationIds);

      expect(result).toBe(3);
      expect(mockQueryWithMeta).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE notifications'),
        expect.arrayContaining(['user-123', ...notificationIds] as never)
      );
    });

    it('should return 0 if no notifications provided', async () => {
      const result = await notificationService.markNotificationsRead('user-123', [] as never);

      expect(result).toBe(0);
      expect(mockQueryWithMeta).not.toHaveBeenCalled();
    });

    it('should handle empty update result', async () => {
      mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await notificationService.markNotificationsRead('user-123', ['notif-1'] as never);

      expect(result).toBe(0);
    });
  });

  describe('markAllNotificationsRead', () => {
    it('should mark all notifications as read', async () => {
      mockQuery.mockResolvedValueOnce([{ count: '10' }] as never);

      const result = await notificationService.markAllNotificationsRead('user-123');

      expect(result).toBe(10);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('mark_all_notifications_read'),
        ['user-123']
      );
    });

    it('should return 0 if no notifications marked', async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await notificationService.markAllNotificationsRead('user-123');

      expect(result).toBe(0);
    });
  });

  describe('deleteNotification', () => {
    it('should delete notification successfully', async () => {
      mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await notificationService.deleteNotification('user-123', 'notif-1');

      expect(result).toBe(true);
      expect(mockQueryWithMeta).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM notifications'),
        ['notif-1', 'user-123']  // notificationId first, then userId
      );
    });

    it('should return false if notification not found', async () => {
      mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await notificationService.deleteNotification('user-123', 'notif-1');

      expect(result).toBe(false);
    });
  });

  describe('cleanupExpiredNotifications', () => {
    it('should cleanup expired notifications', async () => {
      mockQuery.mockResolvedValueOnce([{ count: '15' }] as never);

      const result = await notificationService.cleanupExpiredNotifications();

      expect(result).toBe(15);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('cleanup_expired_notifications')
      );
    });

    it('should return 0 if no expired notifications', async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await notificationService.cleanupExpiredNotifications();

      expect(result).toBe(0);
    });
  });

  describe('getUserPreferences', () => {
    it('should get user notification preferences', async () => {
      const mockPreferences = [
        {
          userId: 'user-123',
          notificationType: 'points',
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          userId: 'user-123',
          notificationType: 'coupon',
          enabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockQuery.mockResolvedValueOnce(mockPreferences);

      const result = await notificationService.getUserPreferences('user-123');

      expect(result).toEqual(mockPreferences);
      expect(result).toHaveLength(2);
    });

    it('should return empty array if no preferences', async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await notificationService.getUserPreferences('user-123');

      expect(result).toEqual([] as never);
    });
  });

  describe('updateUserPreferences', () => {
    it('should update user preferences successfully', async () => {
      const preferences = [
        { type: 'points', enabled: true },
        { type: 'coupon', enabled: false },
        { type: 'general', enabled: true },
      ];

      mockQuery
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([] as never);  // Final getUserPreferences call

      await notificationService.updateUserPreferences('user-123', preferences);

      // Should call once for each preference
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notification_preferences'),
        expect.any(Array)
      );
    });

    it('should handle empty preferences array', async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      await notificationService.updateUserPreferences('user-123', [] as never);

      // Only getUserPreferences should be called
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('createProfileCompletionNotification', () => {
    it('should create profile completion notification with points', async () => {
      const mockNotification = {
        id: 'notif-profile',
        userId: 'user-123',
        title: expect.stringContaining('Profile Completed'),
        message: expect.stringContaining('100'),
        type: 'reward',
        data: { pointsAwarded: 100 },
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: expect.any(Date),
      };

      mockQuery.mockResolvedValueOnce([mockNotification] as never);

      const result = await notificationService.createProfileCompletionNotification('user-123', false, undefined, 100);

      expect(result.type).toBe('reward');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        expect.arrayContaining(['user-123', expect.any(String), expect.any(String), 'reward'] as never)
      );
    });
  });

  describe('createCouponNotification', () => {
    it('should create coupon notification', async () => {
      const mockCoupon = {
        id: 'coupon-123',
        code: 'SAVE20',
        name: '20% Off',
        type: 'percentage',
        value: 20,
      };

      const mockNotification = {
        id: 'notif-coupon',
        userId: 'user-123',
        title: 'New Coupon Available!',
        message: expect.any(String),
        type: 'coupon',
        data: { couponId: mockCoupon.id, code: mockCoupon.code },
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };

      mockQuery.mockResolvedValueOnce([mockNotification] as never);

      const result = await notificationService.createCouponNotification('user-123', mockCoupon as never);

      expect(result).toEqual(mockNotification);
      expect(result.type).toBe('coupon');
    });
  });

  describe('createPointsNotification', () => {
    it('should create points notification', async () => {
      const mockNotification = {
        id: 'notif-points',
        userId: 'user-123',
        title: 'Points Earned!',
        message: 'You earned 500 loyalty points',
        type: 'points',
        data: { points: 500, reason: 'Purchase' },
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };

      mockQuery.mockResolvedValueOnce([mockNotification] as never);

      const result = await notificationService.createPointsNotification('user-123', 500, 'Purchase');

      expect(result).toEqual(mockNotification);
      expect(result.type).toBe('points');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        expect.any(Array)
      );
    });
  });

  describe('createBulkNotifications', () => {
    it('should create multiple notifications at once', async () => {
      const notifications = [
        {
          userId: 'user-1',
          title: 'Test 1',
          message: 'Message 1',
          type: 'general' as const,
        },
        {
          userId: 'user-2',
          title: 'Test 2',
          message: 'Message 2',
          type: 'general' as const,
        },
        {
          userId: 'user-3',
          title: 'Test 3',
          message: 'Message 3',
          type: 'general' as const,
        },
      ];

      mockQueryWithMeta.mockResolvedValueOnce({ rows: [], rowCount: 3 });

      const result = await notificationService.createBulkNotifications(notifications as never);

      expect(result).toBe(3);
      expect(mockQueryWithMeta).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        expect.any(Array)
      );
    });

    it('should return 0 if no notifications provided', async () => {
      const result = await notificationService.createBulkNotifications([] as never);

      expect(result).toBe(0);
      expect(mockQueryWithMeta).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle database connection errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database connection failed') as never);

      await expect(notificationService.getUserNotifications('user-123'))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle invalid user ID gracefully', async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await notificationService.getUserNotifications('invalid-user');

      expect(result.total).toBe(0);
      expect(result.notifications).toEqual([] as never);
    });
  });

  describe('notification types', () => {
    it('should support different notification types', async () => {
      const types = ['general', 'reward', 'coupon'] as const;

      for (const type of types) {
        const notificationData = {
          userId: 'user-123',
          title: `${type} notification`,
          message: `Test ${type} message`,
          type,
        };

        mockQuery.mockResolvedValueOnce([{
          id: `notif-${type}`,
          ...notificationData,
          data: null,
          readAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
        }] as never);

        const result = await notificationService.createNotification(notificationData as never);
        expect(result.type).toBe(type);
      }
    });
  });
});
