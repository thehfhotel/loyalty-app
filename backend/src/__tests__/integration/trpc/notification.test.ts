/**
 * tRPC Notification Router Integration Tests
 * Tests all notification router procedures with real database interactions
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TRPCError } from '@trpc/server';
import { notificationRouter } from '../../../trpc/routers/notification';
import { notificationService } from '../../../services/notificationService';
import { createAuthenticatedCaller, createUnauthenticatedCaller } from './helpers';

// Mock logger to reduce noise
jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('tRPC Notification Router - Integration Tests', () => {
  const NOTIFICATION_ID = '12345678-1234-1234-1234-123456789012';
  const NOTIFICATION_ID_2 = '12345678-1234-1234-1234-123456789013';
  const NOTIFICATION_ID_3 = '12345678-1234-1234-1234-123456789014';

  const mockNotification = {
    id: NOTIFICATION_ID,
    userId: 'customer-test-id',
    title: 'Points Earned!',
    message: 'You have earned 500 points',
    type: 'points',
    data: { pointsAwarded: 500 },
    readAt: undefined,
    createdAt: '2025-01-10T00:00:00.000Z',
    updatedAt: '2025-01-10T00:00:00.000Z',
    expiresAt: undefined,
  } as any;

  const mockNotification2 = {
    id: NOTIFICATION_ID_2,
    userId: 'customer-test-id',
    title: 'Tier Upgrade',
    message: 'Congratulations! You have been upgraded to Gold tier',
    type: 'tier_change',
    data: { newTier: 'gold', oldTier: 'silver' },
    readAt: '2025-01-11T00:00:00.000Z',
    createdAt: '2025-01-09T00:00:00.000Z',
    updatedAt: '2025-01-11T00:00:00.000Z',
    expiresAt: undefined,
  } as any;

  const mockNotificationSummary = {
    notifications: [mockNotification],
    total: 1,
    unread: 1,
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== getNotifications Tests ==========
  describe('getNotifications', () => {
    it('should return notifications with default pagination', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'getUserNotifications').mockResolvedValue(mockNotificationSummary);

      const result = await caller.getNotifications({});

      expect(notificationService.getUserNotifications).toHaveBeenCalledWith(
        'customer-test-id',
        1,
        20,
        true
      );
      expect(result).toEqual({
        notifications: [mockNotification],
        total: 1,
        unread: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('should return notifications with custom pagination', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      const customSummary = {
        notifications: [mockNotification, mockNotification2],
        total: 25,
        unread: 3,
      } as any;
      jest.spyOn(notificationService, 'getUserNotifications').mockResolvedValue(customSummary);

      const result = await caller.getNotifications({ page: 2, limit: 10, includeRead: false });

      expect(notificationService.getUserNotifications).toHaveBeenCalledWith(
        'customer-test-id',
        2,
        10,
        false
      );
      expect(result).toEqual({
        notifications: [mockNotification, mockNotification2],
        total: 25,
        unread: 3,
        page: 2,
        limit: 10,
        totalPages: 3, // Math.ceil(25 / 10) = 3
      });
    });

    it('should return empty notifications list', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'getUserNotifications').mockResolvedValue({
        notifications: [],
        total: 0,
        unread: 0,
      } as any);

      const result = await caller.getNotifications({});

      expect(result).toEqual({
        notifications: [],
        total: 0,
        unread: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
    });

    it('should calculate totalPages correctly', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'getUserNotifications').mockResolvedValue({
        notifications: [],
        total: 45,
        unread: 10,
      } as any);

      const result = await caller.getNotifications({ page: 1, limit: 20 });

      expect(result.totalPages).toBe(3); // Math.ceil(45 / 20) = 3
    });

    it('should handle includeRead flag true by default', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'getUserNotifications').mockResolvedValue(mockNotificationSummary);

      await caller.getNotifications({});

      expect(notificationService.getUserNotifications).toHaveBeenCalledWith(
        'customer-test-id',
        1,
        20,
        true
      );
    });

    it('should handle includeRead flag false', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'getUserNotifications').mockResolvedValue(mockNotificationSummary);

      await caller.getNotifications({ includeRead: false });

      expect(notificationService.getUserNotifications).toHaveBeenCalledWith(
        'customer-test-id',
        1,
        20,
        false
      );
    });

    it('should enforce maximum limit of 50', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'getUserNotifications').mockResolvedValue(mockNotificationSummary);

      await caller.getNotifications({ limit: 50 });

      expect(notificationService.getUserNotifications).toHaveBeenCalledWith(
        'customer-test-id',
        1,
        50,
        true
      );
    });

    it('should reject limit greater than 50', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');

      await expect(
        caller.getNotifications({ limit: 51 })
      ).rejects.toThrow();
    });

    it('should reject negative page number', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');

      await expect(
        caller.getNotifications({ page: -1 })
      ).rejects.toThrow();
    });

    it('should reject zero page number', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');

      await expect(
        caller.getNotifications({ page: 0 })
      ).rejects.toThrow();
    });

    it('should reject negative limit', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');

      await expect(
        caller.getNotifications({ limit: -10 })
      ).rejects.toThrow();
    });

    it('should reject zero limit', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');

      await expect(
        caller.getNotifications({ limit: 0 })
      ).rejects.toThrow();
    });

    it('should work for admin users', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'admin');
      const adminSummary = {
        notifications: [{ ...mockNotification, userId: 'admin-test-id' }],
        total: 1,
        unread: 0,
      } as any;
      jest.spyOn(notificationService, 'getUserNotifications').mockResolvedValue(adminSummary);

      const result = await caller.getNotifications({});

      expect(notificationService.getUserNotifications).toHaveBeenCalledWith(
        'admin-test-id',
        1,
        20,
        true
      );
      expect(result.notifications).toHaveLength(1);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(notificationRouter);

      await expect(caller.getNotifications({})).rejects.toThrow(TRPCError);
      await expect(caller.getNotifications({})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors gracefully', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'getUserNotifications').mockRejectedValue(new Error('Database error'));

      await expect(caller.getNotifications({})).rejects.toThrow('Database error');
    });
  });

  // ========== getUnreadCount Tests ==========
  describe('getUnreadCount', () => {
    it('should return unread count for authenticated user', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'getUnreadCount').mockResolvedValue(5);

      const result = await caller.getUnreadCount();

      expect(notificationService.getUnreadCount).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual({ unreadCount: 5 });
    });

    it('should return zero when no unread notifications', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'getUnreadCount').mockResolvedValue(0);

      const result = await caller.getUnreadCount();

      expect(notificationService.getUnreadCount).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual({ unreadCount: 0 });
    });

    it('should work for admin users', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'admin');
      jest.spyOn(notificationService, 'getUnreadCount').mockResolvedValue(3);

      const result = await caller.getUnreadCount();

      expect(notificationService.getUnreadCount).toHaveBeenCalledWith('admin-test-id');
      expect(result).toEqual({ unreadCount: 3 });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(notificationRouter);

      await expect(caller.getUnreadCount()).rejects.toThrow(TRPCError);
      await expect(caller.getUnreadCount()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors gracefully', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'getUnreadCount').mockRejectedValue(new Error('Database error'));

      await expect(caller.getUnreadCount()).rejects.toThrow('Database error');
    });
  });

  // ========== markAsRead Tests ==========
  describe('markAsRead', () => {
    it('should mark notification as read successfully', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'markNotificationsRead').mockResolvedValue(1);

      const result = await caller.markAsRead({ notificationId: NOTIFICATION_ID });

      expect(notificationService.markNotificationsRead).toHaveBeenCalledWith(
        'customer-test-id',
        [NOTIFICATION_ID]
      );
      expect(result).toEqual({ success: true, markedCount: 1 });
    });

    it('should throw error when notification not found', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'markNotificationsRead').mockResolvedValue(0);

      await expect(
        caller.markAsRead({ notificationId: NOTIFICATION_ID })
      ).rejects.toThrow('Notification not found or already marked as read');
    });

    it('should validate UUID format for notificationId', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');

      await expect(
        caller.markAsRead({ notificationId: 'not-a-uuid' })
      ).rejects.toThrow();
    });

    it('should work for admin users', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'admin');
      jest.spyOn(notificationService, 'markNotificationsRead').mockResolvedValue(1);

      const result = await caller.markAsRead({ notificationId: NOTIFICATION_ID });

      expect(notificationService.markNotificationsRead).toHaveBeenCalledWith(
        'admin-test-id',
        [NOTIFICATION_ID]
      );
      expect(result).toEqual({ success: true, markedCount: 1 });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(notificationRouter);

      await expect(
        caller.markAsRead({ notificationId: NOTIFICATION_ID })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.markAsRead({ notificationId: NOTIFICATION_ID })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors gracefully', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'markNotificationsRead').mockRejectedValue(new Error('Database error'));

      await expect(
        caller.markAsRead({ notificationId: NOTIFICATION_ID })
      ).rejects.toThrow('Database error');
    });
  });

  // ========== markMultipleAsRead Tests ==========
  describe('markMultipleAsRead', () => {
    it('should mark multiple notifications as read successfully', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      const notificationIds = [NOTIFICATION_ID, NOTIFICATION_ID_2, NOTIFICATION_ID_3];
      jest.spyOn(notificationService, 'markNotificationsRead').mockResolvedValue(3);

      const result = await caller.markMultipleAsRead({ notificationIds });

      expect(notificationService.markNotificationsRead).toHaveBeenCalledWith(
        'customer-test-id',
        notificationIds
      );
      expect(result).toEqual({ success: true, markedCount: 3 });
    });

    it('should handle partial success when some notifications already read', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      const notificationIds = [NOTIFICATION_ID, NOTIFICATION_ID_2];
      jest.spyOn(notificationService, 'markNotificationsRead').mockResolvedValue(1);

      const result = await caller.markMultipleAsRead({ notificationIds });

      expect(result).toEqual({ success: true, markedCount: 1 });
    });

    it('should return zero when no notifications were marked', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      const notificationIds = [NOTIFICATION_ID];
      jest.spyOn(notificationService, 'markNotificationsRead').mockResolvedValue(0);

      const result = await caller.markMultipleAsRead({ notificationIds });

      expect(result).toEqual({ success: true, markedCount: 0 });
    });

    it('should validate UUID format for all notificationIds', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');

      await expect(
        caller.markMultipleAsRead({ notificationIds: ['not-a-uuid', NOTIFICATION_ID] })
      ).rejects.toThrow();
    });

    it('should accept empty array', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'markNotificationsRead').mockResolvedValue(0);

      const result = await caller.markMultipleAsRead({ notificationIds: [] });

      expect(result).toEqual({ success: true, markedCount: 0 });
    });

    it('should work for admin users', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'admin');
      const notificationIds = [NOTIFICATION_ID, NOTIFICATION_ID_2];
      jest.spyOn(notificationService, 'markNotificationsRead').mockResolvedValue(2);

      const result = await caller.markMultipleAsRead({ notificationIds });

      expect(notificationService.markNotificationsRead).toHaveBeenCalledWith(
        'admin-test-id',
        notificationIds
      );
      expect(result).toEqual({ success: true, markedCount: 2 });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(notificationRouter);

      await expect(
        caller.markMultipleAsRead({ notificationIds: [NOTIFICATION_ID] })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.markMultipleAsRead({ notificationIds: [NOTIFICATION_ID] })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors gracefully', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'markNotificationsRead').mockRejectedValue(new Error('Database error'));

      await expect(
        caller.markMultipleAsRead({ notificationIds: [NOTIFICATION_ID] })
      ).rejects.toThrow('Database error');
    });
  });

  // ========== markAllAsRead Tests ==========
  describe('markAllAsRead', () => {
    it('should mark all notifications as read successfully', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'markAllNotificationsRead').mockResolvedValue(5);

      const result = await caller.markAllAsRead();

      expect(notificationService.markAllNotificationsRead).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual({ success: true, markedCount: 5 });
    });

    it('should return zero when no unread notifications', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'markAllNotificationsRead').mockResolvedValue(0);

      const result = await caller.markAllAsRead();

      expect(notificationService.markAllNotificationsRead).toHaveBeenCalledWith('customer-test-id');
      expect(result).toEqual({ success: true, markedCount: 0 });
    });

    it('should work for admin users', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'admin');
      jest.spyOn(notificationService, 'markAllNotificationsRead').mockResolvedValue(3);

      const result = await caller.markAllAsRead();

      expect(notificationService.markAllNotificationsRead).toHaveBeenCalledWith('admin-test-id');
      expect(result).toEqual({ success: true, markedCount: 3 });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(notificationRouter);

      await expect(caller.markAllAsRead()).rejects.toThrow(TRPCError);
      await expect(caller.markAllAsRead()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors gracefully', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'markAllNotificationsRead').mockRejectedValue(new Error('Database error'));

      await expect(caller.markAllAsRead()).rejects.toThrow('Database error');
    });
  });

  // ========== deleteNotification Tests ==========
  describe('deleteNotification', () => {
    it('should delete notification successfully', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'deleteNotification').mockResolvedValue(true);

      const result = await caller.deleteNotification({ notificationId: NOTIFICATION_ID });

      expect(notificationService.deleteNotification).toHaveBeenCalledWith(
        'customer-test-id',
        NOTIFICATION_ID
      );
      expect(result).toEqual({ success: true });
    });

    it('should throw error when notification not found', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'deleteNotification').mockResolvedValue(false);

      await expect(
        caller.deleteNotification({ notificationId: NOTIFICATION_ID })
      ).rejects.toThrow('Notification not found or already deleted');
    });

    it('should validate UUID format for notificationId', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');

      await expect(
        caller.deleteNotification({ notificationId: 'not-a-uuid' })
      ).rejects.toThrow();
    });

    it('should work for admin users', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'admin');
      jest.spyOn(notificationService, 'deleteNotification').mockResolvedValue(true);

      const result = await caller.deleteNotification({ notificationId: NOTIFICATION_ID });

      expect(notificationService.deleteNotification).toHaveBeenCalledWith(
        'admin-test-id',
        NOTIFICATION_ID
      );
      expect(result).toEqual({ success: true });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createUnauthenticatedCaller(notificationRouter);

      await expect(
        caller.deleteNotification({ notificationId: NOTIFICATION_ID })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.deleteNotification({ notificationId: NOTIFICATION_ID })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors gracefully', async () => {
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'deleteNotification').mockRejectedValue(new Error('Database error'));

      await expect(
        caller.deleteNotification({ notificationId: NOTIFICATION_ID })
      ).rejects.toThrow('Database error');
    });

    it('should only allow user to delete their own notifications', async () => {
      // This is enforced by the service layer
      const caller = createAuthenticatedCaller(notificationRouter, 'customer');
      jest.spyOn(notificationService, 'deleteNotification').mockResolvedValue(false);

      await expect(
        caller.deleteNotification({ notificationId: '87654321-4321-4321-4321-210987654321' })
      ).rejects.toThrow('Notification not found or already deleted');

      expect(notificationService.deleteNotification).toHaveBeenCalledWith(
        'customer-test-id',
        '87654321-4321-4321-4321-210987654321'
      );
    });
  });
});
