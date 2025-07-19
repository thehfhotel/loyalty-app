import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { addDays, isAfter, isBefore } from 'date-fns';
import QRCode from 'qrcode';
import { logger } from '../utils/logger.js';
import { 
  Survey,
  SurveyQuestion,
  SurveyResponse,
  SurveyWithProgress,
  QuestionAnswer,
  CreateSurvey,
  UpdateSurvey,
  StartSurveyResponseRequest,
  SubmitAnswerRequest,
  CompleteSurveyResponseRequest,
  CompleteSurveyResponseResponse,
  SurveyQRCodeValidationRequest,
  SurveyQRCodeValidationResponse,
  SaveSurveyProgressRequest,
  SurveySearch,
  SurveyAnalytics,
  SurveyDistributionRequest,
  BulkSurveyOperation,
  SurveyQuestionValidation,
  SurveyQuestionValidationResult,
  ERROR_CODES 
} from '@hotel-loyalty/shared';


export class SurveyService {
  constructor(private db: Pool) {}

  /**
   * Create a new survey
   */
  async createSurvey(data: CreateSurvey): Promise<Survey> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      const surveyId = uuidv4();
      const code = this.generateSurveyCode();
      const pointsReward = data.pointsReward || 0;
      
      // Generate QR code for survey access
      const qrCodeData = JSON.stringify({
        surveyId: surveyId,
        code: code,
        type: 'survey_access'
      });
      
      const qrCode = await QRCode.toDataURL(qrCodeData, {
        errorCorrectionLevel: 'M',
        margin: 2,
        scale: 8
      });
      
