import api from './authService';
import type { Notification } from '../types/notification';

export interface NotificationsResponse {
  notifications: Notification[];
  unread: number;
  total: number;
}

export const inAppNotificationService = {
  async getNotifications(page = 1, limit = 10, includeRead = true): Promise<NotificationsResponse> {
    const response = await api.get('/notifications', {
      params: { page, limit, includeRead },
    });
    return response.data.data;
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
