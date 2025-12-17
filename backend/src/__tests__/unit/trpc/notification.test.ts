import { TRPCError } from '@trpc/server';

// Create mock notificationService instance
const mockNotificationService = {
  getUserNotifications: jest.fn(),
  getUnreadCount: jest.fn(),
  markNotificationsRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  deleteNotification: jest.fn(),
};

// Mock the notificationService before importing the router
jest.mock('../../../services/notificationService', () => ({
  notificationService: mockNotificationService,
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
import { notificationRouter } from '../../../trpc/routers/notification';
import type { Context } from '../../../trpc/context';

/**
 * Helper to create a tRPC caller with context
 */
const createCaller = (ctx: Context) => {
  return notificationRouter.createCaller(ctx);
};

describe('tRPC Notification Router', () => {
  const adminUser = { id: 'admin-1', role: 'admin' as const, email: 'admin@test.com' };
  const customerUser = { id: 'customer-1', role: 'customer' as const, email: 'customer@test.com' };

  const mockNotification = {
    id: 'notif-1',
    userId: 'customer-1',
    title: 'Points Earned!',
    message: 'You have earned 500 points',
    type: 'points' as const,
    data: { pointsAwarded: 500 },
    readAt: null,
    createdAt: new Date('2025-01-10'),
    updatedAt: new Date('2025-01-10'),
    expiresAt: null,
  };

  const mockNotificationSummary = {
    notifications: [mockNotification],
    total: 1,
    unread: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== getNotifications Tests ==========
  describe('getNotifications', () => {
    it('should return notifications with default pagination', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.getUserNotifications.mockResolvedValue(mockNotificationSummary);

      const result = await caller.getNotifications({});

      expect(mockNotificationService.getUserNotifications).toHaveBeenCalledWith(
        'customer-1',
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
      const caller = createCaller({ user: customerUser });
      mockNotificationService.getUserNotifications.mockResolvedValue(mockNotificationSummary);

      const result = await caller.getNotifications({ page: 2, limit: 10, includeRead: false });

      expect(mockNotificationService.getUserNotifications).toHaveBeenCalledWith(
        'customer-1',
        2,
        10,
        false
      );
      expect(result).toEqual({
        notifications: [mockNotification],
        total: 1,
        unread: 1,
        page: 2,
        limit: 10,
        totalPages: 1,
      });
    });

    it('should return empty notifications list', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.getUserNotifications.mockResolvedValue({
        notifications: [],
        total: 0,
        unread: 0,
      });

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
      const caller = createCaller({ user: customerUser });
      mockNotificationService.getUserNotifications.mockResolvedValue({
        notifications: [],
        total: 45,
        unread: 10,
      });

      const result = await caller.getNotifications({ page: 1, limit: 20 });

      expect(result.totalPages).toBe(3); // Math.ceil(45 / 20) = 3
    });

    it('should handle includeRead flag true by default', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.getUserNotifications.mockResolvedValue(mockNotificationSummary);

      await caller.getNotifications({});

      expect(mockNotificationService.getUserNotifications).toHaveBeenCalledWith(
        'customer-1',
        1,
        20,
        true
      );
    });

    it('should handle includeRead flag false', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.getUserNotifications.mockResolvedValue(mockNotificationSummary);

      await caller.getNotifications({ includeRead: false });

      expect(mockNotificationService.getUserNotifications).toHaveBeenCalledWith(
        'customer-1',
        1,
        20,
        false
      );
    });

    it('should enforce maximum limit of 50', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.getUserNotifications.mockResolvedValue(mockNotificationSummary);

      await caller.getNotifications({ limit: 50 });

      expect(mockNotificationService.getUserNotifications).toHaveBeenCalledWith(
        'customer-1',
        1,
        50,
        true
      );
    });

    it('should reject limit greater than 50', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getNotifications({ limit: 51 })
      ).rejects.toThrow();
    });

    it('should reject negative page number', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getNotifications({ page: -1 })
      ).rejects.toThrow();
    });

    it('should reject zero page number', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getNotifications({ page: 0 })
      ).rejects.toThrow();
    });

    it('should reject negative limit', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getNotifications({ limit: -10 })
      ).rejects.toThrow();
    });

    it('should reject zero limit', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.getNotifications({ limit: 0 })
      ).rejects.toThrow();
    });

    it('should work for admin users', async () => {
      const caller = createCaller({ user: adminUser });
      mockNotificationService.getUserNotifications.mockResolvedValue(mockNotificationSummary);

      const result = await caller.getNotifications({});

      expect(mockNotificationService.getUserNotifications).toHaveBeenCalledWith(
        'admin-1',
        1,
        20,
        true
      );
      expect(result.notifications).toEqual([mockNotification]);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.getNotifications({})).rejects.toThrow(TRPCError);
      await expect(caller.getNotifications({})).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.getUserNotifications.mockRejectedValue(new Error('Database error'));

      await expect(caller.getNotifications({})).rejects.toThrow('Database error');
    });
  });

  // ========== getUnreadCount Tests ==========
  describe('getUnreadCount', () => {
    it('should return unread count for authenticated user', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.getUnreadCount.mockResolvedValue(5);

      const result = await caller.getUnreadCount();

      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledWith('customer-1');
      expect(result).toEqual({ unreadCount: 5 });
    });

    it('should return zero when no unread notifications', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.getUnreadCount.mockResolvedValue(0);

      const result = await caller.getUnreadCount();

      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledWith('customer-1');
      expect(result).toEqual({ unreadCount: 0 });
    });

    it('should work for admin users', async () => {
      const caller = createCaller({ user: adminUser });
      mockNotificationService.getUnreadCount.mockResolvedValue(3);

      const result = await caller.getUnreadCount();

      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledWith('admin-1');
      expect(result).toEqual({ unreadCount: 3 });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.getUnreadCount()).rejects.toThrow(TRPCError);
      await expect(caller.getUnreadCount()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.getUnreadCount.mockRejectedValue(new Error('Database error'));

      await expect(caller.getUnreadCount()).rejects.toThrow('Database error');
    });
  });

  // ========== markAsRead Tests ==========
  describe('markAsRead', () => {
    it('should mark notification as read successfully', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.markNotificationsRead.mockResolvedValue(1);

      const result = await caller.markAsRead({ notificationId: '12345678-1234-1234-1234-123456789012' });

      expect(mockNotificationService.markNotificationsRead).toHaveBeenCalledWith(
        'customer-1',
        ['12345678-1234-1234-1234-123456789012']
      );
      expect(result).toEqual({ success: true, markedCount: 1 });
    });

    it('should throw error when notification not found', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.markNotificationsRead.mockResolvedValue(0);

      await expect(
        caller.markAsRead({ notificationId: '12345678-1234-1234-1234-123456789012' })
      ).rejects.toThrow('Notification not found or already marked as read');
    });

    it('should require valid UUID for notificationId', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.markAsRead({ notificationId: 'not-a-uuid' })
      ).rejects.toThrow();
    });

    it('should work for admin users', async () => {
      const caller = createCaller({ user: adminUser });
      mockNotificationService.markNotificationsRead.mockResolvedValue(1);

      const result = await caller.markAsRead({ notificationId: '12345678-1234-1234-1234-123456789012' });

      expect(mockNotificationService.markNotificationsRead).toHaveBeenCalledWith(
        'admin-1',
        ['12345678-1234-1234-1234-123456789012']
      );
      expect(result).toEqual({ success: true, markedCount: 1 });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.markAsRead({ notificationId: '12345678-1234-1234-1234-123456789012' })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.markAsRead({ notificationId: '12345678-1234-1234-1234-123456789012' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.markNotificationsRead.mockRejectedValue(new Error('Database error'));

      await expect(
        caller.markAsRead({ notificationId: '12345678-1234-1234-1234-123456789012' })
      ).rejects.toThrow('Database error');
    });
  });

  // ========== markAllAsRead Tests ==========
  describe('markAllAsRead', () => {
    it('should mark all notifications as read successfully', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.markAllNotificationsRead.mockResolvedValue(5);

      const result = await caller.markAllAsRead();

      expect(mockNotificationService.markAllNotificationsRead).toHaveBeenCalledWith('customer-1');
      expect(result).toEqual({ success: true, markedCount: 5 });
    });

    it('should return zero when no unread notifications', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.markAllNotificationsRead.mockResolvedValue(0);

      const result = await caller.markAllAsRead();

      expect(mockNotificationService.markAllNotificationsRead).toHaveBeenCalledWith('customer-1');
      expect(result).toEqual({ success: true, markedCount: 0 });
    });

    it('should work for admin users', async () => {
      const caller = createCaller({ user: adminUser });
      mockNotificationService.markAllNotificationsRead.mockResolvedValue(3);

      const result = await caller.markAllAsRead();

      expect(mockNotificationService.markAllNotificationsRead).toHaveBeenCalledWith('admin-1');
      expect(result).toEqual({ success: true, markedCount: 3 });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.markAllAsRead()).rejects.toThrow(TRPCError);
      await expect(caller.markAllAsRead()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.markAllNotificationsRead.mockRejectedValue(new Error('Database error'));

      await expect(caller.markAllAsRead()).rejects.toThrow('Database error');
    });
  });

  // ========== deleteNotification Tests ==========
  describe('deleteNotification', () => {
    it('should delete notification successfully', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.deleteNotification.mockResolvedValue(true);

      const result = await caller.deleteNotification({ notificationId: '12345678-1234-1234-1234-123456789012' });

      expect(mockNotificationService.deleteNotification).toHaveBeenCalledWith(
        'customer-1',
        '12345678-1234-1234-1234-123456789012'
      );
      expect(result).toEqual({ success: true });
    });

    it('should throw error when notification not found', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.deleteNotification.mockResolvedValue(false);

      await expect(
        caller.deleteNotification({ notificationId: '12345678-1234-1234-1234-123456789012' })
      ).rejects.toThrow('Notification not found or already deleted');
    });

    it('should require valid UUID for notificationId', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.deleteNotification({ notificationId: 'not-a-uuid' })
      ).rejects.toThrow();
    });

    it('should work for admin users', async () => {
      const caller = createCaller({ user: adminUser });
      mockNotificationService.deleteNotification.mockResolvedValue(true);

      const result = await caller.deleteNotification({ notificationId: '12345678-1234-1234-1234-123456789012' });

      expect(mockNotificationService.deleteNotification).toHaveBeenCalledWith(
        'admin-1',
        '12345678-1234-1234-1234-123456789012'
      );
      expect(result).toEqual({ success: true });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.deleteNotification({ notificationId: '12345678-1234-1234-1234-123456789012' })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.deleteNotification({ notificationId: '12345678-1234-1234-1234-123456789012' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockNotificationService.deleteNotification.mockRejectedValue(new Error('Database error'));

      await expect(
        caller.deleteNotification({ notificationId: '12345678-1234-1234-1234-123456789012' })
      ).rejects.toThrow('Database error');
    });

    it('should only allow user to delete their own notifications', async () => {
      // This is enforced by the service layer
      const caller = createCaller({ user: customerUser });
      mockNotificationService.deleteNotification.mockResolvedValue(false);

      await expect(
        caller.deleteNotification({ notificationId: '87654321-4321-4321-4321-210987654321' })
      ).rejects.toThrow('Notification not found or already deleted');

      expect(mockNotificationService.deleteNotification).toHaveBeenCalledWith(
        'customer-1',
        '87654321-4321-4321-4321-210987654321'
      );
    });
  });
});
