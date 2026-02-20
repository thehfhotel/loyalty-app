export type NotificationType =
  | 'success'
  | 'reward'
  | 'coupon'
  | 'warning'
  | 'error'
  | 'profile'
  | 'survey'
  | 'system'
  | 'tier_change'
  | 'points'
  | 'info';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: {
    coupon?: { name: string; [key: string]: unknown };
    pointsAwarded?: number;
    [key: string]: unknown;
  };
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}
