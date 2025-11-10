import { query, getClient } from '../config/database';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

interface CouponUsageEvent {
  userId: string;
  couponId: string;
  userCouponId?: string;
  eventType: 'view' | 'assign' | 'redeem_attempt' | 'redeem_success' | 'redeem_fail' | 'expire' | 'revoke';
  source?: string; // 'admin_assign', 'profile_completion', 'bulk_assign', etc.
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

interface ProfileChangeEvent {
  userId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changeSource: 'user' | 'admin' | 'system';
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}


export class AnalyticsService {
  /**
   * Track coupon usage events for better business insights
   */
  async trackCouponUsage(event: CouponUsageEvent): Promise<void> {
    try {
      await query(
        `INSERT INTO coupon_usage_events (
          user_id, coupon_id, user_coupon_id, event_type, source, 
          metadata, ip_address, user_agent, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          event.userId,
          event.couponId,
          event.userCouponId ?? null,
          event.eventType,
          event.source ?? null,
          JSON.stringify(event.metadata ?? {}),
          event.ipAddress ?? null,
          event.userAgent ?? null
        ]
      );

      logger.info('Coupon usage event tracked', {
        userId: event.userId,
        couponId: event.couponId,
        eventType: event.eventType,
        source: event.source
      });
    } catch (error) {
      logger.error('Failed to track coupon usage event', {
        event,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Track profile changes with detailed before/after values
   */
  async trackProfileChange(change: ProfileChangeEvent): Promise<void> {
    try {
      await query(
        `INSERT INTO profile_change_events (
          user_id, field, old_value, new_value, change_source,
          metadata, ip_address, user_agent, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          change.userId,
          change.field,
          JSON.stringify(change.oldValue),
          JSON.stringify(change.newValue),
          change.changeSource,
          JSON.stringify(change.metadata ?? {}),
          change.ipAddress ?? null,
          change.userAgent ?? null
        ]
      );

      logger.info('Profile change tracked', {
        userId: change.userId,
        field: change.field,
        changeSource: change.changeSource,
        hasOldValue: change.oldValue !== null && change.oldValue !== undefined,
        hasNewValue: change.newValue !== null && change.newValue !== undefined
      });
    } catch (error) {
      logger.error('Failed to track profile change', {
        change,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Enhanced method to track multiple profile changes in a single transaction
   */
  async trackMultipleProfileChanges(
    userId: string,
    changes: Array<{
      field: string;
      oldValue: unknown;
      newValue: unknown;
    }>,
    changeSource: 'user' | 'admin' | 'system',
    metadata?: Record<string, unknown>,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    if (changes.length === 0) return;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      for (const change of changes) {
        await client.query(
          `INSERT INTO profile_change_events (
            user_id, field, old_value, new_value, change_source,
            metadata, ip_address, user_agent, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            userId,
            change.field,
            JSON.stringify(change.oldValue),
            JSON.stringify(change.newValue),
            changeSource,
            JSON.stringify(metadata ?? {}),
            ipAddress ?? null,
            userAgent ?? null
          ]
        );
      }

      await client.query('COMMIT');

      logger.info('Multiple profile changes tracked', {
        userId,
        changeCount: changes.length,
        fields: changes.map(c => c.field),
        changeSource
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to track multiple profile changes', {
        userId,
        changes,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get comprehensive coupon usage analytics
   */
  async getCouponUsageAnalytics(
    startDate?: Date,
    endDate?: Date,
    couponId?: string,
    userId?: string
  ): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    uniqueUsers: number;
    conversionRate: number;
    topSources: Array<{ source: string; count: number }>;
    dailyStats: Array<{
      date: string;
      views: number;
      assignments: number;
      redemptions: number;
      conversionRate: number;
    }>;
  }> {
    const whereConditions: string[] = [];
    const whereValues: (string | Date)[] = [];
    let paramIndex = 1;

    if (startDate) {
      whereConditions.push(`created_at >= $${paramIndex}`);
      whereValues.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereConditions.push(`created_at <= $${paramIndex}`);
      whereValues.push(endDate);
      paramIndex++;
    }

    if (couponId) {
      whereConditions.push(`coupon_id = $${paramIndex}`);
      whereValues.push(couponId);
      paramIndex++;
    }

    if (userId) {
      whereConditions.push(`user_id = $${paramIndex}`);
      whereValues.push(userId);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total events and event type breakdown
    const [totalStats] = await query<{
      totalEvents: number;
      uniqueUsers: number;
    }>(
      `SELECT 
        COUNT(*) as "totalEvents",
        COUNT(DISTINCT user_id) as "uniqueUsers"
       FROM coupon_usage_events ${whereClause}`,
      whereValues
    );

    // Get events by type
    const eventsByType = await query<{ eventType: string; count: number }>(
      `SELECT 
        event_type as "eventType",
        COUNT(*) as count
       FROM coupon_usage_events ${whereClause}
       GROUP BY event_type
       ORDER BY count DESC`,
      whereValues
    );

    // Get top sources
    const topSources = await query<{ source: string; count: number }>(
      `SELECT 
        COALESCE(source, 'unknown') as source,
        COUNT(*) as count
       FROM coupon_usage_events ${whereClause}
       GROUP BY source
       ORDER BY count DESC
       LIMIT 10`,
      whereValues
    );

    // Calculate conversion rate (redemptions / assignments)
    const eventTypeMap = eventsByType.reduce((acc, item) => {
      acc[item.eventType] = item.count;
      return acc;
    }, {} as Record<string, number>);

    const assignments = (eventTypeMap.assign ?? 0);
    const redemptions = (eventTypeMap.redeem_success ?? 0);
    const conversionRate = assignments > 0 ? (redemptions / assignments) * 100 : 0;

    // Get daily statistics
    const dailyStats = await query<{
      date: string;
      views: number;
      assignments: number;
      redemptions: number;
    }>(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) FILTER (WHERE event_type = 'view') as views,
        COUNT(*) FILTER (WHERE event_type = 'assign') as assignments,
        COUNT(*) FILTER (WHERE event_type = 'redeem_success') as redemptions
       FROM coupon_usage_events ${whereClause}
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT 30`,
      whereValues
    );

    // Add conversion rate to daily stats
    const dailyStatsWithConversion = dailyStats.map(day => ({
      ...day,
      conversionRate: day.assignments > 0 ? (day.redemptions / day.assignments) * 100 : 0
    }));

    if (!totalStats) {
      throw new AppError(500, 'Failed to get usage analytics stats');
    }

    return {
      totalEvents: totalStats.totalEvents,
      eventsByType: eventTypeMap,
      uniqueUsers: totalStats.uniqueUsers,
      conversionRate: Number(conversionRate.toFixed(2)),
      topSources,
      dailyStats: dailyStatsWithConversion
    };
  }

  /**
   * Get profile change analytics
   */
  async getProfileChangeAnalytics(
    startDate?: Date,
    endDate?: Date,
    userId?: string
  ): Promise<{
    totalChanges: number;
    uniqueUsers: number;
    changesByField: Record<string, number>;
    changesBySource: Record<string, number>;
    completionMilestones: Array<{
      userId: string;
      firstName: string;
      lastName: string;
      email: string;
      completedAt: Date;
      fieldsCompleted: string[];
    }>;
    dailyActivity: Array<{
      date: string;
      totalChanges: number;
      uniqueUsers: number;
      topField: string;
    }>;
  }> {
    const whereConditions: string[] = [];
    const whereValues: (string | Date)[] = [];
    let paramIndex = 1;

    if (startDate) {
      whereConditions.push(`pce.created_at >= $${paramIndex}`);
      whereValues.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereConditions.push(`pce.created_at <= $${paramIndex}`);
      whereValues.push(endDate);
      paramIndex++;
    }

    if (userId) {
      whereConditions.push(`pce.user_id = $${paramIndex}`);
      whereValues.push(userId);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total changes and unique users
    const [totalStats] = await query<{
      totalChanges: number;
      uniqueUsers: number;
    }>(
      `SELECT 
        COUNT(*) as "totalChanges",
        COUNT(DISTINCT user_id) as "uniqueUsers"
       FROM profile_change_events pce ${whereClause}`,
      whereValues
    );

    // Get changes by field
    const changesByField = await query<{ field: string; count: number }>(
      `SELECT 
        field,
        COUNT(*) as count
       FROM profile_change_events pce ${whereClause}
       GROUP BY field
       ORDER BY count DESC`,
      whereValues
    );

    // Get changes by source
    const changesBySource = await query<{ changeSource: string; count: number }>(
      `SELECT 
        change_source as "changeSource",
        COUNT(*) as count
       FROM profile_change_events pce ${whereClause}
       GROUP BY change_source
       ORDER BY count DESC`,
      whereValues
    );

    // Get completion milestones (users who completed their profile)
    const completionMilestones = await query<{
      userId: string;
      firstName: string;
      lastName: string;
      email: string;
      completedAt: Date;
    }>(
      `SELECT DISTINCT
        up.user_id as "userId",
        up.first_name as "firstName",
        up.last_name as "lastName",
        u.email,
        up.profile_completed_at as "completedAt"
       FROM user_profiles up
       JOIN users u ON up.user_id = u.id
       WHERE up.profile_completed = true
         AND up.profile_completed_at IS NOT NULL
         ${startDate ? 'AND up.profile_completed_at >= $' + (whereValues.length + 1) : ''}
         ${endDate ? 'AND up.profile_completed_at <= $' + (whereValues.length + (startDate ? 2 : 1)) : ''}
       ORDER BY up.profile_completed_at DESC
       LIMIT 50`,
      [
        ...(startDate ? [startDate] : []),
        ...(endDate ? [endDate] : [])
      ]
    );

    // Get fields completed for each milestone
    const milestonesWithFields = await Promise.all(
      completionMilestones.map(async (milestone) => {
        const fieldsCompleted = await query<{ field: string }>(
          `SELECT DISTINCT field
           FROM profile_change_events 
           WHERE user_id = $1 
             AND created_at <= $2
             AND new_value != 'null'
             AND new_value != '""'
             AND new_value != '[]'
           ORDER BY field`,
          [milestone.userId, milestone.completedAt]
        );

        return {
          ...milestone,
          fieldsCompleted: fieldsCompleted.map(f => f.field)
        };
      })
    );

    // Get daily activity
    const dailyActivity = await query<{
      date: string;
      totalChanges: number;
      uniqueUsers: number;
    }>(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as "totalChanges",
        COUNT(DISTINCT user_id) as "uniqueUsers"
       FROM profile_change_events pce ${whereClause}
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT 30`,
      whereValues
    );

    // Add top field for each day
    const dailyActivityWithTopField = await Promise.all(
      dailyActivity.map(async (day) => {
        const [topField] = await query<{ field: string; count: number }>(
          `SELECT 
            field,
            COUNT(*) as count
           FROM profile_change_events
           WHERE DATE(created_at) = $1
           GROUP BY field
           ORDER BY count DESC
           LIMIT 1`,
          [day.date]
        );

        return {
          ...day,
          topField: topField?.field ?? 'none'
        };
      })
    );

    // Convert arrays to objects for easier consumption
    const fieldMap = changesByField.reduce((acc, item) => {
      acc[item.field] = item.count;
      return acc;
    }, {} as Record<string, number>);

    const sourceMap = changesBySource.reduce((acc, item) => {
      acc[item.changeSource] = item.count;
      return acc;
    }, {} as Record<string, number>);

    if (!totalStats) {
      throw new AppError(500, 'Failed to get profile change analytics stats');
    }

    return {
      totalChanges: totalStats.totalChanges,
      uniqueUsers: totalStats.uniqueUsers,
      changesByField: fieldMap,
      changesBySource: sourceMap,
      completionMilestones: milestonesWithFields,
      dailyActivity: dailyActivityWithTopField
    };
  }

  /**
   * Update daily user analytics (typically run as a scheduled job)
   */
  async updateDailyUserAnalytics(date?: Date): Promise<number> {
    const analyticsDate = date ?? new Date();
    
    const result = await query<{ id: string }>(
      `INSERT INTO user_analytics (
        user_id, analytics_date, coupons_viewed, coupons_redeemed,
        profile_changes, last_activity_at, created_at
      )
      SELECT 
        u.id,
        $1::date,
        COALESCE(coupon_stats.views, 0),
        COALESCE(coupon_stats.redemptions, 0),
        COALESCE(profile_stats.changes, 0),
        GREATEST(
          COALESCE(coupon_stats.last_activity, '1970-01-01'::timestamptz),
          COALESCE(profile_stats.last_activity, '1970-01-01'::timestamptz)
        ),
        NOW()
      FROM users u
      LEFT JOIN (
        SELECT 
          user_id,
          COUNT(*) FILTER (WHERE event_type = 'view') as views,
          COUNT(*) FILTER (WHERE event_type = 'redeem_success') as redemptions,
          MAX(created_at) as last_activity
        FROM coupon_usage_events
        WHERE DATE(created_at) = $1::date
        GROUP BY user_id
      ) coupon_stats ON u.id = coupon_stats.user_id
      LEFT JOIN (
        SELECT 
          user_id,
          COUNT(*) as changes,
          MAX(created_at) as last_activity
        FROM profile_change_events
        WHERE DATE(created_at) = $1::date
        GROUP BY user_id
      ) profile_stats ON u.id = profile_stats.user_id
      WHERE COALESCE(coupon_stats.views, 0) > 0 
         OR COALESCE(coupon_stats.redemptions, 0) > 0
         OR COALESCE(profile_stats.changes, 0) > 0
      ON CONFLICT (user_id, analytics_date) DO UPDATE SET
        coupons_viewed = EXCLUDED.coupons_viewed,
        coupons_redeemed = EXCLUDED.coupons_redeemed,
        profile_changes = EXCLUDED.profile_changes,
        last_activity_at = EXCLUDED.last_activity_at,
        updated_at = NOW()
      RETURNING id`,
      [analyticsDate]
    );

    const recordsUpdated = result.length;
    
    logger.info(`Updated daily user analytics for ${analyticsDate.toISOString().split('T')[0]}: ${recordsUpdated} users processed`);
    
    return recordsUpdated;
  }

  /**
   * Get user engagement metrics
   */
  async getUserEngagementMetrics(
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    activeUsers: number;
    totalSessions: number;
    avgCouponsPerUser: number;
    avgProfileChangesPerUser: number;
    userSegments: {
      highEngagement: number; // 5+ interactions
      mediumEngagement: number; // 2-4 interactions  
      lowEngagement: number; // 1 interaction
    };
    topUsers: Array<{
      userId: string;
      firstName: string;
      lastName: string;
      email: string;
      totalInteractions: number;
      couponsViewed: number;
      couponsRedeemed: number;
      profileChanges: number;
    }>;
  }> {
    const whereConditions: string[] = [];
    const whereValues: (string | Date)[] = [];
    let paramIndex = 1;

    if (startDate) {
      whereConditions.push(`analytics_date >= $${paramIndex}`);
      whereValues.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereConditions.push(`analytics_date <= $${paramIndex}`);
      whereValues.push(endDate);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get overall metrics
    const [overallMetrics] = await query<{
      activeUsers: number;
      totalSessions: number;
      avgCouponsPerUser: number;
      avgProfileChangesPerUser: number;
    }>(
      `SELECT 
        COUNT(DISTINCT user_id) as "activeUsers",
        COUNT(*) as "totalSessions",
        AVG(coupons_viewed + coupons_redeemed) as "avgCouponsPerUser",
        AVG(profile_changes) as "avgProfileChangesPerUser"
       FROM user_analytics ua ${whereClause}`,
      whereValues
    );

    // Get user engagement segments
    const engagementData = await query<{
      userId: string;
      totalInteractions: number;
    }>(
      `SELECT 
        user_id as "userId",
        SUM(coupons_viewed + coupons_redeemed + profile_changes) as "totalInteractions"
       FROM user_analytics ua ${whereClause}
       GROUP BY user_id`,
      whereValues
    );

    const userSegments = engagementData.reduce(
      (acc, user) => {
        if (user.totalInteractions >= 5) {
          acc.highEngagement++;
        } else if (user.totalInteractions >= 2) {
          acc.mediumEngagement++;
        } else {
          acc.lowEngagement++;
        }
        return acc;
      },
      { highEngagement: 0, mediumEngagement: 0, lowEngagement: 0 }
    );

    // Get top users
    const topUsers = await query<{
      userId: string;
      firstName: string;
      lastName: string;
      email: string;
      totalInteractions: number;
      couponsViewed: number;
      couponsRedeemed: number;
      profileChanges: number;
    }>(
      `SELECT 
        ua.user_id as "userId",
        COALESCE(up.first_name, '') as "firstName",
        COALESCE(up.last_name, '') as "lastName",
        u.email,
        SUM(ua.coupons_viewed + ua.coupons_redeemed + ua.profile_changes) as "totalInteractions",
        SUM(ua.coupons_viewed) as "couponsViewed",
        SUM(ua.coupons_redeemed) as "couponsRedeemed",
        SUM(ua.profile_changes) as "profileChanges"
       FROM user_analytics ua
       JOIN users u ON ua.user_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       ${whereClause}
       GROUP BY ua.user_id, up.first_name, up.last_name, u.email
       ORDER BY "totalInteractions" DESC
       LIMIT 20`,
      whereValues
    );

    if (!overallMetrics) {
      throw new AppError(500, 'Failed to get user engagement metrics');
    }

    return {
      activeUsers: overallMetrics.activeUsers,
      totalSessions: overallMetrics.totalSessions,
      avgCouponsPerUser: Number(overallMetrics.avgCouponsPerUser?.toFixed(2) ?? 0),
      avgProfileChangesPerUser: Number(overallMetrics.avgProfileChangesPerUser?.toFixed(2) ?? 0),
      userSegments,
      topUsers
    };
  }
}

export const analyticsService = new AnalyticsService();