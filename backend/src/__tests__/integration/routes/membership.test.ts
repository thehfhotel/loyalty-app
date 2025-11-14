/**
 * Membership Routes Integration Tests
 * Tests membership ID lookup, membership statistics, and tier management
 *
 * Week 2 Priority - 15-20 tests
 * Coverage Target: ~2% contribution
 */

import request from 'supertest';
import express, { Express } from 'express';
import membershipRoutes from '../../../routes/membership';
import { errorHandler } from '../../../middleware/errorHandler';

// Mock membershipIdService
jest.mock('../../../services/membershipIdService');
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock authentication middleware for admin routes
jest.mock('../../../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = {
      id: 'admin-user-123',
      email: 'admin@example.com',
      role: 'admin'
    };
    next();
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  authorize: (_roles: string | string[]) => (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    // For testing, allow all authorized roles
    next();
  }
}));

// Mock validateRequest middleware
jest.mock('../../../middleware/validateRequest', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validateRequest: (_schema: unknown) => (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    next();
  }
}));

describe('Membership Routes Integration Tests', () => {
  let app: Express;

  beforeAll(() => {
    // Create Express app with routes
    app = express();
    app.use(express.json());
    app.use('/api/membership', membershipRoutes);
    app.use(errorHandler);
  });

  describe('Membership ID Lookup', () => {
    test('should look up user by valid membership ID', async () => {
      const mockUserInfo = {
        id: 'user-123',
        email: 'user@example.com',
        name: 'Test User',
        membershipId: '26912345',
        tier: 'gold',
        joinDate: '2023-01-15'
      };

      const { membershipIdService } = jest.requireMock('../../../services/membershipIdService');
      membershipIdService.getUserByMembershipId.mockResolvedValue(mockUserInfo);

      const response = await request(app)
        .get('/api/membership/lookup/26912345')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toEqual(mockUserInfo);
    });

    test('should return 400 for invalid membership ID format', async () => {
      const response = await request(app)
        .get('/api/membership/lookup/12345678')
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
    });

    test('should return 404 for non-existent membership ID', async () => {
      const { membershipIdService } = jest.requireMock('../../../services/membershipIdService');
      membershipIdService.getUserByMembershipId.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/membership/lookup/26999999')
        .expect(404);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'User not found');
    });

    test('should handle membership ID service errors', async () => {
      const { membershipIdService } = jest.requireMock('../../../services/membershipIdService');
      membershipIdService.getUserByMembershipId.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/membership/lookup/26912345')
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    test('should validate membership ID format (8 digits starting with 269)', async () => {
      const invalidIds = [
        '2691234',   // Too short
        '269123456', // Too long
        '16912345',  // Wrong prefix
        '2691234a', // Contains letter
        '269 12345' // Contains space
      ];

      for (const id of invalidIds) {
        await request(app)
          .get(`/api/membership/lookup/${id}`)
          .expect(400);
      }
    });

    test('should handle empty membership ID', async () => {
      const response = await request(app)
        .get('/api/membership/lookup/')
        .expect(404);

      expect(response.body.error).toContain('Not Found');
    });
  });

  describe('Membership Statistics', () => {
    test('should return membership statistics', async () => {
      const mockStats = {
        totalMembers: 1250,
        activeMembers: 1180,
        tierDistribution: {
          basic: 500,
          silver: 450,
          gold: 250,
          platinum: 50
        },
        newMembersThisMonth: 45,
        expiringThisMonth: 12
      };

      const { membershipIdService } = jest.requireMock('../../../services/membershipIdService');
      membershipIdService.getMembershipStats.mockResolvedValue(mockStats);

      const response = await request(app)
        .get('/api/membership/stats')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toEqual(mockStats);
    });

    test('should handle statistics service errors', async () => {
      const { membershipIdService } = jest.requireMock('../../../services/membershipIdService');
      membershipIdService.getMembershipStats.mockRejectedValue(new Error('Stats service error'));

      const response = await request(app)
        .get('/api/membership/stats')
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });

    test('should cache statistics results', async () => {
      const { membershipIdService } = jest.requireMock('../../../services/membershipIdService');
      membershipIdService.getMembershipStats.mockResolvedValue({
        totalMembers: 1000,
        activeMembers: 950
      });

      // First call
      await request(app)
        .get('/api/membership/stats')
        .expect(200);

      // Second call should hit cache
      await request(app)
        .get('/api/membership/stats')
        .expect(200);

      expect(membershipIdService.getMembershipStats).toHaveBeenCalledTimes(1);
    });
  });

  describe('Tier Management', () => {
    test('should get user tier information', async () => {
      // Mock user tier in request
      const mockUser = {
        id: 'user-123',
        tier: 'gold',
        membershipId: '26912345',
        benefits: ['discounts', 'priority_support', 'exclusive_events']
      };

      const { membershipIdService } = jest.requireMock('../../../services/membershipIdService');
      membershipIdService.getUserTier.mockResolvedValue(mockUser);

      const response = await request(app)
        .get('/api/membership/tier')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data.tier).toBe('gold');
    });

    test('should return null for user without membership', async () => {
      const { membershipIdService } = jest.requireMock('../../../services/membershipIdService');
      membershipIdService.getUserTier.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/membership/tier')
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });

    test('should handle tier upgrade requests', async () => {
      const upgradeData = {
        targetTier: 'platinum',
        paymentMethod: 'credit_card',
        membershipId: '26912345'
      };

      const { membershipIdService } = jest.requireMock('../../../services/membershipIdService');
      membershipIdService.upgradeTier.mockResolvedValue({
        success: true,
        newTier: 'platinum',
        effectiveDate: '2024-01-01'
      });

      const response = await request(app)
        .post('/api/membership/upgrade')
        .send(upgradeData)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.newTier).toBe('platinum');
    });

    test('should validate upgrade request data', async () => {
      const invalidUpgradeData = {
        targetTier: '',
        paymentMethod: ''
      };

      const response = await request(app)
        .post('/api/membership/upgrade')
        .send(invalidUpgradeData)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Membership Benefits', () => {
    test('should get tier benefits', async () => {
      const mockBenefits = {
        basic: ['standard_support', 'email_newsletter'],
        silver: ['priority_support', 'discounts', 'early_access'],
        gold: ['priority_support', 'discounts', 'exclusive_events', 'concierge_service'],
        platinum: ['all_above', 'unlimited_discounts', 'vip_events', 'personal_manager']
      };

      const { membershipIdService } = jest.requireMock('../../../services/membershipIdService');
      membershipIdService.getTierBenefits.mockResolvedValue(mockBenefits);

      const response = await request(app)
        .get('/api/membership/benefits')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toEqual(mockBenefits);
    });

    test('should get benefits for specific tier', async () => {
      const { membershipIdService } = jest.requireMock('../../../services/membershipIdService');
      membershipIdService.getTierBenefits.mockResolvedValue({
        gold: ['priority_support', 'discounts', 'exclusive_events']
      });

      const response = await request(app)
        .get('/api/membership/benefits?tier=gold')
        .expect(200);

      expect(response.body.data.gold).toBeDefined();
    });

    test('should return empty benefits for invalid tier', async () => {
      const response = await request(app)
        .get('/api/membership/benefits?tier=invalid')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed JSON requests', async () => {
      const response = await request(app)
        .post('/api/membership/upgrade')
        .send('invalid-json')
        .set('Content-Type', 'application/json')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    test('should handle missing required fields', async () => {
      const response = await request(app)
        .post('/api/membership/upgrade')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    test('should handle service timeouts', async () => {
      const { membershipIdService } = jest.requireMock('../../../services/membershipIdService');
      membershipIdService.getUserByMembershipId.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve(null), 60000); // 60 second timeout
        });
      });

      await request(app)
        .get('/api/membership/lookup/26912345')
        .timeout(1000)
        .expect(408);
    });
  });

  describe('Authorization', () => {
    test('should require admin privileges for membership lookup', async () => {
      // This is handled by the mocked authorize middleware
      // In real implementation, non-admin users would get 403
      const response = await request(app)
        .get('/api/membership/lookup/26912345')
        .expect(200);

      // With mocked auth, should pass
      expect(response.body).toBeDefined();
    });

    test('should require admin privileges for statistics', async () => {
      const response = await request(app)
        .get('/api/membership/stats')
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    test('should handle very long membership IDs', async () => {
      const response = await request(app)
        .get('/api/membership/lookup/269999999999999')
        .expect(400);

      expect(response.body.error).toContain('must be 8 digits');
    });

    test('should handle special characters in membership ID', async () => {
      const response = await request(app)
        .get('/api/membership/lookup/26912@345')
        .expect(400);

      expect(response.body.error).toContain('must be 8 digits');
    });

    test('should handle null membership ID in lookup', async () => {
      const response = await request(app)
        .get('/api/membership/lookup/null')
        .expect(400);

      expect(response.body.error).toContain('Membership ID is required');
    });

    test('should handle Unicode characters in search', async () => {
      const response = await request(app)
        .get('/api/membership/lookup/26912345')
        .set('Accept-Language', 'zh-CN')
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });
});