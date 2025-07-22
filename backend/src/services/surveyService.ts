import { getPool } from '../config/database';
import { 
  Survey, 
  SurveyResponse, 
  SurveyInvitation,
  CreateSurveyRequest,
  UpdateSurveyRequest,
  SubmitResponseRequest,
  SurveyAnalytics,
  QuestionAnalytics,
  TargetSegment
} from '../types/survey';

export class SurveyService {
  // Create a new survey
  async createSurvey(data: CreateSurveyRequest, createdBy: string): Promise<Survey> {
    const client = await getPool().connect();
    try {
      const result = await client.query(
        `INSERT INTO surveys (title, description, questions, target_segment, access_type, scheduled_start, scheduled_end, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          data.title,
          data.description,
          JSON.stringify(data.questions),
          JSON.stringify(data.target_segment || {}),
          data.access_type,
          data.scheduled_start,
          data.scheduled_end,
          createdBy
        ]
      );

      const survey = result.rows[0];
      return {
        ...survey,
        questions: survey.questions,
        target_segment: survey.target_segment
      };
    } finally {
      client.release();
    }
  }

  // Get survey by ID
  async getSurveyById(id: string): Promise<Survey | null> {
    const client = await getPool().connect();
    try {
      const result = await client.query(
        'SELECT * FROM surveys WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) return null;

      const survey = result.rows[0];
      return {
        ...survey,
        questions: survey.questions,
        target_segment: survey.target_segment
      };
    } finally {
      client.release();
    }
  }

  // Get surveys with pagination and filtering
  async getSurveys(
    page = 1, 
    limit = 10, 
    status?: string,
    createdBy?: string
  ): Promise<{ surveys: Survey[]; total: number; totalPages: number }> {
    const client = await getPool().connect();
    try {
      const offset = (page - 1) * limit;
      let whereClause = '';
      let queryParams: any[] = [limit, offset];
      let paramIndex = 3;

      const conditions: string[] = [];
      if (status) {
        conditions.push(`status = $${paramIndex}`);
        queryParams.push(status);
        paramIndex++;
      }
      if (createdBy) {
        conditions.push(`created_by = $${paramIndex}`);
        queryParams.push(createdBy);
        paramIndex++;
      }

      if (conditions.length > 0) {
        whereClause = `WHERE ${conditions.join(' AND ')}`;
      }

      // Get surveys
      const surveysResult = await client.query(
        `SELECT * FROM surveys ${whereClause} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        queryParams
      );

      // Get total count
      const countResult = await client.query(
        `SELECT COUNT(*) FROM surveys ${whereClause}`,
        queryParams.slice(2)
      );

      const total = parseInt(countResult.rows[0].count);
      const surveys = surveysResult.rows.map(row => ({
        ...row,
        questions: row.questions,
        target_segment: row.target_segment
      }));

      return {
        surveys,
        total,
        totalPages: Math.ceil(total / limit)
      };
    } finally {
      client.release();
    }
  }

