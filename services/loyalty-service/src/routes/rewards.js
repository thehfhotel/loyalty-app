const express = require('express');
const router = express.Router();
const Reward = require('../models/Reward');
const { validate, schemas } = require('../utils/validation');

// Get available rewards for user
router.get('/', async (req, res, next) => {
  try {
    const { user } = req;
    const { category, minPoints, maxPoints, page = 1, limit = 20 } = req.query;
    
    const filters = {
      category,
      minPoints: minPoints ? parseInt(minPoints) : undefined,
      maxPoints: maxPoints ? parseInt(maxPoints) : undefined,
      page: parseInt(page),
      limit: parseInt(limit)
    };
    
    const rewards = await Reward.findAvailableForUser(user.id, filters);
    
    res.json({
      success: true,
      data: rewards
    });
  } catch (error) {
    next(error);
  }
});

// Get reward details
router.get('/:rewardId', async (req, res, next) => {
  try {
    const { rewardId } = req.params;
    const { user } = req;
    
    const reward = await Reward.findById(rewardId);
    
    if (!reward) {
      return res.status(404).json({
        success: false,
        message: 'Reward not found'
      });
    }
    
    // Check if user can redeem this reward
    const canRedeem = await Reward.canUserRedeem(user.id, rewardId);
    
    res.json({
      success: true,
      data: {
        reward: reward.toJSON(),
        canRedeem,
        userPoints: user.total_points
      }
    });
  } catch (error) {
    next(error);
  }
});

// Redeem reward
router.post('/:rewardId/redeem', validate(schemas.redeemReward), async (req, res, next) => {
  try {
    const { rewardId } = req.params;
    const { user } = req;
    const { quantity = 1 } = req.body;
    
    const redemption = await Reward.redeemReward(user.id, rewardId, quantity);
    
    res.status(201).json({
      success: true,
      message: 'Reward redeemed successfully',
      data: {
        redemption: redemption.toJSON(),
        newPointsBalance: redemption.newPointsBalance
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get user's redemption history
router.get('/history/redemptions', async (req, res, next) => {
  try {
    const { user } = req;
    const { page = 1, limit = 10, status } = req.query;
    
    const filters = {
      page: parseInt(page),
      limit: parseInt(limit),
      status
    };
    
    const redemptions = await Reward.getUserRedemptions(user.id, filters);
    
    res.json({
      success: true,
      data: redemptions
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;