const express = require('express');
const router = express.Router();
const ProfileController = require('../controllers/profileController');
const { authenticateToken } = require('../middleware/auth');
const { validate, schemas } = require('../utils/validation');

// All profile routes require authentication
router.use(authenticateToken);

// Profile management
router.get('/', ProfileController.getProfile);
router.put('/', validate(schemas.updateProfile), ProfileController.updateProfile);
router.delete('/', ProfileController.deleteAccount);

// Points and booking history
router.get('/points-history', ProfileController.getPointsHistory);
router.get('/booking-history', ProfileController.getBookingHistory);

// Data export (GDPR compliance)
router.get('/export', ProfileController.exportData);

module.exports = router;