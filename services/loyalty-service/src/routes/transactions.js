const express = require('express');
const router = express.Router();
const PointTransaction = require('../models/PointTransaction');

// Get user's point transactions
router.get('/', async (req, res, next) => {
  try {
    const { user } = req;
    const { 
      page = 1, 
      limit = 20, 
      type, 
      startDate, 
      endDate 
    } = req.query;
    
    const filters = {
      page: parseInt(page),
      limit: parseInt(limit),
      type,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined
    };
    
    const transactions = await PointTransaction.getUserTransactions(user.id, filters);
    
    res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    next(error);
  }
});

// Get points summary
router.get('/summary', async (req, res, next) => {
  try {
    const { user } = req;
    
    const summary = await PointTransaction.getPointsSummary(user.id);
    
    res.json({
      success: true,
      data: {
        userId: user.id,
        currentBalance: user.total_points,
        ...summary
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get expiring points
router.get('/expiring', async (req, res, next) => {
  try {
    const { user } = req;
    const { days = 30 } = req.query;
    
    const expiringPoints = await PointTransaction.getExpiringPoints(user.id, parseInt(days));
    
    res.json({
      success: true,
      data: {
        expiringPoints,
        daysAhead: parseInt(days)
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;