  // Update survey
  async updateSurvey(id: string, data: UpdateSurveyRequest): Promise<Survey | null> {
    const client = await getPool().connect();
    try {
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (data.title !== undefined) {
        updateFields.push(`title = $${paramIndex}`);
        values.push(data.title);
        paramIndex++;
      }
      if (data.description !== undefined) {
        updateFields.push(`description = $${paramIndex}`);
        values.push(data.description);
        paramIndex++;
      }
      if (data.questions !== undefined) {
        updateFields.push(`questions = $${paramIndex}`);
        values.push(JSON.stringify(data.questions));
        paramIndex++;
      }
      if (data.target_segment !== undefined) {
        updateFields.push(`target_segment = $${paramIndex}`);
        values.push(JSON.stringify(data.target_segment));
        paramIndex++;
      }
      if (data.status !== undefined) {
        updateFields.push(`status = $${paramIndex}`);
        values.push(data.status);
        paramIndex++;
      }
      if (data.access_type !== undefined) {
        updateFields.push(`access_type = $${paramIndex}`);
        values.push(data.access_type);
        paramIndex++;
      }
      if (data.scheduled_start !== undefined) {
        updateFields.push(`scheduled_start = $${paramIndex}`);
        values.push(data.scheduled_start);
        paramIndex++;
      }
      if (data.scheduled_end !== undefined) {
        updateFields.push(`scheduled_end = $${paramIndex}`);
        values.push(data.scheduled_end);
        paramIndex++;
      }

      if (updateFields.length === 0) {
        return await this.getSurveyById(id);
      }

      updateFields.push(`updated_at = NOW()`);
      values.push(id);

      const result = await client.query(
        `UPDATE surveys SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      if (result.rows.length === 0) return null;

      const survey = result.rows[0];
      return {
        ...survey,
        questions: survey.questions,
        target_segment: survey.target_segment
      };
    } finally {
      client.release();
    }
  }

  // Delete survey
  async deleteSurvey(id: string): Promise<boolean> {
    const client = await getPool().connect();
    try {
      const result = await client.query('DELETE FROM surveys WHERE id = $1', [id]);
      return result.rowCount > 0;
    } finally {
      client.release();
    }
  }

  // Submit or update survey response
  async submitResponse(userId: string, data: SubmitResponseRequest): Promise<SurveyResponse> {
    const client = await getPool().connect();
    try {
      // Calculate progress based on answered questions
      const survey = await this.getSurveyById(data.survey_id);
      if (!survey) {
        throw new Error('Survey not found');
      }

      const totalQuestions = survey.questions.length;
      const answeredQuestions = Object.keys(data.answers).length;
      const progress = Math.round((answeredQuestions / totalQuestions) * 100);

      // Try to update existing response first
      const updateResult = await client.query(
        `UPDATE survey_responses 
         SET answers = $1, is_completed = $2, progress = $3, completed_at = $4, updated_at = NOW()
         WHERE survey_id = $5 AND user_id = $6
         RETURNING *`,
        [
          JSON.stringify(data.answers),
          data.is_completed || false,
          progress,
          data.is_completed ? new Date().toISOString() : null,
          data.survey_id,
          userId
        ]
      );

      if (updateResult.rows.length > 0) {
        const response = updateResult.rows[0];
        return {
          ...response,
          answers: response.answers
        };
      }

      // Create new response if none exists
      const insertResult = await client.query(
        `INSERT INTO survey_responses (survey_id, user_id, answers, is_completed, progress, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          data.survey_id,
          userId,
          JSON.stringify(data.answers),
          data.is_completed || false,
          progress,
          data.is_completed ? new Date().toISOString() : null
        ]
      );

      const response = insertResult.rows[0];
      return {
        ...response,
        answers: response.answers
      };
    } finally {
      client.release();
    }
  }

  // Get user's response to a survey
  async getUserResponse(userId: string, surveyId: string): Promise<SurveyResponse | null> {
    const client = await getPool().connect();
    try {
      const result = await client.query(
        'SELECT * FROM survey_responses WHERE user_id = $1 AND survey_id = $2',
        [userId, surveyId]
      );

      if (result.rows.length === 0) return null;

      const response = result.rows[0];
      return {
        ...response,
        answers: response.answers
      };
    } finally {
      client.release();
    }
  }

