import { query, queryWithMeta } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { 
  Notification, 
  CreateNotificationData, 
  NotificationPreference, 
  NotificationSummary
} from '../types/notification';
import { Coupon } from '../types/coupon';
import { logger } from '../utils/logger';

export class NotificationService {
  
  /**
   * Create a new notification for a user
   */
  async createNotification(data: CreateNotificationData): Promise<Notification> {
    const [notification] = await query<Notification>(
      `INSERT INTO notifications (
        user_id, title, message, type, data, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING 
        id,
        user_id AS "userId",
        title,
        message,
        type,
        data,
        read_at AS "readAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        expires_at AS "expiresAt"`,
      [
        data.userId,
        data.title,
        data.message,
        data.type,
        data.data ? JSON.stringify(data.data) : null,
        data.expiresAt ?? null
      ]
    );

    if (!notification) {
      throw new AppError(500, 'Failed to create notification');
    }

    logger.info('Notification created', {
      notificationId: notification.id,
      userId: data.userId,
      type: data.type,
      title: data.title
    });

    return notification;
  }

  /**
   * Get notifications for a user with pagination
   */
  async getUserNotifications(
    userId: string, 
    page = 1, 
    limit = 20,
    includeRead = true
  ): Promise<NotificationSummary> {
    const offset = (page - 1) * limit;
    
    // Base query conditions
    let whereCondition = 'WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())';
    const queryParams: (string | number)[] = [userId];
    
    if (!includeRead) {
      whereCondition += ' AND read_at IS NULL';
    }

    // Get total count
    const [countResult] = await query<{ total: string; unread: string }>(
      `SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN read_at IS NULL THEN 1 END) as unread
      FROM notifications
      ${whereCondition}`,
      queryParams
    );

    if (!countResult) {
      return {
        total: 0,
        unread: 0,
        notifications: []
      };
    }

    // Get notifications
    const notifications = await query<Notification>(
      `SELECT
        id,
        user_id AS "userId",
        title,
        message,
        type,
        data,
        read_at AS "readAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        expires_at AS "expiresAt"
      FROM notifications
      ${whereCondition}
      ORDER BY created_at DESC
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`,
      [...queryParams, limit, offset]
    );

    return {
      total: parseInt(countResult.total),
      unread: parseInt(countResult.unread),
      notifications
    };
  }

