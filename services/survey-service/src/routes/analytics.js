const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');

// Get survey analytics
router.get('/survey/:surveyId', analyticsController.getSurveyAnalytics);

// Get response statistics
router.get('/survey/:surveyId/stats', analyticsController.getResponseStats);

// Get completion rates
router.get('/survey/:surveyId/completion', analyticsController.getCompletionRates);

// Get response trends
router.get('/survey/:surveyId/trends', analyticsController.getResponseTrends);

// Get overall survey metrics
router.get('/metrics', analyticsController.getOverallMetrics);

// Export survey data
router.get('/survey/:surveyId/export', analyticsController.exportSurveyData);

module.exports = router;