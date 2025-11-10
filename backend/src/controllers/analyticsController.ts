import { Request, Response } from 'express';
import { analyticsService } from '../services/analyticsService';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

export class AnalyticsController {
  /**
   * Track a coupon usage event
   * POST /api/analytics/coupon-usage
   */
  async trackCouponUsage(req: Request, res: Response): Promise<void> {
    try {
      const { couponId, userCouponId, eventType, source, metadata } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        throw new AppError(401, 'User not authenticated');
      }

      if (!couponId || !eventType) {
        throw new AppError(400, 'couponId and eventType are required');
      }

      const validEventTypes = ['view', 'assign', 'redeem_attempt', 'redeem_success', 'redeem_fail', 'expire', 'revoke'];
      if (!validEventTypes.includes(eventType)) {
        throw new AppError(400, `Invalid eventType. Must be one of: ${validEventTypes.join(', ')}`);
      }

      await analyticsService.trackCouponUsage({
        userId,
        couponId,
        userCouponId,
        eventType,
        source,
        metadata,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(201).json({ 
        success: true, 
        message: 'Coupon usage event tracked successfully' 
      });
    } catch (error) {
      logger.error('Error tracking coupon usage:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * Track a profile change event
   * POST /api/analytics/profile-change
   */
  async trackProfileChange(req: Request, res: Response): Promise<void> {
    try {
      const { field, oldValue, newValue, changeSource = 'user', metadata } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        throw new AppError(401, 'User not authenticated');
      }

      if (!field || newValue === undefined) {
        throw new AppError(400, 'field and newValue are required');
      }

      const validSources = ['user', 'admin', 'system'];
      if (!validSources.includes(changeSource)) {
        throw new AppError(400, `Invalid changeSource. Must be one of: ${validSources.join(', ')}`);
      }

      await analyticsService.trackProfileChange({
        userId,
        field,
        oldValue: oldValue ?? null,
        newValue,
        changeSource,
        metadata,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(201).json({ 
        success: true, 
        message: 'Profile change event tracked successfully' 
      });
    } catch (error) {
      logger.error('Error tracking profile change:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * Get coupon usage analytics
   * GET /api/analytics/coupon-usage
   */
  async getCouponUsageAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const { startDate, endDate, couponId, userId } = req.query;

      const analytics = await analyticsService.getCouponUsageAnalytics(
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined,
        couponId as string,
        userId as string
      );

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error('Error getting coupon usage analytics:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * Get profile change analytics
   * GET /api/analytics/profile-changes
   */
  async getProfileChangeAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const { startDate, endDate, userId } = req.query;

      const analytics = await analyticsService.getProfileChangeAnalytics(
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined,
        userId as string
      );

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error('Error getting profile change analytics:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * Get user engagement metrics
   * GET /api/analytics/user-engagement
   */
  async getUserEngagementMetrics(req: Request, res: Response): Promise<void> {
    try {
      const { startDate, endDate } = req.query;

      const metrics = await analyticsService.getUserEngagementMetrics(
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );

      res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      logger.error('Error getting user engagement metrics:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * Update daily user analytics (typically called by cron job)
   * POST /api/analytics/update-daily
   */
  async updateDailyAnalytics(req: Request, res: Response): Promise<void> {
    try {
      // Only allow admin or system users to trigger this
      if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
        throw new AppError(403, 'Insufficient permissions');
      }

      const { date } = req.body;
      const targetDate = date ? new Date(date) : undefined;

      const recordsProcessed = await analyticsService.updateDailyUserAnalytics(targetDate);

      res.json({
        success: true,
        message: `Daily analytics updated successfully`,
        data: {
          recordsProcessed,
          date: targetDate?.toISOString().split('T')[0] ?? new Date().toISOString().split('T')[0]
        }
      });
    } catch (error) {
      logger.error('Error updating daily analytics:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * Get analytics dashboard summary (admin only)
   * GET /api/analytics/dashboard
   */
  async getAnalyticsDashboard(req: Request, res: Response): Promise<void> {
    try {
      // Only allow admin users
      if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
        throw new AppError(403, 'Insufficient permissions');
      }

      const { period = '30' } = req.query; // days
      const days = parseInt(period as string, 10);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get all analytics in parallel
      const [
        couponAnalytics,
        profileAnalytics,
        engagementMetrics
      ] = await Promise.all([
        analyticsService.getCouponUsageAnalytics(startDate),
        analyticsService.getProfileChangeAnalytics(startDate),
        analyticsService.getUserEngagementMetrics(startDate)
      ]);

      res.json({
        success: true,
        data: {
          period: `${days} days`,
          couponUsage: {
            totalEvents: couponAnalytics.totalEvents,
            uniqueUsers: couponAnalytics.uniqueUsers,
            conversionRate: couponAnalytics.conversionRate,
            topSources: couponAnalytics.topSources.slice(0, 5),
            eventBreakdown: couponAnalytics.eventsByType
          },
          profileChanges: {
            totalChanges: profileAnalytics.totalChanges,
            uniqueUsers: profileAnalytics.uniqueUsers,
            topFields: Object.entries(profileAnalytics.changesByField)
              .sort(([,a], [,b]) => b - a)
              .slice(0, 5)
              .map(([field, count]) => ({ field, count })),
            recentCompletions: profileAnalytics.completionMilestones.slice(0, 10)
          },
          userEngagement: {
            activeUsers: engagementMetrics.activeUsers,
            userSegments: engagementMetrics.userSegments,
            avgInteractions: {
              coupons: engagementMetrics.avgCouponsPerUser,
              profileChanges: engagementMetrics.avgProfileChangesPerUser
            },
            topUsers: engagementMetrics.topUsers.slice(0, 10)
          }
        }
      });
    } catch (error) {
      logger.error('Error getting analytics dashboard:', error);
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}

export const analyticsController = new AnalyticsController();