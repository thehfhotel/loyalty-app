const Coupon = require('../models/Coupon');
const db = require('../config/database');

class WalletController {
  static async getUserWallet(req, res, next) {
    try {
      const { user } = req;
      const { status = 'active' } = req.query;

      const coupons = await Coupon.findUserCoupons(user.id, { status });

      // Get summary statistics
      const summaryQuery = `
        SELECT 
          COUNT(CASE WHEN c.valid_until >= NOW() AND cu.id IS NULL THEN 1 END) as active_count,
          COUNT(CASE WHEN cu.id IS NOT NULL THEN 1 END) as used_count,
          COUNT(CASE WHEN c.valid_until < NOW() AND cu.id IS NULL THEN 1 END) as expired_count,
          COALESCE(SUM(CASE WHEN cu.id IS NOT NULL THEN cu.discount_amount END), 0) as total_savings
        FROM coupons c
        LEFT JOIN coupon_usage cu ON c.id = cu.coupon_id AND cu.user_id = $1
        WHERE (
          SELECT CASE u.loyalty_tier
            WHEN 'bronze' THEN c.min_tier = 'bronze'
            WHEN 'silver' THEN c.min_tier IN ('bronze', 'silver')
            WHEN 'gold' THEN c.min_tier IN ('bronze', 'silver', 'gold')
            WHEN 'platinum' THEN c.min_tier IN ('bronze', 'silver', 'gold', 'platinum')
            ELSE false
          END
          FROM users u WHERE u.id = $1
        )
      `;

      const summaryResult = await db.query(summaryQuery, [user.id]);
      const summary = summaryResult.rows[0];

      // Get expiring soon coupons (next 7 days)
      const expiringSoonQuery = `
        SELECT c.*, 
               EXTRACT(DAYS FROM (c.valid_until - NOW())) as days_until_expiry
        FROM coupons c
        LEFT JOIN coupon_usage cu ON c.id = cu.coupon_id AND cu.user_id = $1
        WHERE cu.id IS NULL
        AND c.valid_until BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        AND c.is_active = true
        AND (
          SELECT CASE u.loyalty_tier
            WHEN 'bronze' THEN c.min_tier = 'bronze'
            WHEN 'silver' THEN c.min_tier IN ('bronze', 'silver')
            WHEN 'gold' THEN c.min_tier IN ('bronze', 'silver', 'gold')
            WHEN 'platinum' THEN c.min_tier IN ('bronze', 'silver', 'gold', 'platinum')
            ELSE false
          END
          FROM users u WHERE u.id = $1
        )
        ORDER BY c.valid_until ASC
        LIMIT 5
      `;

      const expiringSoonResult = await db.query(expiringSoonQuery, [user.id]);

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            name: `${user.first_name} ${user.last_name}`,
            tier: user.loyalty_tier
          },
          summary: {
            activeCoupons: parseInt(summary.active_count),
            usedCoupons: parseInt(summary.used_count),
            expiredCoupons: parseInt(summary.expired_count),
            totalSavings: parseFloat(summary.total_savings)
          },
          coupons,
          expiringSoon: expiringSoonResult.rows.map(row => {
            const coupon = new Coupon(row);
            coupon.daysUntilExpiry = parseInt(row.days_until_expiry);
            return coupon;
          })
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async getCouponDetails(req, res, next) {
    try {
      const { couponId } = req.params;
      const { user } = req;

      const query = `
        SELECT 
          c.*,
          cu.used_at,
          cu.discount_amount as used_discount_amount,
          cu.booking_id as used_booking_id,
          CASE 
            WHEN cu.id IS NOT NULL THEN 'used'
            WHEN c.valid_until < NOW() THEN 'expired'
            ELSE 'active'
          END as coupon_status
        FROM coupons c
        LEFT JOIN coupon_usage cu ON c.id = cu.coupon_id AND cu.user_id = $2
        WHERE c.id = $1
        AND (
          SELECT CASE u.loyalty_tier
            WHEN 'bronze' THEN c.min_tier = 'bronze'
            WHEN 'silver' THEN c.min_tier IN ('bronze', 'silver')
            WHEN 'gold' THEN c.min_tier IN ('bronze', 'silver', 'gold')
            WHEN 'platinum' THEN c.min_tier IN ('bronze', 'silver', 'gold', 'platinum')
            ELSE false
          END
          FROM users u WHERE u.id = $2
        )
      `;

      const result = await db.query(query, [couponId, user.id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found or not accessible'
        });
      }

      const couponData = result.rows[0];
      const coupon = new Coupon(couponData);
      coupon.status = couponData.coupon_status;
      coupon.usedAt = couponData.used_at;
      coupon.usedDiscountAmount = couponData.used_discount_amount;
      coupon.usedBookingId = couponData.used_booking_id;

      // Generate QR code if coupon is active
      let qrCode = null;
      if (coupon.status === 'active') {
        try {
          qrCode = await coupon.generateQRCode();
        } catch (error) {
          console.error('Error generating QR code:', error);
        }
      }

      res.json({
        success: true,
        data: {
          coupon: coupon.toJSON(),
          status: coupon.status,
          usageDetails: coupon.usedAt ? {
            usedAt: coupon.usedAt,
            discountAmount: coupon.usedDiscountAmount,
            bookingId: coupon.usedBookingId
          } : null,
          qrCode
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async markAsFavorite(req, res, next) {
    try {
      const { couponId } = req.params;
      const { user } = req;
      const { isFavorite } = req.body;

      // This would require a user_favorites table, but for now we'll just return success
      // TODO: Implement favorites functionality with database table

      res.json({
        success: true,
        message: isFavorite ? 'Coupon added to favorites' : 'Coupon removed from favorites',
        data: {
          couponId,
          isFavorite
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async getCouponsByCategory(req, res, next) {
    try {
      const { user } = req;

      const query = `
        SELECT 
          COALESCE(
            CASE c.discount_type
              WHEN 'percentage' THEN 'percentage_discount'
              WHEN 'fixed_amount' THEN 'fixed_discount'
              ELSE 'other'
            END,
            'uncategorized'
          ) as category,
          COUNT(*) as count,
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', c.id,
              'code', c.code,
              'name', c.name,
              'discountValue', c.discount_value,
              'discountType', c.discount_type,
              'validUntil', c.valid_until,
              'status', CASE 
                WHEN cu.id IS NOT NULL THEN 'used'
                WHEN c.valid_until < NOW() THEN 'expired'
                ELSE 'active'
              END
            )
          ) as coupons
        FROM coupons c
        LEFT JOIN coupon_usage cu ON c.id = cu.coupon_id AND cu.user_id = $1
        WHERE (
          SELECT CASE u.loyalty_tier
            WHEN 'bronze' THEN c.min_tier = 'bronze'
            WHEN 'silver' THEN c.min_tier IN ('bronze', 'silver')
            WHEN 'gold' THEN c.min_tier IN ('bronze', 'silver', 'gold')
            WHEN 'platinum' THEN c.min_tier IN ('bronze', 'silver', 'gold', 'platinum')
            ELSE false
          END
          FROM users u WHERE u.id = $1
        )
        GROUP BY category
        ORDER BY category
      `;

      const result = await db.query(query, [user.id]);

      res.json({
        success: true,
        data: {
          categories: result.rows
        }
      });

    } catch (error) {
      next(error);
    }
  }
}

module.exports = WalletController;