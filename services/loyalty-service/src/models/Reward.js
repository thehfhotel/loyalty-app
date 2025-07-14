const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Reward {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.description = data.description;
    this.pointsCost = data.points_cost;
    this.category = data.category;
    this.minTier = data.min_tier;
    this.isActive = data.is_active;
    this.termsConditions = data.terms_conditions;
    this.imageUrl = data.image_url;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  static async findAll(options = {}) {
    const {
      category = null,
      minTier = null,
      isActive = true,
      page = 1,
      limit = 20
    } = options;

    let whereConditions = [];
    let queryParams = [];
    let paramCount = 1;

    if (category) {
      whereConditions.push(`category = $${paramCount}`);
      queryParams.push(category);
      paramCount++;
    }

    if (minTier) {
      // Get tier hierarchy
      const tierHierarchy = ['bronze', 'silver', 'gold', 'platinum'];
      const tierIndex = tierHierarchy.indexOf(minTier);
      
      if (tierIndex >= 0) {
        const allowedTiers = tierHierarchy.slice(0, tierIndex + 1);
        whereConditions.push(`min_tier = ANY($${paramCount})`);
        queryParams.push(allowedTiers);
        paramCount++;
      }
    }

    if (isActive !== null) {
      whereConditions.push(`is_active = $${paramCount}`);
      queryParams.push(isActive);
      paramCount++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    const offset = (page - 1) * limit;

    const query = `
      SELECT *
      FROM rewards
      ${whereClause}
      ORDER BY category, points_cost ASC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    queryParams.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) as total
      FROM rewards
      ${whereClause}
    `;

    const [rewards, countResult] = await Promise.all([
      db.query(query, queryParams),
      db.query(countQuery, queryParams.slice(0, -2))
    ]);

    return {
      rewards: rewards.rows.map(row => new Reward(row)),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(countResult.rows[0].total / limit),
        totalItems: parseInt(countResult.rows[0].total),
        itemsPerPage: parseInt(limit)
      }
    };
  }

  static async findById(id) {
    const query = 'SELECT * FROM rewards WHERE id = $1';
    const result = await db.query(query, [id]);
    return result.rows[0] ? new Reward(result.rows[0]) : null;
  }

  static async findAvailableForUser(userId) {
    const query = `
      SELECT r.*, u.loyalty_tier, u.total_points
      FROM rewards r
      CROSS JOIN users u
      WHERE u.id = $1
      AND r.is_active = true
      AND (
        CASE u.loyalty_tier
          WHEN 'bronze' THEN r.min_tier = 'bronze'
          WHEN 'silver' THEN r.min_tier IN ('bronze', 'silver')
          WHEN 'gold' THEN r.min_tier IN ('bronze', 'silver', 'gold')
          WHEN 'platinum' THEN r.min_tier IN ('bronze', 'silver', 'gold', 'platinum')
          ELSE false
        END
      )
      ORDER BY r.category, r.points_cost ASC
    `;

    const result = await db.query(query, [userId]);
    
    return result.rows.map(row => {
      const reward = new Reward(row);
      reward.canAfford = row.total_points >= row.points_cost;
      reward.userTier = row.loyalty_tier;
      reward.userPoints = row.total_points;
      return reward;
    });
  }

  async redeem(userId) {
    // Check if user meets requirements
    const userQuery = `
      SELECT loyalty_tier, total_points
      FROM users
      WHERE id = $1 AND deleted_at IS NULL
    `;

    const userResult = await db.query(userQuery, [userId]);
    const user = userResult.rows[0];

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    // Check tier requirement
    const tierHierarchy = ['bronze', 'silver', 'gold', 'platinum'];
    const userTierIndex = tierHierarchy.indexOf(user.loyalty_tier);
    const requiredTierIndex = tierHierarchy.indexOf(this.minTier);

    if (userTierIndex < requiredTierIndex) {
      const error = new Error(`Requires ${this.minTier} tier or higher`);
      error.name = 'TierRequirementError';
      error.statusCode = 403;
      throw error;
    }

    // Check points balance
    if (user.total_points < this.pointsCost) {
      const error = new Error('Insufficient points for this reward');
      error.name = 'InsufficientPointsError';
      error.statusCode = 400;
      throw error;
    }

    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Create redemption record
      const redemptionId = uuidv4();
      const redemptionCode = `RDM-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      
      const redemptionQuery = `
        INSERT INTO reward_redemptions (
          id, user_id, reward_id, points_used, redemption_code, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;

      // Most rewards expire in 6 months
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 6);

      const redemptionResult = await client.query(redemptionQuery, [
        redemptionId, userId, this.id, this.pointsCost, redemptionCode, expiresAt
      ]);

      // Create point transaction
      const PointTransaction = require('./PointTransaction');
      await PointTransaction.create({
        userId,
        pointsAmount: -this.pointsCost,
        transactionType: 'redeemed',
        description: `Redeemed: ${this.name}`,
        referenceId: redemptionId,
        referenceType: 'reward_redemption'
      });

      await client.query('COMMIT');
      
      return {
        redemption: redemptionResult.rows[0],
        reward: this,
        redemptionCode
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async getUserRedemptions(userId, options = {}) {
    const {
      status = null,
      page = 1,
      limit = 20
    } = options;

    let whereConditions = ['rr.user_id = $1'];
    let queryParams = [userId];
    let paramCount = 2;

    if (status) {
      whereConditions.push(`rr.status = $${paramCount}`);
      queryParams.push(status);
      paramCount++;
    }

    const offset = (page - 1) * limit;

    const query = `
      SELECT 
        rr.*,
        r.name as reward_name,
        r.description as reward_description,
        r.category as reward_category,
        r.image_url as reward_image_url
      FROM reward_redemptions rr
      JOIN rewards r ON rr.reward_id = r.id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY rr.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    queryParams.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) as total
      FROM reward_redemptions rr
      WHERE ${whereConditions.join(' AND ')}
    `;

    const [redemptions, countResult] = await Promise.all([
      db.query(query, queryParams),
      db.query(countQuery, queryParams.slice(0, -2))
    ]);

    return {
      redemptions: redemptions.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(countResult.rows[0].total / limit),
        totalItems: parseInt(countResult.rows[0].total),
        itemsPerPage: parseInt(limit)
      }
    };
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      pointsCost: this.pointsCost,
      category: this.category,
      minTier: this.minTier,
      isActive: this.isActive,
      termsConditions: this.termsConditions,
      imageUrl: this.imageUrl,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Reward;