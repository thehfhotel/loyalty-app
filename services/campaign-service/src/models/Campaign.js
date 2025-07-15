const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Campaign {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.description = data.description;
    this.campaignType = data.campaign_type;
    this.status = data.status;
    this.content = data.content;
    this.targetCriteria = data.target_criteria;
    this.startDate = data.start_date;
    this.endDate = data.end_date;
    this.createdBy = data.created_by;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  static async create(campaignData) {
    const {
      name,
      description,
      campaignType,
      content,
      targetCriteria = {},
      startDate = null,
      endDate = null,
      createdBy
    } = campaignData;

    const query = `
      INSERT INTO campaigns (
        name, description, campaign_type, content, target_criteria,
        start_date, end_date, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const values = [
      name,
      description,
      campaignType,
      JSON.stringify(content),
      JSON.stringify(targetCriteria),
      startDate,
      endDate,
      createdBy
    ];

    const result = await db.query(query, values);
    return new Campaign(result.rows[0]);
  }

  static async findAll(options = {}) {
    const {
      status = null,
      campaignType = null,
      page = 1,
      limit = 20
    } = options;

    let whereConditions = [];
    let queryParams = [];
    let paramCount = 1;

    if (status) {
      whereConditions.push(`status = $${paramCount}`);
      queryParams.push(status);
      paramCount++;
    }

    if (campaignType) {
      whereConditions.push(`campaign_type = $${paramCount}`);
      queryParams.push(campaignType);
      paramCount++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const query = `
      SELECT c.*,
        COALESCE(stats.total_targeted, 0) as total_targeted,
        COALESCE(stats.total_delivered, 0) as total_delivered,
        COALESCE(stats.total_opened, 0) as total_opened,
        COALESCE(stats.total_clicked, 0) as total_clicked,
        CASE 
          WHEN stats.total_delivered > 0 
          THEN ROUND((stats.total_opened::DECIMAL / stats.total_delivered) * 100, 2)
          ELSE 0 
        END as open_rate
      FROM campaigns c
      LEFT JOIN (
        SELECT 
          campaign_id,
          COUNT(*) as total_targeted,
          COUNT(CASE WHEN status IN ('sent', 'delivered') THEN 1 END) as total_delivered,
          COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) as total_opened,
          COUNT(CASE WHEN clicked_at IS NOT NULL THEN 1 END) as total_clicked
        FROM campaign_deliveries
        GROUP BY campaign_id
      ) stats ON c.id = stats.campaign_id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    queryParams.push(limit, offset);

    const result = await db.query(query, queryParams);
    
    return result.rows.map(row => {
      const campaign = new Campaign(row);
      campaign.stats = {
        totalTargeted: parseInt(row.total_targeted),
        totalDelivered: parseInt(row.total_delivered),
        totalOpened: parseInt(row.total_opened),
        totalClicked: parseInt(row.total_clicked),
        openRate: parseFloat(row.open_rate)
      };
      return campaign;
    });
  }

  static async findById(id) {
    const query = `
      SELECT c.*,
        COALESCE(stats.total_targeted, 0) as total_targeted,
        COALESCE(stats.total_delivered, 0) as total_delivered,
        COALESCE(stats.total_opened, 0) as total_opened,
        COALESCE(stats.total_clicked, 0) as total_clicked
      FROM campaigns c
      LEFT JOIN (
        SELECT 
          campaign_id,
          COUNT(*) as total_targeted,
          COUNT(CASE WHEN status IN ('sent', 'delivered') THEN 1 END) as total_delivered,
          COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) as total_opened,
          COUNT(CASE WHEN clicked_at IS NOT NULL THEN 1 END) as total_clicked
        FROM campaign_deliveries
        GROUP BY campaign_id
      ) stats ON c.id = stats.campaign_id
      WHERE c.id = $1
    `;

    const result = await db.query(query, [id]);
    
    if (result.rows[0]) {
      const campaign = new Campaign(result.rows[0]);
      const row = result.rows[0];
      campaign.stats = {
        totalTargeted: parseInt(row.total_targeted),
        totalDelivered: parseInt(row.total_delivered),
        totalOpened: parseInt(row.total_opened),
        totalClicked: parseInt(row.total_clicked)
      };
      return campaign;
    }
    
    return null;
  }

  async updateStatus(newStatus) {
    const query = `
      UPDATE campaigns 
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const result = await db.query(query, [newStatus, this.id]);
    return new Campaign(result.rows[0]);
  }

  async getTargetAudience() {
    const criteria = this.targetCriteria;
    
    let whereConditions = ['u.deleted_at IS NULL'];
    let queryParams = [];
    let paramCount = 1;

    // Build dynamic query based on target criteria
    if (criteria.loyalty_tier && criteria.loyalty_tier.length > 0) {
      whereConditions.push(`u.loyalty_tier = ANY($${paramCount})`);
      queryParams.push(criteria.loyalty_tier);
      paramCount++;
    }

    if (criteria.min_total_spend) {
      whereConditions.push(`COALESCE(user_stats.total_spend, 0) >= $${paramCount}`);
      queryParams.push(criteria.min_total_spend);
      paramCount++;
    }

    if (criteria.min_bookings) {
      whereConditions.push(`COALESCE(user_stats.total_bookings, 0) >= $${paramCount}`);
      queryParams.push(criteria.min_bookings);
      paramCount++;
    }

    if (criteria.days_since_last_stay) {
      whereConditions.push(`user_stats.last_stay_date < NOW() - INTERVAL '${criteria.days_since_last_stay} days'`);
    }

    if (criteria.age_range && criteria.age_range.min && criteria.age_range.max) {
      whereConditions.push(`EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN $${paramCount} AND $${paramCount + 1}`);
      queryParams.push(criteria.age_range.min, criteria.age_range.max);
      paramCount += 2;
    }

    const query = `
      SELECT u.id, u.email, u.first_name, u.last_name, u.loyalty_tier, u.total_points
      FROM users u
      LEFT JOIN (
        SELECT 
          user_id,
          COUNT(*) as total_bookings,
          SUM(total_amount) as total_spend,
          MAX(checkout_date) as last_stay_date
        FROM bookings
        WHERE status = 'completed'
        GROUP BY user_id
      ) user_stats ON u.id = user_stats.user_id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY u.loyalty_tier DESC, u.total_points DESC
    `;

    const result = await db.query(query, queryParams);
    return result.rows;
  }

  async scheduleDelivery() {
    const audience = await this.getTargetAudience();
    
    if (audience.length === 0) {
      throw new Error('No users match the target criteria');
    }

    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Create delivery records for each user
      const deliveryPromises = audience.map(user => {
        const deliveryQuery = `
          INSERT INTO campaign_deliveries (
            campaign_id, user_id, delivery_channel, status
          ) VALUES ($1, $2, $3, 'pending')
          RETURNING id
        `;

        return client.query(deliveryQuery, [
          this.id,
          user.id,
          this.campaignType === 'multi_channel' ? 'push' : this.campaignType
        ]);
      });

      await Promise.all(deliveryPromises);

      // Update campaign status
      await client.query(
        'UPDATE campaigns SET status = $1, updated_at = NOW() WHERE id = $2',
        ['scheduled', this.id]
      );

      await client.query('COMMIT');

      return {
        campaignId: this.id,
        audienceSize: audience.length,
        deliveriesScheduled: audience.length
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getDeliveryMetrics(dateRange = null) {
    let dateCondition = '';
    let queryParams = [this.id];
    let paramCount = 2;

    if (dateRange && dateRange.from && dateRange.to) {
      dateCondition = `AND sent_at BETWEEN $${paramCount} AND $${paramCount + 1}`;
      queryParams.push(dateRange.from, dateRange.to);
      paramCount += 2;
    }

    const query = `
      SELECT 
        delivery_channel,
        status,
        COUNT(*) as count,
        COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) as opened_count,
        COUNT(CASE WHEN clicked_at IS NOT NULL THEN 1 END) as clicked_count,
        AVG(EXTRACT(EPOCH FROM (delivered_at - sent_at))) as avg_delivery_time
      FROM campaign_deliveries
      WHERE campaign_id = $1 ${dateCondition}
      GROUP BY delivery_channel, status
      ORDER BY delivery_channel, status
    `;

    const result = await db.query(query, queryParams);
    return result.rows;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      campaignType: this.campaignType,
      status: this.status,
      content: this.content,
      targetCriteria: this.targetCriteria,
      startDate: this.startDate,
      endDate: this.endDate,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Campaign;