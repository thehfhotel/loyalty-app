const express = require('express');
const router = express.Router();
const responseController = require('../controllers/responseController');

// Submit survey response
router.post('/', responseController.submitResponse);

// Get responses for a survey
router.get('/survey/:surveyId', responseController.getResponsesBySurvey);

// Get response by ID
router.get('/:id', responseController.getResponseById);

// Get user's responses
router.get('/user/:userId', responseController.getResponsesByUser);

// Update response (if allowed)
router.put('/:id', responseController.updateResponse);

// Delete response
router.delete('/:id', responseController.deleteResponse);

module.exports = router;