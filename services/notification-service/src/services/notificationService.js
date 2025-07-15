const firebaseService = require('./firebaseService');
const emailService = require('./emailService');
const smsService = require('./smsService');
const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class NotificationService {
  static async sendNotification(notificationData) {
    const {
      userId,
      type, // 'push', 'email', 'sms', 'all'
      title,
      body,
      data = {},
      template = null,
      priority = 'normal', // 'low', 'normal', 'high'
      scheduledAt = null
    } = notificationData;

    const notificationId = uuidv4();
    
    try {
      // Get user preferences and contact info
      const userQuery = `
        SELECT 
          u.email, u.phone_number, u.first_name, u.last_name,
          u.preferences->>'communicationPreferences' as comm_prefs,
          pnt.token, pnt.platform
        FROM users u
        LEFT JOIN push_notification_tokens pnt ON u.id = pnt.user_id AND pnt.is_active = true
        WHERE u.id = $1 AND u.deleted_at IS NULL
      `;

      const userResult = await db.query(userQuery, [userId]);
      
      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = userResult.rows[0];
      const commPrefs = user.comm_prefs ? JSON.parse(user.comm_prefs) : {};

      const results = {
        notificationId,
        userId,
        deliveries: []
      };

      // Determine which channels to use
      const channels = this.determineChannels(type, commPrefs, user);

      // Send to each channel
      for (const channel of channels) {
        try {
          let deliveryResult;

          switch (channel) {
            case 'push':
              if (user.token) {
                deliveryResult = await this.sendPushNotification({
                  token: user.token,
                  platform: user.platform,
                  title,
                  body,
                  data,
                  priority
                });
              }
              break;

            case 'email':
              if (user.email) {
                deliveryResult = await this.sendEmailNotification({
                  to: user.email,
                  name: `${user.first_name} ${user.last_name}`,
                  title,
                  body,
                  template,
                  data
                });
              }
              break;

            case 'sms':
              if (user.phone_number) {
                deliveryResult = await this.sendSMSNotification({
                  to: user.phone_number,
                  body,
                  data
                });
              }
              break;
          }

          if (deliveryResult) {
            results.deliveries.push({
              channel,
              status: 'sent',
              deliveryId: deliveryResult.deliveryId,
              sentAt: new Date()
            });

            // Log delivery to database
            await this.logDelivery({
              notificationId,
              userId,
              channel,
              status: 'sent',
              deliveryId: deliveryResult.deliveryId,
              title,
              body,
              data
            });
          }

        } catch (channelError) {
          console.error(`Failed to send ${channel} notification:`, channelError);
          
          results.deliveries.push({
            channel,
            status: 'failed',
            error: channelError.message,
            failedAt: new Date()
          });

          // Log failed delivery
          await this.logDelivery({
            notificationId,
            userId,
            channel,
            status: 'failed',
            title,
            body,
            data,
            errorMessage: channelError.message
          });
        }
      }

      return results;

    } catch (error) {
      console.error('Notification service error:', error);
      throw error;
    }
  }

  static determineChannels(type, userPrefs, user) {
    const channels = [];

    if (type === 'all') {
      if (userPrefs.push !== false && user.token) channels.push('push');
      if (userPrefs.email !== false && user.email) channels.push('email');
      if (userPrefs.sms === true && user.phone_number) channels.push('sms');
    } else if (type === 'push' && userPrefs.push !== false && user.token) {
      channels.push('push');
    } else if (type === 'email' && userPrefs.email !== false && user.email) {
      channels.push('email');
    } else if (type === 'sms' && userPrefs.sms === true && user.phone_number) {
      channels.push('sms');
    }

    return channels;
  }

  static async sendPushNotification(pushData) {
    return await firebaseService.sendNotification(pushData);
  }

  static async sendEmailNotification(emailData) {
    return await emailService.sendEmail(emailData);
  }

  static async sendSMSNotification(smsData) {
    return await smsService.sendSMS(smsData);
  }

  static async logDelivery(logData) {
    const {
      notificationId,
      userId,
      channel,
      status,
      deliveryId = null,
      title,
      body,
      data,
      errorMessage = null
    } = logData;

    const query = `
      INSERT INTO notification_logs (
        id, user_id, channel, status, delivery_id, title, body, data, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    await db.query(query, [
      notificationId,
      userId,
      channel,
      status,
      deliveryId,
      title,
      body,
      JSON.stringify(data),
      errorMessage
    ]);
  }

  static async getDeliveryStatus(notificationId) {
    const query = `
      SELECT * FROM notification_logs
      WHERE id = $1
      ORDER BY created_at DESC
    `;

    const result = await db.query(query, [notificationId]);
    return result.rows;
  }

  static async getUserNotificationHistory(userId, options = {}) {
    const {
      channel = null,
      status = null,
      page = 1,
      limit = 20
    } = options;

    let whereConditions = ['user_id = $1'];
    let queryParams = [userId];
    let paramCount = 2;

    if (channel) {
      whereConditions.push(`channel = $${paramCount}`);
      queryParams.push(channel);
      paramCount++;
    }

    if (status) {
      whereConditions.push(`status = $${paramCount}`);
      queryParams.push(status);
      paramCount++;
    }

    const offset = (page - 1) * limit;

    const query = `
      SELECT *
      FROM notification_logs
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    queryParams.push(limit, offset);

    const result = await db.query(query, queryParams);
    return result.rows;
  }

  static async sendBulkNotifications(notifications) {
    const results = [];

    for (const notification of notifications) {
      try {
        const result = await this.sendNotification(notification);
        results.push(result);
      } catch (error) {
        console.error('Bulk notification error:', error);
        results.push({
          userId: notification.userId,
          error: error.message
        });
      }
    }

    return results;
  }
}

module.exports = NotificationService;