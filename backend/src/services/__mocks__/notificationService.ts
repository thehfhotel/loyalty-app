/**
 * Mock NotificationService for testing
 */

 
export class NotificationService {
  async getUserNotifications(_userId: string, _page: number, _limit: number, _includeRead: boolean) {
    return {
      notifications: [],
      total: 0
    };
  }

  async getUnreadCount(_userId: string) {
    return 0;
  }

  async markNotificationsRead(_userId: string, notificationIds: string[]) {
    return notificationIds.length;
  }

  async markAllNotificationsRead(_userId: string) {
    return 0;
  }

  async deleteNotification(_userId: string, _notificationId: string) {
    return true;
  }

  async getUserPreferences(_userId: string) {
    return {
      email: true,
      push: true,
      inApp: true
    };
  }

  async updateUserPreferences(_userId: string, preferences: unknown) {
    return preferences;
  }

  async createNotification(_data: unknown) {
    return {
      id: 'test-notification-id',
      userId: 'test-user-123',
      title: 'Test',
      message: 'Test message',
      type: 'info' as const,
      read: false,
      createdAt: new Date(),
      data: {}
    };
  }

  async cleanupExpiredNotifications() {
    return 0;
  }
}
 
