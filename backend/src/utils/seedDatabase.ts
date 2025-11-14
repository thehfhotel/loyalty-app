import { getPool, connectDatabase } from '../config/database';
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

export interface SeedTier {
  name: string;
  min_points: number;
  benefits: Record<string, unknown>;
  color: string;
  sort_order: number;
}

export const SAMPLE_TIERS: SeedTier[] = [
  {
    name: 'Bronze',
    min_points: 0,
    benefits: {
      description: 'Welcome tier for new members',
      perks: ['5% discount on services', 'Birthday bonus', 'Member newsletter']
    },
    color: '#CD7F32',
    sort_order: 1
  },
  {
    name: 'Silver',
    min_points: 1000,
    benefits: {
      description: 'Elevated benefits for active members',
      perks: ['10% discount on services', 'Priority check-in', 'Free room upgrade (subject to availability)', 'Birthday bonus']
    },
    color: '#C0C0C0',
    sort_order: 2
  },
  {
    name: 'Gold',
    min_points: 5000,
    benefits: {
      description: 'Premium benefits for valued members',
      perks: ['15% discount on services', 'Complimentary breakfast', 'Late checkout', 'Free room upgrade', 'Priority support']
    },
    color: '#FFD700',
    sort_order: 3
  },
  {
    name: 'Platinum',
    min_points: 10000,
    benefits: {
      description: 'Exclusive benefits for our most loyal members',
      perks: ['20% discount on services', 'Complimentary spa service', 'Airport transfer', 'Guaranteed room upgrade', 'Personal concierge', 'VIP lounge access']
    },
    color: '#E5E4E2',
    sort_order: 4
  }
];

export async function seedTiers(): Promise<void> {
  try {
    const pool = getPool();

    logger.info('Starting tiers seeding...');

    for (const tier of SAMPLE_TIERS) {
      try {
        // Check if tier already exists
        const existing = await pool.query(
          'SELECT id FROM tiers WHERE name = $1',
          [tier.name]
        );

        if (existing.rows.length > 0) {
          logger.info(`Tier ${tier.name} already exists, skipping`);
          continue;
        }

        // Insert tier
        await pool.query(`
          INSERT INTO tiers (name, min_points, benefits, color, sort_order, is_active, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        `, [
          tier.name,
          tier.min_points,
          JSON.stringify(tier.benefits),
          tier.color,
          tier.sort_order,
          true
        ]);

        logger.info(`✅ Seeded tier: ${tier.name} (${tier.min_points}+ points)`);
      } catch (error) {
        logger.error(`Failed to seed tier ${tier.name}:`, error);
      }
    }

    logger.info('Tiers seeding completed');
  } catch (error) {
    logger.error('Tiers seeding failed:', error);
  }
}

export async function seedMembershipSequence(): Promise<void> {
  try {
    const pool = getPool();

    logger.info('Starting membership_id_sequence initialization...');

    // Check if membership_id_sequence table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'membership_id_sequence'
      );
    `);

    if (!tableCheck.rows[0]?.exists) {
      logger.warn('membership_id_sequence table does not exist, skipping seeding');
      return;
    }

    // Check if sequence is already initialized
    const existing = await pool.query('SELECT id FROM membership_id_sequence WHERE id = 1');

    if (existing.rows.length > 0) {
      logger.info('membership_id_sequence already initialized, skipping');
      return;
    }

    // Initialize the sequence with id=1 and current_user_count=0
    await pool.query(`
      INSERT INTO membership_id_sequence (id, current_user_count)
      VALUES (1, 0)
      ON CONFLICT (id) DO NOTHING
    `);

    logger.info('✅ membership_id_sequence initialized successfully');
  } catch (error) {
    logger.error('membership_id_sequence initialization failed:', error);
  }
}

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

    logger.info('Starting surveys seeding...');

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

    logger.info('Surveys seeding completed');
  } catch (error) {
    logger.error('Surveys seeding failed:', error);
  }
}

// Main seed function
async function seedDatabase() {
  logger.info('🌱 Starting database seeding...');

  // Initialize database connection
  await connectDatabase();
  logger.info('Database connection established');

  // Initialize membership_id_sequence (required for user registration)
  await seedMembershipSequence();

  // Seed tiers first (they're referenced by user_loyalty)
  await seedTiers();

  // Then seed surveys
  await seedSurveys();

  logger.info('✅ Database seeding completed successfully');
  process.exit(0);
}

// Run seeding if this file is executed directly
if (require.main === module) {
  seedDatabase().catch((error) => {
    logger.error('❌ Database seeding failed:', error);
    process.exit(1);
  });
}
