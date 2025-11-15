import { getPool } from '../config/database';
import { logger } from '../utils/logger';

export interface Tier {
  id: string;
  name: string;
  min_points: number; // Not used for tier calculation - kept for legacy compatibility
  min_nights: number; // ACTUAL tier requirement - membership based on nights only
  benefits: {
    description: string;
    perks: string[];
  };
  color: string;
  sort_order: number;
}

export interface PointsTransaction {
  id: string;
  user_id: string;
  points: number;
  type: string;
  description: string | null;
  reference_id: string | null;
  admin_user_id: string | null;
  admin_reason: string | null;
  expires_at: Date | null;
  created_at: Date;
}

export interface UserLoyaltyStatus {
  user_id: string;
  current_points: number; // For redemption only
  total_nights: number; // Determines tier membership
  tier_name: string;
  tier_color: string;
  tier_benefits: Record<string, unknown>;
  tier_level: number;
  progress_percentage: number; // Based on nights, not points
  next_tier_nights: number | null;
  next_tier_name: string | null;
  nights_to_next_tier: number | null;
}

export interface PointsCalculation {
  current_points: number;
  expiring_points: number;
  next_expiry_date: Date | null;
}

export class LoyaltyService {
  /**
   * Get all available tiers
   */
  async getAllTiers(): Promise<Tier[]> {
    try {
      const result = await getPool().query(
        'SELECT * FROM tiers WHERE is_active = true ORDER BY sort_order ASC'
      );
      return result.rows;
    } catch (error) {
      logger.error('Error fetching tiers:', error);
      throw new Error('Failed to fetch loyalty tiers');
    }
  }

