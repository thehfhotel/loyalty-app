const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Get campaign analytics overview
router.get('/overview', async (req, res, next) => {
  try {
    const { dateFrom, dateTo } = req.query;
    
    let dateCondition = '';
    let queryParams = [];
    
    if (dateFrom && dateTo) {
      dateCondition = 'AND c.created_at BETWEEN $1 AND $2';
      queryParams = [new Date(dateFrom), new Date(dateTo)];
    }
    
    const query = `
      SELECT 
        COUNT(DISTINCT c.id) as total_campaigns,
        COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.id END) as active_campaigns,
        COUNT(DISTINCT CASE WHEN c.status = 'completed' THEN c.id END) as completed_campaigns,
        COUNT(DISTINCT cd.id) as total_deliveries,
        COUNT(DISTINCT CASE WHEN cd.status = 'delivered' THEN cd.id END) as successful_deliveries,
        COUNT(DISTINCT CASE WHEN cd.opened_at IS NOT NULL THEN cd.id END) as total_opens,
        COUNT(DISTINCT CASE WHEN cd.clicked_at IS NOT NULL THEN cd.id END) as total_clicks,
        CASE 
          WHEN COUNT(DISTINCT CASE WHEN cd.status = 'delivered' THEN cd.id END) > 0 
          THEN ROUND(
            COUNT(DISTINCT CASE WHEN cd.opened_at IS NOT NULL THEN cd.id END)::DECIMAL / 
            COUNT(DISTINCT CASE WHEN cd.status = 'delivered' THEN cd.id END) * 100, 2
          )
          ELSE 0 
        END as overall_open_rate,
        CASE 
          WHEN COUNT(DISTINCT CASE WHEN cd.opened_at IS NOT NULL THEN cd.id END) > 0 
          THEN ROUND(
            COUNT(DISTINCT CASE WHEN cd.clicked_at IS NOT NULL THEN cd.id END)::DECIMAL / 
            COUNT(DISTINCT CASE WHEN cd.opened_at IS NOT NULL THEN cd.id END) * 100, 2
          )
          ELSE 0 
        END as overall_click_rate
      FROM campaigns c
      LEFT JOIN campaign_deliveries cd ON c.id = cd.campaign_id
      WHERE 1=1 ${dateCondition}
    `;
    
    const result = await db.query(query, queryParams);
    
    res.json({
      success: true,
      data: {
        overview: result.rows[0],
        dateRange: dateFrom && dateTo ? { from: dateFrom, to: dateTo } : null
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get campaign performance by type
router.get('/performance-by-type', async (req, res, next) => {
  try {
    const { dateFrom, dateTo } = req.query;
    
    let dateCondition = '';
    let queryParams = [];
    
    if (dateFrom && dateTo) {
      dateCondition = 'AND c.created_at BETWEEN $1 AND $2';
      queryParams = [new Date(dateFrom), new Date(dateTo)];
    }
    
    const query = `
      SELECT 
        c.campaign_type,
        COUNT(DISTINCT c.id) as campaign_count,
        COUNT(DISTINCT cd.id) as total_deliveries,
        COUNT(DISTINCT CASE WHEN cd.status = 'delivered' THEN cd.id END) as successful_deliveries,
        COUNT(DISTINCT CASE WHEN cd.opened_at IS NOT NULL THEN cd.id END) as total_opens,
        COUNT(DISTINCT CASE WHEN cd.clicked_at IS NOT NULL THEN cd.id END) as total_clicks,
        CASE 
          WHEN COUNT(DISTINCT CASE WHEN cd.status = 'delivered' THEN cd.id END) > 0 
          THEN ROUND(
            COUNT(DISTINCT CASE WHEN cd.opened_at IS NOT NULL THEN cd.id END)::DECIMAL / 
            COUNT(DISTINCT CASE WHEN cd.status = 'delivered' THEN cd.id END) * 100, 2
          )
          ELSE 0 
        END as open_rate,
        CASE 
          WHEN COUNT(DISTINCT CASE WHEN cd.opened_at IS NOT NULL THEN cd.id END) > 0 
          THEN ROUND(
            COUNT(DISTINCT CASE WHEN cd.clicked_at IS NOT NULL THEN cd.id END)::DECIMAL / 
            COUNT(DISTINCT CASE WHEN cd.opened_at IS NOT NULL THEN cd.id END) * 100, 2
          )
          ELSE 0 
        END as click_rate
      FROM campaigns c
      LEFT JOIN campaign_deliveries cd ON c.id = cd.campaign_id
      WHERE 1=1 ${dateCondition}
      GROUP BY c.campaign_type
      ORDER BY campaign_count DESC
    `;
    
    const result = await db.query(query, queryParams);
    
    res.json({
      success: true,
      data: {
        performanceByType: result.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get top performing campaigns
router.get('/top-campaigns', async (req, res, next) => {
  try {
    const { limit = 10, sortBy = 'open_rate' } = req.query;
    
    const validSortFields = ['open_rate', 'click_rate', 'total_deliveries', 'total_opens'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'open_rate';
    
    const query = `
      SELECT 
        c.id,
        c.name,
        c.campaign_type,
        c.status,
        c.created_at,
        COUNT(DISTINCT cd.id) as total_deliveries,
        COUNT(DISTINCT CASE WHEN cd.status = 'delivered' THEN cd.id END) as successful_deliveries,
        COUNT(DISTINCT CASE WHEN cd.opened_at IS NOT NULL THEN cd.id END) as total_opens,
        COUNT(DISTINCT CASE WHEN cd.clicked_at IS NOT NULL THEN cd.id END) as total_clicks,
        CASE 
          WHEN COUNT(DISTINCT CASE WHEN cd.status = 'delivered' THEN cd.id END) > 0 
          THEN ROUND(
            COUNT(DISTINCT CASE WHEN cd.opened_at IS NOT NULL THEN cd.id END)::DECIMAL / 
            COUNT(DISTINCT CASE WHEN cd.status = 'delivered' THEN cd.id END) * 100, 2
          )
          ELSE 0 
        END as open_rate,
        CASE 
          WHEN COUNT(DISTINCT CASE WHEN cd.opened_at IS NOT NULL THEN cd.id END) > 0 
          THEN ROUND(
            COUNT(DISTINCT CASE WHEN cd.clicked_at IS NOT NULL THEN cd.id END)::DECIMAL / 
            COUNT(DISTINCT CASE WHEN cd.opened_at IS NOT NULL THEN cd.id END) * 100, 2
          )
          ELSE 0 
        END as click_rate
      FROM campaigns c
      LEFT JOIN campaign_deliveries cd ON c.id = cd.campaign_id
      GROUP BY c.id, c.name, c.campaign_type, c.status, c.created_at
      HAVING COUNT(DISTINCT cd.id) > 0
      ORDER BY ${sortField} DESC
      LIMIT $1
    `;
    
    const result = await db.query(query, [parseInt(limit)]);
    
    res.json({
      success: true,
      data: {
        topCampaigns: result.rows,
        sortBy: sortField
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;