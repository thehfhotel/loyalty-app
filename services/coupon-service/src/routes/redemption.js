const express = require('express');
const router = express.Router();
const redemptionController = require('../controllers/redemptionController');
const authMiddleware = require('../middleware/auth');

// Validate coupon (can be used by staff without authentication)
router.post('/validate', redemptionController.validateCoupon);

// Redeem coupon (requires authentication)
router.post('/redeem', authMiddleware.authenticateToken, redemptionController.redeemCoupon);

// Get redemption history
router.get('/history', authMiddleware.authenticateToken, redemptionController.getRedemptionHistory);

// Get redemption statistics (admin only)
router.get('/stats', authMiddleware.authenticateToken, redemptionController.getRedemptionStats);

// Reverse redemption (admin only)
router.post('/reverse/:redemptionId', authMiddleware.authenticateToken, redemptionController.reverseRedemption);

module.exports = router;