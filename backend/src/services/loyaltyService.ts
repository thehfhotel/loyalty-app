import { Pool } from 'pg';
import { 
  PointsRule,
  PointsTransaction,
  PointsEarningRequest,
  RedemptionOption,
  RedemptionRequest,
  CreateRedemptionRequest,
  LoyaltyDashboard,
  PointsBalanceUpdate,
  LoyaltyAnalytics,
  TierUpdate,
  CreateTier,
  CreatePointsRule,
  UpdatePointsRule
} from '@hotel-loyalty/shared/types/loyalty';
import { Tier } from '@hotel-loyalty/shared/types/customer';
import { db } from '../config/database.js';

export class LoyaltyService {
  private pool: Pool;

  constructor(pool: Pool = db) {
    this.pool = pool;
  }

  // ============ Points Management ============

  /**
   * Award points to customer based on rules
   */
  async awardPoints(request: PointsEarningRequest): Promise<PointsTransaction> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get points rule
      const ruleQuery = `
        SELECT * FROM points_rules 
        WHERE type = $1 AND is_active = true 
        AND (valid_from IS NULL OR valid_from <= NOW())
        AND (valid_to IS NULL OR valid_to >= NOW())
        ORDER BY created_at DESC
        LIMIT 1
      `;
      
      const ruleResult = await client.query(ruleQuery, [request.ruleType]);
      
      if (ruleResult.rows.length === 0) {
        throw new Error(`No active points rule found for type: ${request.ruleType}`);
      }

      const rule = ruleResult.rows[0];
      
      // Calculate points to award
      const pointsToAward = Math.floor(
        request.amount * rule.points_per_unit * rule.multiplier
      );

      if (pointsToAward <= 0) {
        throw new Error('No points to award');
      }

      // Create points transaction
      const transactionQuery = `
        INSERT INTO points_transactions (
          customer_profile_id,
          type,
          amount,
          description,
          reference_id,
          reference_type
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;

      const description = `Points earned: ${rule.name}`;
      
      const transactionResult = await client.query(transactionQuery, [
        request.customerProfileId,
        'earned',
        pointsToAward,
        description,
        request.referenceId,
        request.referenceType
      ]);

      await client.query('COMMIT');
      
      const transaction = transactionResult.rows[0];
      
      return {
        id: transaction.id,
        customerProfileId: transaction.customer_profile_id,
        type: transaction.type,
        amount: transaction.amount,
        description: transaction.description,
        referenceId: transaction.reference_id,
        referenceType: transaction.reference_type,
        expiresAt: transaction.expires_at ? new Date(transaction.expires_at) : undefined,
        createdAt: new Date(transaction.created_at),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update customer points balance manually
   */
  async updatePointsBalance(
    customerProfileId: string, 
    update: PointsBalanceUpdate
  ): Promise<PointsTransaction> {
    const query = `
      INSERT INTO points_transactions (
        customer_profile_id,
        type,
        amount,
        description,
        reference_id,
        reference_type
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const result = await this.pool.query(query, [
      customerProfileId,
      update.type,
      update.amount,
      update.description,
      update.referenceId,
      update.referenceType
    ]);

    const transaction = result.rows[0];
    
    return {
      id: transaction.id,
      customerProfileId: transaction.customer_profile_id,
      type: transaction.type,
      amount: transaction.amount,
      description: transaction.description,
      referenceId: transaction.reference_id,
      referenceType: transaction.reference_type,
      expiresAt: transaction.expires_at ? new Date(transaction.expires_at) : undefined,
      createdAt: new Date(transaction.created_at),
    };
  }

