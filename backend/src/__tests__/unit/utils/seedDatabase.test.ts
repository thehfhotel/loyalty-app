/**
 * SeedDatabase Unit Tests
 * Tests database seeding functionality for tiers, membership sequences, and surveys
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  seedTiers,
  seedMembershipSequence,
  seedSurveys,
  SAMPLE_TIERS,
  SAMPLE_SURVEYS,
  SeedTier,
  SeedSurvey,
} from '../../../utils/seedDatabase';
import * as database from '../../../config/database';

// Mock dependencies
jest.mock('../../../config/database');
jest.mock('../../../utils/logger');

// Import mocked logger to verify error logging
import { logger } from '../../../utils/logger';
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('SeedDatabase Utils', () => {
  let mockGetPool: jest.Mock;
  let mockQuery: jest.Mock;
  let mockConnectDatabase: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockQuery = jest.fn();
    mockGetPool = jest.fn().mockReturnValue({ query: mockQuery });
    mockConnectDatabase = jest.fn();

    (database as unknown as Record<string, unknown>).getPool = mockGetPool;
    (database as unknown as Record<string, unknown>).connectDatabase = mockConnectDatabase;
  });

  describe('SAMPLE_TIERS constant', () => {
    it('should contain 4 tiers', () => {
      expect(SAMPLE_TIERS).toHaveLength(4);
    });

    it('should have tiers in correct order', () => {
      expect(SAMPLE_TIERS[0]!.name).toBe('Bronze');
      expect(SAMPLE_TIERS[1]!.name).toBe('Silver');
      expect(SAMPLE_TIERS[2]!.name).toBe('Gold');
      expect(SAMPLE_TIERS[3]!.name).toBe('Platinum');
    });

    it('should have correct night thresholds', () => {
      expect(SAMPLE_TIERS[0]!.min_nights).toBe(0);  // Bronze: 0+ nights
      expect(SAMPLE_TIERS[1]!.min_nights).toBe(1);  // Silver: 1+ nights
      expect(SAMPLE_TIERS[2]!.min_nights).toBe(10); // Gold: 10+ nights
      expect(SAMPLE_TIERS[3]!.min_nights).toBe(20); // Platinum: 20+ nights
    });

    it('should have ascending sort order', () => {
      expect(SAMPLE_TIERS[0]!.sort_order).toBe(1);
      expect(SAMPLE_TIERS[1]!.sort_order).toBe(2);
      expect(SAMPLE_TIERS[2]!.sort_order).toBe(3);
      expect(SAMPLE_TIERS[3]!.sort_order).toBe(4);
    });

    it('should have unique colors', () => {
      const colors = SAMPLE_TIERS.map(tier => tier.color);
      const uniqueColors = new Set(colors);
      expect(uniqueColors.size).toBe(SAMPLE_TIERS.length);
    });

    it('should have benefits objects', () => {
      SAMPLE_TIERS.forEach(tier => {
        expect(tier.benefits).toBeDefined();
        expect(typeof tier.benefits).toBe('object');
      });
    });

    it('should have legacy min_points set to 0', () => {
      SAMPLE_TIERS.forEach(tier => {
        expect(tier.min_points).toBe(0);
      });
    });
  });

  describe('SAMPLE_SURVEYS constant', () => {
    it('should contain survey data', () => {
      expect(SAMPLE_SURVEYS.length).toBeGreaterThan(0);
    });

    it('should have surveys with required fields', () => {
      SAMPLE_SURVEYS.forEach(survey => {
        expect(survey.id).toBeDefined();
        expect(survey.title).toBeDefined();
        expect(survey.description).toBeDefined();
        expect(survey.questions).toBeDefined();
        expect(Array.isArray(survey.questions)).toBe(true);
        expect(survey.access_type).toBeDefined();
        expect(survey.status).toBeDefined();
      });
    });

    it('should have valid access types', () => {
      SAMPLE_SURVEYS.forEach(survey => {
        expect(['public', 'invite_only']).toContain(survey.access_type);
      });
    });

    it('should have valid status values', () => {
      SAMPLE_SURVEYS.forEach(survey => {
        expect(['draft', 'active', 'paused', 'completed', 'archived']).toContain(survey.status);
      });
    });

    it('should have questions with proper structure', () => {
      SAMPLE_SURVEYS.forEach(survey => {
        expect(survey.questions.length).toBeGreaterThan(0);
        survey.questions.forEach(question => {
          expect(question).toHaveProperty('id');
          expect(question).toHaveProperty('type');
          expect(question).toHaveProperty('text');
        });
      });
    });
  });

  describe('seedTiers', () => {
    it('should seed all tiers successfully', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as never); // No existing tiers

      await seedTiers();

      expect(mockQuery).toHaveBeenCalledTimes(SAMPLE_TIERS.length * 2); // SELECT + INSERT for each tier
    });

    it('should check for existing tiers before inserting', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as never);

      await seedTiers();

      SAMPLE_TIERS.forEach(tier => {
        expect(mockQuery).toHaveBeenCalledWith(
          'SELECT id FROM tiers WHERE name = $1',
          [tier.name]
        );
      });
    });

    it('should skip existing tiers', async () => {
      // Mock Bronze already exists
      mockQuery.mockImplementation((((query: string, params?: unknown[]) => {
        if (query.includes('SELECT') && params?.[0] === 'Bronze') {
          return Promise.resolve({ rows: [{ id: '123' }] });
        }
        return Promise.resolve({ rows: [] });
      })) as never);

      await seedTiers();

      // Should have fewer INSERT calls (Bronze skipped)
      const insertCalls = (mockQuery.mock.calls as Array<[string, unknown[]]>).filter(
        call => call[0].includes('INSERT INTO tiers')
      );
      expect(insertCalls.length).toBe(SAMPLE_TIERS.length - 1);
    });

    it('should insert tier with correct data structure', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as never);

      await seedTiers();

      const bronzeTier = SAMPLE_TIERS[0]!;
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tiers'),
        [
          bronzeTier.name,
          bronzeTier.min_points,
          bronzeTier.min_nights,
          JSON.stringify(bronzeTier.benefits),
          bronzeTier.color,
          bronzeTier.sort_order,
          true
        ]
      );
    });

    it('should handle individual tier seeding errors', async () => {
      mockQuery.mockImplementation(((query: string, params?: unknown[]) => {
        if (query.includes('INSERT') && params?.[0] === 'Silver') {
          return Promise.reject(new Error('Database error'));
        }
        return Promise.resolve({ rows: [] });
      }) as never);

      await expect(seedTiers()).resolves.not.toThrow();

      // Should continue seeding other tiers
      expect(mockQuery).toHaveBeenCalledTimes(SAMPLE_TIERS.length * 2);
    });

    it('should handle database connection errors gracefully', async () => {
      mockGetPool.mockImplementation(() => {
        throw new Error('Connection failed');
      });

      await expect(seedTiers()).resolves.not.toThrow();
    });

    it('should stringify benefits as JSON', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as never);

      await seedTiers();

      SAMPLE_TIERS.forEach(tier => {
        expect(mockQuery).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining([JSON.stringify(tier.benefits)])
        );
      });
    });

    it('should set is_active to true for all tiers', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as never);

      await seedTiers();

      SAMPLE_TIERS.forEach(() => {
        expect(mockQuery).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining([true])
        );
      });
    });
  });

  describe('seedMembershipSequence', () => {
    it('should initialize membership sequence successfully', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] } as never) // Table exists
        .mockResolvedValueOnce({ rows: [] } as never); // No existing sequence

      await seedMembershipSequence();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO membership_id_sequence')
      );
    });

    it('should check if table exists before seeding', async () => {
      mockQuery.mockResolvedValue({ rows: [{ exists: true }] } as never);

      await seedMembershipSequence();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT EXISTS')
      );
    });

    it('should skip seeding if table does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] } as never);

      await seedMembershipSequence();

      // Should only be called once (table check), not for INSERT
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should skip if sequence already initialized', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] } as never) // Table exists
        .mockResolvedValueOnce({ rows: [{ id: 1 }] } as never); // Sequence exists

      await seedMembershipSequence();

      // Should not call INSERT
      const insertCalls = (mockQuery.mock.calls as Array<[string]>).filter(
        call => call[0].includes('INSERT')
      );
      expect(insertCalls.length).toBe(0);
    });

    it('should initialize with id=1 and current_user_count=0', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      await seedMembershipSequence();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO membership_id_sequence (id, current_user_count)')
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('VALUES (1, 0)')
      );
    });

    it('should use ON CONFLICT DO NOTHING for idempotency', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      await seedMembershipSequence();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (id) DO NOTHING')
      );
    });

    it('should handle database errors gracefully', async () => {
      mockQuery.mockRejectedValue(new Error('Database error') as never);

      await expect(seedMembershipSequence()).resolves.not.toThrow();
    });

    it('should handle table check errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Table check failed') as never);

      await expect(seedMembershipSequence()).resolves.not.toThrow();
    });
  });

  describe('seedSurveys', () => {
    it('should seed all surveys successfully', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] } as never) // Table exists
        .mockResolvedValue({ rows: [] } as never); // No existing surveys

      await seedSurveys();

      // Table check + (SELECT + INSERT) for each survey
      expect(mockQuery).toHaveBeenCalledTimes(1 + SAMPLE_SURVEYS.length * 2);
    });

    it('should check if surveys table exists', async () => {
      mockQuery.mockResolvedValue({ rows: [{ exists: true }] } as never);

      await seedSurveys();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT EXISTS')
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("table_name = 'surveys'")
      );
    });

    it('should skip seeding if table does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] } as never);

      await seedSurveys();

      expect(mockQuery).toHaveBeenCalledTimes(1); // Only table check
    });

    it('should check for existing surveys by ID', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] } as never)
        .mockResolvedValue({ rows: [] } as never);

      await seedSurveys();

      SAMPLE_SURVEYS.forEach(survey => {
        expect(mockQuery).toHaveBeenCalledWith(
          'SELECT id FROM surveys WHERE id = $1',
          [survey.id]
        );
      });
    });

    it('should skip existing surveys', async () => {
      const firstSurveyId = SAMPLE_SURVEYS[0]!.id;

      mockQuery.mockImplementation(((query: string, params?: unknown[]) => {
        if (query.includes('SELECT EXISTS')) {
          return Promise.resolve({ rows: [{ exists: true }] });
        }
        if (query.includes('SELECT id FROM surveys') && params?.[0] === firstSurveyId) {
          return Promise.resolve({ rows: [{ id: firstSurveyId }] });
        }
        return Promise.resolve({ rows: [] });
      }) as never);

      await seedSurveys();

      const insertCalls = (mockQuery.mock.calls as Array<[string, unknown[]]>).filter(
        call => call[0].includes('INSERT INTO surveys')
      );
      expect(insertCalls.length).toBe(SAMPLE_SURVEYS.length - 1);
    });

    it('should insert survey with correct data structure', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] } as never)
        .mockResolvedValue({ rows: [] } as never);

      await seedSurveys();

      const firstSurvey = SAMPLE_SURVEYS[0]!;
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO surveys'),
        [
          firstSurvey.id,
          firstSurvey.title,
          firstSurvey.description,
          JSON.stringify(firstSurvey.questions),
          JSON.stringify(firstSurvey.target_segment),
          firstSurvey.access_type,
          firstSurvey.status
        ]
      );
    });

    it('should stringify questions as JSON', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] } as never)
        .mockResolvedValue({ rows: [] } as never);

      await seedSurveys();

      SAMPLE_SURVEYS.forEach(survey => {
        expect(mockQuery).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining([JSON.stringify(survey.questions)])
        );
      });
    });

    it('should stringify target_segment as JSON', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] } as never)
        .mockResolvedValue({ rows: [] } as never);

      await seedSurveys();

      SAMPLE_SURVEYS.forEach(survey => {
        expect(mockQuery).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining([JSON.stringify(survey.target_segment)])
        );
      });
    });

    it('should handle individual survey seeding errors', async () => {
      mockQuery.mockImplementation(((query: string, params?: unknown[]) => {
        if (query.includes('SELECT EXISTS')) {
          return Promise.resolve({ rows: [{ exists: true }] });
        }
        if (query.includes('INSERT') && params && params[1] === SAMPLE_SURVEYS[0]!.title) {
          return Promise.reject(new Error('Insert failed'));
        }
        return Promise.resolve({ rows: [] });
      }) as never);

      await expect(seedSurveys()).resolves.not.toThrow();
    });

    it('should handle database connection errors gracefully', async () => {
      mockGetPool.mockImplementation(() => {
        throw new Error('Connection failed');
      });

      await expect(seedSurveys()).resolves.not.toThrow();
    });
  });

  describe('Idempotency', () => {
    it('should allow re-running seedTiers without duplicates', async () => {
      // First run - insert all
      mockQuery.mockResolvedValue({ rows: [] } as never);
      await seedTiers();

      const firstRunInserts = (mockQuery.mock.calls as Array<[string]>).filter(
        call => call[0].includes('INSERT')
      ).length;

      jest.clearAllMocks();

      // Second run - all exist
      mockQuery.mockResolvedValue({ rows: [{ id: '123' }] } as never);
      await seedTiers();

      const secondRunInserts = (mockQuery.mock.calls as Array<[string]>).filter(
        call => call[0].includes('INSERT')
      ).length;

      expect(firstRunInserts).toBeGreaterThan(0);
      expect(secondRunInserts).toBe(0);
    });

    it('should allow re-running seedMembershipSequence without duplicates', async () => {
      // First run
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      await seedMembershipSequence();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT')
      );

      jest.clearAllMocks();

      // Second run - sequence exists
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] } as never)
        .mockResolvedValueOnce({ rows: [{ id: 1 }] } as never);

      await seedMembershipSequence();

      const insertCalls = (mockQuery.mock.calls as Array<[string]>).filter(
        call => call[0].includes('INSERT')
      );
      expect(insertCalls.length).toBe(0);
    });

    it('should allow re-running seedSurveys without duplicates', async () => {
      // First run
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] } as never)
        .mockResolvedValue({ rows: [] } as never);

      await seedSurveys();

      const firstRunInserts = (mockQuery.mock.calls as Array<[string]>).filter(
        call => call[0].includes('INSERT')
      ).length;

      jest.clearAllMocks();

      // Second run - all exist
      mockQuery.mockImplementation(((query: string) => {
        if (query.includes('SELECT EXISTS')) {
          return Promise.resolve({ rows: [{ exists: true }] });
        }
        return Promise.resolve({ rows: [{ id: '123' }] });
      }) as never);

      await seedSurveys();

      const secondRunInserts = (mockQuery.mock.calls as Array<[string]>).filter(
        call => call[0].includes('INSERT')
      ).length;

      expect(firstRunInserts).toBeGreaterThan(0);
      expect(secondRunInserts).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty database pool gracefully', async () => {
      mockGetPool.mockReturnValue(null);

      // Functions catch errors internally and don't throw
      await expect(seedTiers()).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle partial tier seeding failure', async () => {
      let callCount = 0;
      mockQuery.mockImplementation(((query: string) => {
        if (query.includes('INSERT')) {
          callCount++;
          if (callCount === 2) {
            return Promise.reject(new Error('Insert failed'));
          }
        }
        return Promise.resolve({ rows: [] });
      }) as never);

      await seedTiers();

      // Should continue despite one failure
      expect(mockQuery).toHaveBeenCalled();
    });

    it('should handle malformed query responses gracefully', async () => {
      mockQuery.mockResolvedValue(null as never);

      // Functions catch errors internally and don't throw
      await expect(seedTiers()).resolves.not.toThrow();
    });

    it('should handle query timeout gracefully', async () => {
      mockQuery.mockImplementation((() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Query timeout')), 100);
        });
      }) as never);

      // Functions catch errors internally and don't throw
      await expect(seedTiers()).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Type definitions', () => {
    it('should have correct SeedTier interface', () => {
      const tier: SeedTier = {
        name: 'Test',
        min_points: 0,
        min_nights: 0,
        benefits: {},
        color: '#000000',
        sort_order: 1,
      };

      expect(tier).toHaveProperty('name');
      expect(tier).toHaveProperty('min_nights');
      expect(tier).toHaveProperty('benefits');
    });

    it('should have correct SeedSurvey interface', () => {
      const survey: SeedSurvey = {
        id: 'test-id',
        title: 'Test Survey',
        description: 'Test',
        questions: [],
        target_segment: null,
        access_type: 'public',
        status: 'active',
      };

      expect(survey).toHaveProperty('id');
      expect(survey).toHaveProperty('questions');
      expect(survey).toHaveProperty('access_type');
    });
  });
});
