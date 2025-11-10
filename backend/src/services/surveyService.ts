import { getPool } from '../config/database';
import { db } from '../config/prisma';
import { logger } from '../utils/logger';
import { formatDateToDDMMYYYY } from '../utils/dateFormatter';
import {
  Survey,
  SurveyResponse,
  // SurveyInvitation,
  CreateSurveyRequest,
  UpdateSurveyRequest,
  SubmitResponseRequest,
  // SurveyAnalytics,
  QuestionAnalytics,
  TargetSegment,
  SurveyCouponAssignment,
  SurveyRewardHistory,
  AssignCouponToSurveyRequest,
  UpdateSurveyCouponAssignmentRequest,
  SurveyCouponAssignmentListResponse,
  SurveyQuestion
} from '../types/survey';

// Internal types for survey service

interface UserWithLoyalty {
  id: string;
  email: string;
  tier_id?: number;
  oauth_provider?: string;
  created_at: Date;
  first_name?: string;
  last_name?: string;
}

interface SurveyTranslations {
  [language: string]: {
    title: string;
    description: string;
    questions: SurveyQuestion[];
  };
}

interface SurveyWithTranslations {
  original_language: string;
  available_languages: string[];
  translations: SurveyTranslations;
}

interface SurveyInvitation {
  id: string;
  survey_id: string;
  user_id: string;
  status: string;
  sent_at?: Date;
  created_at: Date;
  updated_at: Date;
  email?: string;
  first_name?: string;
  last_name?: string;
}

export class SurveyService {
  // Normalize question options to ensure consistent values
  private normalizeQuestionOptions(questions: SurveyQuestion[]): SurveyQuestion[] {
    return questions.map(question => {
      if (question.options && Array.isArray(question.options)) {
        // Re-index option values to be sequential numbers starting from 1
        question.options = question.options.map((option, index: number) => ({
          ...option,
          value: (index + 1).toString() // Ensure values are sequential strings "1", "2", "3", etc.
        }));
      }
      return question;
    });
  }

