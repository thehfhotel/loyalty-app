/**
 * Membership Routes Integration Tests
 * Tests membership ID lookup, stats, regeneration, and user access
 *
 * Week 2 Priority - 15-20 tests
 * Coverage Target: ~2-3% contribution
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test mocks require flexible typing */
/* eslint-disable @typescript-eslint/no-unused-vars -- Test setup may have intentionally unused variables */

import request from 'supertest';
import { Express } from 'express';
import routes from '../../../routes/membership';
import { createTestApp } from '../../fixtures';

// Mock dependencies - Service-based mocking
jest.mock('../../../services/membershipIdService', () => ({
  membershipIdService: {
    getUserByMembershipId: jest.fn(),
    getMembershipIdByUserId: jest.fn(),
    regenerateMembershipId: jest.fn(),
    getMembershipIdStats: jest.fn(),
  },
}));

jest.mock('../../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    // Admin routes: GET /lookup, GET /stats, POST /regenerate
    // User routes: GET /my-id
    const adminPaths = ['/lookup', '/stats', '/regenerate'];
    const isAdminRoute = adminPaths.some(p => req.path.includes(p));

    req.user = isAdminRoute ? {
      id: 'admin-user-id',
      email: 'admin@example.com',
      role: 'admin',
    } : {
      id: 'test-user-id',
      email: 'test@example.com',
      role: 'customer',
    };
    next();
  },
  authorize: (..._roles: string[]) => (_req: any, _res: any, next: any) => {
    next();
  },
}));

// Import mocked service
import { membershipIdService } from '../../../services/membershipIdService';

