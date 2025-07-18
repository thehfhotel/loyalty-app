const express = require('express');
const router = express.Router();
const surveyController = require('../controllers/surveyController');

// Create a new survey
router.post('/', surveyController.createSurvey);

// Get all surveys
router.get('/', surveyController.getSurveys);

// Get survey by ID
router.get('/:id', surveyController.getSurveyById);

// Update survey
router.put('/:id', surveyController.updateSurvey);

// Delete survey
router.delete('/:id', surveyController.deleteSurvey);

// Publish survey
router.post('/:id/publish', surveyController.publishSurvey);

// Unpublish survey
router.post('/:id/unpublish', surveyController.unpublishSurvey);

module.exports = router;