  /**
   * Get customer points history
   */
  async getPointsHistory(
    customerProfileId: string, 
    limit: number = 50
  ): Promise<PointsTransaction[]> {
    const query = `
      SELECT * FROM points_transactions
      WHERE customer_profile_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    const result = await this.pool.query(query, [customerProfileId, limit]);

    return result.rows.map(row => ({
      id: row.id,
      customerProfileId: row.customer_profile_id,
      type: row.type,
      amount: row.amount,
      description: row.description,
      referenceId: row.reference_id,
      referenceType: row.reference_type,
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  // ============ Tier Management ============

  /**
   * Get all tiers
   */
  async getAllTiers(): Promise<Tier[]> {
    const query = `
      SELECT 
        id,
        name,
        description,
        min_points as "minPoints",
        max_points as "maxPoints",
        benefits,
        color,
        icon,
        is_active as "isActive",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM tiers
      ORDER BY min_points ASC
    `;

    const result = await this.pool.query(query);

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      minPoints: row.minPoints,
      maxPoints: row.maxPoints,
      benefits: row.benefits || [],
      color: row.color,
      icon: row.icon,
      isActive: row.isActive,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }));
  }

  /**
   * Get tier by ID
   */
  async getTier(id: string): Promise<Tier> {
    const query = `
      SELECT 
        id,
        name,
        description,
        min_points as "minPoints",
        max_points as "maxPoints",
        benefits,
        color,
        icon,
        is_active as "isActive",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM tiers
      WHERE id = $1
    `;

    const result = await this.pool.query(query, [id]);

    if (result.rows.length === 0) {
      throw new Error('Tier not found');
    }

    const row = result.rows[0];

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      minPoints: row.minPoints,
      maxPoints: row.maxPoints,
      benefits: row.benefits || [],
      color: row.color,
      icon: row.icon,
      isActive: row.isActive,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  /**
   * Create new tier
   */
  async createTier(tierData: CreateTier): Promise<Tier> {
    const query = `
      INSERT INTO tiers (
        name,
        description,
        min_points,
        max_points,
        benefits,
        color,
        icon
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const result = await this.pool.query(query, [
      tierData.name,
      tierData.description,
      tierData.minPoints,
      tierData.maxPoints,
      JSON.stringify(tierData.benefits),
      tierData.color,
      tierData.icon
    ]);

    const row = result.rows[0];

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      minPoints: row.min_points,
      maxPoints: row.max_points,
      benefits: row.benefits || [],
      color: row.color,
      icon: row.icon,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Update tier
   */
  async updateTier(id: string, updateData: TierUpdate): Promise<Tier> {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (updateData.name !== undefined) {
      fields.push(`name = $${paramCount++}`);
      values.push(updateData.name);
    }
    if (updateData.description !== undefined) {
      fields.push(`description = $${paramCount++}`);
      values.push(updateData.description);
    }
    if (updateData.minPoints !== undefined) {
      fields.push(`min_points = $${paramCount++}`);
      values.push(updateData.minPoints);
    }
    if (updateData.maxPoints !== undefined) {
      fields.push(`max_points = $${paramCount++}`);
      values.push(updateData.maxPoints);
    }
    if (updateData.benefits !== undefined) {
      fields.push(`benefits = $${paramCount++}`);
      values.push(JSON.stringify(updateData.benefits));
    }
    if (updateData.color !== undefined) {
      fields.push(`color = $${paramCount++}`);
      values.push(updateData.color);
    }
    if (updateData.icon !== undefined) {
      fields.push(`icon = $${paramCount++}`);
      values.push(updateData.icon);
    }
    if (updateData.isActive !== undefined) {
      fields.push(`is_active = $${paramCount++}`);
      values.push(updateData.isActive);
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `
      UPDATE tiers 
      SET ${fields.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await this.pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error('Tier not found');
    }

    const row = result.rows[0];

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      minPoints: row.min_points,
      maxPoints: row.max_points,
      benefits: row.benefits || [],
      color: row.color,
      icon: row.icon,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // ============ Redemption Management ============

  /**
   * Get available redemption options
   */
  async getRedemptionOptions(): Promise<RedemptionOption[]> {
    const query = `
      SELECT 
        id,
        name,
        description,
        category,
        points_cost as "pointsCost",
        cash_value as "cashValue",
        availability,
        terms,
        image_url as "imageUrl",
        is_active as "isActive",
        valid_from as "validFrom",
        valid_to as "validTo",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM redemption_options
      WHERE is_active = true
      AND (valid_from IS NULL OR valid_from <= NOW())
      AND (valid_to IS NULL OR valid_to >= NOW())
      AND (availability IS NULL OR availability > 0)
      ORDER BY category, points_cost ASC
    `;

    const result = await this.pool.query(query);

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      pointsCost: row.pointsCost,
      cashValue: parseFloat(row.cashValue),
      availability: row.availability,
      terms: row.terms,
      imageUrl: row.imageUrl,
      isActive: row.isActive,
      validFrom: row.validFrom ? new Date(row.validFrom) : undefined,
      validTo: row.validTo ? new Date(row.validTo) : undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }));
  }

  /**
   * Create redemption request
   */
  async createRedemptionRequest(
    customerProfileId: string,
    request: CreateRedemptionRequest
  ): Promise<RedemptionRequest> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get redemption option and customer points
      const optionQuery = 'SELECT * FROM redemption_options WHERE id = $1 AND is_active = true';
      const optionResult = await client.query(optionQuery, [request.redemptionOptionId]);

      if (optionResult.rows.length === 0) {
        throw new Error('Redemption option not found or inactive');
      }

      const option = optionResult.rows[0];

      // Check customer points balance
      const balanceQuery = 'SELECT points_balance FROM customer_profiles WHERE id = $1';
      const balanceResult = await client.query(balanceQuery, [customerProfileId]);

      if (balanceResult.rows.length === 0) {
        throw new Error('Customer profile not found');
      }

      const pointsBalance = balanceResult.rows[0].points_balance;

      if (pointsBalance < option.points_cost) {
        throw new Error('Insufficient points for redemption');
      }

      // Create redemption request
      const requestQuery = `
        INSERT INTO redemption_requests (
          customer_profile_id,
          redemption_option_id,
          points_used,
          notes
        ) VALUES ($1, $2, $3, $4)
        RETURNING *
      `;

      const requestResult = await client.query(requestQuery, [
        customerProfileId,
        request.redemptionOptionId,
        option.points_cost,
        request.notes
      ]);

      await client.query('COMMIT');

      const redemptionRequest = requestResult.rows[0];

      return {
        id: redemptionRequest.id,
        customerProfileId: redemptionRequest.customer_profile_id,
        redemptionOptionId: redemptionRequest.redemption_option_id,
        pointsUsed: redemptionRequest.points_used,
        status: redemptionRequest.status,
        notes: redemptionRequest.notes,
        approvedBy: redemptionRequest.approved_by,
        approvedAt: redemptionRequest.approved_at ? new Date(redemptionRequest.approved_at) : undefined,
        usedAt: redemptionRequest.used_at ? new Date(redemptionRequest.used_at) : undefined,
        createdAt: new Date(redemptionRequest.created_at),
        updatedAt: new Date(redemptionRequest.updated_at),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get customer's redemption requests
   */
  async getCustomerRedemptions(customerProfileId: string): Promise<RedemptionRequest[]> {
    const query = `
      SELECT * FROM redemption_requests
      WHERE customer_profile_id = $1
      ORDER BY created_at DESC
    `;

    const result = await this.pool.query(query, [customerProfileId]);

    return result.rows.map(row => ({
      id: row.id,
      customerProfileId: row.customer_profile_id,
      redemptionOptionId: row.redemption_option_id,
      pointsUsed: row.points_used,
      status: row.status,
      notes: row.notes,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
      usedAt: row.used_at ? new Date(row.used_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  // ============ Dashboard & Analytics ============

  /**
   * Get loyalty dashboard data for customer
   */
  async getLoyaltyDashboard(customerProfileId: string): Promise<LoyaltyDashboard> {
    // Get customer profile with tier info
    const profileQuery = `
      SELECT 
        cp.*,
        t.name as tier_name,
        t.benefits
      FROM customer_profiles cp
      JOIN tiers t ON cp.tier_id = t.id
      WHERE cp.id = $1
    `;

    const profileResult = await this.pool.query(profileQuery, [customerProfileId]);

    if (profileResult.rows.length === 0) {
      throw new Error('Customer profile not found');
    }

    const profile = profileResult.rows[0];

    // Get next tier
    const nextTierQuery = `
      SELECT name, min_points 
      FROM tiers 
      WHERE min_points > $1 AND is_active = true
      ORDER BY min_points ASC
      LIMIT 1
    `;

    const nextTierResult = await this.pool.query(nextTierQuery, [profile.points_balance]);
    const nextTier = nextTierResult.rows[0];

    // Calculate tier progress
    const currentTierQuery = `
      SELECT min_points, max_points 
      FROM tiers 
      WHERE id = $1
    `;

    const currentTierResult = await this.pool.query(currentTierQuery, [profile.tier_id]);
    const currentTier = currentTierResult.rows[0];

    let tierProgress = 100;
    let pointsToNextTier = undefined;

    if (nextTier) {
      const progressRange = nextTier.min_points - currentTier.min_points;
      const currentProgress = profile.points_balance - currentTier.min_points;
      tierProgress = Math.min(100, (currentProgress / progressRange) * 100);
      pointsToNextTier = nextTier.min_points - profile.points_balance;
    }

    // Get recent transactions
    const recentTransactions = await this.getPointsHistory(customerProfileId, 10);

    // Get available redemptions
    const availableRedemptions = await this.getRedemptionOptions();

    // Get pending redemptions
    const pendingRedemptions = await this.getCustomerRedemptions(customerProfileId);

    return {
      currentTier: profile.tier_name,
      pointsBalance: profile.points_balance,
      lifetimePoints: profile.lifetime_points,
      nextTier: nextTier?.name,
      pointsToNextTier,
      tierProgress,
      recentTransactions,
      availableRedemptions,
      pendingRedemptions: pendingRedemptions.filter(r => r.status === 'pending'),
      tierBenefits: profile.benefits || [],
    };
  }

  /**
   * Get loyalty analytics for admin
   */
  async getLoyaltyAnalytics(): Promise<LoyaltyAnalytics> {
    // Get total points statistics
    const pointsStatsQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'earned' THEN amount ELSE 0 END), 0) as total_earned,
        COALESCE(SUM(CASE WHEN type = 'redeemed' THEN ABS(amount) ELSE 0 END), 0) as total_redeemed,
        COUNT(DISTINCT customer_profile_id) as active_customers
      FROM points_transactions
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `;

    const pointsStatsResult = await this.pool.query(pointsStatsQuery);
    const pointsStats = pointsStatsResult.rows[0];

    // Get redemption statistics
    const redemptionStatsQuery = `
      SELECT 
        COUNT(*) as active_redemptions,
        AVG(points_used) as avg_points_per_redemption
      FROM redemption_requests
      WHERE status IN ('pending', 'approved')
    `;

    const redemptionStatsResult = await this.pool.query(redemptionStatsQuery);
    const redemptionStats = redemptionStatsResult.rows[0];

    // Get top redemption categories
    const topCategoriesQuery = `
      SELECT 
        ro.category,
        COUNT(rr.id) as count,
        SUM(rr.points_used) as total_points
      FROM redemption_requests rr
      JOIN redemption_options ro ON rr.redemption_option_id = ro.id
      WHERE rr.created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY ro.category
      ORDER BY count DESC
      LIMIT 5
    `;

    const topCategoriesResult = await this.pool.query(topCategoriesQuery);

    // Get tier distribution
    const tierDistributionQuery = `
      SELECT t.name, COUNT(cp.id) as count
      FROM tiers t
      LEFT JOIN customer_profiles cp ON t.id = cp.tier_id
      GROUP BY t.id, t.name
      ORDER BY t.min_points
    `;

    const tierDistributionResult = await this.pool.query(tierDistributionQuery);
    const tierDistribution = tierDistributionResult.rows.reduce((acc, row) => {
      acc[row.name] = parseInt(row.count);
      return acc;
    }, {} as Record<string, number>);

    // Get points expiring this month (placeholder - would need to implement expiration logic)
    const pointsExpiringQuery = `
      SELECT COALESCE(SUM(amount), 0) as expiring_points
      FROM points_transactions
      WHERE expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
      AND type = 'earned'
    `;

    const pointsExpiringResult = await this.pool.query(pointsExpiringQuery);

    return {
      totalPointsEarned: parseInt(pointsStats.total_earned),
      totalPointsRedeemed: parseInt(pointsStats.total_redeemed),
      activeRedemptions: parseInt(redemptionStats.active_redemptions),
      topRedemptionCategories: topCategoriesResult.rows.map(row => ({
        category: row.category,
        count: parseInt(row.count),
        totalPoints: parseInt(row.total_points),
      })),
      tierDistribution,
      pointsExpiringThisMonth: parseInt(pointsExpiringResult.rows[0].expiring_points),
      averagePointsPerCustomer: Math.round(parseInt(pointsStats.total_earned) / Math.max(1, parseInt(pointsStats.active_customers))),
    };
  }

  // ============ Points Rules Management ============

  /**
   * Get all points rules
   */
  async getPointsRules(): Promise<PointsRule[]> {
    const query = `
      SELECT 
        id,
        name,
        description,
        type,
        points_per_unit as "pointsPerUnit",
        multiplier,
        conditions,
        is_active as "isActive",
        valid_from as "validFrom",
        valid_to as "validTo",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM points_rules
      ORDER BY created_at DESC
    `;

    const result = await this.pool.query(query);

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      type: row.type,
      pointsPerUnit: parseFloat(row.pointsPerUnit),
      multiplier: parseFloat(row.multiplier),
      conditions: row.conditions || {},
      isActive: row.isActive,
      validFrom: row.validFrom ? new Date(row.validFrom) : undefined,
      validTo: row.validTo ? new Date(row.validTo) : undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }));
  }

