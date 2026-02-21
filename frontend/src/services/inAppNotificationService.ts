import api from './authService';
import type { Notification } from '../types/notification';

export interface NotificationsResponse {
  notifications: Notification[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export const inAppNotificationService = {
  async getNotifications(page = 1, limit = 10, includeRead = true): Promise<NotificationsResponse> {
    const response = await api.get('/notifications', {
      params: { page, limit, unread_only: !includeRead },
    });
    // Rust returns NotificationsListResponse { notifications, pagination } directly
    return response.data;
  },

  async markMultipleAsRead(notificationIds: string[]): Promise<void> {
    await api.put('/notifications/read', { notificationIds });
  },

  async markAllAsRead(): Promise<void> {
    await api.put('/notifications/read-all');
  },

  async deleteNotification(notificationId: string): Promise<void> {
    await api.delete(`/notifications/${notificationId}`);
  },
};
