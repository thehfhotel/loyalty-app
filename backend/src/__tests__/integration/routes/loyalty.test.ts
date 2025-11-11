/**
 * Loyalty Routes Integration Tests
 * Tests loyalty status, tiers, points transactions, and admin operations
 *
 * Week 1 Priority - 25-30 tests
 * Coverage Target: ~3% contribution
 */

import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import loyaltyRoutes from '../../../routes/loyalty';
import { errorHandler } from '../../../middleware/errorHandler';
import { LoyaltyController } from '../../../controllers/loyaltyController';

// Mock dependencies
jest.mock('../../../controllers/loyaltyController');

describe('Loyalty Routes Integration Tests', () => {
  let app: Express;
  let loyaltyController: jest.Mocked<LoyaltyController>;

  // Mock authenticate middleware
  const mockAuthenticate = (role: 'customer' | 'admin' | 'super_admin' = 'customer') => (
    req: Request,
    _res: Response,
    next: NextFunction
  ) => {
    req.user = {
      id: 'test-user-id',
      email: 'test@example.com',
      role: role,
    };
    next();
  };

  beforeAll(() => {
    // Create Express app with routes
    app = express();
    app.use(express.json());

    // Mock authentication middleware
    jest.mock('../../../middleware/auth', () => ({
      authenticate: mockAuthenticate('customer'),
    }));

    app.use('/api/loyalty', loyaltyRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    loyaltyController = new LoyaltyController() as jest.Mocked<LoyaltyController>;
    jest.clearAllMocks();
  });

  describe('GET /api/loyalty/tiers', () => {
    it('should get all loyalty tiers', async () => {
      const mockTiers = [
        { id: 'tier-1', name: 'Bronze', minPoints: 0, benefits: [] },
        { id: 'tier-2', name: 'Silver', minPoints: 1000, benefits: [] },
        { id: 'tier-3', name: 'Gold', minPoints: 5000, benefits: [] },
      ];

      loyaltyController.getTiers = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: mockTiers });
      }) as unknown as jest.Mocked<LoyaltyController>['getTiers'];

      const response = await request(app).get('/api/loyalty/tiers');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockTiers);
      expect(response.body.data).toHaveLength(3);
    });

    it('should handle errors when fetching tiers', async () => {
      loyaltyController.getTiers = jest.fn((
        _req: Request,
        _res: Response,
        next: NextFunction
      ) => {
        next(new Error('Failed to fetch tiers'));
      }) as unknown as jest.Mocked<LoyaltyController>['getTiers'];

      const response = await request(app).get('/api/loyalty/tiers');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/loyalty/status', () => {
    it('should get current user loyalty status', async () => {
      const mockStatus = {
        userId: 'test-user-id',
        currentPoints: 2500,
        tierName: 'Silver',
        nextTier: 'Gold',
        pointsToNextTier: 2500,
      };

      loyaltyController.getUserLoyaltyStatus = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: mockStatus });
      }) as unknown as jest.Mocked<LoyaltyController>['getUserLoyaltyStatus'];

      const response = await request(app).get('/api/loyalty/status');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockStatus);
      expect(response.body.data.currentPoints).toBe(2500);
    });

    it('should handle user with no loyalty data', async () => {
      loyaltyController.getUserLoyaltyStatus = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            userId: 'test-user-id',
            currentPoints: 0,
            tierName: 'Bronze',
            nextTier: 'Silver',
            pointsToNextTier: 1000,
          },
        });
      }) as unknown as jest.Mocked<LoyaltyController>['getUserLoyaltyStatus'];

      const response = await request(app).get('/api/loyalty/status');

      expect(response.status).toBe(200);
      expect(response.body.data.currentPoints).toBe(0);
      expect(response.body.data.tierName).toBe('Bronze');
    });
  });

  describe('GET /api/loyalty/points/calculation', () => {
    it('should get detailed points calculation', async () => {
      const mockCalculation = {
        totalPoints: 2500,
        activePoints: 2300,
        expiringPoints: 200,
        expirationDate: '2024-12-31',
        breakdown: {
          earned: 3000,
          redeemed: 500,
          expired: 0,
        },
      };

      loyaltyController.getPointsCalculation = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: mockCalculation });
      }) as unknown as jest.Mocked<LoyaltyController>['getPointsCalculation'];

      const response = await request(app).get('/api/loyalty/points/calculation');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockCalculation);
      expect(response.body.data.expiringPoints).toBe(200);
    });

    it('should show zero expiring points when none expire soon', async () => {
      loyaltyController.getPointsCalculation = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            totalPoints: 2500,
            activePoints: 2500,
            expiringPoints: 0,
            breakdown: { earned: 2500, redeemed: 0, expired: 0 },
          },
        });
      }) as unknown as jest.Mocked<LoyaltyController>['getPointsCalculation'];

      const response = await request(app).get('/api/loyalty/points/calculation');

      expect(response.status).toBe(200);
      expect(response.body.data.expiringPoints).toBe(0);
    });
  });

  describe('GET /api/loyalty/history', () => {
    it('should get points transaction history with default pagination', async () => {
      const mockHistory = [
        {
          id: 'txn-1',
          points: 500,
          type: 'earned_stay',
          description: 'Hotel stay',
          createdAt: '2024-01-15',
        },
        {
          id: 'txn-2',
          points: -200,
          type: 'redeemed_coupon',
          description: 'Coupon redemption',
          createdAt: '2024-01-10',
        },
      ];

      loyaltyController.getPointsHistory = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: mockHistory });
      }) as unknown as jest.Mocked<LoyaltyController>['getPointsHistory'];

      const response = await request(app).get('/api/loyalty/history');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].type).toBe('earned_stay');
    });

    it('should support custom pagination parameters', async () => {
      loyaltyController.getPointsHistory = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: [] });
      }) as unknown as jest.Mocked<LoyaltyController>['getPointsHistory'];

      const response = await request(app)
        .get('/api/loyalty/history')
        .query({ limit: 10, offset: 20 });

      expect(response.status).toBe(200);
    });

    it('should return empty array for user with no transactions', async () => {
      loyaltyController.getPointsHistory = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: [] });
      }) as unknown as jest.Mocked<LoyaltyController>['getPointsHistory'];

      const response = await request(app).get('/api/loyalty/history');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });

  describe('POST /api/loyalty/simulate-stay', () => {
    it('should simulate earning points for hotel stay', async () => {
      const mockResult = {
        pointsEarned: 500,
        newTotalPoints: 3000,
        tierAfterEarning: 'Silver',
      };

      loyaltyController.simulateStayEarning = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: mockResult });
      }) as unknown as jest.Mocked<LoyaltyController>['simulateStayEarning'];

      const response = await request(app)
        .post('/api/loyalty/simulate-stay')
        .send({
          amountSpent: 5000,
          stayId: 'stay-123',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.pointsEarned).toBe(500);
    });

    it('should simulate stay without optional stayId', async () => {
      loyaltyController.simulateStayEarning = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: { pointsEarned: 300, newTotalPoints: 2800 },
        });
      }) as unknown as jest.Mocked<LoyaltyController>['simulateStayEarning'];

      const response = await request(app)
        .post('/api/loyalty/simulate-stay')
        .send({
          amountSpent: 3000,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.pointsEarned).toBe(300);
    });

    it('should handle tier upgrade during simulation', async () => {
      loyaltyController.simulateStayEarning = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            pointsEarned: 2000,
            newTotalPoints: 5000,
            tierAfterEarning: 'Gold',
            tierUpgraded: true,
          },
        });
      }) as unknown as jest.Mocked<LoyaltyController>['simulateStayEarning'];

      const response = await request(app)
        .post('/api/loyalty/simulate-stay')
        .send({ amountSpent: 20000 });

      expect(response.status).toBe(200);
      expect(response.body.data.tierUpgraded).toBe(true);
      expect(response.body.data.tierAfterEarning).toBe('Gold');
    });
  });

  describe('Admin Routes - GET /api/loyalty/admin/users', () => {
    beforeEach(() => {
      // Mock admin authentication
      jest.doMock('../../../middleware/auth', () => ({
        authenticate: mockAuthenticate('admin'),
      }));
    });

    it('should get all users loyalty status for admin', async () => {
      const mockUsers = [
        { userId: 'user-1', currentPoints: 1000, tierName: 'Bronze' },
        { userId: 'user-2', currentPoints: 3000, tierName: 'Silver' },
      ];

      loyaltyController.getAllUsersLoyaltyStatus = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: mockUsers });
      }) as unknown as jest.Mocked<LoyaltyController>['getAllUsersLoyaltyStatus'];

      const response = await request(app).get('/api/loyalty/admin/users');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });

    it('should support pagination for admin user list', async () => {
      loyaltyController.getAllUsersLoyaltyStatus = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: [] });
      }) as unknown as jest.Mocked<LoyaltyController>['getAllUsersLoyaltyStatus'];

      const response = await request(app)
        .get('/api/loyalty/admin/users')
        .query({ limit: 20, offset: 40 });

      expect(response.status).toBe(200);
    });

    it('should support search for admin user list', async () => {
      loyaltyController.getAllUsersLoyaltyStatus = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: [{ userId: 'user-1', email: 'search@example.com' }],
        });
      }) as unknown as jest.Mocked<LoyaltyController>['getAllUsersLoyaltyStatus'];

      const response = await request(app)
        .get('/api/loyalty/admin/users')
        .query({ search: 'search@example' });

      expect(response.status).toBe(200);
      expect(response.body.data[0].email).toContain('search@example');
    });
  });

  describe('Admin Routes - POST /api/loyalty/admin/award-points', () => {
    it('should award points to user as admin', async () => {
      loyaltyController.awardPoints = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          message: 'Points awarded successfully',
          data: { newTotalPoints: 3500 },
        });
      }) as unknown as jest.Mocked<LoyaltyController>['awardPoints'];

      const response = await request(app)
        .post('/api/loyalty/admin/award-points')
        .send({
          userId: 'user-123',
          points: 500,
          description: 'Bonus points',
          referenceId: 'bonus-001',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.newTotalPoints).toBe(3500);
    });

    it('should award points without optional fields', async () => {
      loyaltyController.awardPoints = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: { newTotalPoints: 1500 } });
      }) as unknown as jest.Mocked<LoyaltyController>['awardPoints'];

      const response = await request(app)
        .post('/api/loyalty/admin/award-points')
        .send({
          userId: 'user-123',
          points: 500,
        });

      expect(response.status).toBe(200);
    });

    it('should handle user not found when awarding points', async () => {
      loyaltyController.awardPoints = jest.fn((
        _req: Request,
        _res: Response,
        next: NextFunction
      ) => {
        next(new Error('User not found'));
      }) as unknown as jest.Mocked<LoyaltyController>['awardPoints'];

      const response = await request(app)
        .post('/api/loyalty/admin/award-points')
        .send({
          userId: 'nonexistent',
          points: 500,
        });

      expect(response.status).toBe(500);
    });
  });

  describe('Admin Routes - POST /api/loyalty/admin/deduct-points', () => {
    it('should deduct points from user as admin', async () => {
      loyaltyController.deductPoints = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          message: 'Points deducted successfully',
          data: { newTotalPoints: 2500 },
        });
      }) as unknown as jest.Mocked<LoyaltyController>['deductPoints'];

      const response = await request(app)
        .post('/api/loyalty/admin/deduct-points')
        .send({
          userId: 'user-123',
          points: 500,
          reason: 'Refund',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.newTotalPoints).toBe(2500);
    });

    it('should prevent deducting more points than user has', async () => {
      loyaltyController.deductPoints = jest.fn((
        _req: Request,
        _res: Response,
        next: NextFunction
      ) => {
        next(new Error('Insufficient points'));
      }) as unknown as jest.Mocked<LoyaltyController>['deductPoints'];

      const response = await request(app)
        .post('/api/loyalty/admin/deduct-points')
        .send({
          userId: 'user-123',
          points: 10000,
          reason: 'Refund',
        });

      expect(response.status).toBe(500);
    });
  });

  describe('Admin Routes - GET /api/loyalty/admin/user/:userId/history', () => {
    it('should get specific user points history as admin', async () => {
      const mockHistory = [
        { id: 'txn-1', points: 500, type: 'earned_stay' },
        { id: 'txn-2', points: -200, type: 'redeemed_coupon' },
      ];

      loyaltyController.getUserPointsHistoryAdmin = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: mockHistory });
      }) as unknown as jest.Mocked<LoyaltyController>['getUserPointsHistoryAdmin'];

      const response = await request(app).get(
        '/api/loyalty/admin/user/user-123/history'
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });

    it('should support pagination for user history', async () => {
      loyaltyController.getUserPointsHistoryAdmin = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: [] });
      }) as unknown as jest.Mocked<LoyaltyController>['getUserPointsHistoryAdmin'];

      const response = await request(app)
        .get('/api/loyalty/admin/user/user-123/history')
        .query({ limit: 10, offset: 20 });

      expect(response.status).toBe(200);
    });
  });

  describe('Admin Routes - GET /api/loyalty/admin/earning-rules', () => {
    it('should get points earning rules as admin', async () => {
      const mockRules = {
        stayPointsPerThb: 10,
        bonusMultiplier: 1.5,
        tierBonuses: {
          Bronze: 1.0,
          Silver: 1.2,
          Gold: 1.5,
        },
      };

      loyaltyController.getEarningRules = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: mockRules });
      }) as unknown as jest.Mocked<LoyaltyController>['getEarningRules'];

      const response = await request(app).get('/api/loyalty/admin/earning-rules');

      expect(response.status).toBe(200);
      expect(response.body.data.stayPointsPerThb).toBe(10);
      expect(response.body.data.tierBonuses).toBeDefined();
    });
  });

  describe('Admin Routes - POST /api/loyalty/admin/expire-points', () => {
    it('should manually trigger points expiration as admin', async () => {
      loyaltyController.expirePoints = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          message: 'Points expiration completed',
          data: {
            usersProcessed: 50,
            pointsExpired: 10000,
          },
        });
      }) as unknown as jest.Mocked<LoyaltyController>['expirePoints'];

      const response = await request(app).post('/api/loyalty/admin/expire-points');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.usersProcessed).toBe(50);
    });

    it('should handle no points to expire', async () => {
      loyaltyController.expirePoints = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            usersProcessed: 0,
            pointsExpired: 0,
          },
        });
      }) as unknown as jest.Mocked<LoyaltyController>['expirePoints'];

      const response = await request(app).post('/api/loyalty/admin/expire-points');

      expect(response.status).toBe(200);
      expect(response.body.data.pointsExpired).toBe(0);
    });
  });

  describe('Admin Routes - POST /api/loyalty/admin/award-spending-with-nights', () => {
    it('should award spending points with nights stayed', async () => {
      const mockResult = {
        transactionId: 'txn-123',
        pointsEarned: 500,
        newTotalNights: 15,
        newTierName: 'Silver',
        loyaltyStatus: {
          currentPoints: 3500,
          tierName: 'Silver',
        },
      };

      loyaltyController.awardSpendingWithNights = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({ success: true, data: mockResult });
      }) as unknown as jest.Mocked<LoyaltyController>['awardSpendingWithNights'];

      const response = await request(app)
        .post('/api/loyalty/admin/award-spending-with-nights')
        .send({
          userId: 'user-123',
          amountSpent: 5000,
          nightsStayed: 3,
          referenceId: 'stay-001',
          description: 'Weekend stay',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.pointsEarned).toBe(500);
      expect(response.body.data.newTotalNights).toBe(15);
    });

    it('should award spending without nights stayed', async () => {
      loyaltyController.awardSpendingWithNights = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            transactionId: 'txn-124',
            pointsEarned: 300,
            newTotalNights: 12,
          },
        });
      }) as unknown as jest.Mocked<LoyaltyController>['awardSpendingWithNights'];

      const response = await request(app)
        .post('/api/loyalty/admin/award-spending-with-nights')
        .send({
          userId: 'user-123',
          amountSpent: 3000,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.pointsEarned).toBe(300);
    });

    it('should handle tier upgrade from spending with nights', async () => {
      loyaltyController.awardSpendingWithNights = jest.fn((
        _req: Request,
        res: Response
      ) => {
        res.json({
          success: true,
          data: {
            transactionId: 'txn-125',
            pointsEarned: 2000,
            newTotalNights: 20,
            newTierName: 'Gold',
            tierUpgraded: true,
          },
        });
      }) as unknown as jest.Mocked<LoyaltyController>['awardSpendingWithNights'];

      const response = await request(app)
        .post('/api/loyalty/admin/award-spending-with-nights')
        .send({
          userId: 'user-123',
          amountSpent: 20000,
          nightsStayed: 7,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.tierUpgraded).toBe(true);
      expect(response.body.data.newTierName).toBe('Gold');
    });
  });
});
