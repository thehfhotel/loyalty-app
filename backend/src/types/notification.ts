export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  data?: Record<string, unknown>;
  readAt?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export type NotificationType =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'system'
  | 'reward'
  | 'coupon'
  | 'survey'
  | 'profile'
  | 'tier_change'
  | 'points';

export interface CreateNotificationData {
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  data?: Record<string, unknown>;
  expiresAt?: string;
}

export interface NotificationPreference {
  id: string;
  userId: string;
  type: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationSummary {
  total: number;
  unread: number;
  notifications: Notification[];
}

export interface MarkReadRequest {
  notificationIds?: string[];
  markAll?: boolean;
}