  /**
   * Create points rule
   */
  async createPointsRule(ruleData: CreatePointsRule): Promise<PointsRule> {
    const query = `
      INSERT INTO points_rules (
        name,
        description,
        type,
        points_per_unit,
        multiplier,
        conditions,
        valid_from,
        valid_to
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const result = await this.pool.query(query, [
      ruleData.name,
      ruleData.description,
      ruleData.type,
      ruleData.pointsPerUnit,
      ruleData.multiplier,
      JSON.stringify(ruleData.conditions),
      ruleData.validFrom,
      ruleData.validTo
    ]);

    const row = result.rows[0];

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      type: row.type,
      pointsPerUnit: parseFloat(row.points_per_unit),
      multiplier: parseFloat(row.multiplier),
      conditions: row.conditions || {},
      isActive: row.is_active,
      validFrom: row.valid_from ? new Date(row.valid_from) : undefined,
      validTo: row.valid_to ? new Date(row.valid_to) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Update points rule
   */
  async updatePointsRule(id: string, updateData: UpdatePointsRule): Promise<PointsRule> {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (updateData.name !== undefined) {
      fields.push(`name = $${paramCount++}`);
      values.push(updateData.name);
    }
    if (updateData.description !== undefined) {
      fields.push(`description = $${paramCount++}`);
      values.push(updateData.description);
    }
    if (updateData.pointsPerUnit !== undefined) {
      fields.push(`points_per_unit = $${paramCount++}`);
      values.push(updateData.pointsPerUnit);
    }
    if (updateData.multiplier !== undefined) {
      fields.push(`multiplier = $${paramCount++}`);
      values.push(updateData.multiplier);
    }
    if (updateData.conditions !== undefined) {
      fields.push(`conditions = $${paramCount++}`);
      values.push(JSON.stringify(updateData.conditions));
    }
    if (updateData.isActive !== undefined) {
      fields.push(`is_active = $${paramCount++}`);
      values.push(updateData.isActive);
    }
    if (updateData.validFrom !== undefined) {
      fields.push(`valid_from = $${paramCount++}`);
      values.push(updateData.validFrom);
    }
    if (updateData.validTo !== undefined) {
      fields.push(`valid_to = $${paramCount++}`);
      values.push(updateData.validTo);
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `
      UPDATE points_rules 
      SET ${fields.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await this.pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error('Points rule not found');
    }

    const row = result.rows[0];

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      type: row.type,
      pointsPerUnit: parseFloat(row.points_per_unit),
      multiplier: parseFloat(row.multiplier),
      conditions: row.conditions || {},
      isActive: row.is_active,
      validFrom: row.valid_from ? new Date(row.valid_from) : undefined,
      validTo: row.valid_to ? new Date(row.valid_to) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export const loyaltyService = new LoyaltyService();