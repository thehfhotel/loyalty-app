const express = require('express');
const router = express.Router();
const WalletController = require('../controllers/walletController');
const { validate, schemas } = require('../utils/validation');

// Get user's coupon wallet
router.get('/', validate(schemas.getWallet), WalletController.getUserWallet);

// Get coupons by category
router.get('/categories', WalletController.getCouponsByCategory);

// Get specific coupon details
router.get('/coupons/:couponId', WalletController.getCouponDetails);

// Mark coupon as favorite
router.post('/coupons/:couponId/favorite', validate(schemas.markFavorite), WalletController.markAsFavorite);

module.exports = router;