  // Create a new survey
  async createSurvey(data: CreateSurveyRequest, createdBy: string): Promise<Survey> {
    const client = await getPool().connect();
    try {
      // Normalize question options before saving
      const normalizedQuestions = this.normalizeQuestionOptions(data.questions);
      
      const result = await client.query(
        `INSERT INTO surveys (title, description, questions, target_segment, access_type, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          data.title,
          data.description,
          JSON.stringify(normalizedQuestions),
          JSON.stringify(data.target_segment ?? {}),
          data.access_type,
          data.status ?? 'draft',
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

  // Get survey with translations for a specific language
  async getSurveyWithTranslations(id: string, language?: string): Promise<Survey | null> {
    const client = await getPool().connect();
    try {
      let survey: Survey | null = null;

      if (language && language !== 'th') {
        // Try to get translated version first
        const translationResult = await client.query(
          'SELECT s.*, st.title as translated_title, st.description as translated_description, st.questions as translated_questions FROM surveys s LEFT JOIN survey_translations st ON s.id = st.survey_id AND st.language = $2 WHERE s.id = $1',
          [id, language]
        );
        
        if (translationResult.rows.length > 0) {
          const row = translationResult.rows[0];
          survey = {
            ...row,
            title: row.translated_title || row.title,
            description: row.translated_description || row.description,
            questions: row.translated_questions || row.questions
          };
        }
      }
      
      if (!survey) {
        // Fallback to original survey
        const result = await client.query(
          'SELECT * FROM surveys WHERE id = $1',
          [id]
        );
        
        if (result.rows.length === 0) return null;
        survey = result.rows[0];
      }

      return {
        ...survey,
        questions: survey.questions,
        target_segment: survey.target_segment
      };
    } finally {
      client.release();
    }
  }

  // Get all translations for a survey in multilingual format
  async getAllSurveyTranslations(id: string): Promise<SurveyWithTranslations | null> {
    const client = await getPool().connect();
    try {
      // Get the original survey
      const surveyResult = await client.query(
        'SELECT * FROM surveys WHERE id = $1',
        [id]
      );

      if (surveyResult.rows.length === 0) return null;

      const originalSurvey = surveyResult.rows[0];

      // Get all translations for this survey
      const translationsResult = await client.query(
        'SELECT language, title, description, questions FROM survey_translations WHERE survey_id = $1',
        [id]
      );

      // Build the translations object
      const translations: SurveyTranslations = {};
      const availableLanguages = ['th']; // Start with original language
      
      // Add original survey content
      translations.th = {
        title: originalSurvey.title,
        description: originalSurvey.description,
        questions: originalSurvey.questions
      };
      
      // Add translated content
      translationsResult.rows.forEach(translation => {
        translations[translation.language] = {
          title: translation.title,
          description: translation.description,
          questions: translation.questions
        };
        if (!availableLanguages.includes(translation.language)) {
          availableLanguages.push(translation.language);
        }
      });
      
      return {
        original_language: 'th',
        available_languages: availableLanguages,
        translations: translations
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
      const queryParams: (string | number)[] = [limit, offset];
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
      const values: (string | number | boolean | Date | null | object)[] = [];
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
        // Normalize question options before saving
        const normalizedQuestions = this.normalizeQuestionOptions(data.questions);
        values.push(JSON.stringify(normalizedQuestions));
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
      // Removed scheduled_start and scheduled_end - columns don't exist

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
      return (result.rowCount ?? 0) > 0;
    } finally {
      client.release();
    }
  }

  // Submit or update survey response
  async submitResponse(userId: string, data: SubmitResponseRequest): Promise<SurveyResponse> {
    try {
      // Calculate progress based on answered questions
      const survey = await this.getSurveyById(data.survey_id);
      if (!survey) {
        throw new Error('Survey not found');
      }

      const totalQuestions = survey.questions.length;
      const answeredQuestions = Object.keys(data.answers).length;
      const progress = Math.round((answeredQuestions / totalQuestions) * 100);

      // Try to update existing response first using Prisma
      const existingResponse = await db.survey_responses.findUnique({
        where: {
          survey_id_user_id: {
            survey_id: data.survey_id,
            user_id: userId
          }
        }
      });

      if (existingResponse) {
        // Update existing response
        const updatedResponse = await db.survey_responses.update({
          where: {
            id: existingResponse.id
          },
          data: {
            answers: data.answers,
            is_completed: data.is_completed ?? false,
            progress: progress,
            completed_at: data.is_completed ? new Date() : null,
            updated_at: new Date()
          }
        });

        return {
          ...updatedResponse,
          answers: updatedResponse.answers as Record<string, string | number | boolean | string[] | null>
        };
      }

      // Create new response if none exists
      const newResponse = await db.survey_responses.create({
        data: {
          survey_id: data.survey_id,
          user_id: userId,
          answers: data.answers,
          is_completed: data.is_completed ?? false,
          progress: progress,
          completed_at: data.is_completed ? new Date() : null
        }
      });

      return {
        ...newResponse,
        answers: newResponse.answers as Record<string, string | number | boolean | string[] | null>
      };
    } catch (error) {
      logger.error('Error submitting survey response:', error);
      throw error;
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

      // Get active public surveys (allow multiple submissions)
      const surveysResult = await client.query(
        `SELECT s.* FROM surveys s
         WHERE s.status = 'active'
         AND s.access_type = 'public'
         ORDER BY s.created_at DESC`,
        []
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
      // Get active invite-only surveys where user has been invited (allow multiple submissions)
      const surveysResult = await client.query(
        `SELECT DISTINCT s.* FROM surveys s
         INNER JOIN survey_invitations si ON s.id = si.survey_id
         WHERE s.status = 'active'
         AND s.access_type = 'invite_only'
         AND si.user_id = $1
         AND si.status IN ('sent', 'viewed', 'started')
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

      // Removed scheduled_start and scheduled_end checks - columns don't exist

      // Allow multiple survey submissions - removed completion check

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
  private isUserTargeted(user: UserWithLoyalty, targetSegment: TargetSegment): boolean {
    // If no targeting criteria, include all users
    if (!targetSegment || Object.keys(targetSegment).length === 0) {
      return true;
    }

    // Check tier restrictions
    if (targetSegment.tier_restrictions && targetSegment.tier_restrictions.length > 0) {
      if (!user.tier_id || !targetSegment.tier_restrictions.includes(user.tier_id)) {
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
      const userProvider = user.oauth_provider ?? 'email';
      if (!targetSegment.oauth_providers.includes(userProvider)) {
        return false;
      }
    }

    // Check excluded users
    if (targetSegment.exclude_users?.includes(user.id)) {
      return false;
    }

    return true;
  }

  // Generate survey analytics
  async getSurveyAnalytics(surveyId: string): Promise<{
    survey: Survey;
    responses: unknown[];
    totalResponses: number;
    completionRate: number;
    averageCompletionTime: number;
    responsesByDate: Array<{ date: string; count: number }>;
    questionAnalytics: Array<{
      questionId: string;
      question: string;
      type: string;
      responses: Record<string, number>;
      averageRating?: number;
    }>;
  } | null> {
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
        date: formatDateToDDMMYYYY(row.date) ?? row.date,
        count: parseInt(row.count)
      })).reverse();

      // Generate question analytics
      const questionAnalytics: Array<{
        questionId: string;
        question: string;
        type: string;
        responses: Record<string, number>;
        averageRating?: number;
      }> = [];
      
      for (const question of survey.questions) {
        const analytics = await this.getQuestionAnalytics(surveyId, question);
        questionAnalytics.push({
          questionId: analytics.question_id,
          question: analytics.question_text,
          type: analytics.question_type,
          responses: analytics.response_distribution ?? {},
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
  private async getQuestionAnalytics(surveyId: string, question: SurveyQuestion): Promise<QuestionAnalytics> {
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
          responseDistribution = responses.reduce((acc: Record<string, number>, response: unknown) => {
            const key = Array.isArray(response) ? response.join(', ') : String(response);
            // Safe: key is stringified response data used only for counting
            // eslint-disable-next-line security/detect-object-injection
            acc[key] = (acc[key] ?? 0) + 1;
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
  async getSurveyInvitations(surveyId: string): Promise<SurveyInvitation[]> {
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

  // Send survey invitations to specific users
  async sendSurveyInvitationsToUsers(surveyId: string, userIds: string[]): Promise<{ sent: number }> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      
      // Get survey details
      const survey = await this.getSurveyById(surveyId);
      if (!survey) {
        throw new Error('Survey not found');
      }

      let sent = 0;
      
      for (const userId of userIds) {
        // Check if user exists and is eligible
        const userResult = await client.query(
          `SELECT u.*, ul.tier_id, up.first_name, up.last_name
           FROM users u
           LEFT JOIN user_loyalty ul ON u.id = ul.user_id
           LEFT JOIN user_profiles up ON u.id = up.user_id
           WHERE u.id = $1 AND u.role NOT IN ('admin', 'super_admin')`,
          [userId]
        );

        if (userResult.rows.length === 0) {
          continue; // Skip invalid or admin users
        }

        const user = userResult.rows[0];

        // Check if user matches targeting criteria
        if (!this.isUserTargeted(user, survey.target_segment)) {
          continue; // Skip users who don't match targeting
        }

        // Check if user already has an invitation
        const existingInvitation = await client.query(
          'SELECT id FROM survey_invitations WHERE survey_id = $1 AND user_id = $2',
          [surveyId, userId]
        );

        if (existingInvitation.rows.length === 0) {
          // Create invitation
          await client.query(
            `INSERT INTO survey_invitations (id, survey_id, user_id, status, created_at, updated_at)
             VALUES (uuid_generate_v4(), $1, $2, 'sent', NOW(), NOW())`,
            [surveyId, userId]
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
  private async getEligibleUsers(targetSegment: TargetSegment): Promise<UserWithLoyalty[]> {
    const client = await getPool().connect();
    try {
      let query = `
        SELECT u.*, ul.tier_id, up.first_name, up.last_name
        FROM users u
        LEFT JOIN user_loyalty ul ON u.id = ul.user_id
        LEFT JOIN user_profiles up ON u.id = up.user_id
        WHERE u.role NOT IN ('admin', 'super_admin')
      `;
      const params: (string | number | string[] | number[])[] = [];
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

  // ===== Survey Coupon Assignment Methods =====

  // Assign coupon to survey (always awarded on completion)
  async assignCouponToSurvey(data: AssignCouponToSurveyRequest, assignedBy: string): Promise<SurveyCouponAssignment> {
    const client = await getPool().connect();
    try {
      const result = await client.query(
        `SELECT assign_coupon_to_survey($1, $2, $3, $4, $5, $6) as assignment_id`,
        [
          data.survey_id,
          data.coupon_id,
          assignedBy,
          data.max_awards ?? null,
          data.custom_expiry_days ?? null,
          data.assigned_reason ?? 'Survey completion reward'
        ]
      );

      const assignmentId = result.rows[0].assignment_id;

      // Get the created assignment
      const assignmentResult = await client.query(
        `SELECT * FROM survey_coupon_assignments WHERE id = $1`,
        [assignmentId]
      );

      const assignment = assignmentResult.rows[0];
      return {
        id: assignment.id,
        survey_id: assignment.survey_id,
        coupon_id: assignment.coupon_id,
        is_active: assignment.is_active,
        max_awards: assignment.max_awards,
        awarded_count: assignment.awarded_count,
        assigned_by: assignment.assigned_by,
        assigned_reason: assignment.assigned_reason,
        custom_expiry_days: assignment.custom_expiry_days,
        created_at: assignment.created_at,
        updated_at: assignment.updated_at
      };
    } finally {
      client.release();
    }
  }

  // Get survey coupon assignments with details
  async getSurveyCouponAssignments(
    surveyId: string,
    page = 1,
    limit = 20
  ): Promise<SurveyCouponAssignmentListResponse> {
    const client = await getPool().connect();
    try {
      const offset = (page - 1) * limit;

      // Get total count
      const countResult = await client.query(
        'SELECT COUNT(*) FROM survey_coupon_details WHERE survey_id = $1',
        [surveyId]
      );

      const total = parseInt(countResult.rows[0].count);

      // Get assignments
      const assignmentsResult = await client.query(
        `SELECT * FROM survey_coupon_details 
         WHERE survey_id = $1 
         ORDER BY assigned_at DESC 
         LIMIT $2 OFFSET $3`,
        [surveyId, limit, offset]
      );

      const assignments = assignmentsResult.rows.map(row => ({
        assignment_id: row.assignment_id,
        survey_id: row.survey_id,
        survey_title: row.survey_title,
        survey_status: row.survey_status,
        coupon_id: row.coupon_id,
        coupon_code: row.coupon_code,
        coupon_name: row.coupon_name,
        coupon_type: row.coupon_type,
        coupon_value: row.coupon_value,
        coupon_currency: row.coupon_currency,
        coupon_status: row.coupon_status,
        is_active: row.is_active,
        award_condition: row.award_condition,
        max_awards: row.max_awards,
        awarded_count: row.awarded_count,
        custom_expiry_days: row.custom_expiry_days,
        assigned_reason: row.assigned_reason,
        assigned_by: row.assigned_by,
        assigned_by_email: row.assigned_by_email,
        assigned_at: row.assigned_at,
        updated_at: row.updated_at
      }));

      return {
        assignments,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } finally {
      client.release();
    }
  }

  // Update survey coupon assignment
  async updateSurveyCouponAssignment(
    surveyId: string,
    couponId: string,
    data: UpdateSurveyCouponAssignmentRequest
  ): Promise<SurveyCouponAssignment | null> {
    const client = await getPool().connect();
    try {
      const updateFields: string[] = [];
      const values: (string | number | boolean | null)[] = [surveyId, couponId];
      let paramIndex = 3;

      // Note: award_condition is no longer needed - coupons always awarded on completion
      if (data.max_awards !== undefined) {
        updateFields.push(`max_awards = $${paramIndex}`);
        values.push(data.max_awards);
        paramIndex++;
      }
      if (data.custom_expiry_days !== undefined) {
        updateFields.push(`custom_expiry_days = $${paramIndex}`);
        values.push(data.custom_expiry_days);
        paramIndex++;
      }
      if (data.assigned_reason !== undefined) {
        updateFields.push(`assigned_reason = $${paramIndex}`);
        values.push(data.assigned_reason);
        paramIndex++;
      }
      if (data.is_active !== undefined) {
        updateFields.push(`is_active = $${paramIndex}`);
        values.push(data.is_active);
        paramIndex++;
      }

      if (updateFields.length === 0) {
        // No updates, just return current assignment
        const result = await client.query(
          'SELECT * FROM survey_coupon_assignments WHERE survey_id = $1 AND coupon_id = $2',
          [surveyId, couponId]
        );
        return result.rows.length > 0 ? result.rows[0] : null;
      }

      updateFields.push('updated_at = NOW()');

      const result = await client.query(
        `UPDATE survey_coupon_assignments 
         SET ${updateFields.join(', ')} 
         WHERE survey_id = $1 AND coupon_id = $2 
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) return null;

      const assignment = result.rows[0];
      return {
        id: assignment.id,
        survey_id: assignment.survey_id,
        coupon_id: assignment.coupon_id,
        is_active: assignment.is_active,
        max_awards: assignment.max_awards,
        awarded_count: assignment.awarded_count,
        assigned_by: assignment.assigned_by,
        assigned_reason: assignment.assigned_reason,
        custom_expiry_days: assignment.custom_expiry_days,
        created_at: assignment.created_at,
        updated_at: assignment.updated_at
      };
    } finally {
      client.release();
    }
  }

  // Remove coupon assignment from survey
  async removeCouponFromSurvey(surveyId: string, couponId: string, removedBy: string): Promise<boolean> {
    const client = await getPool().connect();
    try {
      const result = await client.query(
        'SELECT remove_coupon_from_survey($1, $2, $3) as removed',
        [surveyId, couponId, removedBy]
      );

      return result.rows[0].removed;
    } finally {
      client.release();
    }
  }

  // Get survey reward history
  async getSurveyRewardHistory(
    surveyId: string,
    page = 1,
    limit = 20
  ): Promise<{ rewards: SurveyRewardHistory[]; total: number; totalPages: number }> {
    const client = await getPool().connect();
    try {
      const offset = (page - 1) * limit;

      // Get total count
      const countResult = await client.query(
        `SELECT COUNT(*) FROM survey_reward_history srh
         JOIN survey_coupon_assignments sca ON srh.survey_coupon_assignment_id = sca.id
         WHERE sca.survey_id = $1`,
        [surveyId]
      );

      const total = parseInt(countResult.rows[0].count);

      // Get reward history
      const rewardsResult = await client.query(
        `SELECT srh.*, u.email as user_email, up.first_name, up.last_name,
                c.code as coupon_code, c.name as coupon_name
         FROM survey_reward_history srh
         JOIN survey_coupon_assignments sca ON srh.survey_coupon_assignment_id = sca.id
         JOIN users u ON srh.user_id = u.id
         LEFT JOIN user_profiles up ON u.id = up.user_id
         JOIN coupons c ON sca.coupon_id = c.id
         WHERE sca.survey_id = $1
         ORDER BY srh.awarded_at DESC
         LIMIT $2 OFFSET $3`,
        [surveyId, limit, offset]
      );

      const rewards = rewardsResult.rows.map(row => ({
        id: row.id,
        survey_coupon_assignment_id: row.survey_coupon_assignment_id,
        survey_response_id: row.survey_response_id,
        user_coupon_id: row.user_coupon_id,
        user_id: row.user_id,
        awarded_at: row.awarded_at,
        award_condition_met: row.award_condition_met,
        metadata: row.metadata,
        created_at: row.created_at,
        // Additional fields for display
        user_email: row.user_email,
        user_name: [row.first_name, row.last_name].filter(Boolean).join(' ') ?? '',
        coupon_code: row.coupon_code,
        coupon_name: row.coupon_name
      }));

      return {
        rewards,
        total,
        totalPages: Math.ceil(total / limit)
      };
    } finally {
      client.release();
    }
  }

  // Get all coupon assignments across surveys (admin overview)
  async getAllSurveyCouponAssignments(
    page = 1,
    limit = 20,
    filters: {
      survey_id?: string;
      coupon_id?: string;
      is_active?: boolean;
      assigned_by?: string;
    } = {}
  ): Promise<SurveyCouponAssignmentListResponse> {
    const client = await getPool().connect();
    try {
      const offset = (page - 1) * limit;
      const whereConditions: string[] = [];
      const whereValues: (string | boolean | number)[] = [];
      let paramIndex = 1;

      if (filters.survey_id) {
        whereConditions.push(`survey_id = $${paramIndex}`);
        whereValues.push(filters.survey_id);
        paramIndex++;
      }

      if (filters.coupon_id) {
        whereConditions.push(`coupon_id = $${paramIndex}`);
        whereValues.push(filters.coupon_id);
        paramIndex++;
      }

      if (filters.is_active !== undefined) {
        whereConditions.push(`is_active = $${paramIndex}`);
        whereValues.push(filters.is_active);
        paramIndex++;
      }

      if (filters.assigned_by) {
        whereConditions.push(`assigned_by = $${paramIndex}`);
        whereValues.push(filters.assigned_by);
        paramIndex++;
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      // Get total count
      const countResult = await client.query(
        `SELECT COUNT(*) FROM survey_coupon_details ${whereClause}`,
        whereValues
      );

      const total = parseInt(countResult.rows[0].count);

      // Get assignments
      const assignmentsResult = await client.query(
        `SELECT * FROM survey_coupon_details 
         ${whereClause}
         ORDER BY assigned_at DESC 
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...whereValues, limit, offset]
      );

      const assignments = assignmentsResult.rows.map(row => ({
        assignment_id: row.assignment_id,
        survey_id: row.survey_id,
        survey_title: row.survey_title,
        survey_status: row.survey_status,
        coupon_id: row.coupon_id,
        coupon_code: row.coupon_code,
        coupon_name: row.coupon_name,
        coupon_type: row.coupon_type,
        coupon_value: row.coupon_value,
        coupon_currency: row.coupon_currency,
        coupon_status: row.coupon_status,
        is_active: row.is_active,
        award_condition: row.award_condition,
        max_awards: row.max_awards,
        awarded_count: row.awarded_count,
        custom_expiry_days: row.custom_expiry_days,
        assigned_reason: row.assigned_reason,
        assigned_by: row.assigned_by,
        assigned_by_email: row.assigned_by_email,
        assigned_at: row.assigned_at,
        updated_at: row.updated_at
      }));

      return {
        assignments,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } finally {
      client.release();
    }
  }
}

export const surveyService = new SurveyService();