  /**
   * Get unread notification count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    const [result] = await query<{ count: string }>(
      'SELECT get_unread_notification_count($1) as count',
      [userId]
    );

    return result ? parseInt(result.count) : 0;
  }

  /**
   * Mark specific notifications as read
   */
  async markNotificationsRead(userId: string, notificationIds: string[]): Promise<number> {
    if (notificationIds.length === 0) {
      return 0;
    }

    const placeholders = notificationIds.map((_, index) => `$${index + 2}`).join(',');
    
    const result = await queryWithMeta(
      `UPDATE notifications 
      SET read_at = NOW(), updated_at = NOW()
      WHERE user_id = $1 AND id IN (${placeholders}) AND read_at IS NULL`,
      [userId, ...notificationIds]
    );

    logger.info('Notifications marked as read', {
      userId,
      notificationIds,
      markedCount: result.rowCount
    });

    return result.rowCount || 0;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllNotificationsRead(userId: string): Promise<number> {
    const [result] = await query<{ count: string }>(
      'SELECT mark_all_notifications_read($1) as count',
      [userId]
    );

    const markedCount = result ? parseInt(result.count) : 0;

    logger.info('All notifications marked as read', {
      userId,
      markedCount
    });

    return markedCount;
  }

  /**
   * Delete a notification (only the owner can delete)
   */
  async deleteNotification(userId: string, notificationId: string): Promise<boolean> {
    const result = await queryWithMeta(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
      [notificationId, userId]
    );

    const wasDeleted = (result.rowCount || 0) > 0;

    if (wasDeleted) {
      logger.info('Notification deleted', {
        userId,
        notificationId
      });
    }

    return wasDeleted;
  }

  /**
   * Clean up expired notifications
   */
  async cleanupExpiredNotifications(): Promise<number> {
    const [result] = await query<{ count: string }>(
      'SELECT cleanup_expired_notifications() as count'
    );

    const deletedCount = result ? parseInt(result.count) : 0;

    if (deletedCount > 0) {
      logger.info('Expired notifications cleaned up', {
        deletedCount
      });
    }

    return deletedCount;
  }

  /**
   * Get notification preferences for a user
   */
  async getUserPreferences(userId: string): Promise<NotificationPreference[]> {
    return await query<NotificationPreference>(
      `SELECT 
        id,
        user_id AS "userId",
        type,
        enabled,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM notification_preferences 
      WHERE user_id = $1
      ORDER BY type`,
      [userId]
    );
  }

  /**
   * Update notification preferences for a user
   */
  async updateUserPreferences(
    userId: string, 
    preferences: Array<{ type: string; enabled: boolean }>
  ): Promise<NotificationPreference[]> {
    // Update preferences in bulk
    for (const pref of preferences) {
      await query(
        `INSERT INTO notification_preferences (user_id, type, enabled)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, type) 
        DO UPDATE SET enabled = $3, updated_at = NOW()`,
        [userId, pref.type, pref.enabled]
      );
    }

    logger.info('Notification preferences updated', {
      userId,
      preferencesCount: preferences.length
    });

    // Return updated preferences
    return await this.getUserPreferences(userId);
  }

  /**
   * Create system notification for profile completion rewards
   */
  async createProfileCompletionNotification(
    userId: string, 
    couponAwarded: boolean, 
    coupon?: Coupon, 
    pointsAwarded?: number
  ): Promise<Notification> {
    let title = 'Profile Completed!';
    let message = 'Congratulations! You have successfully completed your profile.';
    const data: Record<string, unknown> = {};

    if (couponAwarded && coupon) {
      title = '🎉 Profile Completed - Coupon Reward!';
      message = `Congratulations! Your profile is complete and you've received a special coupon: ${coupon.name}`;
      data.coupon = coupon;
    }

    if (pointsAwarded && pointsAwarded > 0) {
      if (couponAwarded) {
        message += ` Plus, you've earned ${pointsAwarded} bonus points!`;
      } else {
        title = '🎉 Profile Completed - Points Reward!';
        message = `Congratulations! Your profile is complete and you've earned ${pointsAwarded} bonus points!`;
      }
      data.pointsAwarded = pointsAwarded;
    }

    return await this.createNotification({
      userId,
      title,
      message,
      type: 'reward',
      data: Object.keys(data).length > 0 ? data : undefined,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // Expire after 30 days
    });
  }

  /**
   * Create system notification for coupon awards
   */
  async createCouponNotification(
    userId: string, 
    coupon: Coupon, 
    reason = 'Special offer'
  ): Promise<Notification> {
    return await this.createNotification({
      userId,
      title: '🎫 New Coupon Available!',
      message: `You've received a new coupon: ${coupon.name}. ${reason}`,
      type: 'coupon',
      data: { coupon },
      expiresAt: coupon.validUntil ? coupon.validUntil.toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
  }

  /**
   * Create system notification for points awards
   */
  async createPointsNotification(
    userId: string,
    points: number,
    reason = 'Points earned'
  ): Promise<Notification> {
    return await this.createNotification({
      userId,
      title: '⭐ Points Earned!',
      message: `You've earned ${points} points! ${reason}`,
      type: 'points',
      data: { pointsAwarded: points, reason },
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
  }

  /**
   * Create notification for tier change (upgrade)
   */
  async createTierChangeNotification(
    userId: string,
    previousTier: string,
    newTier: string,
    totalNights: number
  ): Promise<Notification> {
    const tierEmojis = new Map<string, string>([
      ['Bronze', '🥉'],
      ['Silver', '🥈'],
      ['Gold', '🥇'],
      ['Platinum', '💎']
    ]);

    const emoji = tierEmojis.get(newTier) ?? '🎉';

    return await this.createNotification({
      userId,
      title: `${emoji} Congratulations! You've been upgraded to ${newTier}!`,
      message: `Your loyalty has been rewarded! You've moved from ${previousTier} to ${newTier} tier with ${totalNights} nights stayed. Enjoy your new benefits!`,
      type: 'tier_change',
      data: {
        previousTier,
        newTier,
        totalNights,
        upgradedAt: new Date().toISOString()
      },
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // Expire after 90 days
    });
  }

  /**
   * Bulk create notifications for multiple users
   */
  async createBulkNotifications(notifications: CreateNotificationData[]): Promise<number> {
    if (notifications.length === 0) {
      return 0;
    }

    const values = notifications.map((_, index) => {
      const baseIndex = index * 6;
      return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6})`;
    }).join(',');

    const params = notifications.flatMap(notif => [
      notif.userId,
      notif.title,
      notif.message,
      notif.type,
      notif.data ? JSON.stringify(notif.data) : null,
      notif.expiresAt ?? null
    ]);

    const result = await queryWithMeta(
      `INSERT INTO notifications (user_id, title, message, type, data, expires_at)
      VALUES ${values}`,
      params
    );

    const createdCount = result.rowCount || 0;

    logger.info('Bulk notifications created', {
      createdCount,
      totalRequested: notifications.length
    });

    return createdCount;
  }
}

// Export singleton instance for use in tests and other services
export const notificationService = new NotificationService();