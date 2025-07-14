const Coupon = require('../models/Coupon');

class CouponController {
  static async getAvailableCoupons(req, res, next) {
    try {
      const { user } = req;
      const { page = 1, limit = 20, category } = req.query;

      const result = await Coupon.findActive({
        userTier: user.loyalty_tier,
        category,
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      next(error);
    }
  }

  static async getCouponByCode(req, res, next) {
    try {
      const { code } = req.params;
      const { user } = req;

      const coupon = await Coupon.findByCode(code);

      if (!coupon) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found'
        });
      }

      // Validate for current user
      const validation = coupon.validateForUser(user.id, user.loyalty_tier);

      res.json({
        success: true,
        data: {
          coupon: coupon.toJSON(),
          validation,
          canUse: validation.isValid
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async generateQRCode(req, res, next) {
    try {
      const { code } = req.params;
      const { user } = req;

      const coupon = await Coupon.findByCode(code);

      if (!coupon) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found'
        });
      }

      // Validate user can access this coupon
      const validation = coupon.validateForUser(user.id, user.loyalty_tier);

      if (!validation.isValid) {
        return res.status(403).json({
          success: false,
          message: 'You cannot access this coupon',
          errors: validation.errors
        });
      }

      const qrCodeDataURL = await coupon.generateQRCode();

      res.json({
        success: true,
        data: {
          coupon: coupon.toJSON(),
          qrCode: qrCodeDataURL,
          qrCodeInstructions: 'Show this QR code to hotel staff for redemption'
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async validateCoupon(req, res, next) {
    try {
      const { code } = req.params;
      const { orderAmount = 0 } = req.query;
      const { user } = req;

      const coupon = await Coupon.findByCode(code);

      if (!coupon) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found'
        });
      }

      const validation = coupon.validateForUser(user.id, user.loyalty_tier, parseFloat(orderAmount));
      const discountAmount = validation.isValid ? coupon.calculateDiscount(parseFloat(orderAmount)) : 0;

      res.json({
        success: true,
        data: {
          coupon: coupon.toJSON(),
          validation,
          discountAmount,
          finalAmount: parseFloat(orderAmount) - discountAmount,
          canRedeem: validation.isValid
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async redeemCoupon(req, res, next) {
    try {
      const { code } = req.params;
      const { orderAmount, bookingId } = req.body;
      const { user } = req;

      const coupon = await Coupon.findByCode(code);

      if (!coupon) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found'
        });
      }

      const redemption = await coupon.redeem(user.id, orderAmount, bookingId);

      res.json({
        success: true,
        message: 'Coupon redeemed successfully',
        data: redemption
      });

    } catch (error) {
      next(error);
    }
  }

  static async getCouponUsageHistory(req, res, next) {
    try {
      const { user } = req;
      const { page = 1, limit = 20 } = req.query;

      const offset = (page - 1) * limit;

      const query = `
        SELECT 
          cu.*,
          c.code,
          c.name as coupon_name,
          c.description as coupon_description,
          c.discount_type,
          c.discount_value
        FROM coupon_usage cu
        JOIN coupons c ON cu.coupon_id = c.id
        WHERE cu.user_id = $1
        ORDER BY cu.used_at DESC
        LIMIT $2 OFFSET $3
      `;

      const countQuery = `
        SELECT COUNT(*) as total
        FROM coupon_usage
        WHERE user_id = $1
      `;

      const [usage, countResult] = await Promise.all([
        db.query(query, [user.id, limit, offset]),
        db.query(countQuery, [user.id])
      ]);

      res.json({
        success: true,
        data: {
          usage: usage.rows,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(countResult.rows[0].total / limit),
            totalItems: parseInt(countResult.rows[0].total),
            itemsPerPage: parseInt(limit)
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }
}

module.exports = CouponController;