  /**
   * Get user's loyalty status with tier information
   */
  async getUserLoyaltyStatus(userId: string): Promise<UserLoyaltyStatus | null> {
    try {
      const result = await getPool().query(
        `SELECT
          ul.user_id,
          ul.current_points,
          ul.total_nights,
          t.name as tier_name,
          t.color as tier_color,
          t.benefits as tier_benefits,
          t.sort_order as tier_level,
          CASE
            WHEN next_tier.min_nights IS NOT NULL
            THEN ROUND((ul.total_nights::numeric / next_tier.min_nights) * 100)
            ELSE 100
          END as progress_percentage,
          next_tier.min_nights as next_tier_nights,
          next_tier.name as next_tier_name,
          CASE
            WHEN next_tier.min_nights IS NOT NULL
            THEN (next_tier.min_nights - ul.total_nights)
            ELSE NULL
          END as nights_to_next_tier
        FROM user_loyalty ul
        JOIN tiers t ON ul.tier_id = t.id
        LEFT JOIN tiers next_tier ON next_tier.sort_order = t.sort_order + 1 AND next_tier.is_active = true
        WHERE ul.user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        // Initialize user loyalty if not exists
        await this.initializeUserLoyalty(userId);
        return this.getUserLoyaltyStatus(userId);
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching user loyalty status:', error);
      throw new Error('Failed to fetch user loyalty status');
    }
  }

  /**
   * Initialize loyalty status for a new user
   */
  async initializeUserLoyalty(userId: string): Promise<void> {
    try {
      // Get the Bronze tier (lowest tier)
      const bronzeTier = await getPool().query(
        'SELECT id FROM tiers WHERE is_active = true ORDER BY sort_order ASC LIMIT 1'
      );

      if (bronzeTier.rows.length === 0) {
        throw new Error('No active tiers found');
      }

      const result = await getPool().query(
        `INSERT INTO user_loyalty (user_id, current_points, tier_id)
         VALUES ($1, 0, $2)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING user_id`,
        [userId, bronzeTier.rows[0].id]
      );

      if (result.rows.length > 0) {
        logger.info(`Initialized loyalty status for user ${userId} - new enrollment`);
      } else {
        logger.debug(`User ${userId} already has loyalty status - skipping initialization`);
      }
    } catch (error) {
      logger.error('Error initializing user loyalty:', error);
      throw new Error('Failed to initialize user loyalty');
    }
  }

  /**
   * Ensure user has loyalty status (auto-enroll if needed)
   * This is the main function to call on every login
   */
  async ensureUserLoyaltyEnrollment(userId: string): Promise<void> {
    try {
      await this.initializeUserLoyalty(userId);
    } catch (error) {
      logger.error(`Failed to ensure loyalty enrollment for user ${userId}:`, error);
      // Don't throw error to avoid breaking login flow
      // Loyalty enrollment failure shouldn't prevent login
    }
  }

  /**
   * Award points to a user
   */
  async awardPoints(
    userId: string,
    points: number,
    type = 'admin_award',
    description?: string,
    referenceId?: string,
    adminUserId?: string,
    adminReason?: string,
    expiresAt?: Date
  ): Promise<string> {
    try {
      const result = await getPool().query(
        'SELECT award_points($1, $2, $3, $4, $5, $6, $7, $8) as transaction_id',
        [
          userId,
          points,
          type,
          description,
          referenceId,
          adminUserId,
          adminReason,
          expiresAt
        ]
      );

      const transactionId = result.rows[0].transaction_id;
      logger.info(`Awarded ${points} points to user ${userId}, transaction: ${transactionId}`);
      return transactionId;
    } catch (error) {
      logger.error('Error awarding points:', error);
      throw new Error('Failed to award points');
    }
  }

  /**
   * Deduct points from a user
   */
  async deductPoints(
    userId: string,
    points: number,
    type = 'admin_deduction',
    description?: string,
    referenceId?: string,
    adminUserId?: string,
    adminReason?: string
  ): Promise<string> {
    try {
      // Check if user has enough points
      const loyaltyStatus = await this.getUserLoyaltyStatus(userId);
      if (!loyaltyStatus || loyaltyStatus.current_points < points) {
        throw new Error('Insufficient points for deduction');
      }

      return this.awardPoints(
        userId,
        -points, // Negative points for deduction
        type,
        description,
        referenceId,
        adminUserId,
        adminReason
      );
    } catch (error) {
      logger.error('Error deducting points:', error);
      throw new Error('Failed to deduct points');
    }
  }

  /**
   * Get user's points transaction history
   */
  async getUserPointsHistory(
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<{ transactions: PointsTransaction[]; total: number }> {
    try {
      // Get transactions with pagination
      const transactionsResult = await getPool().query(
        `SELECT pt.*, u.email as admin_email
         FROM points_transactions pt
         LEFT JOIN users u ON pt.admin_user_id = u.id
         WHERE pt.user_id = $1
         ORDER BY pt.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      // Get total count
      const countResult = await getPool().query(
        'SELECT COUNT(*) as total FROM points_transactions WHERE user_id = $1',
        [userId]
      );

      return {
        transactions: transactionsResult.rows,
        total: parseInt(countResult.rows[0].total)
      };
    } catch (error) {
      logger.error('Error fetching user points history:', error);
      throw new Error('Failed to fetch points history');
    }
  }

  /**
   * Calculate user's current points with expiration info
   */
  async calculateUserPoints(userId: string): Promise<PointsCalculation> {
    try {
      const result = await getPool().query(
        `SELECT
          COALESCE(ul.current_points, 0) as current_points,
          COALESCE(
            (SELECT SUM(points)
             FROM points_transactions
             WHERE user_id = $1
               AND expires_at IS NOT NULL
               AND expires_at <= NOW() + INTERVAL '30 days'
               AND expires_at > NOW()
               AND points > 0),
            0
          ) as expiring_points,
          (SELECT MIN(expires_at)
           FROM points_transactions
           WHERE user_id = $1
             AND expires_at IS NOT NULL
             AND expires_at > NOW()
             AND points > 0
          ) as next_expiry_date
        FROM user_loyalty ul
        WHERE ul.user_id = $1`,
        [userId]
      );

      return result.rows[0] ?? { current_points: 0, expiring_points: 0, next_expiry_date: null };
    } catch (error) {
      logger.error('Error calculating user points:', error);
      throw new Error('Failed to calculate user points');
    }
  }

  /**
   * Get all users' loyalty status for admin (with pagination)
   */
  async getAllUsersLoyaltyStatus(
    limit = 50,
    offset = 0,
    searchTerm?: string
  ): Promise<{ users: UserLoyaltyStatus[]; total: number }> {
    try {
      let query = `
        SELECT
          ul.user_id,
          ul.current_points,
          ul.total_nights,
          t.name as tier_name,
          t.color as tier_color,
          t.benefits as tier_benefits,
          t.sort_order as tier_level,
          CASE
            WHEN next_tier.min_nights IS NOT NULL
            THEN ROUND((ul.total_nights::numeric / next_tier.min_nights) * 100)
            ELSE 100
          END as progress_percentage,
          next_tier.min_nights as next_tier_nights,
          next_tier.name as next_tier_name,
          CASE
            WHEN next_tier.min_nights IS NOT NULL
            THEN (next_tier.min_nights - ul.total_nights)
            ELSE NULL
          END as nights_to_next_tier,
          up.first_name,
          up.last_name,
          up.membership_id,
          u.email,
          u.oauth_provider,
          u.oauth_provider_id,
          u.created_at as user_created_at
        FROM user_loyalty ul
        JOIN tiers t ON ul.tier_id = t.id
        LEFT JOIN tiers next_tier ON next_tier.sort_order = t.sort_order + 1 AND next_tier.is_active = true
        JOIN users u ON ul.user_id = u.id
        LEFT JOIN user_profiles up ON u.id = up.user_id
      `;

      const params: (string | number)[] = [];
      let paramIndex = 1;

      if (searchTerm) {
        query += ` WHERE (u.email ILIKE $${paramIndex} OR up.first_name ILIKE $${paramIndex} OR up.last_name ILIKE $${paramIndex} OR u.id::text ILIKE $${paramIndex} OR up.membership_id ILIKE $${paramIndex})`;
        params.push(`%${searchTerm}%`);
        paramIndex++;
      }

      query += ` ORDER BY ul.total_nights DESC, ul.current_points DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const usersResult = await getPool().query(query, params);

      // Get total count
      let countQuery = `
        SELECT COUNT(*) as total
        FROM user_loyalty ul
        JOIN users u ON ul.user_id = u.id
        LEFT JOIN user_profiles up ON u.id = up.user_id
      `;

      const countParams: string[] = [];
      if (searchTerm) {
        countQuery += ` WHERE (u.email ILIKE $1 OR up.first_name ILIKE $1 OR up.last_name ILIKE $1 OR u.id::text ILIKE $1 OR up.membership_id ILIKE $1)`;
        countParams.push(`%${searchTerm}%`);
      }

      const countResult = await getPool().query(countQuery, countParams);

      return {
        users: usersResult.rows,
        total: parseInt(countResult.rows[0].total)
      };
    } catch (error) {
      logger.error('Error fetching all users loyalty status:', error);
      throw new Error('Failed to fetch users loyalty status');
    }
  }

  /**
   * Get points earning rules
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getPointsEarningRules(): Promise<any[]> {
    try {
      const result = await getPool().query(
        'SELECT * FROM points_earning_rules WHERE is_active = true ORDER BY created_at DESC'
      );
      return result.rows;
    } catch (error) {
      logger.error('Error fetching points earning rules:', error);
      throw new Error('Failed to fetch points earning rules');
    }
  }

  /**
   * Add nights and points for a hotel stay
   */
  async addStayNightsAndPoints(
    userId: string,
    nights: number,
    amountSpent: number,
    referenceId?: string,
    description?: string
  ): Promise<{
    transactionId: string;
    pointsEarned: number;
    newTotalNights: number;
    newTierName: string;
  }> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      // Calculate points (10 points per 1 THB spent)
      const pointsEarned = Math.floor(amountSpent * 10);

      // Ensure user has loyalty status
      await client.query(
        `INSERT INTO user_loyalty (user_id, tier_id, current_points, total_nights)
         SELECT $1, t.id, 0, 0
         FROM tiers t
         WHERE t.name = 'Bronze'
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );

      // Determine transaction type based on whether it's adding or removing nights/points
      const transactionType = (nights < 0 || pointsEarned < 0) ? 'admin_deduction' : 'earned_stay';

      // Create points transaction
      const transactionResult = await client.query(
        `INSERT INTO points_transactions (
           user_id, points, type, description, reference_id, created_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '1 year')
         RETURNING id`,
        [
          userId,
          pointsEarned,
          transactionType,
          description || `Hotel stay: ${nights} night(s), ${amountSpent.toFixed(2)} THB spent`,
          referenceId || `STAY-${Date.now()}`
        ]
      );

      const transactionId = transactionResult.rows[0].id;

      // Update user_loyalty: add points and nights
      await client.query(
        `UPDATE user_loyalty
         SET current_points = current_points + $2,
             total_nights = total_nights + $3,
             updated_at = NOW()
         WHERE user_id = $1`,
        [userId, pointsEarned, nights]
      );

      // Get updated total nights for tier recalculation
      const loyaltyResult = await client.query(
        'SELECT total_nights FROM user_loyalty WHERE user_id = $1',
        [userId]
      );
      const newTotalNights = loyaltyResult.rows[0].total_nights;

      // Recalculate tier based on total_nights
      const tierResult = await client.query(
        `SELECT * FROM recalculate_user_tier_by_nights($1)`,
        [userId]
      );

      const newTierName = tierResult.rows[0]?.new_tier_name || 'Bronze';

      await client.query('COMMIT');

      logger.info(`Added ${nights} nights and ${pointsEarned} points to user ${userId}`);

      return {
        transactionId,
        pointsEarned,
        newTotalNights,
        newTierName
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error adding stay nights and points:', error);
      throw new Error('Failed to add stay nights and points');
    } finally {
      client.release();
    }
  }

  /**
   * Simulate earning points for a hotel stay
   */
  async earnPointsForStay(
    userId: string,
    amountSpent: number,
    stayId?: string
  ): Promise<string> {
    try {
      // Get current user tier for multiplier
      const loyaltyStatus = await this.getUserLoyaltyStatus(userId);
      if (!loyaltyStatus) {
        throw new Error('User loyalty status not found');
      }

      // Get earning rules
      const rules = await this.getPointsEarningRules();
      if (rules.length === 0) {
        throw new Error('No earning rules configured');
      }

      const rule = rules[0]; // Use first active rule
      const basePoints = Math.floor(amountSpent * rule.points_per_unit);

      // Apply tier multiplier
      const tierMultiplier = rule.multiplier_by_tier[loyaltyStatus.tier_name] ?? 1.0;
      const finalPoints = Math.floor(basePoints * tierMultiplier);

      // Set expiration to 2 years from now
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 2);

      return this.awardPoints(
        userId,
        finalPoints,
        'earned_stay',
        `Earned ${finalPoints} points for hotel stay (${loyaltyStatus.tier_name} tier bonus applied)`,
        stayId,
        undefined,
        undefined,
        expiresAt
      );
    } catch (error) {
      logger.error('Error earning points for stay:', error);
      throw new Error('Failed to earn points for stay');
    }
  }

