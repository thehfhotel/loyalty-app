const Survey = require('../models/Survey');
const SurveyResponse = require('../models/SurveyResponse');

class SurveyController {
  static async getAvailableSurveys(req, res, next) {
    try {
      const { user } = req;
      const { type } = req.query;

      const surveys = await Survey.findForUser(user.id);

      // Filter by type if specified
      const filteredSurveys = type 
        ? surveys.filter(s => s.surveyType === type)
        : surveys;

      res.json({
        success: true,
        data: {
          surveys: filteredSurveys.map(survey => ({
            ...survey.toJSON(),
            userResponse: survey.userResponse
          }))
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async getSurveyById(req, res, next) {
    try {
      const { surveyId } = req.params;
      const { user } = req;

      const survey = await Survey.findById(surveyId);

      if (!survey) {
        return res.status(404).json({
          success: false,
          message: 'Survey not found'
        });
      }

      // Check eligibility
      const eligibility = await survey.checkEligibility(user.id);

      res.json({
        success: true,
        data: {
          survey: survey.toJSON(),
          eligibility
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async startSurvey(req, res, next) {
    try {
      const { surveyId } = req.params;
      const { user } = req;

      const survey = await Survey.findById(surveyId);

      if (!survey) {
        return res.status(404).json({
          success: false,
          message: 'Survey not found'
        });
      }

      // Check eligibility
      const eligibility = await survey.checkEligibility(user.id);

      if (!eligibility.eligible && !eligibility.canContinue) {
        return res.status(403).json({
          success: false,
          message: eligibility.reason
        });
      }

      // Create or get existing response
      let response;
      
      if (eligibility.canContinue) {
        // Get existing response
        response = await SurveyResponse.findByUserAndSurvey(user.id, surveyId);
      } else {
        // Create new response
        response = await SurveyResponse.create({
          surveyId,
          userId: user.id,
          responses: {}
        });
      }

      res.json({
        success: true,
        message: eligibility.canContinue ? 'Survey resumed' : 'Survey started',
        data: {
          survey: survey.toJSON(),
          response: response.toJSON()
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async submitResponse(req, res, next) {
    try {
      const { surveyId } = req.params;
      const { user } = req;
      const { responses, isComplete = false } = req.body;

      const survey = await Survey.findById(surveyId);

      if (!survey) {
        return res.status(404).json({
          success: false,
          message: 'Survey not found'
        });
      }

      // Get or create response
      let response = await SurveyResponse.findByUserAndSurvey(user.id, surveyId);
      
      if (!response) {
        response = await SurveyResponse.create({
          surveyId,
          userId: user.id,
          responses: {}
        });
      }

      // Update response
      const updatedResponse = await response.updateResponses(responses, isComplete);

      // Award points if survey completed
      let pointsAwarded = 0;
      if (isComplete && survey.rewardPoints > 0) {
        // This would typically call the loyalty service to award points
        pointsAwarded = survey.rewardPoints;
      }

      res.json({
        success: true,
        message: isComplete ? 'Survey completed successfully' : 'Responses saved',
        data: {
          response: updatedResponse.toJSON(),
          pointsAwarded
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async getUserResponses(req, res, next) {
    try {
      const { user } = req;
      const { page = 1, limit = 20, status } = req.query;

      const responses = await SurveyResponse.findByUser(user.id, {
        status,
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: responses
      });

    } catch (error) {
      next(error);
    }
  }
}

module.exports = SurveyController;