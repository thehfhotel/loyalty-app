const db = require('../config/database');

class SurveyController {
  async createSurvey(req, res) {
    try {
      const { title, description, questions, survey_type = 'feedback', reward_points = 0, target_audience = {} } = req.body;
      
      // Validate required fields
      if (!title || !description || !questions || !Array.isArray(questions)) {
        return res.status(400).json({
          success: false,
          message: 'Title, description, and questions array are required'
        });
      }

      const query = `
        INSERT INTO surveys (title, description, questions, survey_type, reward_points, target_audience, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING *
      `;
      
      const result = await db.query(query, [
        title,
        description,
        JSON.stringify(questions),
        survey_type,
        reward_points,
        JSON.stringify(target_audience),
        'draft'
      ]);
      
      res.status(201).json({
        success: true,
        message: 'Survey created successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Error creating survey:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getSurveys(req, res) {
    try {
      const { status, survey_type, page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;
      
      let query = 'SELECT * FROM surveys';
      let params = [];
      let whereConditions = [];
      
      if (status) {
        whereConditions.push(`status = $${params.length + 1}`);
        params.push(status);
      }
      
      if (survey_type) {
        whereConditions.push(`survey_type = $${params.length + 1}`);
        params.push(survey_type);
      }
      
      if (whereConditions.length > 0) {
        query += ' WHERE ' + whereConditions.join(' AND ');
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      
      const result = await db.query(query, params);
      
      // Get total count for pagination
      let countQuery = 'SELECT COUNT(*) FROM surveys';
      let countParams = [];
      
      if (status) {
        countQuery += ` WHERE status = $${countParams.length + 1}`;
        countParams.push(status);
      }
      
      if (survey_type) {
        countQuery += status ? ` AND survey_type = $${countParams.length + 1}` : ` WHERE survey_type = $${countParams.length + 1}`;
        countParams.push(survey_type);
      }
      
      const countResult = await db.query(countQuery, countParams);
      
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
      console.error('Error getting surveys:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getSurveyById(req, res) {
    try {
      const { id } = req.params;
      
      const query = 'SELECT * FROM surveys WHERE id = $1';
      const result = await db.query(query, [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Survey not found'
        });
      }
      
      // Get response count
      const responseCountQuery = 'SELECT COUNT(*) as response_count FROM survey_responses WHERE survey_id = $1';
      const responseCountResult = await db.query(responseCountQuery, [id]);
      
      const survey = result.rows[0];
      survey.response_count = parseInt(responseCountResult.rows[0].response_count);
      
      res.json({
        success: true,
        data: survey
      });
    } catch (error) {
      console.error('Error getting survey:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async updateSurvey(req, res) {
    try {
      const { id } = req.params;
      const { title, description, questions, survey_type, reward_points, target_audience } = req.body;
      
      // Check if survey exists
      const existingQuery = 'SELECT * FROM surveys WHERE id = $1';
      const existingResult = await db.query(existingQuery, [id]);
      
      if (existingResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Survey not found'
        });
      }

      // Build update query dynamically
      let updateFields = [];
      let params = [];
      let paramIndex = 1;
      
      if (title) {
        updateFields.push(`title = $${paramIndex}`);
        params.push(title);
        paramIndex++;
      }
      
      if (description) {
        updateFields.push(`description = $${paramIndex}`);
        params.push(description);
        paramIndex++;
      }
      
      if (questions) {
        updateFields.push(`questions = $${paramIndex}`);
        params.push(JSON.stringify(questions));
        paramIndex++;
      }
      
      if (survey_type) {
        updateFields.push(`survey_type = $${paramIndex}`);
        params.push(survey_type);
        paramIndex++;
      }
      
      if (reward_points !== undefined) {
        updateFields.push(`reward_points = $${paramIndex}`);
        params.push(reward_points);
        paramIndex++;
      }
      
      if (target_audience) {
        updateFields.push(`target_audience = $${paramIndex}`);
        params.push(JSON.stringify(target_audience));
        paramIndex++;
      }
      
      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update'
        });
      }
      
      updateFields.push(`updated_at = NOW()`);
      params.push(id);
      
      const query = `UPDATE surveys SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
      const result = await db.query(query, params);
      
      res.json({
        success: true,
        message: 'Survey updated successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Error updating survey:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async deleteSurvey(req, res) {
    try {
      const { id } = req.params;
      
      const query = 'DELETE FROM surveys WHERE id = $1 RETURNING *';
      const result = await db.query(query, [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Survey not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Survey deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting survey:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async publishSurvey(req, res) {
    try {
      const { id } = req.params;
      
      const query = 'UPDATE surveys SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *';
      const result = await db.query(query, ['published', id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Survey not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Survey published successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Error publishing survey:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async unpublishSurvey(req, res) {
    try {
      const { id } = req.params;
      
      const query = 'UPDATE surveys SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *';
      const result = await db.query(query, ['draft', id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Survey not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Survey unpublished successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Error unpublishing survey:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
}

module.exports = new SurveyController();