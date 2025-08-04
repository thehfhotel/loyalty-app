import { getPool } from '../config/database';
import { logger } from './logger';

export interface SeedSurvey {
  id: string;
  title: string;
  description: string;
  questions: Array<Record<string, unknown>>;
  target_segment: Record<string, string | number | boolean | null> | null;
  access_type: 'public' | 'invite_only';
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
}

export const SAMPLE_SURVEYS: SeedSurvey[] = [
  {
    id: 'b5cbde95-7faf-4268-b3e3-7047a1e4e17b',
    title: 'Public Test Survey',
    description: 'This is a public survey for testing the surveys page',
    access_type: 'public',
    status: 'active',
    target_segment: {},
    questions: [
      {
        id: 'q_1',
        type: 'single_choice',
        text: 'How satisfied are you with our service?',
        required: true,
        order: 1,
        options: [
          { id: 'opt_1', text: 'Very Satisfied', value: 5 },
          { id: 'opt_2', text: 'Satisfied', value: 4 },
          { id: 'opt_3', text: 'Neutral', value: 3 },
          { id: 'opt_4', text: 'Dissatisfied', value: 2 },
          { id: 'opt_5', text: 'Very Dissatisfied', value: 1 }
        ]
      },
      {
        id: 'q_2',
        type: 'text',
        text: 'Please provide any additional feedback',
        required: false,
        order: 2
      }
    ]
  },
  {
    id: '5eb4165b-7e38-439c-9936-db47b454a7e5',
    title: 'Customer Satisfaction Survey',
    description: 'Tell us about your experience with our hotel services',
    access_type: 'public',
    status: 'active',
    target_segment: {},
    questions: [
      {
        id: 'q_rating',
        type: 'rating_5',
        text: 'How would you rate your overall experience?',
        required: true,
        order: 1
      },
      {
        id: 'q_recommend',
        type: 'yes_no',
        text: 'Would you recommend us to others?',
        required: true,
        order: 2
      }
    ]
  },
  {
    id: 'c5824262-bcba-489e-ab48-5c720ff3dbb4',
    title: 'Service Quality Assessment',
    description: 'Help us improve our service quality',
    access_type: 'public',
    status: 'active',
    target_segment: {},
    questions: [
      {
        id: 'q_service_rating',
        type: 'rating_10',
        text: 'Rate the quality of our customer service (1-10)',
        required: true,
        order: 1
      }
    ]
  }
];

export async function seedSurveys(): Promise<void> {
  try {
    const pool = getPool();
    
    // Check if surveys table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'surveys'
      );
    `);
    
    if (!tableCheck.rows[0]?.exists) {
      logger.warn('Surveys table does not exist, skipping seeding');
      return;
    }

    logger.info('Starting database seeding with sample surveys...');
    
    for (const survey of SAMPLE_SURVEYS) {
      try {
        // Check if survey already exists
        const existing = await pool.query(
          'SELECT id FROM surveys WHERE id = $1',
          [survey.id]
        );
        
        if (existing.rows.length > 0) {
          logger.info(`Survey ${survey.id} already exists, skipping`);
          continue;
        }
        
        // Insert survey
        await pool.query(`
          INSERT INTO surveys (
            id, title, description, questions, target_segment, 
            access_type, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        `, [
          survey.id,
          survey.title,
          survey.description,
          JSON.stringify(survey.questions),
          JSON.stringify(survey.target_segment),
          survey.access_type,
          survey.status
        ]);
        
        logger.info(`✅ Seeded survey: ${survey.title} (${survey.id})`);
      } catch (error) {
        logger.error(`Failed to seed survey ${survey.id}:`, error);
      }
    }
    
    logger.info('Database seeding completed');
  } catch (error) {
    logger.error('Database seeding failed:', error);
  }
}

