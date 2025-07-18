const express = require('express');
const router = express.Router();
const LoyaltyTier = require('../models/LoyaltyTier');

// Get all tiers
router.get('/', async (req, res, next) => {
  try {
    const tiers = await LoyaltyTier.findAll();
    
    res.json({
      success: true,
      data: {
        tiers
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get user's tier information
router.get('/my-tier', async (req, res, next) => {
  try {
    const { user } = req;
    
    const tierInfo = await LoyaltyTier.getUserTierInfo(user.id);
    
    res.json({
      success: true,
      data: tierInfo
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;