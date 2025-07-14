const db = require('../config/database');

class LoyaltyTier {
  constructor(data) {
    this.id = data.id;
    this.tierName = data.tier_name;
    this.minPoints = data.min_points;
    this.minNights = data.min_nights;
    this.minSpend = parseFloat(data.min_spend);
    this.benefits = data.benefits;
    this.pointMultiplier = parseFloat(data.point_multiplier);
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  static async findAll() {
    const query = `
      SELECT * FROM loyalty_tiers
      ORDER BY min_points ASC
    `;

    const result = await db.query(query);
    return result.rows.map(row => new LoyaltyTier(row));
  }

  static async findByName(tierName) {
    const query = 'SELECT * FROM loyalty_tiers WHERE tier_name = $1';
    const result = await db.query(query, [tierName]);
    return result.rows[0] ? new LoyaltyTier(result.rows[0]) : null;
  }

  static async getUserTierInfo(userId) {
    const query = `
      SELECT 
        u.loyalty_tier,
        u.total_points,
        lt.min_points,
        lt.min_nights,
        lt.min_spend,
        lt.benefits,
        lt.point_multiplier,
        -- Calculate progress to next tier
        next_lt.tier_name as next_tier_name,
        next_lt.min_points as next_tier_points,
        CASE 
          WHEN next_lt.min_points IS NOT NULL 
          THEN ROUND(((u.total_points::DECIMAL / next_lt.min_points) * 100), 2)
          ELSE 100.00
        END as progress_to_next_tier,
        -- Calculate user stats from bookings and transactions
        COALESCE(stats.total_nights, 0) as total_nights,
        COALESCE(stats.total_spend, 0) as total_spend,
        COALESCE(stats.this_year_nights, 0) as this_year_nights,
        COALESCE(stats.this_year_spend, 0) as this_year_spend
      FROM users u
      JOIN loyalty_tiers lt ON u.loyalty_tier = lt.tier_name
      LEFT JOIN loyalty_tiers next_lt ON next_lt.min_points > lt.min_points
        AND next_lt.min_points = (
          SELECT MIN(min_points) 
          FROM loyalty_tiers 
          WHERE min_points > lt.min_points
        )
      LEFT JOIN (
        SELECT 
          user_id,
          SUM(nights_count) as total_nights,
          SUM(total_amount) as total_spend,
          SUM(CASE WHEN EXTRACT(YEAR FROM checkin_date) = EXTRACT(YEAR FROM NOW()) 
              THEN nights_count ELSE 0 END) as this_year_nights,
          SUM(CASE WHEN EXTRACT(YEAR FROM checkin_date) = EXTRACT(YEAR FROM NOW()) 
              THEN total_amount ELSE 0 END) as this_year_spend
        FROM bookings
        WHERE status = 'completed'
        GROUP BY user_id
      ) stats ON u.id = stats.user_id
      WHERE u.id = $1 AND u.deleted_at IS NULL
    `;

    const result = await db.query(query, [userId]);
    
    if (result.rows.length === 0) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    const tierInfo = result.rows[0];

    // Check if user qualifies for tier upgrade
    const qualifiesForUpgrade = await this.checkTierUpgradeEligibility(
      tierInfo.total_points,
      tierInfo.this_year_nights,
      tierInfo.this_year_spend
    );

    return {
      currentTier: {
        name: tierInfo.loyalty_tier,
        minPoints: tierInfo.min_points,
        minNights: tierInfo.min_nights,
        minSpend: tierInfo.min_spend,
        benefits: tierInfo.benefits,
        pointMultiplier: tierInfo.point_multiplier
      },
      nextTier: tierInfo.next_tier_name ? {
        name: tierInfo.next_tier_name,
        minPoints: tierInfo.next_tier_points,
        progressPercentage: tierInfo.progress_to_next_tier
      } : null,
      userStats: {
        totalPoints: tierInfo.total_points,
        totalNights: tierInfo.total_nights,
        totalSpend: tierInfo.total_spend,
        thisYearNights: tierInfo.this_year_nights,
        thisYearSpend: tierInfo.this_year_spend
      },
      qualifiesForUpgrade
    };
  }

  static async checkTierUpgradeEligibility(totalPoints, thisYearNights, thisYearSpend) {
    const query = `
      SELECT tier_name, min_points, min_nights, min_spend
      FROM loyalty_tiers
      WHERE min_points <= $1 
      AND min_nights <= $2 
      AND min_spend <= $3
      ORDER BY min_points DESC
      LIMIT 1
    `;

    const result = await db.query(query, [totalPoints, thisYearNights, thisYearSpend]);
    return result.rows[0] || null;
  }

  static async calculatePointsForBooking(bookingAmount, userTier = 'bronze') {
    const tierQuery = 'SELECT point_multiplier FROM loyalty_tiers WHERE tier_name = $1';
    const tierResult = await db.query(tierQuery, [userTier]);
    
    const multiplier = tierResult.rows[0]?.point_multiplier || 1.00;
    
    // Base: 1 point per dollar spent
    const basePoints = Math.floor(bookingAmount);
    const bonusPoints = Math.floor(basePoints * (multiplier - 1));
    
    return {
      basePoints,
      bonusPoints,
      totalPoints: basePoints + bonusPoints,
      multiplier
    };
  }

  static async getTierBenefits(tierName) {
    const tier = await this.findByName(tierName);
    return tier ? tier.benefits : null;
  }

  static async getTierComparison() {
    const tiers = await this.findAll();
    
    return tiers.map(tier => ({
      tierName: tier.tierName,
      minPoints: tier.minPoints,
      minNights: tier.minNights,
      minSpend: tier.minSpend,
      pointMultiplier: tier.pointMultiplier,
      benefits: tier.benefits.benefits || [],
      description: tier.benefits.description || ''
    }));
  }

  static async getUsersCountByTier() {
    const query = `
      SELECT 
        loyalty_tier,
        COUNT(*) as user_count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM users
      WHERE deleted_at IS NULL
      GROUP BY loyalty_tier
      ORDER BY 
        CASE loyalty_tier
          WHEN 'bronze' THEN 1
          WHEN 'silver' THEN 2
          WHEN 'gold' THEN 3
          WHEN 'platinum' THEN 4
        END
    `;

    const result = await db.query(query);
    return result.rows;
  }

  toJSON() {
    return {
      id: this.id,
      tierName: this.tierName,
      minPoints: this.minPoints,
      minNights: this.minNights,
      minSpend: this.minSpend,
      benefits: this.benefits,
      pointMultiplier: this.pointMultiplier,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = LoyaltyTier;