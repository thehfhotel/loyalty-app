const db = require('../config/database');

class ResponseController {
  async submitResponse(req, res) {
    try {
      const { surveyId, userId, responses } = req.body;
      
      // Validate required fields
      if (!surveyId || !userId || !responses) {
        return res.status(400).json({
          success: false,
          message: 'Survey ID, user ID, and responses are required'
        });
      }

      // Check if survey exists and is published
      const surveyQuery = 'SELECT * FROM surveys WHERE id = $1 AND status = $2';
      const surveyResult = await db.query(surveyQuery, [surveyId, 'published']);
      
      if (surveyResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Survey not found or not published'
        });
      }

      // Check if user already responded
      const existingResponseQuery = 'SELECT id FROM survey_responses WHERE survey_id = $1 AND user_id = $2';
      const existingResult = await db.query(existingResponseQuery, [surveyId, userId]);
      
      if (existingResult.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'User has already responded to this survey'
        });
      }

      // Insert response
      const insertQuery = `
        INSERT INTO survey_responses (survey_id, user_id, responses, submitted_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING *
      `;
      
      const result = await db.query(insertQuery, [surveyId, userId, JSON.stringify(responses)]);
      
      res.status(201).json({
        success: true,
        message: 'Response submitted successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Error submitting response:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getResponsesBySurvey(req, res) {
    try {
      const { surveyId } = req.params;
      const { page = 1, limit = 10 } = req.query;
      
      const offset = (page - 1) * limit;
      
      const query = `
        SELECT r.*, u.email as user_email
        FROM survey_responses r
        LEFT JOIN users u ON r.user_id = u.id
        WHERE r.survey_id = $1
        ORDER BY r.submitted_at DESC
        LIMIT $2 OFFSET $3
      `;
      
      const result = await db.query(query, [surveyId, limit, offset]);
      
      // Get total count
      const countQuery = 'SELECT COUNT(*) FROM survey_responses WHERE survey_id = $1';
      const countResult = await db.query(countQuery, [surveyId]);
      
      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countResult.rows[0].count)
        }
      });
    } catch (error) {
      console.error('Error getting responses:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getResponseById(req, res) {
    try {
      const { id } = req.params;
      
      const query = `
        SELECT r.*, u.email as user_email, s.title as survey_title
        FROM survey_responses r
        LEFT JOIN users u ON r.user_id = u.id
        LEFT JOIN surveys s ON r.survey_id = s.id
        WHERE r.id = $1
      `;
      
      const result = await db.query(query, [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Response not found'
        });
      }
      
      res.json({
        success: true,
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Error getting response:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getResponsesByUser(req, res) {
    try {
      const { userId } = req.params;
      const { page = 1, limit = 10 } = req.query;
      
      const offset = (page - 1) * limit;
      
      const query = `
        SELECT r.*, s.title as survey_title
        FROM survey_responses r
        LEFT JOIN surveys s ON r.survey_id = s.id
        WHERE r.user_id = $1
        ORDER BY r.submitted_at DESC
        LIMIT $2 OFFSET $3
      `;
      
      const result = await db.query(query, [userId, limit, offset]);
      
      // Get total count
      const countQuery = 'SELECT COUNT(*) FROM survey_responses WHERE user_id = $1';
      const countResult = await db.query(countQuery, [userId]);
      
      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countResult.rows[0].count)
        }
      });
    } catch (error) {
      console.error('Error getting user responses:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async updateResponse(req, res) {
    try {
      const { id } = req.params;
      const { responses } = req.body;
      
      if (!responses) {
        return res.status(400).json({
          success: false,
          message: 'Responses are required'
        });
      }

      // Check if response exists
      const existingQuery = 'SELECT * FROM survey_responses WHERE id = $1';
      const existingResult = await db.query(existingQuery, [id]);
      
      if (existingResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Response not found'
        });
      }

      // Update response
      const updateQuery = `
        UPDATE survey_responses 
        SET responses = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `;
      
      const result = await db.query(updateQuery, [JSON.stringify(responses), id]);
      
      res.json({
        success: true,
        message: 'Response updated successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Error updating response:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async deleteResponse(req, res) {
    try {
      const { id } = req.params;
      
      const query = 'DELETE FROM survey_responses WHERE id = $1 RETURNING *';
      const result = await db.query(query, [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Response not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Response deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting response:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
}

module.exports = new ResponseController();