  // Get all responses for a survey
  async getSurveyResponses(
    surveyId: string, 
    page = 1, 
    limit = 10
  ): Promise<{ responses: SurveyResponse[]; total: number; totalPages: number }> {
    const client = await getPool().connect();
    try {
      const offset = (page - 1) * limit;

      // Get responses
      const responsesResult = await client.query(
        `SELECT sr.*, u.email, up.first_name, up.last_name 
         FROM survey_responses sr
         JOIN users u ON sr.user_id = u.id
         LEFT JOIN user_profiles up ON u.id = up.user_id
         WHERE sr.survey_id = $1
         ORDER BY sr.created_at DESC
         LIMIT $2 OFFSET $3`,
        [surveyId, limit, offset]
      );

      // Get total count
      const countResult = await client.query(
        'SELECT COUNT(*) FROM survey_responses WHERE survey_id = $1',
        [surveyId]
      );

      const total = parseInt(countResult.rows[0].count);
      const responses = responsesResult.rows.map(row => ({
        id: row.id,
        survey_id: row.survey_id,
        user_id: row.user_id,
        answers: row.answers,
        is_completed: row.is_completed,
        progress: row.progress,
        started_at: row.started_at,
        completed_at: row.completed_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        user_email: row.email,
        user_first_name: row.first_name,
        user_last_name: row.last_name
      }));

      return {
        responses,
        total,
        totalPages: Math.ceil(total / limit)
      };
    } finally {
      client.release();
    }
  }

  // Get public surveys available to all users
  async getPublicSurveys(userId: string): Promise<Survey[]> {
    const client = await getPool().connect();
    try {
      // Get user details for targeting
      const userResult = await client.query(
        `SELECT u.*, ul.tier_id, up.first_name, up.last_name
         FROM users u
         LEFT JOIN user_loyalty ul ON u.id = ul.user_id
         LEFT JOIN user_profiles up ON u.id = up.user_id
         WHERE u.id = $1`,
        [userId]
      );

      if (userResult.rows.length === 0) return [];
      const user = userResult.rows[0];

      // Get active public surveys
      const surveysResult = await client.query(
        `SELECT s.* FROM surveys s
         WHERE s.status = 'active'
         AND s.access_type = 'public'
         AND (s.scheduled_start IS NULL OR s.scheduled_start <= NOW())
         AND (s.scheduled_end IS NULL OR s.scheduled_end >= NOW())
         AND NOT EXISTS (
           SELECT 1 FROM survey_responses sr 
           WHERE sr.survey_id = s.id AND sr.user_id = $1 AND sr.is_completed = true
         )
         ORDER BY s.created_at DESC`,
        [userId]
      );

      // Filter surveys based on targeting criteria
      const availableSurveys: Survey[] = [];
      
      for (const surveyRow of surveysResult.rows) {
        const survey = {
          ...surveyRow,
          questions: surveyRow.questions,
          target_segment: surveyRow.target_segment
        };

        if (this.isUserTargeted(user, survey.target_segment)) {
          availableSurveys.push(survey);
        }
      }

      return availableSurveys;
    } finally {
      client.release();
    }
  }

  // Get invite-only surveys available to a user (through invitations)
  async getInvitedSurveys(userId: string): Promise<Survey[]> {
    const client = await getPool().connect();
    try {
      // Get active invite-only surveys where user has been invited
      const surveysResult = await client.query(
        `SELECT DISTINCT s.* FROM surveys s
         INNER JOIN survey_invitations si ON s.id = si.survey_id
         WHERE s.status = 'active'
         AND s.access_type = 'invite_only'
         AND si.user_id = $1
         AND si.status IN ('sent', 'viewed', 'started')
         AND (s.scheduled_start IS NULL OR s.scheduled_start <= NOW())
         AND (s.scheduled_end IS NULL OR s.scheduled_end >= NOW())
         AND NOT EXISTS (
           SELECT 1 FROM survey_responses sr 
           WHERE sr.survey_id = s.id AND sr.user_id = $1 AND sr.is_completed = true
         )
         ORDER BY s.created_at DESC`,
        [userId]
      );

      return surveysResult.rows.map(surveyRow => ({
        ...surveyRow,
        questions: surveyRow.questions,
        target_segment: surveyRow.target_segment
      }));
    } finally {
      client.release();
    }
  }

