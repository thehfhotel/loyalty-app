const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class AnalyticsEvent {
  constructor(data) {
    this.id = data.id;
    this.eventName = data.event_name;
    this.userId = data.user_id;
    this.sessionId = data.session_id;
    this.eventData = data.event_data;
    this.userProperties = data.user_properties;
    this.platform = data.platform;
    this.appVersion = data.app_version;
    this.ipAddress = data.ip_address;
    this.userAgent = data.user_agent;
    this.referrer = data.referrer;
    this.createdAt = data.created_at;
  }

  static async track(eventData) {
    const {
      eventName,
      userId = null,
      sessionId = null,
      eventData: data = {},
      userProperties = {},
      platform = null,
      appVersion = null,
      ipAddress = null,
      userAgent = null,
      referrer = null
    } = eventData;

    const query = `
      INSERT INTO analytics_events (
        event_name, user_id, session_id, event_data, user_properties,
        platform, app_version, ip_address, user_agent, referrer
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      eventName,
      userId,
      sessionId,
      JSON.stringify(data),
      JSON.stringify(userProperties),
      platform,
      appVersion,
      ipAddress,
      userAgent,
      referrer
    ];

    const result = await db.query(query, values);
    const event = new AnalyticsEvent(result.rows[0]);

    // Process event for real-time metrics
    await this.processRealtimeMetrics(event);

    return event;
  }

  static async processRealtimeMetrics(event) {
    try {
      // Update session if provided
      if (event.sessionId) {
        await this.updateSession(event);
      }

      // Process specific event types
      switch (event.eventName) {
        case 'app_session_start':
          await this.processSessionStart(event);
          break;
        case 'user_registration':
          await this.processUserRegistration(event);
          break;
        case 'booking_completed':
          await this.processBookingCompleted(event);
          break;
        case 'points_earned':
          await this.processPointsEarned(event);
          break;
        case 'coupon_redeemed':
          await this.processCouponRedeemed(event);
          break;
        case 'survey_completed':
          await this.processSurveyCompleted(event);
          break;
      }
    } catch (error) {
      console.error('Error processing realtime metrics:', error);
    }
  }

  static async updateSession(event) {
    const upsertQuery = `
      INSERT INTO user_sessions (session_id, user_id, platform, app_version, ip_address, user_agent, events_count)
      VALUES ($1, $2, $3, $4, $5, $6, 1)
      ON CONFLICT (session_id)
      DO UPDATE SET 
        events_count = user_sessions.events_count + 1,
        ended_at = CASE 
          WHEN $7 = 'app_session_end' THEN NOW()
          ELSE user_sessions.ended_at
        END
    `;

    await db.query(upsertQuery, [
      event.sessionId,
      event.userId,
      event.platform,
      event.appVersion,
      event.ipAddress,
      event.userAgent,
      event.eventName
    ]);
  }

  static async processSessionStart(event) {
    // Update daily metrics
    await this.updateDailyMetric('sessions', 'total_sessions', 1);
    
    if (event.userId) {
      await this.updateDailyMetric('users', 'active_users', 1, { user_id: event.userId });
    }
  }

  static async processUserRegistration(event) {
    await this.updateDailyMetric('users', 'new_registrations', 1);
    
    // Update KPI dashboard
    await this.updateKPI('executive', 'daily_registrations', 1);
  }

  static async processBookingCompleted(event) {
    const bookingValue = event.eventData.booking_value || 0;
    
    await this.updateDailyMetric('revenue', 'total_bookings', 1);
    await this.updateDailyMetric('revenue', 'booking_revenue', bookingValue);
    
    // Update KPIs
    await this.updateKPI('executive', 'daily_revenue', bookingValue);
  }

  static async processPointsEarned(event) {
    const pointsAmount = event.eventData.points_amount || 0;
    await this.updateDailyMetric('loyalty', 'points_earned', pointsAmount);
  }

  static async processCouponRedeemed(event) {
    const discountAmount = event.eventData.discount_amount || 0;
    
    await this.updateDailyMetric('coupons', 'coupons_redeemed', 1);
    await this.updateDailyMetric('coupons', 'discount_value', discountAmount);
  }

  static async processSurveyCompleted(event) {
    await this.updateDailyMetric('surveys', 'surveys_completed', 1);
    
    if (event.eventData.nps_score) {
      await this.updateDailyMetric('surveys', 'nps_responses', 1);
    }
  }

  static async updateDailyMetric(metricType, metricName, value, dimensions = {}) {
    const query = `
      INSERT INTO daily_metrics (metric_date, metric_type, metric_name, metric_value, dimensions)
      VALUES (CURRENT_DATE, $1, $2, $3, $4)
      ON CONFLICT (metric_date, metric_type, metric_name, dimensions)
      DO UPDATE SET 
        metric_value = daily_metrics.metric_value + $3,
        updated_at = NOW()
    `;

    await db.query(query, [metricType, metricName, value, JSON.stringify(dimensions)]);
  }

  static async updateKPI(dashboardName, kpiName, value) {
    const query = `
      INSERT INTO kpi_dashboard (dashboard_name, kpi_name, kpi_value, period_type, period_start, period_end)
      VALUES ($1, $2, $3, 'daily', CURRENT_DATE, CURRENT_DATE)
      ON CONFLICT (dashboard_name, kpi_name, period_start, period_end)
      DO UPDATE SET 
        kpi_value = kpi_dashboard.kpi_value + $3,
        last_updated = NOW()
    `;

    await db.query(query, [dashboardName, kpiName, value]);
  }

  static async getEvents(options = {}) {
    const {
      eventName = null,
      userId = null,
      dateFrom = null,
      dateTo = null,
      page = 1,
      limit = 100
    } = options;

    let whereConditions = [];
    let queryParams = [];
    let paramCount = 1;

    if (eventName) {
      whereConditions.push(`event_name = $${paramCount}`);
      queryParams.push(eventName);
      paramCount++;
    }

    if (userId) {
      whereConditions.push(`user_id = $${paramCount}`);
      queryParams.push(userId);
      paramCount++;
    }

    if (dateFrom) {
      whereConditions.push(`created_at >= $${paramCount}`);
      queryParams.push(dateFrom);
      paramCount++;
    }

    if (dateTo) {
      whereConditions.push(`created_at <= $${paramCount}`);
      queryParams.push(dateTo);
      paramCount++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const query = `
      SELECT *
      FROM analytics_events
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    queryParams.push(limit, offset);

    const result = await db.query(query, queryParams);
    return result.rows.map(row => new AnalyticsEvent(row));
  }

  static async getEventCounts(timeframe = '24h') {
    let timeCondition = '';
    
    switch (timeframe) {
      case '1h':
        timeCondition = "created_at > NOW() - INTERVAL '1 hour'";
        break;
      case '24h':
        timeCondition = "created_at > NOW() - INTERVAL '24 hours'";
        break;
      case '7d':
        timeCondition = "created_at > NOW() - INTERVAL '7 days'";
        break;
      case '30d':
        timeCondition = "created_at > NOW() - INTERVAL '30 days'";
        break;
      default:
        timeCondition = "created_at > NOW() - INTERVAL '24 hours'";
    }

    const query = `
      SELECT 
        event_name,
        COUNT(*) as event_count,
        COUNT(DISTINCT user_id) as unique_users
      FROM analytics_events
      WHERE ${timeCondition}
      GROUP BY event_name
      ORDER BY event_count DESC
    `;

    const result = await db.query(query);
    return result.rows;
  }

  toJSON() {
    return {
      id: this.id,
      eventName: this.eventName,
      userId: this.userId,
      sessionId: this.sessionId,
      eventData: this.eventData,
      userProperties: this.userProperties,
      platform: this.platform,
      appVersion: this.appVersion,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      referrer: this.referrer,
      createdAt: this.createdAt
    };
  }
}

module.exports = AnalyticsEvent;