      // Create survey
      const surveyResult = await client.query(
        `INSERT INTO surveys (
          id, title, description, code, start_date, end_date, 
          max_responses, points_reward, target_audience, 
          estimated_time, qr_code
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          surveyId, data.title, data.description, code, data.startDate,
          data.endDate, data.maxResponses, pointsReward, data.targetAudience,
          data.estimatedTime, qrCode
        ]
      );
      
      // Create questions
      const questions: SurveyQuestion[] = [];
      for (const questionData of data.questions) {
        const questionId = uuidv4();
        
        const questionResult = await client.query(
          `INSERT INTO survey_questions (
            id, survey_id, type, title, description, is_required, 
            order_index, options, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *`,
          [
            questionId, surveyId, questionData.type, questionData.title,
            questionData.description, questionData.isRequired, questionData.order,
            JSON.stringify(questionData.options), JSON.stringify(questionData.metadata)
          ]
        );
        
        questions.push(this.mapQuestionRow(questionResult.rows[0]));
      }
      
      await client.query('COMMIT');
      
      const survey = this.mapSurveyRow(surveyResult.rows[0]);
      survey.questions = questions;
      
      logger.info(`Survey created: ${surveyId}`);
      return survey;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating survey:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    } finally {
      client.release();
    }
  }

  /**
   * Get survey by ID
   */
  async getSurveyById(id: string, includeQuestions = true): Promise<Survey | null> {
    try {
      const surveyResult = await this.db.query(
        'SELECT * FROM surveys WHERE id = $1',
        [id]
      );
      
      if (surveyResult.rows.length === 0) {
        return null;
      }
      
      const survey = this.mapSurveyRow(surveyResult.rows[0]);
      
      if (includeQuestions) {
        const questionsResult = await this.db.query(
          'SELECT * FROM survey_questions WHERE survey_id = $1 ORDER BY order_index',
          [id]
        );
        
        survey.questions = questionsResult.rows.map(row => this.mapQuestionRow(row));
      }
      
      return survey;
    } catch (error) {
      logger.error('Error getting survey by ID:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    }
  }

  /**
   * Get survey by code
   */
  async getSurveyByCode(code: string): Promise<Survey | null> {
    try {
      const result = await this.db.query(
        'SELECT * FROM surveys WHERE code = $1 AND is_active = true',
        [code]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return this.getSurveyById(result.rows[0].id);
    } catch (error) {
      logger.error('Error getting survey by code:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    }
  }

  /**
   * Get active surveys for customer
   */
  async getActiveSurveys(customerId?: string): Promise<SurveyWithProgress[]> {
    try {
      let query = `
        SELECT DISTINCT s.* FROM surveys s
        WHERE s.is_active = true 
        AND s.start_date <= NOW() 
        AND s.end_date >= NOW()
        AND (s.max_responses IS NULL OR s.response_count < s.max_responses)
      `;
      
      const params: string[] = [];
      
      if (customerId) {
        query += ` AND s.id NOT IN (
          SELECT sr.survey_id FROM survey_responses sr 
          WHERE sr.customer_id = $1 AND sr.is_completed = true
        )`;
        params.push(customerId);
      }
      
      query += ' ORDER BY s.created_at DESC';
      
      const result = await this.db.query(query, params);
      
      const surveys = await Promise.all(
        result.rows.map(async row => {
          const survey = this.mapSurveyRow(row);
          
          // Get question count for preview
          const questionCount = await this.db.query(
            'SELECT COUNT(*) as count FROM survey_questions WHERE survey_id = $1',
            [survey.id]
          );
          survey.questions = []; // Don't load full questions for list view
          (survey as any).questionCount = parseInt(questionCount.rows[0].count);
          
          return survey;
        })
      );
      
      return surveys;
    } catch (error) {
      logger.error('Error getting active surveys:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    }
  }

  /**
   * Start survey response
   */
  async startSurveyResponse(
    surveyId: string, 
    customerId: string,
    metadata?: { ipAddress?: string; userAgent?: string }
  ): Promise<SurveyResponse> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // Check if survey exists and is active
      const survey = await this.getSurveyById(surveyId, false);
      if (!survey) {
        throw new Error(ERROR_CODES.RESOURCE_NOT_FOUND);
      }
      
      if (!survey.isActive) {
        throw new Error('Survey is not active');
      }
      
      // Check survey dates
      const now = new Date();
      if (isBefore(now, survey.startDate) || isAfter(now, survey.endDate)) {
        throw new Error('Survey is not available at this time');
      }
      
      // Check if customer already has a response
      const existingResponse = await client.query(
        'SELECT id FROM survey_responses WHERE survey_id = $1 AND customer_id = $2',
        [surveyId, customerId]
      );
      
      if (existingResponse.rows.length > 0) {
        throw new Error('Customer has already started this survey');
      }
      
      // Create survey response
      const responseId = uuidv4();
      const responseResult = await client.query(
        `INSERT INTO survey_responses (
          id, survey_id, customer_id, ip_address, user_agent
        ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [responseId, surveyId, customerId, metadata?.ipAddress, metadata?.userAgent]
      );
      
      await client.query('COMMIT');
      
      logger.info(`Survey response started: ${responseId} for survey ${surveyId}`);
      return this.mapResponseRow(responseResult.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error starting survey response:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Submit survey answer
   */
  async submitAnswer(
    responseId: string,
    questionId: string,
    answer: any
  ): Promise<void> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // Validate question exists
      const questionResult = await client.query(
        'SELECT * FROM survey_questions WHERE id = $1',
        [questionId]
      );
      
      if (questionResult.rows.length === 0) {
        throw new Error('Question not found');
      }
      
      const question = this.mapQuestionRow(questionResult.rows[0]);
      
      // Validate answer format
      this.validateAnswerInternal(question, answer);
      
      // Check if answer already exists
      const existingAnswer = await client.query(
        'SELECT id FROM survey_answers WHERE response_id = $1 AND question_id = $2',
        [responseId, questionId]
      );
      
      if (existingAnswer.rows.length > 0) {
        // Update existing answer
        await client.query(
          'UPDATE survey_answers SET answer = $1, answered_at = NOW() WHERE response_id = $2 AND question_id = $3',
          [JSON.stringify(answer), responseId, questionId]
        );
      } else {
        // Create new answer
        await client.query(
          'INSERT INTO survey_answers (id, response_id, question_id, answer) VALUES ($1, $2, $3, $4)',
          [uuidv4(), responseId, questionId, JSON.stringify(answer)]
        );
      }
      
      await client.query('COMMIT');
      
      logger.debug(`Answer submitted for question ${questionId} in response ${responseId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error submitting answer:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Complete survey response
   */
  async completeSurveyResponse(
    responseId: string, 
    answers?: QuestionAnswer[]
  ): Promise<CompleteSurveyResponseResponse> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get response with survey info
      const responseResult = await client.query(
        `SELECT sr.*, s.points_reward, s.id as survey_id
         FROM survey_responses sr
         JOIN surveys s ON sr.survey_id = s.id
         WHERE sr.id = $1`,
        [responseId]
      );
      
      if (responseResult.rows.length === 0) {
        throw new Error('Survey response not found');
      }
      
      const responseData = responseResult.rows[0];
      
      if (responseData.is_completed) {
        throw new Error('Survey already completed');
      }
      
      // Check all required questions are answered
      const unansweredRequired = await client.query(
        `SELECT q.id FROM survey_questions q
         WHERE q.survey_id = $1 AND q.is_required = true
         AND q.id NOT IN (
           SELECT sa.question_id FROM survey_answers sa 
           WHERE sa.response_id = $2
         )`,
        [responseData.survey_id, responseId]
      );
      
      if (unansweredRequired.rows.length > 0) {
        throw new Error('Required questions not answered');
      }
      
      // Save final answers if provided
      if (answers && answers.length > 0) {
        // Delete existing answers for this response
        await client.query(
          'DELETE FROM survey_answers WHERE response_id = $1',
          [responseId]
        );
        
        // Insert final answers
        for (const answer of answers) {
          await client.query(
            'INSERT INTO survey_answers (id, response_id, question_id, answer, answered_at) VALUES ($1, $2, $3, $4, $5)',
            [uuidv4(), responseId, answer.questionId, JSON.stringify(answer.answer), answer.answeredAt || new Date()]
          );
        }
      }

      const pointsAwarded = responseData.points_reward || 0;
      
      // Complete the response
      await client.query(
        `UPDATE survey_responses 
         SET is_completed = true, completed_at = NOW(), points_awarded = $1
         WHERE id = $2`,
        [pointsAwarded, responseId]
      );
      
      // Update survey response count
      await client.query(
        'UPDATE surveys SET response_count = response_count + 1 WHERE id = $1',
        [responseData.survey_id]
      );
      
      // Award points to customer (if points system is integrated)
      if (pointsAwarded > 0) {
        await this.awardPointsToCustomer(responseData.customer_id, pointsAwarded, 'survey_completion');
      }
      
      await client.query('COMMIT');
      
      // Get updated response
      const updatedResponse = await this.getSurveyResponse(responseId);
      
      logger.info(`Survey completed: ${responseId}, points awarded: ${pointsAwarded}`);
      
      return {
        success: true,
        pointsAwarded,
        response: updatedResponse!
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error completing survey response:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get survey response
   */
  async getSurveyResponse(responseId: string): Promise<SurveyResponse | null> {
    try {
      const result = await this.db.query(
        `SELECT sr.*, 
         json_agg(
           json_build_object(
             'questionId', sa.question_id,
             'answer', sa.answer,
             'answeredAt', sa.answered_at
           )
         ) FILTER (WHERE sa.id IS NOT NULL) as answers
         FROM survey_responses sr
         LEFT JOIN survey_answers sa ON sr.id = sa.response_id
         WHERE sr.id = $1
         GROUP BY sr.id`,
        [responseId]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      const response = this.mapResponseRow(row);
      
      if (row.answers && row.answers[0].questionId) {
        response.responses = row.answers.map((answer: any) => ({
          questionId: answer.questionId,
          answer: typeof answer.answer === 'string' ? JSON.parse(answer.answer) : answer.answer,
          answeredAt: answer.answeredAt
        }));
      } else {
        response.responses = [];
      }
      
      return response;
    } catch (error) {
      logger.error('Error getting survey response:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    }
  }

  /**
   * Get survey questions
   */
  async getSurveyQuestions(surveyId: string): Promise<SurveyQuestion[]> {
    try {
      const result = await this.db.query(
        'SELECT * FROM survey_questions WHERE survey_id = $1 ORDER BY order_index',
        [surveyId]
      );
      
      return result.rows.map(row => this.mapQuestionRow(row));
    } catch (error) {
      logger.error('Error getting survey questions:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    }
  }

  /**
   * Validate QR code
   */
  async validateQRCode(qrData: string): Promise<SurveyQRCodeValidationResponse> {
    try {
      // Parse QR code data
      let parsedData;
      try {
        parsedData = JSON.parse(qrData);
      } catch (error) {
        return {
          survey: {
            id: '',
            title: '',
            description: '',
            estimatedTime: 0,
            pointsReward: 0
          },
          valid: false,
          code: ''
        };
      }

      // Validate QR code structure
      if (!parsedData.surveyId || !parsedData.code || parsedData.type !== 'survey_access') {
        return {
          survey: {
            id: '',
            title: '',
            description: '',
            estimatedTime: 0,
            pointsReward: 0
          },
          valid: false,
          code: ''
        };
      }

      // Get survey by ID
      const survey = await this.getSurveyById(parsedData.surveyId, false);
      if (!survey) {
        return {
          survey: {
            id: '',
            title: '',
            description: '',
            estimatedTime: 0,
            pointsReward: 0
          },
          valid: false,
          code: parsedData.code
        };
      }

      // Check if survey is valid
      const now = new Date();
      const isValid = survey.isActive && 
                     !isBefore(now, survey.startDate) && 
                     !isAfter(now, survey.endDate) &&
                     (survey.maxResponses === null || survey.maxResponses === undefined || survey.responseCount < survey.maxResponses);

      return {
        survey: {
          id: survey.id,
          title: survey.title,
          description: survey.description,
          estimatedTime: survey.estimatedTime,
          pointsReward: survey.pointsReward
        },
        valid: isValid,
        code: parsedData.code
      };
    } catch (error) {
      logger.error('Error validating QR code:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    }
  }

  /**
   * Save survey progress
   */
  async saveSurveyProgress(responseId: string, answers: QuestionAnswer[]): Promise<void> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // Verify the response exists
      const responseResult = await client.query(
        'SELECT id FROM survey_responses WHERE id = $1',
        [responseId]
      );
      
      if (responseResult.rows.length === 0) {
        throw new Error('Survey response not found');
      }
      
      // Delete existing answers for this response
      await client.query(
        'DELETE FROM survey_answers WHERE response_id = $1',
        [responseId]
      );
      
      // Insert new answers
      for (const answer of answers) {
        await client.query(
          'INSERT INTO survey_answers (id, response_id, question_id, answer, answered_at) VALUES ($1, $2, $3, $4, $5)',
          [uuidv4(), responseId, answer.questionId, JSON.stringify(answer.answer), answer.answeredAt || new Date()]
        );
      }
      
      // Update response timestamp
      await client.query(
        'UPDATE survey_responses SET updated_at = $1 WHERE id = $2',
        [new Date(), responseId]
      );
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error saving survey progress:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get survey analytics
   */
  async getSurveyAnalytics(surveyId: string): Promise<SurveyAnalytics> {
    try {
      const survey = await this.getSurveyById(surveyId);
      if (!survey) {
        throw new Error(ERROR_CODES.RESOURCE_NOT_FOUND);
      }
      
      // Total responses
      const totalResult = await this.db.query(
        'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_completed = true) as completed FROM survey_responses WHERE survey_id = $1',
        [surveyId]
      );
      
      const totalResponses = parseInt(totalResult.rows[0].completed);
      const completionRate = totalResult.rows[0].total > 0 
        ? (totalResponses / parseInt(totalResult.rows[0].total)) * 100 
        : 0;
      
      // Average completion time
      const avgTimeResult = await this.db.query(
        `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at))/60) as avg_minutes
         FROM survey_responses 
         WHERE survey_id = $1 AND is_completed = true`,
        [surveyId]
      );
      
      const averageTime = parseFloat(avgTimeResult.rows[0].avg_minutes || '0');
      
      // Question analytics
      const questionAnalytics = await Promise.all(
        survey.questions.map(async (question) => {
          const answersResult = await this.db.query(
            `SELECT sa.answer 
             FROM survey_answers sa
             JOIN survey_responses sr ON sa.response_id = sr.id
             WHERE sa.question_id = $1 AND sr.is_completed = true`,
            [question.id]
          );
          
          const answers = answersResult.rows.map(row => 
            typeof row.answer === 'string' ? JSON.parse(row.answer) : row.answer
          );
          
          const answerDistribution: Record<string, number> = {};
          let totalRating = 0;
          let ratingCount = 0;
          
          answers.forEach(answer => {
            if (question.type === 'rating') {
              totalRating += parseInt(answer);
              ratingCount++;
            } else if (question.type === 'single_choice') {
              answerDistribution[answer] = (answerDistribution[answer] || 0) + 1;
            } else if (question.type === 'multiple_choice') {
              answer.forEach((choice: string) => {
                answerDistribution[choice] = (answerDistribution[choice] || 0) + 1;
              });
            } else {
              answerDistribution['answered'] = answers.length;
            }
          });
          
          return {
            questionId: question.id,
            questionTitle: question.title,
            responseCount: answers.length,
            answerDistribution,
            averageRating: ratingCount > 0 ? totalRating / ratingCount : undefined
          };
        })
      );
      
      // Responses by date
      const dateResult = await this.db.query(
        `SELECT DATE(completed_at) as date, COUNT(*) as count
         FROM survey_responses 
         WHERE survey_id = $1 AND is_completed = true
         GROUP BY DATE(completed_at)
         ORDER BY date DESC`,
        [surveyId]
      );
      
      const responsesByDate = dateResult.rows.map(row => ({
        date: row.date,
        count: parseInt(row.count)
      }));
      
      return {
        totalSurveys: 1,
        activeSurveys: survey.isActive ? 1 : 0,
        totalResponses,
        completionRate,
        averageResponseTime: averageTime,
        pointsAwarded: totalResponses * survey.pointsReward,
        responsesByDate,
        topSurveys: [{ survey, responseCount: totalResponses, completionRate }],
        questionTypeDistribution: survey.questions.reduce((acc, q) => {
          acc[q.type] = (acc[q.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      };
    } catch (error) {
      logger.error('Error getting survey analytics:', error);
      throw new Error(ERROR_CODES.SYSTEM_ERROR);
    }
  }

  /**
   * Generate survey code
   */
  private generateSurveyCode(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'SV';
    for (let i = 0; i < 6; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }

  /**
   * Validate answer format
   */
  validateAnswer(question: SurveyQuestion, answer: any): SurveyQuestionValidationResult {
    if (question.isRequired && (answer === null || answer === undefined || answer === '')) {
      return { isValid: false, error: 'This question is required' };
    }

    if (!question.isRequired && (answer === null || answer === undefined || answer === '')) {
      return { isValid: true };
    }

    switch (question.type) {
      case 'text':
        if (typeof answer !== 'string') {
          return { isValid: false, error: 'Answer must be text' };
        }
        if (answer.length > 1000) {
          return { isValid: false, error: 'Answer must be less than 1000 characters' };
        }
        break;

      case 'number':
        if (typeof answer !== 'number' || isNaN(answer)) {
          return { isValid: false, error: 'Answer must be a valid number' };
        }
        break;

      case 'boolean':
        if (typeof answer !== 'boolean') {
          return { isValid: false, error: 'Please select Yes or No' };
        }
        break;

      case 'single_choice':
        if (!question.options?.includes(answer)) {
          return { isValid: false, error: 'Please select a valid option' };
        }
        break;

      case 'multiple_choice':
        if (!Array.isArray(answer)) {
          return { isValid: false, error: 'Please select at least one option' };
        }
        if (answer.length === 0) {
          return { isValid: false, error: 'Please select at least one option' };
        }
        if (!answer.every(choice => question.options?.includes(choice))) {
          return { isValid: false, error: 'Please select valid options only' };
        }
        break;

      case 'rating':
        if (typeof answer !== 'number' || answer < 1 || answer > 5) {
          return { isValid: false, error: 'Please select a rating between 1 and 5' };
        }
        break;

      default:
        return { isValid: false, error: 'Unknown question type' };
    }

    return { isValid: true };
  }

  /**
   * Private validate answer for internal use
   */
  private validateAnswerInternal(question: SurveyQuestion, answer: any): void {
    const result = this.validateAnswer(question, answer);
    if (!result.isValid) {
      throw new Error(result.error);
    }
  }

  /**
   * Award points to customer (placeholder for loyalty integration)
   */
  private async awardPointsToCustomer(customerId: string, points: number, source: string): Promise<void> {
    try {
      // This would integrate with the loyalty points system
      // For now, just log the points award
      logger.info(`Points awarded: ${points} to customer ${customerId} for ${source}`);
      
      // TODO: Integrate with loyalty service when Stream A is complete
      // await loyaltyService.addPoints(customerId, points, source);
    } catch (error) {
      logger.error('Error awarding points:', error);
      // Don't fail survey completion if points award fails
    }
  }

  /**
   * Map database row to Survey object
   */
  private mapSurveyRow(row: any): Survey {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      code: row.code,
      isActive: row.is_active,
      startDate: row.start_date,
      endDate: row.end_date,
      maxResponses: row.max_responses,
      responseCount: row.response_count || 0,
      pointsReward: row.points_reward || 0,
      targetAudience: row.target_audience,
      estimatedTime: row.estimated_time,
      qrCode: row.qr_code,
      questions: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Map database row to SurveyQuestion object
   */
  private mapQuestionRow(row: any): SurveyQuestion {
    return {
      id: row.id,
      surveyId: row.survey_id,
      type: row.type,
      title: row.title,
      description: row.description,
      isRequired: row.is_required,
      order: row.order_index,
      options: row.options ? JSON.parse(row.options) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at
    };
  }

  /**
   * Map database row to SurveyResponse object
   */
  private mapResponseRow(row: any): SurveyResponse {
    return {
      id: row.id,
      surveyId: row.survey_id,
      customerId: row.customer_id,
      responses: [],
      startedAt: row.started_at,
      completedAt: row.completed_at,
      isCompleted: row.is_completed,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      pointsAwarded: row.points_awarded || 0,
      createdAt: row.created_at
    };
  }
}