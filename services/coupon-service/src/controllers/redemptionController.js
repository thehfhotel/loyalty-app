const db = require('../config/database');
const QRCode = require('qrcode');

class RedemptionController {
  async validateCoupon(req, res) {
    try {
      const { code } = req.body;
      
      if (!code) {
        return res.status(400).json({
          success: false,
          message: 'Coupon code is required'
        });
      }

      // Find the coupon
      const couponQuery = `
        SELECT c.*, uc.id as user_coupon_id, uc.status as user_coupon_status
        FROM coupons c
        LEFT JOIN user_coupons uc ON c.id = uc.coupon_id
        WHERE uc.code = $1
      `;
      
      const result = await db.query(couponQuery, [code]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Invalid coupon code'
        });
      }

      const coupon = result.rows[0];
      
      // Check if coupon is valid
      const validationResult = this.validateCouponRules(coupon);
      
      res.json({
        success: validationResult.valid,
        message: validationResult.message,
        data: validationResult.valid ? {
          coupon: {
            id: coupon.id,
            name: coupon.name,
            description: coupon.description,
            discount_type: coupon.discount_type,
            discount_value: coupon.discount_value,
            minimum_purchase: coupon.minimum_purchase,
            maximum_discount: coupon.maximum_discount
          }
        } : null
      });
    } catch (error) {
      console.error('Error validating coupon:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async redeemCoupon(req, res) {
    try {
      const { code, purchase_amount = 0 } = req.body;
      const { user } = req;
      
      if (!code) {
        return res.status(400).json({
          success: false,
          message: 'Coupon code is required'
        });
      }

      // Find the user's coupon
      const couponQuery = `
        SELECT c.*, uc.id as user_coupon_id, uc.status as user_coupon_status, uc.user_id
        FROM coupons c
        JOIN user_coupons uc ON c.id = uc.coupon_id
        WHERE uc.code = $1 AND uc.user_id = $2
      `;
      
      const result = await db.query(couponQuery, [code, user.id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found or not owned by user'
        });
      }

      const coupon = result.rows[0];
      
      // Validate coupon
      const validationResult = this.validateCouponRules(coupon);
      
      if (!validationResult.valid) {
        return res.status(400).json({
          success: false,
          message: validationResult.message
        });
      }

      // Check minimum purchase requirement
      if (coupon.minimum_purchase && purchase_amount < coupon.minimum_purchase) {
        return res.status(400).json({
          success: false,
          message: `Minimum purchase amount of $${coupon.minimum_purchase} required`
        });
      }

      // Calculate discount
      let discount_amount = 0;
      if (coupon.discount_type === 'percentage') {
        discount_amount = (purchase_amount * coupon.discount_value) / 100;
        if (coupon.maximum_discount && discount_amount > coupon.maximum_discount) {
          discount_amount = coupon.maximum_discount;
        }
      } else if (coupon.discount_type === 'fixed') {
        discount_amount = Math.min(coupon.discount_value, purchase_amount);
      }

      // Begin transaction
      await db.query('BEGIN');

      try {
        // Mark coupon as used
        await db.query(
          'UPDATE user_coupons SET status = $1, used_at = NOW() WHERE id = $2',
          ['used', coupon.user_coupon_id]
        );

        // Record redemption
        const redemptionQuery = `
          INSERT INTO coupon_redemptions (user_coupon_id, user_id, coupon_id, purchase_amount, discount_amount, redeemed_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          RETURNING *
        `;
        
        const redemptionResult = await db.query(redemptionQuery, [
          coupon.user_coupon_id,
          user.id,
          coupon.id,
          purchase_amount,
          discount_amount
        ]);

        // Update coupon usage count
        await db.query(
          'UPDATE coupons SET usage_count = usage_count + 1 WHERE id = $1',
          [coupon.id]
        );

        await db.query('COMMIT');

        res.json({
          success: true,
          message: 'Coupon redeemed successfully',
          data: {
            redemption: redemptionResult.rows[0],
            discount_amount,
            final_amount: purchase_amount - discount_amount
          }
        });
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.error('Error redeeming coupon:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getRedemptionHistory(req, res) {
    try {
      const { user } = req;
      const { page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;
      
      const query = `
        SELECT cr.*, c.name as coupon_name, c.description as coupon_description
        FROM coupon_redemptions cr
        JOIN coupons c ON cr.coupon_id = c.id
        WHERE cr.user_id = $1
        ORDER BY cr.redeemed_at DESC
        LIMIT $2 OFFSET $3
      `;
      
      const result = await db.query(query, [user.id, limit, offset]);
      
      // Get total count
      const countQuery = 'SELECT COUNT(*) FROM coupon_redemptions WHERE user_id = $1';
      const countResult = await db.query(countQuery, [user.id]);
      
      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countResult.rows[0].count)
        }
      });
    } catch (error) {
      console.error('Error getting redemption history:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getRedemptionStats(req, res) {
    try {
      const { period = '30d' } = req.query;
      
      let dateFilter = '';
      switch (period) {
        case '24h':
          dateFilter = "redeemed_at >= NOW() - INTERVAL '24 hours'";
          break;
        case '7d':
          dateFilter = "redeemed_at >= NOW() - INTERVAL '7 days'";
          break;
        case '30d':
          dateFilter = "redeemed_at >= NOW() - INTERVAL '30 days'";
          break;
        default:
          dateFilter = "redeemed_at >= NOW() - INTERVAL '30 days'";
      }
      
      const statsQuery = `
        SELECT 
          COUNT(*) as total_redemptions,
          SUM(discount_amount) as total_discount_given,
          SUM(purchase_amount) as total_purchase_amount,
          AVG(discount_amount) as avg_discount_amount,
          COUNT(DISTINCT user_id) as unique_users
        FROM coupon_redemptions
        WHERE ${dateFilter}
      `;
      
      const statsResult = await db.query(statsQuery);
      
      // Get top coupons
      const topCouponsQuery = `
        SELECT 
          c.name,
          c.id,
          COUNT(cr.id) as redemption_count,
          SUM(cr.discount_amount) as total_discount
        FROM coupon_redemptions cr
        JOIN coupons c ON cr.coupon_id = c.id
        WHERE ${dateFilter}
        GROUP BY c.id, c.name
        ORDER BY redemption_count DESC
        LIMIT 10
      `;
      
      const topCouponsResult = await db.query(topCouponsQuery);
      
      res.json({
        success: true,
        data: {
          period,
          stats: statsResult.rows[0],
          top_coupons: topCouponsResult.rows
        }
      });
    } catch (error) {
      console.error('Error getting redemption stats:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async reverseRedemption(req, res) {
    try {
      const { redemptionId } = req.params;
      const { reason } = req.body;
      
      if (!reason) {
        return res.status(400).json({
          success: false,
          message: 'Reason for reversal is required'
        });
      }

      // Find the redemption
      const redemptionQuery = `
        SELECT cr.*, uc.id as user_coupon_id
        FROM coupon_redemptions cr
        JOIN user_coupons uc ON cr.user_coupon_id = uc.id
        WHERE cr.id = $1
      `;
      
      const result = await db.query(redemptionQuery, [redemptionId]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Redemption not found'
        });
      }

      const redemption = result.rows[0];
      
      await db.query('BEGIN');

      try {
        // Restore coupon to available state
        await db.query(
          'UPDATE user_coupons SET status = $1, used_at = NULL WHERE id = $2',
          ['available', redemption.user_coupon_id]
        );

        // Mark redemption as reversed
        await db.query(
          'UPDATE coupon_redemptions SET status = $1, reversed_at = NOW(), reversal_reason = $2 WHERE id = $3',
          ['reversed', reason, redemptionId]
        );

        // Update coupon usage count
        await db.query(
          'UPDATE coupons SET usage_count = usage_count - 1 WHERE id = $1',
          [redemption.coupon_id]
        );

        await db.query('COMMIT');

        res.json({
          success: true,
          message: 'Redemption reversed successfully'
        });
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.error('Error reversing redemption:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  validateCouponRules(coupon) {
    const now = new Date();
    
    // Check if coupon is already used
    if (coupon.user_coupon_status === 'used') {
      return { valid: false, message: 'Coupon has already been used' };
    }

    // Check if coupon is expired
    if (coupon.user_coupon_status === 'expired') {
      return { valid: false, message: 'Coupon has expired' };
    }

    // Check coupon validity dates
    if (coupon.valid_from && new Date(coupon.valid_from) > now) {
      return { valid: false, message: 'Coupon is not yet valid' };
    }

    if (coupon.valid_until && new Date(coupon.valid_until) < now) {
      return { valid: false, message: 'Coupon has expired' };
    }

    // Check usage limits
    if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
      return { valid: false, message: 'Coupon usage limit exceeded' };
    }

    // Check if coupon is active
    if (coupon.status !== 'active') {
      return { valid: false, message: 'Coupon is not active' };
    }

    return { valid: true, message: 'Coupon is valid' };
  }
}

module.exports = new RedemptionController();