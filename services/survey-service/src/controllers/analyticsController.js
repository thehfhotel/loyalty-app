const db = require('../config/database');

class AnalyticsController {
  async getSurveyAnalytics(req, res) {
    try {
      const { surveyId } = req.params;
      
      // Get basic survey info
      const surveyQuery = 'SELECT * FROM surveys WHERE id = $1';
      const surveyResult = await db.query(surveyQuery, [surveyId]);
      
      if (surveyResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Survey not found'
        });
      }
      
      // Get response count
      const responseCountQuery = 'SELECT COUNT(*) as response_count FROM survey_responses WHERE survey_id = $1';
      const responseCountResult = await db.query(responseCountQuery, [surveyId]);
      
      // Get completion rate (assuming survey has target audience)
      const completionQuery = `
        SELECT 
          COUNT(*) as completed_responses,
          (SELECT COUNT(*) FROM survey_invitations WHERE survey_id = $1) as total_invitations
        FROM survey_responses WHERE survey_id = $1
      `;
      const completionResult = await db.query(completionQuery, [surveyId]);
      
      // Get response trends by day
      const trendsQuery = `
        SELECT 
          DATE(submitted_at) as date,
          COUNT(*) as responses
        FROM survey_responses 
        WHERE survey_id = $1 
        GROUP BY DATE(submitted_at)
        ORDER BY date DESC
        LIMIT 30
      `;
      const trendsResult = await db.query(trendsQuery, [surveyId]);
      