describe('Membership Routes Integration Tests', () => {
  let app: Express;
  const mockMembershipIdService = membershipIdService as jest.Mocked<typeof membershipIdService>;

  beforeAll(() => {
    app = createTestApp(routes, '/api/membership');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/membership/my-id', () => {
    it('should get current user membership ID', async () => {
      mockMembershipIdService.getMembershipIdByUserId.mockResolvedValue('26900001');

      const response = await request(app)
        .get('/api/membership/my-id');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.membershipId).toBe('26900001');
      expect(mockMembershipIdService.getMembershipIdByUserId).toHaveBeenCalledWith('test-user-id');
    });

    it('should handle error when membership ID not found', async () => {
      mockMembershipIdService.getMembershipIdByUserId.mockRejectedValue(
        new Error('Membership ID not found')
      );

      const response = await request(app)
        .get('/api/membership/my-id');

      expect(response.status).toBe(500);
    });

    it('should return valid 8-digit membership ID starting with 269', async () => {
      mockMembershipIdService.getMembershipIdByUserId.mockResolvedValue('26912345');

      const response = await request(app)
        .get('/api/membership/my-id');

      expect(response.status).toBe(200);
      expect(response.body.data.membershipId).toMatch(/^269\d{5}$/);
    });
  });

  describe('GET /api/membership/lookup/:membershipId (Admin)', () => {
    it('should lookup user by membership ID', async () => {
      mockMembershipIdService.getUserByMembershipId.mockResolvedValue({
        userId: 'user-123',
        membershipId: '26900001',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        phone: '+66812345678',
        tier: 'Gold',
        currentPoints: 1500,
        totalNights: 15,
        joinedAt: new Date('2024-01-01').toISOString(),
      } as any);

      const response = await request(app)
        .get('/api/membership/lookup/26900001');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.membershipId).toBe('26900001');
      expect(response.body.data.email).toBe('john@example.com');
      expect(response.body.data.tier).toBe('Gold');
    });

    it('should reject invalid membership ID format (not 8 digits)', async () => {
      const response = await request(app)
        .get('/api/membership/lookup/123456');

      expect(response.status).toBe(400);
    });

    it('should reject membership ID not starting with 269', async () => {
      const response = await request(app)
        .get('/api/membership/lookup/12345678');

      expect(response.status).toBe(400);
    });

    it('should handle membership ID not found', async () => {
      mockMembershipIdService.getUserByMembershipId.mockRejectedValue(
        new Error('Membership ID not found')
      );

      const response = await request(app)
        .get('/api/membership/lookup/26999999');

      expect(response.status).toBe(500);
    });

    it('should return complete user information', async () => {
      mockMembershipIdService.getUserByMembershipId.mockResolvedValue({
        userId: 'user-456',
        membershipId: '26900002',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        phone: '+66887654321',
        tier: 'Platinum',
        currentPoints: 5000,
        totalNights: 50,
        joinedAt: new Date('2023-06-15').toISOString(),
      } as any);

      const response = await request(app)
        .get('/api/membership/lookup/26900002');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('userId');
      expect(response.body.data).toHaveProperty('membershipId');
      expect(response.body.data).toHaveProperty('firstName');
      expect(response.body.data).toHaveProperty('lastName');
      expect(response.body.data).toHaveProperty('email');
      expect(response.body.data).toHaveProperty('tier');
      expect(response.body.data).toHaveProperty('currentPoints');
      expect(response.body.data).toHaveProperty('totalNights');
    });
  });

  describe('GET /api/membership/stats (Admin)', () => {
    it('should get membership ID statistics', async () => {
      mockMembershipIdService.getMembershipIdStats.mockResolvedValue({
        totalUsers: 1500,
        usersWithMembershipId: 1450,
        usersWithoutMembershipId: 50,
        currentUserCount: 1451,
        currentBlock: 14,
        currentBlockRange: '1401-1500',
        blocksInUse: 15,
      });

      const response = await request(app)
        .get('/api/membership/stats');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.totalUsers).toBe(1500);
      expect(response.body.data.usersWithMembershipId).toBe(1450);
      expect(response.body.data.currentUserCount).toBe(1451);
    });

    it('should return block information', async () => {
      mockMembershipIdService.getMembershipIdStats.mockResolvedValue({
        totalUsers: 1000,
        usersWithMembershipId: 980,
        usersWithoutMembershipId: 20,
        currentUserCount: 981,
        currentBlock: 9,
        currentBlockRange: '901-1000',
        blocksInUse: 10,
      });

      const response = await request(app)
        .get('/api/membership/stats');

      expect(response.status).toBe(200);
      expect(response.body.data.currentBlock).toBe(9);
      expect(response.body.data.currentBlockRange).toBe('901-1000');
      expect(response.body.data.blocksInUse).toBe(10);
    });

    it('should return user count statistics', async () => {
      mockMembershipIdService.getMembershipIdStats.mockResolvedValue({
        totalUsers: 800,
        usersWithMembershipId: 790,
        usersWithoutMembershipId: 10,
        currentUserCount: 791,
        currentBlock: 7,
        currentBlockRange: '701-800',
        blocksInUse: 8,
      });

      const response = await request(app)
        .get('/api/membership/stats');

      expect(response.status).toBe(200);
      expect(response.body.data.totalUsers).toBe(800);
      expect(response.body.data.usersWithMembershipId).toBe(790);
      expect(response.body.data.usersWithoutMembershipId).toBe(10);
    });

    it('should handle errors in stats retrieval', async () => {
      mockMembershipIdService.getMembershipIdStats.mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .get('/api/membership/stats');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/membership/regenerate/:userId (Super Admin)', () => {
    it('should regenerate membership ID for user', async () => {
      mockMembershipIdService.regenerateMembershipId.mockResolvedValue('26900999');

      const response = await request(app)
        .post('/api/membership/regenerate/user-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.userId).toBe('user-123');
      expect(response.body.data.newMembershipId).toBe('26900999');
      expect(response.body.message).toBe('Membership ID regenerated successfully');
    });

    it('should return new membership ID in valid format', async () => {
      mockMembershipIdService.regenerateMembershipId.mockResolvedValue('26901234');

      const response = await request(app)
        .post('/api/membership/regenerate/user-456');

      expect(response.status).toBe(200);
      expect(response.body.data.newMembershipId).toMatch(/^269\d{5}$/);
    });

    it('should reject regeneration without user ID', async () => {
      const response = await request(app)
        .post('/api/membership/regenerate/');

      expect(response.status).toBe(404);
    });

    it('should handle user not found error', async () => {
      mockMembershipIdService.regenerateMembershipId.mockRejectedValue(
        new Error('User not found')
      );

      const response = await request(app)
        .post('/api/membership/regenerate/nonexistent-user');

      expect(response.status).toBe(500);
    });

    it('should handle sequence exhaustion error', async () => {
      mockMembershipIdService.regenerateMembershipId.mockRejectedValue(
        new Error('Membership ID sequence exhausted')
      );

      const response = await request(app)
        .post('/api/membership/regenerate/user-789');

      expect(response.status).toBe(500);
    });
  });

  describe('Error Handling', () => {
    it('should handle service unavailable errors gracefully', async () => {
      mockMembershipIdService.getMembershipIdByUserId.mockRejectedValue(
        new Error('Service temporarily unavailable')
      );

      const response = await request(app)
        .get('/api/membership/my-id');

      expect(response.status).toBe(500);
    });

    it('should handle database connection errors', async () => {
      mockMembershipIdService.getUserByMembershipId.mockRejectedValue(
        new Error('Database connection lost')
      );

      const response = await request(app)
        .get('/api/membership/lookup/26900001');

      expect(response.status).toBe(500);
    });
  });

  describe('Input Validation', () => {
    it('should validate membership ID format with correct length', async () => {
      const response = await request(app)
        .get('/api/membership/lookup/269000'); // 6 digits

      expect(response.status).toBe(400);
    });

    it('should validate membership ID starts with 269', async () => {
      const response = await request(app)
        .get('/api/membership/lookup/99900001');

      expect(response.status).toBe(400);
    });

    it('should reject non-numeric membership IDs', async () => {
      const response = await request(app)
        .get('/api/membership/lookup/269ABC01');

      expect(response.status).toBe(400);
    });

    it('should accept valid membership ID format', async () => {
      mockMembershipIdService.getUserByMembershipId.mockResolvedValue({
        userId: 'user-123',
        membershipId: '26900001',
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        tier: 'Bronze',
        currentPoints: 0,
        totalNights: 0,
      } as any);

      const response = await request(app)
        .get('/api/membership/lookup/26900001');

      expect(response.status).toBe(200);
    });
  });
});
