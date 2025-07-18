const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Get delivery status for a campaign
router.get('/campaign/:campaignId', async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    const offset = (page - 1) * limit;
    
    const query = `
      SELECT 
        cd.*,
        u.email,
        u.first_name,
        u.last_name,
        u.loyalty_tier
      FROM campaign_deliveries cd
      JOIN users u ON cd.user_id = u.id
      WHERE cd.campaign_id = $1
      ORDER BY cd.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const countQuery = `
      SELECT COUNT(*) as total
      FROM campaign_deliveries
      WHERE campaign_id = $1
    `;
    
    const [deliveries, countResult] = await Promise.all([
      db.query(query, [campaignId, limit, offset]),
      db.query(countQuery, [campaignId])
    ]);
    
    const total = parseInt(countResult.rows[0].total);
    
    res.json({
      success: true,
      data: {
        deliveries: deliveries.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Update delivery status
router.patch('/:deliveryId/status', async (req, res, next) => {
  try {
    const { deliveryId } = req.params;
    const { status, errorMessage } = req.body;
    
    const updateFields = ['status = $1', 'updated_at = NOW()'];
    const queryParams = [status, deliveryId];
    let paramCount = 3;
    
    if (status === 'sent') {
      updateFields.push(`sent_at = NOW()`);
    } else if (status === 'delivered') {
      updateFields.push(`delivered_at = NOW()`);
    } else if (status === 'failed' && errorMessage) {
      updateFields.push(`error_message = $${paramCount}`);
      queryParams.splice(-1, 0, errorMessage);
      paramCount++;
    }
    
    const query = `
      UPDATE campaign_deliveries
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount - 1}
      RETURNING *
    `;
    
    const result = await db.query(query, queryParams);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Delivery record not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Delivery status updated',
      data: {
        delivery: result.rows[0]
      }
    });
  } catch (error) {
    next(error);
  }
});

// Track delivery opened
router.post('/:deliveryId/opened', async (req, res, next) => {
  try {
    const { deliveryId } = req.params;
    
    const query = `
      UPDATE campaign_deliveries
      SET opened_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND opened_at IS NULL
      RETURNING *
    `;
    
    const result = await db.query(query, [deliveryId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Delivery record not found or already opened'
      });
    }
    
    res.json({
      success: true,
      message: 'Delivery marked as opened',
      data: {
        delivery: result.rows[0]
      }
    });
  } catch (error) {
    next(error);
  }
});

// Track delivery clicked
router.post('/:deliveryId/clicked', async (req, res, next) => {
  try {
    const { deliveryId } = req.params;
    
    const query = `
      UPDATE campaign_deliveries
      SET clicked_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND clicked_at IS NULL
      RETURNING *
    `;
    
    const result = await db.query(query, [deliveryId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Delivery record not found or already clicked'
      });
    }
    
    res.json({
      success: true,
      message: 'Delivery marked as clicked',
      data: {
        delivery: result.rows[0]
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;