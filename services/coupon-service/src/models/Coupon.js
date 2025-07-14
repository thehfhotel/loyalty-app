const db = require('../config/database');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

class Coupon {
  constructor(data) {
    this.id = data.id;
    this.code = data.code;
    this.name = data.name;
    this.description = data.description;
    this.discountType = data.discount_type;
    this.discountValue = parseFloat(data.discount_value);
    this.minSpend = parseFloat(data.min_spend);
    this.maxDiscount = data.max_discount ? parseFloat(data.max_discount) : null;
    this.usageLimit = data.usage_limit;
    this.usageLimitPerUser = data.usage_limit_per_user;
    this.minTier = data.min_tier;
    this.validFrom = data.valid_from;
    this.validUntil = data.valid_until;
    this.isActive = data.is_active;
    this.termsConditions = data.terms_conditions;
    this.createdBy = data.created_by;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  static async findActive(options = {}) {
    const {
      userTier = 'bronze',
      category = null,
      page = 1,
      limit = 20
    } = options;

    let whereConditions = [
      'is_active = true',
      'valid_from <= NOW()',
      'valid_until >= NOW()'
    ];
    
    let queryParams = [];
    let paramCount = 1;

    // Tier filtering
    const tierHierarchy = ['bronze', 'silver', 'gold', 'platinum'];
    const userTierIndex = tierHierarchy.indexOf(userTier);
    
    if (userTierIndex >= 0) {
      const allowedTiers = tierHierarchy.slice(0, userTierIndex + 1);
      whereConditions.push(`min_tier = ANY($${paramCount})`);
      queryParams.push(allowedTiers);
      paramCount++;
    }

    // Usage limit check
    whereConditions.push(`(usage_limit IS NULL OR usage_limit > (
      SELECT COUNT(*) FROM coupon_usage WHERE coupon_id = coupons.id
    ))`);

    const offset = (page - 1) * limit;

    const query = `
      SELECT 
        c.*,
        COALESCE(usage_stats.total_used, 0) as times_used,
        CASE 
          WHEN c.usage_limit IS NOT NULL 
          THEN c.usage_limit - COALESCE(usage_stats.total_used, 0)
          ELSE NULL
        END as remaining_uses
      FROM coupons c
      LEFT JOIN (
        SELECT coupon_id, COUNT(*) as total_used
        FROM coupon_usage
        GROUP BY coupon_id
      ) usage_stats ON c.id = usage_stats.coupon_id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY c.valid_until ASC, c.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    queryParams.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) as total
      FROM coupons c
      WHERE ${whereConditions.join(' AND ')}
    `;

    const [coupons, countResult] = await Promise.all([
      db.query(query, queryParams),
      db.query(countQuery, queryParams.slice(0, -2))
    ]);

    return {
      coupons: coupons.rows.map(row => {
        const coupon = new Coupon(row);
        coupon.timesUsed = parseInt(row.times_used);
        coupon.remainingUses = row.remaining_uses;
        return coupon;
      }),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(countResult.rows[0].total / limit),
        totalItems: parseInt(countResult.rows[0].total),
        itemsPerPage: parseInt(limit)
      }
    };
  }

  static async findByCode(code) {
    const query = `
      SELECT 
        c.*,
        COALESCE(usage_stats.total_used, 0) as times_used
      FROM coupons c
      LEFT JOIN (
        SELECT coupon_id, COUNT(*) as total_used
        FROM coupon_usage
        GROUP BY coupon_id
      ) usage_stats ON c.id = usage_stats.coupon_id
      WHERE c.code = $1
    `;

    const result = await db.query(query, [code]);
    
    if (result.rows[0]) {
      const coupon = new Coupon(result.rows[0]);
      coupon.timesUsed = parseInt(result.rows[0].times_used);
      return coupon;
    }
    
    return null;
  }

