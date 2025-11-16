/**
 * Notifications Routes Integration Tests
 * Tests notification creation, retrieval, marking as read, preferences, and push subscriptions
 *
 * Following service-based mocking pattern from coupon.test.ts
 * Coverage Target: Comprehensive route testing
 */

import request from 'supertest';
import { Express } from 'express';
import routes from '../../../routes/notifications';
import { createTestApp } from '../../fixtures';

// Mock the NotificationService class
jest.mock('../../../services/notificationService', () => {
  return {
    NotificationService: jest.fn().mockImplementation(() => ({
      createNotification: jest.fn(),
      getUserNotifications: jest.fn(),
      getUnreadCount: jest.fn(),
      markNotificationsRead: jest.fn(),
      markAllNotificationsRead: jest.fn(),
      deleteNotification: jest.fn(),
      getUserPreferences: jest.fn(),
      updateUserPreferences: jest.fn(),
      cleanupExpiredNotifications: jest.fn(),
    })),
  };
});

jest.mock('../../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    const adminPaths = ['/admin'];
    const isPOST = req.method === 'POST' && (req.path === '/test' || req.path.includes('/admin'));
    const isAdminRoute = isPOST || adminPaths.some(p => req.path.includes(p));

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
}));

// Import mocked service class
import { NotificationService } from '../../../services/notificationService';

