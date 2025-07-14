const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Survey {
  constructor(data) {
    this.id = data.id;
    this.title = data.title;
    this.description = data.description;
    this.surveyType = data.survey_type;
    this.status = data.status;
    this.triggerConditions = data.trigger_conditions;
    this.questions = data.questions;
    this.estimatedDuration = data.estimated_duration;
    this.rewardPoints = data.reward_points;
    this.targetCriteria = data.target_criteria;
    this.isRequired = data.is_required;
    this.startDate = data.start_date;
    this.endDate = data.end_date;
    this.createdBy = data.created_by;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  static async findActive(options = {}) {
    const {
      surveyType = null,
      userId = null,
      page = 1,
      limit = 20
    } = options;

    let whereConditions = [
      'status = $1',
      '(start_date IS NULL OR start_date <= NOW())',
      '(end_date IS NULL OR end_date >= NOW())'
    ];
    
    let queryParams = ['active'];
    let paramCount = 2;

    if (surveyType) {
      whereConditions.push(`survey_type = $${paramCount}`);
      queryParams.push(surveyType);
      paramCount++;
    }

    // Exclude surveys user has already responded to
    if (userId) {
      whereConditions.push(`id NOT IN (
        SELECT survey_id FROM survey_responses 
        WHERE user_id = $${paramCount} AND completion_status = 'completed'
      )`);
      queryParams.push(userId);
      paramCount++;
    }

    const offset = (page - 1) * limit;

    const query = `
      SELECT s.*,
        COALESCE(stats.total_responses, 0) as response_count,
        COALESCE(stats.completion_rate, 0) as completion_rate
      FROM surveys s
      LEFT JOIN (
        SELECT 
          survey_id,
          COUNT(*) as total_responses,
          ROUND(
            COUNT(CASE WHEN completion_status = 'completed' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0), 2
          ) as completion_rate
        FROM survey_responses
        GROUP BY survey_id
      ) stats ON s.id = stats.survey_id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY s.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    queryParams.push(limit, offset);

    const result = await db.query(query, queryParams);
    
    return result.rows.map(row => {
      const survey = new Survey(row);
      survey.responseCount = parseInt(row.response_count);
      survey.completionRate = parseFloat(row.completion_rate);
      return survey;
    });
  }

  static async findById(id) {
    const query = 'SELECT * FROM surveys WHERE id = $1';
    const result = await db.query(query, [id]);
    return result.rows[0] ? new Survey(result.rows[0]) : null;
  }

  static async findForUser(userId) {
    const query = `
      SELECT s.*,
        sr.id as response_id,
        sr.completion_status,
        sr.started_at,
        sr.completed_at
      FROM surveys s
      LEFT JOIN survey_responses sr ON s.id = sr.survey_id AND sr.user_id = $1
      WHERE s.status = 'active'
      AND (s.start_date IS NULL OR s.start_date <= NOW())
      AND (s.end_date IS NULL OR s.end_date >= NOW())
      ORDER BY 
        CASE 
          WHEN sr.completion_status = 'started' THEN 1
          WHEN sr.completion_status IS NULL THEN 2
          ELSE 3
        END,
        s.created_at DESC
    `;

    const result = await db.query(query, [userId]);
    
    return result.rows.map(row => {
      const survey = new Survey(row);
      survey.userResponse = row.response_id ? {
        id: row.response_id,
        status: row.completion_status,
        startedAt: row.started_at,
        completedAt: row.completed_at
      } : null;
      return survey;
    });
  }

  async checkEligibility(userId) {
    // Check if user has already responded
    const responseQuery = `
      SELECT completion_status FROM survey_responses 
      WHERE survey_id = $1 AND user_id = $2
    `;
    
    const responseResult = await db.query(responseQuery, [this.id, userId]);
    
    if (responseResult.rows.length > 0) {
      const status = responseResult.rows[0].completion_status;
      return {
        eligible: status === 'started', // Can continue if started but not completed
        reason: status === 'completed' ? 'Already completed' : 'In progress',
        canContinue: status === 'started'
      };
    }

    // Check target criteria if specified
    if (this.targetCriteria && Object.keys(this.targetCriteria).length > 0) {
      const userQuery = `
        SELECT u.*, 
          COALESCE(b.total_bookings, 0) as total_bookings,
          COALESCE(b.total_spend, 0) as total_spend
        FROM users u
        LEFT JOIN (
          SELECT user_id, COUNT(*) as total_bookings, SUM(total_amount) as total_spend
          FROM bookings WHERE status = 'completed'
          GROUP BY user_id
        ) b ON u.id = b.user_id
        WHERE u.id = $1
      `;

      const userResult = await db.query(userQuery, [userId]);
      const user = userResult.rows[0];

      // Basic criteria checking (can be extended)
      const criteria = this.targetCriteria;
      
      if (criteria.min_tier) {
        const tierHierarchy = ['bronze', 'silver', 'gold', 'platinum'];
        const userTierIndex = tierHierarchy.indexOf(user.loyalty_tier);
        const minTierIndex = tierHierarchy.indexOf(criteria.min_tier);
        
        if (userTierIndex < minTierIndex) {
          return {
            eligible: false,
            reason: `Requires ${criteria.min_tier} tier or higher`
          };
        }
      }

      if (criteria.min_bookings && user.total_bookings < criteria.min_bookings) {
        return {
          eligible: false,
          reason: `Requires ${criteria.min_bookings} bookings minimum`
        };
      }
    }

    return {
      eligible: true,
      reason: 'Eligible to participate'
    };
  }

  calculateNPSScore(responses) {
    const npsResponses = responses.filter(r => 
      r.responses && r.responses.nps_question !== undefined
    );

    if (npsResponses.length === 0) return null;

    const promoters = npsResponses.filter(r => r.responses.nps_question >= 9).length;
    const detractors = npsResponses.filter(r => r.responses.nps_question <= 6).length;
    
    return ((promoters - detractors) / npsResponses.length) * 100;
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      surveyType: this.surveyType,
      status: this.status,
      questions: this.questions,
      estimatedDuration: this.estimatedDuration,
      rewardPoints: this.rewardPoints,
      isRequired: this.isRequired,
      startDate: this.startDate,
      endDate: this.endDate,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Survey;