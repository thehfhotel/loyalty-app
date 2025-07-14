const express = require('express');
const router = express.Router();
const LoyaltyController = require('../controllers/loyaltyController');
const { validate, schemas } = require('../utils/validation');

// Main loyalty dashboard
router.get('/dashboard', LoyaltyController.getDashboard);

// Points balance and summary
router.get('/points', LoyaltyController.getPointsBalance);

// Add points (admin/internal only)
router.post('/points', validate(schemas.addPoints), LoyaltyController.addPoints);

// Simulate points for a booking
router.post('/simulate-booking', validate(schemas.simulateBooking), LoyaltyController.simulateBookingPoints);

// Get earning opportunities
router.get('/earning-opportunities', LoyaltyController.getEarningOpportunities);

module.exports = router;