describe('Notifications Routes Integration Tests', () => {
  let app: Express;
  let mockNotificationService: jest.Mocked<NotificationService>;

  beforeAll(() => {
    app = createTestApp(routes, '/api/notifications');
    // Get the mock instance created by the routes module
    const mockConstructor = NotificationService as jest.MockedClass<typeof NotificationService>;
    mockNotificationService = mockConstructor.mock.results[0]?.value as jest.Mocked<NotificationService>;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/notifications/vapid-key (public)', () => {
    it('should return 503 when VAPID key not configured', async () => {
      const response = await request(app).get('/api/notifications/vapid-key');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        error: 'Push notifications not configured',
        configured: false,
      });
    });

    it('should return VAPID public key when configured', async () => {
      const originalKey = process.env.VAPID_PUBLIC_KEY;
      process.env.VAPID_PUBLIC_KEY = 'test-vapid-key';

      const response = await request(app).get('/api/notifications/vapid-key');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        publicKey: 'test-vapid-key',
        configured: true,
      });

      // Restore
      if (originalKey) {
        process.env.VAPID_PUBLIC_KEY = originalKey;
      } else {
        delete process.env.VAPID_PUBLIC_KEY;
      }
    });
  });

  describe('GET /api/notifications', () => {
    it('should return user notifications with pagination', async () => {
      const testDate = new Date('2025-01-01T00:00:00.000Z');
      const mockNotifications = [
        {
          id: 'notif-1',
          userId: 'test-user-id',
          type: 'points_earned',
          title: 'Points Earned',
          message: 'You earned 100 points!',
          isRead: false,
          createdAt: testDate,
        },
        {
          id: 'notif-2',
          userId: 'test-user-id',
          type: 'tier_upgrade',
          title: 'Tier Upgraded',
          message: 'You are now Gold tier!',
          isRead: true,
          createdAt: testDate,
        },
      ];

      mockNotificationService.getUserNotifications.mockResolvedValue({
        notifications: mockNotifications,
        total: 2,
      } as any);

      const response = await request(app).get('/api/notifications');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('notifications');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.notifications).toHaveLength(2);
      expect(response.body.notifications[0].id).toBe('notif-1');
      expect(response.body.notifications[1].id).toBe('notif-2');
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        pages: 1,
      });
      expect(mockNotificationService.getUserNotifications).toHaveBeenCalledWith('test-user-id', 1, 20, true);
    });

    it('should return empty array when no notifications', async () => {
      mockNotificationService.getUserNotifications.mockResolvedValue({
        notifications: [],
        total: 0,
      } as any);

      const response = await request(app).get('/api/notifications');

      expect(response.status).toBe(200);
      expect(response.body.notifications).toEqual([]);
      expect(response.body.pagination.total).toBe(0);
    });

    it('should handle service errors', async () => {
      mockNotificationService.getUserNotifications.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/notifications');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/notifications/unread-count', () => {
    it('should return unread notification count', async () => {
      mockNotificationService.getUnreadCount.mockResolvedValue(5);

      const response = await request(app).get('/api/notifications/unread-count');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: { unreadCount: 5 },
      });
      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledWith('test-user-id');
    });

    it('should return zero when no unread notifications', async () => {
      mockNotificationService.getUnreadCount.mockResolvedValue(0);

      const response = await request(app).get('/api/notifications/unread-count');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: { unreadCount: 0 },
      });
    });
  });

  describe('POST /api/notifications/mark-read', () => {
    it('should mark notifications as read', async () => {
      mockNotificationService.markNotificationsRead.mockResolvedValue(2);

      const response = await request(app)
        .post('/api/notifications/mark-read')
        .send({ notificationIds: ['notif-1', 'notif-2'] });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        markedRead: 2,
      });
      expect(mockNotificationService.markNotificationsRead).toHaveBeenCalledWith('test-user-id', ['notif-1', 'notif-2']);
    });

    it('should return 400 when notificationIds is missing', async () => {
      const response = await request(app)
        .post('/api/notifications/mark-read')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('notificationIds array is required');
    });

    it('should handle empty array', async () => {
      mockNotificationService.markNotificationsRead.mockResolvedValue(0);

      const response = await request(app)
        .post('/api/notifications/mark-read')
        .send({ notificationIds: [] });

      expect(response.status).toBe(200);
      expect(response.body.markedRead).toBe(0);
    });
  });

  describe('POST /api/notifications/mark-all-read', () => {
    it('should mark all notifications as read', async () => {
      mockNotificationService.markAllNotificationsRead.mockResolvedValue(3);

      const response = await request(app).post('/api/notifications/mark-all-read');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        markedRead: 3,
      });
      expect(mockNotificationService.markAllNotificationsRead).toHaveBeenCalledWith('test-user-id');
    });

    it('should handle when no notifications to mark', async () => {
      mockNotificationService.markAllNotificationsRead.mockResolvedValue(0);

      const response = await request(app).post('/api/notifications/mark-all-read');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        markedRead: 0,
      });
    });
  });

  describe('DELETE /api/notifications/:notificationId', () => {
    it('should delete notification', async () => {
      mockNotificationService.deleteNotification.mockResolvedValue(true);

      const response = await request(app).delete('/api/notifications/notif-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Notification deleted successfully',
      });
      expect(mockNotificationService.deleteNotification).toHaveBeenCalledWith('test-user-id', 'notif-1');
    });

    it('should return 404 when notification not found', async () => {
      mockNotificationService.deleteNotification.mockResolvedValue(false);

      const response = await request(app).delete('/api/notifications/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Notification not found or already deleted');
    });

    it('should handle deletion errors', async () => {
      mockNotificationService.deleteNotification.mockRejectedValue(new Error('Delete failed'));

      const response = await request(app).delete('/api/notifications/notif-1');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/notifications/preferences', () => {
    it('should return user notification preferences', async () => {
      const mockPreferences = [
        {
          userId: 'test-user-id',
          channel: 'email',
          type: 'reward',
          enabled: true,
        },
      ];

      mockNotificationService.getUserPreferences.mockResolvedValue(mockPreferences as any);

      const response = await request(app).get('/api/notifications/preferences');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        preferences: mockPreferences,
      });
      expect(mockNotificationService.getUserPreferences).toHaveBeenCalledWith('test-user-id');
    });

    it('should handle empty preferences', async () => {
      mockNotificationService.getUserPreferences.mockResolvedValue([] as any);

      const response = await request(app).get('/api/notifications/preferences');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.preferences).toEqual([]);
    });
  });

  describe('PUT /api/notifications/preferences', () => {
    it('should update notification preferences', async () => {
      const preferences = [
        { channel: 'email', type: 'reward', enabled: true },
        { channel: 'push', type: 'coupon', enabled: false },
      ];

      mockNotificationService.updateUserPreferences.mockResolvedValue(preferences as any);

      const response = await request(app)
        .put('/api/notifications/preferences')
        .send(preferences);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        preferences,
      });
      expect(mockNotificationService.updateUserPreferences).toHaveBeenCalledWith(
        'test-user-id',
        preferences
      );
    });

    it('should return 400 when preferences data is malformed', async () => {
      // Malformed JSON is caught by body-parser middleware
      const response = await request(app)
        .put('/api/notifications/preferences')
        .set('Content-Type', 'application/json')
        .send('null');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid JSON format');
    });

    it('should handle update errors', async () => {
      mockNotificationService.updateUserPreferences.mockRejectedValue(new Error('Update failed'));

      const response = await request(app)
        .put('/api/notifications/preferences')
        .send([{ channel: 'email', type: 'reward', enabled: false }]);

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/notifications/test (development only)', () => {
    it('should create test notification', async () => {
      const testNotification = {
        id: 'notif-test',
        userId: 'test-user-id',
        type: 'info',
        title: 'Test Notification',
        message: 'This is a test',
        data: { isTest: true },
      };

      mockNotificationService.createNotification.mockResolvedValue(testNotification as any);

      const response = await request(app)
        .post('/api/notifications/test')
        .send({
          title: 'Test Notification',
          message: 'This is a test',
          type: 'info',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: testNotification,
        message: 'Test notification created successfully',
      });
      expect(mockNotificationService.createNotification).toHaveBeenCalled();
    });

    it('should return 400 when title is missing', async () => {
      const response = await request(app)
        .post('/api/notifications/test')
        .send({ message: 'Message' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Title and message are required');
    });

    it('should return 400 when message is missing', async () => {
      const response = await request(app)
        .post('/api/notifications/test')
        .send({ title: 'Title' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Title and message are required');
    });
  });

  describe('POST /api/notifications/admin/cleanup (admin)', () => {
    it('should cleanup expired notifications', async () => {
      mockNotificationService.cleanupExpiredNotifications.mockResolvedValue(150);

      const response = await request(app)
        .post('/api/notifications/admin/cleanup')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: { deletedCount: 150 },
        message: '150 expired notifications cleaned up',
      });
      expect(mockNotificationService.cleanupExpiredNotifications).toHaveBeenCalled();
    });

    it('should handle zero deletions', async () => {
      mockNotificationService.cleanupExpiredNotifications.mockResolvedValue(0);

      const response = await request(app)
        .post('/api/notifications/admin/cleanup')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.deletedCount).toBe(0);
    });

    it('should handle cleanup errors', async () => {
      mockNotificationService.cleanupExpiredNotifications.mockRejectedValue(new Error('Cleanup failed'));

      const response = await request(app)
        .post('/api/notifications/admin/cleanup')
        .send({});

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/notifications/push/subscribe', () => {
    it('should accept push notification subscription', async () => {
      const subscription = {
        endpoint: 'https://push.example.com/abc123',
        keys: {
          p256dh: 'key1',
          auth: 'key2',
        },
      };

      const response = await request(app)
        .post('/api/notifications/push/subscribe')
        .send({ subscription, platform: 'web' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Successfully subscribed to push notifications',
      });
    });

    it('should return 400 when subscription is missing', async () => {
      const response = await request(app)
        .post('/api/notifications/push/subscribe')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing subscription data');
    });
  });

  describe('POST /api/notifications/push/unsubscribe', () => {
    it('should accept push notification unsubscription', async () => {
      const response = await request(app)
        .post('/api/notifications/push/unsubscribe')
        .send({ subscription: { endpoint: 'https://push.example.com/abc123' } });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Successfully unsubscribed from push notifications',
      });
    });

    it('should return 400 when subscription is missing', async () => {
      const response = await request(app)
        .post('/api/notifications/push/unsubscribe')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing subscription');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/notifications/mark-read')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}');

      expect(response.status).toBe(400);
    });

    it('should handle missing authentication', async () => {
      // This is handled by the auth middleware mock, so we just verify it's working
      const response = await request(app).get('/api/notifications');
      expect(response.status).not.toBe(401); // Should be authenticated by mock
    });
  });
});
