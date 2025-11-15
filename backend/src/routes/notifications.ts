import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { NotificationService } from '../services/notificationService';
import { NotificationType } from '../types/notification';
import { logger } from '../utils/logger';

const router = Router();
const notificationService = new NotificationService();

// VAPID public key endpoint (no auth required)
router.get('/vapid-key', (_req, res) => {
  try {
    // In a real implementation, you would have VAPID keys configured
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    
    if (!publicKey) {
      logger.warn('[Notifications] VAPID public key not configured');
      return res.status(503).json({
        error: 'Push notifications not configured',
        configured: false
      });
    }

    return res.json({
      publicKey,
      configured: true
    });
  } catch (error) {
    logger.error('[Notifications] Failed to get VAPID key:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// All other routes require authentication
router.use(authenticate);

// Get user's notifications with pagination
router.get('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const requestedPage = parseInt(req.query.page as string);
    const requestedLimit = parseInt(req.query.limit as string);

    // Ensure page is at least 1 (handle negative, zero, decimal, and NaN)
    const page = Math.max(1, Math.floor(requestedPage)) || 1;
    // Ensure limit is between 1 and 50 (handle negative, zero, decimal, and NaN)
    const limit = Math.min(50, Math.max(1, Math.floor(requestedLimit))) || 20;
    const includeRead = req.query.includeRead !== 'false'; // Default to true

    const result = await notificationService.getUserNotifications(
      req.user.id,
      page,
      limit,
      includeRead
    );

    return res.json({
      notifications: result.notifications || [],
      pagination: {
        page,
        limit,
        total: result.total,
        pages: Math.ceil(result.total / limit)
      }
    });
  } catch (error) {
    return next(error);
  }
});

// Get unread notification count
router.get('/unread-count', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const count = await notificationService.getUnreadCount(req.user.id);

    return res.json({
      success: true,
      data: { unreadCount: count }
    });
  } catch (error) {
    return next(error);
  }
});

// Mark notifications as read (single or multiple)
router.post('/mark-read', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { notificationIds }: { notificationIds: string[] } = req.body;

    if (!notificationIds || !Array.isArray(notificationIds)) {
      return res.status(400).json({
        error: 'notificationIds array is required'
      });
    }

    let markedCount = 0;

    if (notificationIds.length > 0) {
      markedCount = await notificationService.markNotificationsRead(req.user.id, notificationIds);
    }

    return res.json({
      success: true,
      markedRead: markedCount
    });
  } catch (error) {
    return next(error);
  }
});

// Mark all notifications as read
router.post('/mark-all-read', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const markedCount = await notificationService.markAllNotificationsRead(req.user.id);

    return res.json({
      success: true,
      markedRead: markedCount
    });
  } catch (error) {
    return next(error);
  }
});

// Delete a specific notification
router.delete('/:notificationId', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { notificationId } = req.params;

    if (!notificationId) {
      return res.status(400).json({ error: 'Notification ID is required' });
    }

    const wasDeleted = await notificationService.deleteNotification(req.user.id, notificationId);

    if (!wasDeleted) {
      return res.status(404).json({ error: 'Notification not found or already deleted' });
    }

    return res.json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    return next(error);
  }
});

// Get user's notification preferences
router.get('/preferences', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const preferences = await notificationService.getUserPreferences(req.user.id);

    return res.json({
      success: true,
      preferences
    });
  } catch (error) {
    return next(error);
  }
});

// Update user's notification preferences
router.put('/preferences', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const preferences = req.body;

    // Allow both object format and array format for backward compatibility
    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({
        error: 'Preferences object is required'
      });
    }

    const updatedPreferences = await notificationService.updateUserPreferences(
      req.user.id,
      preferences
    );

    return res.json({
      success: true,
      preferences: updatedPreferences
    });
  } catch (error) {
    return next(error);
  }
});

// Create a test notification (development only)
router.post('/test', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Test notifications not available in production' });
    }

    const { title, message, type } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    const validTypes: NotificationType[] = ['info', 'success', 'warning', 'error', 'system', 'reward', 'coupon', 'survey', 'profile'];
    const notificationType: NotificationType = validTypes.includes(type) ? type : 'info';

    const notification = await notificationService.createNotification({
      userId: req.user.id,
      title,
      message,
      type: notificationType,
      data: { isTest: true }
    });

    return res.json({
      success: true,
      data: notification,
      message: 'Test notification created successfully'
    });
  } catch (error) {
    return next(error);
  }
});

// Admin route: cleanup expired notifications
router.post('/admin/cleanup', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user is admin
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const deletedCount = await notificationService.cleanupExpiredNotifications();

    return res.json({
      success: true,
      data: { deletedCount },
      message: `${deletedCount} expired notifications cleaned up`
    });
  } catch (error) {
    return next(error);
  }
});

// PWA Push Notification endpoints
// Subscribe to push notifications
router.post('/push/subscribe', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { subscription, platform } = req.body;
    
    if (!subscription) {
      return res.status(400).json({ error: 'Missing subscription data' });
    }
    
    // In a real implementation, you would save the subscription to database
    logger.info('[Notifications] Push subscription received', {
      userId: req.user.id,
      platform,
      endpoint: subscription.endpoint ? 'present' : 'missing'
    });
    
    // TODO: Save subscription to database
    // await saveUserPushSubscription(req.user.id, subscription, platform);
    
    res.json({ 
      success: true,
      message: 'Successfully subscribed to push notifications' 
    });
  } catch (error) {
    return next(error);
  }
});

// Unsubscribe from push notifications
router.post('/push/unsubscribe', async (req, res, next) => {
  try {
    const { subscription } = req.body;
    
    if (!subscription) {
      return res.status(400).json({ error: 'Missing subscription' });
    }
    
    // In a real implementation, you would remove the subscription from database
    logger.info('[Notifications] Push unsubscription received', {
      endpoint: subscription.endpoint ? 'present' : 'missing'
    });
    
    // TODO: Remove subscription from database
    // await removeUserPushSubscription(subscription);
    
    res.json({ 
      success: true,
      message: 'Successfully unsubscribed from push notifications' 
    });
  } catch (error) {
    return next(error);
  }
});

export default router;