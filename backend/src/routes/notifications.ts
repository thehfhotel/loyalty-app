import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { NotificationService } from '../services/notificationService';
import { MarkReadRequest, NotificationType } from '../types/notification';

const router = Router();
const notificationService = new NotificationService();

// All routes require authentication
router.use(authenticate);

// Get user's notifications with pagination
router.get('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50); // Max 50 per page
    const includeRead = req.query.includeRead !== 'false'; // Default to true

    const result = await notificationService.getUserNotifications(
      req.user.id, 
      page, 
      limit, 
      includeRead
    );

    return res.json({
      success: true,
      data: result,
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

// Mark notifications as read
router.patch('/mark-read', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { notificationIds, markAll }: MarkReadRequest = req.body;

    if (!markAll && (!notificationIds || !Array.isArray(notificationIds))) {
      return res.status(400).json({ 
        error: 'Either provide notificationIds array or set markAll to true' 
      });
    }

    let markedCount = 0;

    if (markAll) {
      markedCount = await notificationService.markAllNotificationsRead(req.user.id);
    } else if (notificationIds && notificationIds.length > 0) {
      markedCount = await notificationService.markNotificationsRead(req.user.id, notificationIds);
    }

    return res.json({
      success: true,
      data: { markedCount },
      message: `${markedCount} notification${markedCount !== 1 ? 's' : ''} marked as read`
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
      data: preferences
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

    const { preferences } = req.body;

    if (!preferences || !Array.isArray(preferences)) {
      return res.status(400).json({ 
        error: 'Preferences array is required' 
      });
    }

    // Validate preferences format
    for (const pref of preferences) {
      if (!pref.type || typeof pref.enabled !== 'boolean') {
        return res.status(400).json({ 
          error: 'Each preference must have type (string) and enabled (boolean)' 
        });
      }
    }

    const updatedPreferences = await notificationService.updateUserPreferences(
      req.user.id,
      preferences
    );

    return res.json({
      success: true,
      data: updatedPreferences,
      message: 'Notification preferences updated successfully'
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

export default router;