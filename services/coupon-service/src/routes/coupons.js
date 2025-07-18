const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');

// Admin routes (create, update, delete)
router.post('/', couponController.createCoupon);
router.get('/', couponController.getCoupons);
router.get('/:id', couponController.getCouponById);
router.put('/:id', couponController.updateCoupon);
router.delete('/:id', couponController.deleteCoupon);

// Generate QR code for coupon
router.get('/:id/qr', couponController.generateQRCode);

// Distribute coupon to users
router.post('/:id/distribute', couponController.distributeCoupon);

module.exports = router;