  static async findUserCoupons(userId, options = {}) {
    const {
      status = 'active', // active, used, expired, all
      page = 1,
      limit = 20
    } = options;

    let whereConditions = ['1=1'];
    let queryParams = [];
    let paramCount = 1;

    // Status filtering
    if (status === 'active') {
      whereConditions.push('c.is_active = true');
      whereConditions.push('c.valid_until >= NOW()');
      whereConditions.push('cu.id IS NULL'); // Not used yet
    } else if (status === 'used') {
      whereConditions.push('cu.id IS NOT NULL');
    } else if (status === 'expired') {
      whereConditions.push('c.valid_until < NOW()');
      whereConditions.push('cu.id IS NULL');
    }

    // User tier check
    whereConditions.push(`(
      SELECT CASE loyalty_tier
        WHEN 'bronze' THEN c.min_tier = 'bronze'
        WHEN 'silver' THEN c.min_tier IN ('bronze', 'silver')
        WHEN 'gold' THEN c.min_tier IN ('bronze', 'silver', 'gold')
        WHEN 'platinum' THEN c.min_tier IN ('bronze', 'silver', 'gold', 'platinum')
        ELSE false
      END
      FROM users WHERE id = $${paramCount}
    )`);
    queryParams.push(userId);
    paramCount++;

    const offset = (page - 1) * limit;

    const query = `
      SELECT 
        c.*,
        cu.used_at,
        cu.discount_amount as used_discount_amount,
        CASE 
          WHEN cu.id IS NOT NULL THEN 'used'
          WHEN c.valid_until < NOW() THEN 'expired'
          ELSE 'active'
        END as coupon_status
      FROM coupons c
      LEFT JOIN coupon_usage cu ON c.id = cu.coupon_id AND cu.user_id = $1
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY 
        CASE 
          WHEN c.valid_until < NOW() THEN 2
          WHEN cu.id IS NOT NULL THEN 3
          ELSE 1
        END,
        c.valid_until ASC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    queryParams.push(limit, offset);

    const result = await db.query(query, queryParams);
    
    return result.rows.map(row => {
      const coupon = new Coupon(row);
      coupon.status = row.coupon_status;
      coupon.usedAt = row.used_at;
      coupon.usedDiscountAmount = row.used_discount_amount;
      return coupon;
    });
  }

  async generateQRCode() {
    try {
      const qrData = {
        type: 'coupon',
        code: this.code,
        id: this.id,
        validUntil: this.validUntil
      };

      const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrData), {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      return qrCodeDataURL;
    } catch (error) {
      console.error('Error generating QR code:', error);
      throw new Error('Failed to generate QR code');
    }
  }

  validateForUser(userId, userTier, orderAmount = 0) {
    const errors = [];

    // Check if coupon is active
    if (!this.isActive) {
      errors.push('Coupon is not active');
    }

    // Check validity dates
    const now = new Date();
    if (new Date(this.validFrom) > now) {
      errors.push('Coupon is not yet valid');
    }
    if (new Date(this.validUntil) < now) {
      errors.push('Coupon has expired');
    }

    // Check tier requirement
    const tierHierarchy = ['bronze', 'silver', 'gold', 'platinum'];
    const userTierIndex = tierHierarchy.indexOf(userTier);
    const requiredTierIndex = tierHierarchy.indexOf(this.minTier);

    if (userTierIndex < requiredTierIndex) {
      errors.push(`Requires ${this.minTier} tier or higher`);
    }

    // Check minimum spend
    if (orderAmount < this.minSpend) {
      errors.push(`Minimum spend of $${this.minSpend} required`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  calculateDiscount(orderAmount) {
    if (orderAmount < this.minSpend) {
      return 0;
    }

    let discount = 0;

    if (this.discountType === 'percentage') {
      discount = orderAmount * (this.discountValue / 100);
      
      // Apply max discount limit
      if (this.maxDiscount && discount > this.maxDiscount) {
        discount = this.maxDiscount;
      }
    } else if (this.discountType === 'fixed_amount') {
      discount = this.discountValue;
      
      // Discount cannot exceed order amount
      if (discount > orderAmount) {
        discount = orderAmount;
      }
    }

    return Math.round(discount * 100) / 100; // Round to 2 decimal places
  }

  async redeem(userId, orderAmount, bookingId = null) {
    // Validate coupon for user
    const userQuery = 'SELECT loyalty_tier FROM users WHERE id = $1';
    const userResult = await db.query(userQuery, [userId]);
    
    if (!userResult.rows[0]) {
      throw new Error('User not found');
    }

    const userTier = userResult.rows[0].loyalty_tier;
    const validation = this.validateForUser(userId, userTier, orderAmount);

    if (!validation.isValid) {
      const error = new Error(validation.errors.join(', '));
      error.statusCode = 400;
      throw error;
    }

    // Check usage limits
    const usageQuery = `
      SELECT COUNT(*) as user_usage_count
      FROM coupon_usage
      WHERE coupon_id = $1 AND user_id = $2
    `;

    const usageResult = await db.query(usageQuery, [this.id, userId]);
    const userUsageCount = parseInt(usageResult.rows[0].user_usage_count);

    if (userUsageCount >= this.usageLimitPerUser) {
      const error = new Error('User has exceeded usage limit for this coupon');
      error.statusCode = 400;
      throw error;
    }

    // Check total usage limit
    if (this.usageLimit && this.timesUsed >= this.usageLimit) {
      const error = new Error('Coupon usage limit has been reached');
      error.statusCode = 400;
      throw error;
    }

    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Calculate discount
      const discountAmount = this.calculateDiscount(orderAmount);

      // Record usage
      const usageId = uuidv4();
      const usageInsertQuery = `
        INSERT INTO coupon_usage (id, coupon_id, user_id, booking_id, discount_amount)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;

      const usageRecord = await client.query(usageInsertQuery, [
        usageId, this.id, userId, bookingId, discountAmount
      ]);

      await client.query('COMMIT');

      return {
        coupon: this,
        discountAmount,
        usage: usageRecord.rows[0],
        finalAmount: orderAmount - discountAmount
      };

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
      code: this.code,
      name: this.name,
      description: this.description,
      discountType: this.discountType,
      discountValue: this.discountValue,
      minSpend: this.minSpend,
      maxDiscount: this.maxDiscount,
      usageLimit: this.usageLimit,
      usageLimitPerUser: this.usageLimitPerUser,
      minTier: this.minTier,
      validFrom: this.validFrom,
      validUntil: this.validUntil,
      isActive: this.isActive,
      termsConditions: this.termsConditions,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Coupon;