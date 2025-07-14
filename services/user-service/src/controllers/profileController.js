const User = require('../models/User');
const db = require('../config/database');

class ProfileController {
  static async getProfile(req, res, next) {
    try {
      const { user } = req;

      // Get additional profile information
      const loyaltyInfoQuery = `
        SELECT 
          u.loyalty_tier,
          u.total_points,
          COALESCE(SUM(CASE WHEN pt.created_at > NOW() - INTERVAL '60 days' THEN pt.points_amount ELSE 0 END), 0) as points_expiring_soon,
          COUNT(DISTINCT b.id) as total_bookings,
          COALESCE(SUM(b.total_amount), 0) as total_spent,
          MAX(b.checkout_date) as last_stay_date
        FROM users u
        LEFT JOIN point_transactions pt ON u.id = pt.user_id AND pt.transaction_type = 'earned'
        LEFT JOIN bookings b ON u.id = b.user_id AND b.status = 'completed'
        WHERE u.id = $1
        GROUP BY u.id, u.loyalty_tier, u.total_points
      `;

      const loyaltyInfo = await db.query(loyaltyInfoQuery, [user.id]);
      const profileData = loyaltyInfo.rows[0] || {
        loyalty_tier: user.loyaltyTier,
        total_points: user.totalPoints,
        points_expiring_soon: 0,
        total_bookings: 0,
        total_spent: 0,
        last_stay_date: null
      };

      res.json({
        success: true,
        data: {
          user: {
            ...user.toJSON(),
            loyaltyInfo: {
              tier: profileData.loyalty_tier,
              totalPoints: parseInt(profileData.total_points),
              pointsExpiringSoon: parseInt(profileData.points_expiring_soon),
              totalBookings: parseInt(profileData.total_bookings),
              totalSpent: parseFloat(profileData.total_spent),
              lastStayDate: profileData.last_stay_date
            }
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async updateProfile(req, res, next) {
    try {
      const { user } = req;
      const updateData = req.body;

      const updatedUser = await user.updateProfile(updateData);

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: updatedUser.toJSON()
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async deleteAccount(req, res, next) {
    try {
      const { user } = req;

      // Soft delete - mark account as deleted but keep data for compliance
      await db.query(
        'UPDATE users SET deleted_at = NOW(), email = $1 WHERE id = $2',
        [`deleted_${user.id}_${user.email}`, user.id]
      );

      res.json({
        success: true,
        message: 'Account deleted successfully'
      });

    } catch (error) {
      next(error);
    }
  }

  static async getPointsHistory(req, res, next) {
    try {
      const { user } = req;
      const { page = 1, limit = 20 } = req.query;
      
      const offset = (page - 1) * limit;

      const query = `
        SELECT 
          id,
          points_amount,
          transaction_type,
          description,
          created_at,
          expires_at
        FROM point_transactions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;

      const countQuery = `
        SELECT COUNT(*) as total
        FROM point_transactions
        WHERE user_id = $1
      `;

      const [transactions, countResult] = await Promise.all([
        db.query(query, [user.id, limit, offset]),
        db.query(countQuery, [user.id])
      ]);

      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      res.json({
        success: true,
        data: {
          transactions: transactions.rows,
          pagination: {
            currentPage: parseInt(page),
            totalPages,
            totalItems: total,
            itemsPerPage: parseInt(limit)
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async getBookingHistory(req, res, next) {
    try {
      const { user } = req;
      const { page = 1, limit = 10 } = req.query;
      
      const offset = (page - 1) * limit;

      const query = `
        SELECT 
          id,
          booking_reference,
          room_type,
          checkin_date,
          checkout_date,
          total_amount,
          status,
          created_at
        FROM bookings
        WHERE user_id = $1
        ORDER BY checkin_date DESC
        LIMIT $2 OFFSET $3
      `;

      const countQuery = `
        SELECT COUNT(*) as total
        FROM bookings
        WHERE user_id = $1
      `;

      const [bookings, countResult] = await Promise.all([
        db.query(query, [user.id, limit, offset]),
        db.query(countQuery, [user.id])
      ]);

      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      res.json({
        success: true,
        data: {
          bookings: bookings.rows,
          pagination: {
            currentPage: parseInt(page),
            totalPages,
            totalItems: total,
            itemsPerPage: parseInt(limit)
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async exportData(req, res, next) {
    try {
      const { user } = req;

      // Get all user data for GDPR compliance
      const userDataQuery = `
        SELECT 
          u.*,
          json_agg(DISTINCT pt.*) FILTER (WHERE pt.id IS NOT NULL) as point_transactions,
          json_agg(DISTINCT b.*) FILTER (WHERE b.id IS NOT NULL) as bookings,
          json_agg(DISTINCT sr.*) FILTER (WHERE sr.id IS NOT NULL) as survey_responses
        FROM users u
        LEFT JOIN point_transactions pt ON u.id = pt.user_id
        LEFT JOIN bookings b ON u.id = b.user_id
        LEFT JOIN survey_responses sr ON u.id = sr.user_id
        WHERE u.id = $1
        GROUP BY u.id
      `;

      const result = await db.query(userDataQuery, [user.id]);
      const userData = result.rows[0];

      // Remove sensitive data
      delete userData.password_hash;

      res.json({
        success: true,
        message: 'User data exported successfully',
        data: userData,
        exportedAt: new Date().toISOString()
      });

    } catch (error) {
      next(error);
    }
  }
}

module.exports = ProfileController;