const express = require('express');
const router = express.Router();
const CouponController = require('../controllers/couponController');
const { validate, schemas } = require('../utils/validation');

// Get available coupons
router.get('/', validate(schemas.getCoupons), CouponController.getAvailableCoupons);

// Get coupon by code
router.get('/:code', CouponController.getCouponByCode);

// Generate QR code for coupon
router.get('/:code/qr', CouponController.generateQRCode);

// Validate coupon for order
router.get('/:code/validate', validate(schemas.validateCoupon), CouponController.validateCoupon);

// Redeem coupon
router.post('/:code/redeem', validate(schemas.redeemCoupon), CouponController.redeemCoupon);

// Get usage history
router.get('/usage/history', validate(schemas.getUsageHistory), CouponController.getCouponUsageHistory);

module.exports = router;