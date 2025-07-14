const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class PointTransaction {
  constructor(data) {
    this.id = data.id;
    this.userId = data.user_id;
    this.pointsAmount = data.points_amount;
    this.transactionType = data.transaction_type;
    this.description = data.description;
    this.referenceId = data.reference_id;
    this.referenceType = data.reference_type;
    this.createdAt = data.created_at;
    this.expiresAt = data.expires_at;
  }

  static async create(transactionData) {
    const {
      userId,
      pointsAmount,
      transactionType,
      description,
      referenceId = null,
      referenceType = null,
      expiresAt = null
    } = transactionData;

    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Insert the transaction
      const transactionQuery = `
        INSERT INTO point_transactions (
          user_id, points_amount, transaction_type, description, 
          reference_id, reference_type, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;

      const transactionResult = await client.query(transactionQuery, [
        userId, pointsAmount, transactionType, description,
        referenceId, referenceType, expiresAt
      ]);

      // Update user's total points
      const updateUserQuery = `
        UPDATE users 
        SET total_points = total_points + $1, updated_at = NOW()
        WHERE id = $2
        RETURNING total_points, loyalty_tier
      `;

      const userResult = await client.query(updateUserQuery, [pointsAmount, userId]);
      const newTotalPoints = userResult.rows[0].total_points;

      // Check for tier upgrade
      const newTier = await this.checkTierUpgrade(client, userId, newTotalPoints);
      
      if (newTier && newTier !== userResult.rows[0].loyalty_tier) {
        await this.upgradeTier(client, userId, newTier);
      }

      await client.query('COMMIT');
      
      const transaction = new PointTransaction(transactionResult.rows[0]);
      transaction.newTotalPoints = newTotalPoints;
      transaction.tierUpgrade = newTier;
      
      return transaction;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async getUserTransactions(userId, options = {}) {
    const {
      page = 1,
      limit = 20,
      transactionType = null,
      dateFrom = null,
      dateTo = null
    } = options;

    let whereConditions = ['user_id = $1'];
    let queryParams = [userId];
    let paramCount = 2;

    if (transactionType) {
      whereConditions.push(`transaction_type = $${paramCount}`);
      queryParams.push(transactionType);
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

    const offset = (page - 1) * limit;
    
    const query = `
      SELECT *
      FROM point_transactions
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    queryParams.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) as total
      FROM point_transactions
      WHERE ${whereConditions.join(' AND ')}
    `;

    const [transactions, countResult] = await Promise.all([
      db.query(query, queryParams),
      db.query(countQuery, queryParams.slice(0, -2)) // Remove limit and offset for count
    ]);

    return {
      transactions: transactions.rows.map(row => new PointTransaction(row)),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(countResult.rows[0].total / limit),
        totalItems: parseInt(countResult.rows[0].total),
        itemsPerPage: parseInt(limit)
      }
    };
  }

  static async getPointsSummary(userId) {
    const query = `
      SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'earned' THEN points_amount ELSE 0 END), 0) as total_earned,
        COALESCE(SUM(CASE WHEN transaction_type = 'redeemed' THEN ABS(points_amount) ELSE 0 END), 0) as total_redeemed,
        COALESCE(SUM(CASE WHEN transaction_type = 'expired' THEN ABS(points_amount) ELSE 0 END), 0) as total_expired,
        COALESCE(SUM(CASE WHEN transaction_type = 'earned' AND expires_at > NOW() THEN points_amount ELSE 0 END), 0) as points_expiring_soon,
        COUNT(*) as total_transactions
      FROM point_transactions
      WHERE user_id = $1
    `;

    const result = await db.query(query, [userId]);
    return result.rows[0];
  }

  static async checkTierUpgrade(client, userId, totalPoints) {
    const tierQuery = `
      SELECT tier_name
      FROM loyalty_tiers
      WHERE min_points <= $1
      ORDER BY min_points DESC
      LIMIT 1
    `;

    const result = await client.query(tierQuery, [totalPoints]);
    return result.rows[0]?.tier_name || 'bronze';
  }

  static async upgradeTier(client, userId, newTier) {
    const updateQuery = `
      UPDATE users 
      SET loyalty_tier = $1, updated_at = NOW()
      WHERE id = $2
    `;

    await client.query(updateQuery, [newTier, userId]);

    // Create a tier upgrade transaction record
    const tierUpgradeTransaction = `
      INSERT INTO point_transactions (
        user_id, points_amount, transaction_type, description, reference_type
      ) VALUES ($1, 0, 'adjusted', $2, 'tier_upgrade')
    `;

    await client.query(tierUpgradeTransaction, [
      userId,
      `Tier upgraded to ${newTier}`
    ]);

    return true;
  }

  static async expirePoints() {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Find expired points
      const expiredPointsQuery = `
        SELECT user_id, SUM(points_amount) as expired_points
        FROM point_transactions
        WHERE transaction_type = 'earned' 
        AND expires_at < NOW()
        AND id NOT IN (
          SELECT reference_id::uuid 
          FROM point_transactions 
          WHERE reference_type = 'expiration' 
          AND reference_id IS NOT NULL
        )
        GROUP BY user_id
      `;

      const expiredPointsResult = await client.query(expiredPointsQuery);

      for (const row of expiredPointsResult.rows) {
        const { user_id: userId, expired_points: expiredPoints } = row;

        // Create expiration transaction
        await client.query(`
          INSERT INTO point_transactions (
            user_id, points_amount, transaction_type, description, reference_type
          ) VALUES ($1, $2, 'expired', 'Points expired', 'expiration')
        `, [userId, -Math.abs(expiredPoints)]);

        // Update user's total points
        await client.query(`
          UPDATE users 
          SET total_points = total_points - $1, updated_at = NOW()
          WHERE id = $2
        `, [Math.abs(expiredPoints), userId]);
      }

      await client.query('COMMIT');
      return expiredPointsResult.rows.length;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      pointsAmount: this.pointsAmount,
      transactionType: this.transactionType,
      description: this.description,
      referenceId: this.referenceId,
      referenceType: this.referenceType,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt
    };
  }
}

module.exports = PointTransaction;