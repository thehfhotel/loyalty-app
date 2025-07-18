const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Get user segments
router.get('/', async (req, res, next) => {
  try {
    const segments = [
      {
        id: 'high-value',
        name: 'High Value Customers',
        description: 'Customers with high total spend',
        criteria: { min_total_spend: 1000 },
        estimatedSize: 0
      },
      {
        id: 'loyal-customers',
        name: 'Loyal Customers',
        description: 'Gold and Platinum tier customers',
        criteria: { loyalty_tier: ['gold', 'platinum'] },
        estimatedSize: 0
      },
      {
        id: 'inactive-customers',
        name: 'Inactive Customers',
        description: 'Customers who haven\'t stayed in 6 months',
        criteria: { days_since_last_stay: 180 },
        estimatedSize: 0
      },
      {
        id: 'new-customers',
        name: 'New Customers',
        description: 'Customers who joined in last 30 days',
        criteria: { days_since_registration: 30 },
        estimatedSize: 0
      }
    ];

    // Calculate estimated sizes
    for (const segment of segments) {
      const count = await getSegmentSize(segment.criteria);
      segment.estimatedSize = count;
    }

    res.json({
      success: true,
      data: {
        segments
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get segment preview
router.post('/preview', async (req, res, next) => {
  try {
    const { criteria } = req.body;
    
    const users = await getUsersByCriteria(criteria);
    
    res.json({
      success: true,
      data: {
        criteria,
        users: users.slice(0, 10), // First 10 users
        totalCount: users.length
      }
    });
  } catch (error) {
    next(error);
  }
});

async function getSegmentSize(criteria) {
  let whereConditions = ['u.deleted_at IS NULL'];
  let queryParams = [];
  let paramCount = 1;

  if (criteria.loyalty_tier && criteria.loyalty_tier.length > 0) {
    whereConditions.push(`u.loyalty_tier = ANY($${paramCount})`);
    queryParams.push(criteria.loyalty_tier);
    paramCount++;
  }

  if (criteria.min_total_spend) {
    whereConditions.push(`COALESCE(user_stats.total_spend, 0) >= $${paramCount}`);
    queryParams.push(criteria.min_total_spend);
    paramCount++;
  }

  if (criteria.days_since_last_stay) {
    whereConditions.push(`user_stats.last_stay_date < NOW() - INTERVAL '${criteria.days_since_last_stay} days'`);
  }

  if (criteria.days_since_registration) {
    whereConditions.push(`u.created_at >= NOW() - INTERVAL '${criteria.days_since_registration} days'`);
  }

  const query = `
    SELECT COUNT(*) as count
    FROM users u
    LEFT JOIN (
      SELECT 
        user_id,
        COUNT(*) as total_bookings,
        SUM(total_amount) as total_spend,
        MAX(checkout_date) as last_stay_date
      FROM bookings
      WHERE status = 'completed'
      GROUP BY user_id
    ) user_stats ON u.id = user_stats.user_id
    WHERE ${whereConditions.join(' AND ')}
  `;

  const result = await db.query(query, queryParams);
  return parseInt(result.rows[0].count);
}

async function getUsersByCriteria(criteria) {
  let whereConditions = ['u.deleted_at IS NULL'];
  let queryParams = [];
  let paramCount = 1;

  if (criteria.loyalty_tier && criteria.loyalty_tier.length > 0) {
    whereConditions.push(`u.loyalty_tier = ANY($${paramCount})`);
    queryParams.push(criteria.loyalty_tier);
    paramCount++;
  }

  if (criteria.min_total_spend) {
    whereConditions.push(`COALESCE(user_stats.total_spend, 0) >= $${paramCount}`);
    queryParams.push(criteria.min_total_spend);
    paramCount++;
  }

  if (criteria.days_since_last_stay) {
    whereConditions.push(`user_stats.last_stay_date < NOW() - INTERVAL '${criteria.days_since_last_stay} days'`);
  }

  if (criteria.days_since_registration) {
    whereConditions.push(`u.created_at >= NOW() - INTERVAL '${criteria.days_since_registration} days'`);
  }

  const query = `
    SELECT u.id, u.email, u.first_name, u.last_name, u.loyalty_tier, u.total_points
    FROM users u
    LEFT JOIN (
      SELECT 
        user_id,
        COUNT(*) as total_bookings,
        SUM(total_amount) as total_spend,
        MAX(checkout_date) as last_stay_date
      FROM bookings
      WHERE status = 'completed'
      GROUP BY user_id
    ) user_stats ON u.id = user_stats.user_id
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY u.loyalty_tier DESC, u.total_points DESC
  `;

  const result = await db.query(query, queryParams);
  return result.rows;
}

module.exports = router;