      const analytics = {
        survey: surveyResult.rows[0],
        total_responses: parseInt(responseCountResult.rows[0].response_count),
        completion_rate: completionResult.rows[0].total_invitations > 0 
          ? (completionResult.rows[0].completed_responses / completionResult.rows[0].total_invitations * 100).toFixed(2)
          : 0,
        daily_trends: trendsResult.rows
      };
      
      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      console.error('Error getting survey analytics:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getResponseStats(req, res) {
    try {
      const { surveyId } = req.params;
      
      // Get question-wise statistics
      const responsesQuery = 'SELECT responses FROM survey_responses WHERE survey_id = $1';
      const responsesResult = await db.query(responsesQuery, [surveyId]);
      
      if (responsesResult.rows.length === 0) {
        return res.json({
          success: true,
          data: {
            total_responses: 0,
            question_stats: []
          }
        });
      }
      
      // Process responses to get statistics
      const allResponses = responsesResult.rows.map(row => JSON.parse(row.responses));
      const questionStats = {};
      
      allResponses.forEach(response => {
        Object.keys(response).forEach(questionId => {
          if (!questionStats[questionId]) {
            questionStats[questionId] = {
              question_id: questionId,
              response_count: 0,
              answers: {}
            };
          }
          
          questionStats[questionId].response_count++;
          const answer = response[questionId];
          
          if (typeof answer === 'string') {
            questionStats[questionId].answers[answer] = (questionStats[questionId].answers[answer] || 0) + 1;
          } else if (Array.isArray(answer)) {
            answer.forEach(a => {
              questionStats[questionId].answers[a] = (questionStats[questionId].answers[a] || 0) + 1;
            });
          }
        });
      });
      
      res.json({
        success: true,
        data: {
          total_responses: allResponses.length,
          question_stats: Object.values(questionStats)
        }
      });
    } catch (error) {
      console.error('Error getting response stats:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getCompletionRates(req, res) {
    try {
      const { surveyId } = req.params;
      
      const query = `
        SELECT 
          COUNT(*) as total_responses,
          COUNT(CASE WHEN submitted_at IS NOT NULL THEN 1 END) as completed_responses,
          AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_completion_time
        FROM survey_responses 
        WHERE survey_id = $1
      `;
      
      const result = await db.query(query, [surveyId]);
      const stats = result.rows[0];
      
      res.json({
        success: true,
        data: {
          total_responses: parseInt(stats.total_responses),
          completed_responses: parseInt(stats.completed_responses),
          completion_rate: stats.total_responses > 0 
            ? (stats.completed_responses / stats.total_responses * 100).toFixed(2)
            : 0,
          avg_completion_time: stats.avg_completion_time ? Math.round(stats.avg_completion_time) : 0
        }
      });
    } catch (error) {
      console.error('Error getting completion rates:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getResponseTrends(req, res) {
    try {
      const { surveyId } = req.params;
      const { period = '7d' } = req.query;
      
      let dateFilter = '';
      switch (period) {
        case '24h':
          dateFilter = "submitted_at >= NOW() - INTERVAL '24 hours'";
          break;
        case '7d':
          dateFilter = "submitted_at >= NOW() - INTERVAL '7 days'";
          break;
        case '30d':
          dateFilter = "submitted_at >= NOW() - INTERVAL '30 days'";
          break;
        default:
          dateFilter = "submitted_at >= NOW() - INTERVAL '7 days'";
      }
      
      const query = `
        SELECT 
          DATE_TRUNC('day', submitted_at) as date,
          COUNT(*) as responses
        FROM survey_responses 
        WHERE survey_id = $1 AND ${dateFilter}
        GROUP BY DATE_TRUNC('day', submitted_at)
        ORDER BY date ASC
      `;
      
      const result = await db.query(query, [surveyId]);
      
      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      console.error('Error getting response trends:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async getOverallMetrics(req, res) {
    try {
      // Get overall survey metrics
      const metricsQuery = `
        SELECT 
          COUNT(DISTINCT s.id) as total_surveys,
          COUNT(DISTINCT sr.id) as total_responses,
          COUNT(DISTINCT sr.user_id) as unique_respondents,
          AVG(sr.submitted_at - sr.created_at) as avg_response_time
        FROM surveys s
        LEFT JOIN survey_responses sr ON s.id = sr.survey_id
      `;
      
      const result = await db.query(metricsQuery);
      const metrics = result.rows[0];
      
      // Get survey status distribution
      const statusQuery = `
        SELECT 
          status,
          COUNT(*) as count
        FROM surveys 
        GROUP BY status
      `;
      
      const statusResult = await db.query(statusQuery);
      
      res.json({
        success: true,
        data: {
          total_surveys: parseInt(metrics.total_surveys),
          total_responses: parseInt(metrics.total_responses),
          unique_respondents: parseInt(metrics.unique_respondents),
          avg_response_time: metrics.avg_response_time ? Math.round(metrics.avg_response_time) : 0,
          survey_status_distribution: statusResult.rows
        }
      });
    } catch (error) {
      console.error('Error getting overall metrics:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  async exportSurveyData(req, res) {
    try {
      const { surveyId } = req.params;
      const { format = 'json' } = req.query;
      
      // Get survey with responses
      const query = `
        SELECT 
          s.title,
          s.description,
          s.questions,
          sr.responses,
          sr.submitted_at,
          u.email as user_email
        FROM surveys s
        LEFT JOIN survey_responses sr ON s.id = sr.survey_id
        LEFT JOIN users u ON sr.user_id = u.id
        WHERE s.id = $1
        ORDER BY sr.submitted_at DESC
      `;
      
      const result = await db.query(query, [surveyId]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Survey not found'
        });
      }
      
      if (format === 'csv') {
        // Convert to CSV format
        const csvData = this.convertToCSV(result.rows);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=survey_${surveyId}_data.csv`);
        res.send(csvData);
      } else {
        // Return JSON format
        res.json({
          success: true,
          data: result.rows
        });
      }
    } catch (error) {
      console.error('Error exporting survey data:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  convertToCSV(data) {
    if (data.length === 0) return '';
    
    const headers = ['Survey Title', 'User Email', 'Submitted At', 'Responses'];
    const rows = data.map(row => [
      row.title || '',
      row.user_email || '',
      row.submitted_at || '',
      JSON.stringify(row.responses || {})
    ]);
    
    const csvContent = [headers, ...rows]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');
    
    return csvContent;
  }
}

module.exports = new AnalyticsController();