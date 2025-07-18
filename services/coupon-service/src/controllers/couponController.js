const db = require('../config/database');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

class CouponController {
  async createCoupon(req, res) {
    try {
      const {
        name,
        description,
        discount_type,
        discount_value,
        minimum_purchase = 0,
        maximum_discount = null,
        valid_from,
        valid_until,
        usage_limit = null,
        user_limit = 1,
        target_tier = 'all',
        category = 'general',
        terms_conditions = ''
      } = req.body;

      // Validate required fields
      if (!name || !description || !discount_type || !discount_value) {
        return res.status(400).json({
          success: false,
          message: 'Name, description, discount_type, and discount_value are required'
        });
      }

      // Validate discount_type
      if (!['percentage', 'fixed'].includes(discount_type)) {
        return res.status(400).json({
          success: false,
          message: 'Discount type must be either "percentage" or "fixed"'
        });
      }

      const query = `
        INSERT INTO coupons (
          name, description, discount_type, discount_value, minimum_purchase, maximum_discount,
          valid_from, valid_until, usage_limit, user_limit, target_tier, category, terms_conditions,
          status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
        RETURNING *
      `;

      const result = await db.query(query, [
        name, description, discount_type, discount_value, minimum_purchase, maximum_discount,
        valid_from, valid_until, usage_limit, user_limit, target_tier, category, terms_conditions,
        'active'
      ]);

      res.status(201).json({
        success: true,
        message: 'Coupon created successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Error creating coupon:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getCoupons(req, res) {
    try {
      const { status, category, discount_type, page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      let query = 'SELECT * FROM coupons';
      let params = [];
      let whereConditions = [];

      if (status) {
        whereConditions.push(`status = $${params.length + 1}`);
        params.push(status);
      }

      if (category) {
        whereConditions.push(`category = $${params.length + 1}`);
        params.push(category);
      }

      if (discount_type) {
        whereConditions.push(`discount_type = $${params.length + 1}`);
        params.push(discount_type);
      }

      if (whereConditions.length > 0) {
        query += ' WHERE ' + whereConditions.join(' AND ');
      }

      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await db.query(query, params);

      // Get total count
      let countQuery = 'SELECT COUNT(*) FROM coupons';
      let countParams = [];

      if (whereConditions.length > 0) {
        countQuery += ' WHERE ' + whereConditions.join(' AND ');
        countParams = params.slice(0, -2); // Remove limit and offset
      }

      const countResult = await db.query(countQuery, countParams);

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
      console.error('Error getting coupons:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getCouponById(req, res) {
    try {
      const { id } = req.params;

      const query = 'SELECT * FROM coupons WHERE id = $1';
      const result = await db.query(query, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found'
        });
      }

      // Get usage statistics
      const usageQuery = 'SELECT COUNT(*) as usage_count FROM coupon_redemptions WHERE coupon_id = $1';
      const usageResult = await db.query(usageQuery, [id]);

      const coupon = result.rows[0];
      coupon.current_usage = parseInt(usageResult.rows[0].usage_count);

      res.json({
        success: true,
        data: coupon
      });
    } catch (error) {
      console.error('Error getting coupon:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async updateCoupon(req, res) {
    try {
      const { id } = req.params;
      const {
        name,
        description,
        discount_type,
        discount_value,
        minimum_purchase,
        maximum_discount,
        valid_from,
        valid_until,
        usage_limit,
        user_limit,
        target_tier,
        category,
        terms_conditions,
        status
      } = req.body;

      // Check if coupon exists
      const existingQuery = 'SELECT * FROM coupons WHERE id = $1';
      const existingResult = await db.query(existingQuery, [id]);

      if (existingResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found'
        });
      }

      // Build update query dynamically
      let updateFields = [];
      let params = [];
      let paramIndex = 1;

      const fields = {
        name, description, discount_type, discount_value, minimum_purchase,
        maximum_discount, valid_from, valid_until, usage_limit, user_limit,
        target_tier, category, terms_conditions, status
      };

      Object.keys(fields).forEach(field => {
        if (fields[field] !== undefined) {
          updateFields.push(`${field} = $${paramIndex}`);
          params.push(fields[field]);
          paramIndex++;
        }
      });

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update'
        });
      }

      updateFields.push(`updated_at = NOW()`);
      params.push(id);

      const query = `UPDATE coupons SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
      const result = await db.query(query, params);

      res.json({
        success: true,
        message: 'Coupon updated successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Error updating coupon:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async deleteCoupon(req, res) {
    try {
      const { id } = req.params;

      const query = 'DELETE FROM coupons WHERE id = $1 RETURNING *';
      const result = await db.query(query, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found'
        });
      }

      res.json({
        success: true,
        message: 'Coupon deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting coupon:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async generateQRCode(req, res) {
    try {
      const { id } = req.params;

      const query = 'SELECT * FROM coupons WHERE id = $1';
      const result = await db.query(query, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found'
        });
      }

      const coupon = result.rows[0];

      // Generate QR code data (could be coupon code or URL)
      const qrData = {
        couponId: coupon.id,
        name: coupon.name,
        discount: `${coupon.discount_value}${coupon.discount_type === 'percentage' ? '%' : '$'} OFF`,
        validUntil: coupon.valid_until,
        timestamp: new Date().toISOString()
      };

      // Generate QR code
      const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrData), {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      res.json({
        success: true,
        data: {
          coupon: coupon,
          qrCode: qrCodeDataURL,
          qrData: qrData
        }
      });
    } catch (error) {
      console.error('Error generating QR code:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async distributeCoupon(req, res) {
    try {
      const { id } = req.params;
      const { user_ids, distribution_method = 'manual' } = req.body;

      if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'User IDs array is required'
        });
      }

      // Check if coupon exists
      const couponQuery = 'SELECT * FROM coupons WHERE id = $1';
      const couponResult = await db.query(couponQuery, [id]);

      if (couponResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found'
        });
      }

      const coupon = couponResult.rows[0];

      // Create user coupons for each user
      const userCoupons = [];
      
      for (const userId of user_ids) {
        const code = uuidv4();
        const insertQuery = `
          INSERT INTO user_coupons (user_id, coupon_id, code, status, distributed_at)
          VALUES ($1, $2, $3, $4, NOW())
          RETURNING *
        `;
        
        const result = await db.query(insertQuery, [userId, id, code, 'available']);
        userCoupons.push(result.rows[0]);
      }

      // Update coupon distribution count
      await db.query(
        'UPDATE coupons SET distribution_count = distribution_count + $1 WHERE id = $2',
        [user_ids.length, id]
      );

      res.json({
        success: true,
        message: `Coupon distributed to ${user_ids.length} users successfully`,
        data: {
          coupon: coupon,
          distributed_to: user_ids.length,
          user_coupons: userCoupons
        }
      });
    } catch (error) {
      console.error('Error distributing coupon:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
}

module.exports = new CouponController();