  // Get all surveys available to a user (both public and invited)
  async getAvailableSurveys(userId: string): Promise<Survey[]> {
    const [publicSurveys, invitedSurveys] = await Promise.all([
      this.getPublicSurveys(userId),
      this.getInvitedSurveys(userId)
    ]);

    // Combine and deduplicate surveys
    const surveyMap = new Map();
    [...publicSurveys, ...invitedSurveys].forEach(survey => {
      surveyMap.set(survey.id, survey);
    });

    return Array.from(surveyMap.values()).sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  // Check if user has access to a specific survey
  async canUserAccessSurvey(userId: string, surveyId: string): Promise<boolean> {
    const client = await getPool().connect();
    try {
      // Get survey details
      const survey = await this.getSurveyById(surveyId);
      if (!survey) return false;

      // Check survey status
      if (survey.status !== 'active') return false;

      // Check if survey is within scheduled timeframe
      if (survey.scheduled_start && new Date(survey.scheduled_start) > new Date()) {
        return false;
      }
      if (survey.scheduled_end && new Date(survey.scheduled_end) < new Date()) {
        return false;
      }

      // Check if user has already completed the survey
      const existingResponse = await client.query(
        'SELECT id FROM survey_responses WHERE survey_id = $1 AND user_id = $2 AND is_completed = true',
        [surveyId, userId]
      );
      if (existingResponse.rows.length > 0) return false;

      // For public surveys, check targeting criteria
      if (survey.access_type === 'public') {
        // Get user details for targeting
        const userResult = await client.query(
          `SELECT u.*, ul.tier_id, up.first_name, up.last_name
           FROM users u
           LEFT JOIN user_loyalty ul ON u.id = ul.user_id
           LEFT JOIN user_profiles up ON u.id = up.user_id
           WHERE u.id = $1`,
          [userId]
        );

        if (userResult.rows.length === 0) return false;
        const user = userResult.rows[0];

        return this.isUserTargeted(user, survey.target_segment);
      }

      // For invite-only surveys, check if user has a valid invitation
      if (survey.access_type === 'invite_only') {
        const invitationResult = await client.query(
          `SELECT id FROM survey_invitations 
           WHERE survey_id = $1 AND user_id = $2 AND status IN ('sent', 'viewed', 'started')`,
          [surveyId, userId]
        );

        return invitationResult.rows.length > 0;
      }

      return false;
    } finally {
      client.release();
    }
  }

  // Check if user matches targeting criteria
  private isUserTargeted(user: any, targetSegment: TargetSegment): boolean {
    // If no targeting criteria, include all users
    if (!targetSegment || Object.keys(targetSegment).length === 0) {
      return true;
    }

    // Check tier restrictions
    if (targetSegment.tier_restrictions && targetSegment.tier_restrictions.length > 0) {
      if (!targetSegment.tier_restrictions.includes(user.tier_id)) {
        return false;
      }
    }

    // Check registration date filters
    if (targetSegment.registration_after) {
      if (new Date(user.created_at) < new Date(targetSegment.registration_after)) {
        return false;
      }
    }

    if (targetSegment.registration_before) {
      if (new Date(user.created_at) > new Date(targetSegment.registration_before)) {
        return false;
      }
    }

    // Check OAuth provider filters
    if (targetSegment.oauth_providers && targetSegment.oauth_providers.length > 0) {
      const userProvider = user.oauth_provider || 'email';
      if (!targetSegment.oauth_providers.includes(userProvider)) {
        return false;
      }
    }

    // Check excluded users
    if (targetSegment.exclude_users && targetSegment.exclude_users.includes(user.id)) {
      return false;
    }

    return true;
  }

  // Generate survey analytics
  async getSurveyAnalytics(surveyId: string): Promise<any | null> {
    const client = await getPool().connect();
    try {
      // Get survey details
      const survey = await this.getSurveyById(surveyId);
      if (!survey) return null;

      // Get all responses
      const responsesResult = await client.query(
        `SELECT sr.*, u.email as user_email, up.first_name as user_first_name, up.last_name as user_last_name
         FROM survey_responses sr
         LEFT JOIN users u ON sr.user_id = u.id
         LEFT JOIN user_profiles up ON sr.user_id = up.user_id
         WHERE sr.survey_id = $1
         ORDER BY sr.created_at DESC`,
        [surveyId]
      );

      const responses = responsesResult.rows;

      // Get response statistics
      const statsResult = await client.query(
        `SELECT 
           COUNT(*) as total_responses,
           COUNT(*) FILTER (WHERE is_completed = true) as completed_responses,
           AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_completion_time
         FROM survey_responses 
         WHERE survey_id = $1`,
        [surveyId]
      );

      const stats = statsResult.rows[0];
      const totalResponses = parseInt(stats.total_responses);
      const completedResponses = parseInt(stats.completed_responses);
      const completionRate = totalResponses > 0 ? (completedResponses / totalResponses) * 100 : 0;

      // Get responses by date
      const responsesByDateResult = await client.query(
        `SELECT 
           DATE(created_at) as date,
           COUNT(*) as count
         FROM survey_responses
         WHERE survey_id = $1
         GROUP BY DATE(created_at)
         ORDER BY date DESC
         LIMIT 30`,
        [surveyId]
      );

      const responsesByDate = responsesByDateResult.rows.map(row => ({
        date: new Date(row.date).toLocaleDateString(),
        count: parseInt(row.count)
      })).reverse();

      // Generate question analytics
      const questionAnalytics: any[] = [];
      
      for (const question of survey.questions) {
        const analytics = await this.getQuestionAnalytics(surveyId, question);
        questionAnalytics.push({
          questionId: analytics.question_id,
          question: analytics.question_text,
          type: analytics.question_type,
          responses: analytics.response_distribution || {},
          averageRating: analytics.average_rating
        });
      }

      return {
        survey,
        responses,
        totalResponses,
        completionRate,
        averageCompletionTime: parseFloat(stats.avg_completion_time) || 0,
        responsesByDate,
        questionAnalytics
      };
    } finally {
      client.release();
    }
  }

  // Generate analytics for a specific question
  private async getQuestionAnalytics(surveyId: string, question: any): Promise<QuestionAnalytics> {
    const client = await getPool().connect();
    try {
      // Get all responses for this question
      const result = await client.query(
        `SELECT answers->$1 as answer 
         FROM survey_responses 
         WHERE survey_id = $2 AND answers ? $1`,
        [question.id, surveyId]
      );

      const responses = result.rows.map(row => row.answer).filter(answer => answer !== null && answer !== undefined);
      const totalResponses = responses.length;

      let responseDistribution: Record<string, number> = {};
      let averageRating: number | undefined;
      let commonResponses: string[] = [];

      if (totalResponses > 0) {
        // Calculate response distribution for choice questions
        if (question.type === 'multiple_choice' || question.type === 'single_choice' || question.type === 'yes_no') {
          responseDistribution = responses.reduce((acc: Record<string, number>, response: any) => {
            const key = Array.isArray(response) ? response.join(', ') : String(response);
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {});
        }

        // Calculate average for rating questions
        if (question.type === 'rating_5' || question.type === 'rating_10') {
          const numericResponses = responses.filter(r => typeof r === 'number').map(r => Number(r));
          if (numericResponses.length > 0) {
            averageRating = numericResponses.reduce((sum, rating) => sum + rating, 0) / numericResponses.length;
          }
        }

        // Get common text responses
        if (question.type === 'text' || question.type === 'textarea') {
          const textResponses = responses.filter(r => typeof r === 'string' && r.trim().length > 0);
          // Get most common words or phrases (simplified)
          commonResponses = textResponses.slice(0, 5);
        }
      }

      return {
        question_id: question.id,
        question_text: question.text,
        question_type: question.type,
        total_responses: totalResponses,
        response_distribution: Object.keys(responseDistribution).length > 0 ? responseDistribution : undefined,
        average_rating: averageRating,
        common_responses: commonResponses.length > 0 ? commonResponses : undefined
      };
    } finally {
      client.release();
    }
  }

  // Get survey invitations
  async getSurveyInvitations(surveyId: string): Promise<any[]> {
    const client = await getPool().connect();
    try {
      const result = await client.query(
        `SELECT si.*, u.email, up.first_name, up.last_name
         FROM survey_invitations si
         JOIN users u ON si.user_id = u.id
         LEFT JOIN user_profiles up ON si.user_id = up.user_id
         WHERE si.survey_id = $1
         ORDER BY si.created_at DESC`,
        [surveyId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Send survey invitations
  async sendSurveyInvitations(surveyId: string): Promise<{ sent: number }> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      
      // Get survey details and target segment
      const survey = await this.getSurveyById(surveyId);
      if (!survey) {
        throw new Error('Survey not found');
      }

      // Get all eligible users based on target segment
      const eligibleUsers = await this.getEligibleUsers(survey.target_segment);
      
      let sent = 0;
      
      for (const user of eligibleUsers) {
        // Check if user already has an invitation
        const existingInvitation = await client.query(
          'SELECT id FROM survey_invitations WHERE survey_id = $1 AND user_id = $2',
          [surveyId, user.id]
        );

        if (existingInvitation.rows.length === 0) {
          // Create invitation
          await client.query(
            `INSERT INTO survey_invitations (id, survey_id, user_id, status, created_at, updated_at)
             VALUES (uuid_generate_v4(), $1, $2, 'sent', NOW(), NOW())`,
            [surveyId, user.id]
          );
          sent++;
        }
      }

      await client.query('COMMIT');
      return { sent };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Resend invitation
  async resendInvitation(invitationId: string): Promise<void> {
    const client = await getPool().connect();
    try {
      await client.query(
        `UPDATE survey_invitations 
         SET status = 'sent', sent_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [invitationId]
      );
    } finally {
      client.release();
    }
  }

  // Get eligible users for a target segment
  private async getEligibleUsers(targetSegment: TargetSegment): Promise<any[]> {
    const client = await getPool().connect();
    try {
      let query = `
        SELECT u.*, ul.tier_id, up.first_name, up.last_name
        FROM users u
        LEFT JOIN user_loyalty ul ON u.id = ul.user_id
        LEFT JOIN user_profiles up ON u.id = up.user_id
        WHERE u.role NOT IN ('admin', 'super_admin')
      `;
      const params: any[] = [];
      let paramIndex = 1;

      // Add tier restrictions
      if (targetSegment.tier_restrictions && targetSegment.tier_restrictions.length > 0) {
        query += ` AND ul.tier_id = ANY($${paramIndex})`;
        params.push(targetSegment.tier_restrictions);
        paramIndex++;
      }

      // Add registration date filters
      if (targetSegment.registration_after) {
        query += ` AND u.created_at >= $${paramIndex}`;
        params.push(targetSegment.registration_after);
        paramIndex++;
      }

      if (targetSegment.registration_before) {
        query += ` AND u.created_at <= $${paramIndex}`;
        params.push(targetSegment.registration_before);
        paramIndex++;
      }

      // Add OAuth provider filters
      if (targetSegment.oauth_providers && targetSegment.oauth_providers.length > 0) {
        query += ` AND (u.oauth_provider = ANY($${paramIndex}) OR (u.oauth_provider IS NULL AND $${paramIndex} @> ARRAY['email']))`;
        params.push(targetSegment.oauth_providers);
        paramIndex++;
      }

      // Exclude specific users
      if (targetSegment.exclude_users && targetSegment.exclude_users.length > 0) {
        query += ` AND u.id != ALL($${paramIndex})`;
        params.push(targetSegment.exclude_users);
        paramIndex++;
      }

      const result = await client.query(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }
}

export const surveyService = new SurveyService();