  /**
   * Expire old points (to be run as a scheduled job)
   */
  async expireOldPoints(): Promise<number> {
    try {
      const result = await getPool().query(
        `INSERT INTO points_transactions (user_id, points, type, description, created_at)
         SELECT 
           user_id,
           -points,
           'expired',
           'Points expired automatically',
           NOW()
         FROM points_transactions
         WHERE expires_at <= NOW()
         AND points > 0
         AND id NOT IN (
           SELECT reference_id::UUID 
           FROM points_transactions 
           WHERE type = 'expired' 
           AND reference_id IS NOT NULL
         )
         RETURNING user_id`
      );

      logger.info(`Expired points for ${result.rows.length} transactions`);
      return result.rows.length;
    } catch (error) {
      logger.error('Error expiring old points:', error);
      throw new Error('Failed to expire old points');
    }
  }

  /**
   * Get paginated transaction history (for tRPC)
   * @param userId - User UUID
   * @param page - Page number (1-indexed)
   * @param pageSize - Items per page
   * @returns Paginated transaction list
   */
  async getTransactionHistory(
    userId: string,
    page: number,
    pageSize: number
  ): Promise<{
    transactions: PointsTransaction[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const offset = (page - 1) * pageSize;

    // Reuse existing method with adapted parameters
    const { transactions, total } = await this.getUserPointsHistory(userId, pageSize, offset);

    const totalPages = Math.ceil(total / pageSize);

    return {
      transactions,
      total,
      page,
      pageSize,
      totalPages
    };
  }

  /**
   * Get loyalty tier configuration
   * @returns Array of tier configurations
   */
  async getTierConfiguration(): Promise<Array<{
    id: string;
    name: string;
    required_points: number;
    benefits: string[];
    color: string;
    icon: string;
  }>> {
    try {
      const result = await getPool().query(
        `SELECT id, name, min_points as required_points, benefits, color, 'star' as icon
         FROM tiers
         WHERE is_active = true
         ORDER BY sort_order ASC`
      );

      return result.rows;
    } catch (error) {
      logger.error('Error fetching tier configuration:', error);
      throw new Error('Failed to fetch tier configuration');
    }
  }

  /**
   * Update tier configuration (admin only)
   * @param tierId - Tier UUID
   * @param config - Updated tier configuration
   * @returns Updated tier
   */
  async updateTierConfiguration(
    tierId: string,
    config: {
      name?: string;
      required_points?: number;
      benefits?: string[];
      color?: string;
      icon?: string;
    }
  ): Promise<{
    id: string;
    name: string;
    required_points: number;
    benefits: string[];
    color: string;
    icon: string;
  }> {
    try {
      // Build dynamic UPDATE query
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramCount = 1;

      if (config.name !== undefined) {
        updates.push(`name = $${paramCount++}`);
        values.push(config.name);
      }
      if (config.required_points !== undefined) {
        updates.push(`min_points = $${paramCount++}`);
        values.push(config.required_points);
      }
      if (config.benefits !== undefined) {
        updates.push(`benefits = $${paramCount++}`);
        values.push(JSON.stringify(config.benefits));
      }
      if (config.color !== undefined) {
        updates.push(`color = $${paramCount++}`);
        values.push(config.color);
      }

      if (updates.length === 0) {
        throw new Error('No fields to update');
      }

      updates.push(`updated_at = NOW()`);
      values.push(tierId);

      const result = await getPool().query(
        `UPDATE tiers
         SET ${updates.join(', ')}
         WHERE id = $${paramCount}
         RETURNING id, name, min_points as required_points, benefits, color, 'star' as icon`,
        values
      );

      if (result.rows.length === 0) {
        throw new Error('Tier not found');
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Error updating tier configuration:', error);
      throw new Error('Failed to update tier configuration');
    }
  }
}

// Export singleton instance for use in other services
export const loyaltyService = new LoyaltyService();