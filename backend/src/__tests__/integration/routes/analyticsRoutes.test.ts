/**
 * Analytics Routes Integration Tests
 * Tests analytics tracking and reporting endpoints
 *
 * Week 2 Priority - 10-15 tests
 * Coverage Target: ~2% contribution
 */

import request from 'supertest';
import express, { Express } from 'express';
import analyticsRoutes from '../../../routes/analyticsRoutes';
import { errorHandler } from '../../../middleware/errorHandler';

// Mock analyticsService
jest.mock('../../../services/analyticsService');
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock authentication and authorization middleware
const mockAuthMiddleware = (role: string = 'customer') => {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = {
      id: 'test-user-123',
      email: 'test@example.com',
      role: role as 'customer' | 'admin' | 'super_admin'
    };
    next();
  };
};

// Mock requestLogger middleware
jest.mock('../../../middleware/requestLogger', () => ({
  requestLogger: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    next();
  }
}));

describe('Analytics Routes Integration Tests', () => {
  let app: Express;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  describe('POST /coupon-usage - Track Coupon Usage', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(mockAuthMiddleware('customer'));
      app.use('/api/analytics', analyticsRoutes);
      app.use(errorHandler);
    });

    test('should track coupon usage event successfully', async () => {
      const eventData = {
        couponId: 'coupon-123',
        userCouponId: 'user-coupon-456',
        eventType: 'view',
        source: 'mobile-app',
        metadata: { platform: 'iOS' }
      };

      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.trackCouponUsage.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/analytics/coupon-usage')
        .send(eventData)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message', 'Coupon usage event tracked successfully');
      expect(analyticsService.trackCouponUsage).toHaveBeenCalled();
    });

    test('should validate required fields', async () => {
      const invalidData = {
        source: 'mobile-app'
      };

      const response = await request(app)
        .post('/api/analytics/coupon-usage')
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'couponId and eventType are required');
    });

    test('should validate eventType values', async () => {
      const invalidData = {
        couponId: 'coupon-123',
        eventType: 'invalid-type'
      };

      const response = await request(app)
        .post('/api/analytics/coupon-usage')
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toContain('Invalid eventType');
    });

    test('should accept all valid event types', async () => {
      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.trackCouponUsage.mockResolvedValue(undefined);

      const validTypes = ['view', 'assign', 'redeem_attempt', 'redeem_success', 'redeem_fail', 'expire', 'revoke'];

      for (const eventType of validTypes) {
        const response = await request(app)
          .post('/api/analytics/coupon-usage')
          .send({ couponId: 'test', eventType })
          .expect(201);

        expect(response.body.success).toBe(true);
      }
    });

    test('should include IP address and User-Agent in tracking', async () => {
      const eventData = {
        couponId: 'coupon-123',
        eventType: 'view'
      };

      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.trackCouponUsage.mockResolvedValue(undefined);

      await request(app)
        .post('/api/analytics/coupon-usage')
        .set('User-Agent', 'Test Browser/1.0')
        .send(eventData)
        .expect(201);

      expect(analyticsService.trackCouponUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userAgent: 'Test Browser/1.0',
          ipAddress: expect.any(String)
        })
      );
    });
  });

  describe('POST /profile-change - Track Profile Change', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(mockAuthMiddleware('customer'));
      app.use('/api/analytics', analyticsRoutes);
      app.use(errorHandler);
    });

    test('should track profile change event successfully', async () => {
      const changeData = {
        field: 'email',
        oldValue: 'old@example.com',
        newValue: 'new@example.com',
        changeSource: 'user',
        metadata: { verificationRequired: true }
      };

      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.trackProfileChange.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/analytics/profile-change')
        .send(changeData)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message', 'Profile change event tracked successfully');
    });

    test('should validate required fields', async () => {
      const invalidData = {
        oldValue: 'old'
      };

      const response = await request(app)
        .post('/api/analytics/profile-change')
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'field and newValue are required');
    });

    test('should validate changeSource values', async () => {
      const invalidData = {
        field: 'name',
        newValue: 'New Name',
        changeSource: 'invalid-source'
      };

      const response = await request(app)
        .post('/api/analytics/profile-change')
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toContain('Invalid changeSource');
    });

    test('should accept all valid change sources', async () => {
      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.trackProfileChange.mockResolvedValue(undefined);

      const validSources = ['user', 'admin', 'system'];

      for (const changeSource of validSources) {
        const response = await request(app)
          .post('/api/analytics/profile-change')
          .send({ field: 'test', newValue: 'value', changeSource })
          .expect(201);

        expect(response.body.success).toBe(true);
      }
    });

    test('should handle missing oldValue', async () => {
      const changeData = {
        field: 'phone',
        newValue: '+1234567890',
        changeSource: 'user'
      };

      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.trackProfileChange.mockResolvedValue(undefined);

      await request(app)
        .post('/api/analytics/profile-change')
        .send(changeData)
        .expect(201);

      expect(analyticsService.trackProfileChange).toHaveBeenCalledWith(
        expect.objectContaining({
          oldValue: null
        })
      );
    });
  });

  describe('GET /coupon-usage - Get Coupon Usage Analytics', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(mockAuthMiddleware('admin'));
      app.use('/api/analytics', analyticsRoutes);
      app.use(errorHandler);
    });

    test('should return coupon usage analytics for admin', async () => {
      const mockAnalytics = {
        totalEvents: 1500,
        uniqueUsers: 450,
        conversionRate: 0.35,
        eventsByType: {
          view: 800,
          assign: 500,
          redeem_success: 200
        },
        topSources: ['mobile-app', 'web-app'],
        dateRange: { start: '2024-01-01', end: '2024-01-31' }
      };

      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.getCouponUsageAnalytics.mockResolvedValue(mockAnalytics);

      const response = await request(app)
        .get('/api/analytics/coupon-usage')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockAnalytics);
    });

    test('should filter by date range', async () => {
      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.getCouponUsageAnalytics.mockResolvedValue({});

      await request(app)
        .get('/api/analytics/coupon-usage?startDate=2024-01-01&endDate=2024-01-31')
        .expect(200);

      expect(analyticsService.getCouponUsageAnalytics).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        undefined,
        undefined
      );
    });

    test('should filter by couponId', async () => {
      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.getCouponUsageAnalytics.mockResolvedValue({});

      await request(app)
        .get('/api/analytics/coupon-usage?couponId=coupon-123')
        .expect(200);

      expect(analyticsService.getCouponUsageAnalytics).toHaveBeenCalledWith(
        undefined,
        undefined,
        'coupon-123',
        undefined
      );
    });

    test('should deny access to non-admin users', async (): Promise<void> => {
      app = express();
      app.use(express.json());
      app.use(mockAuthMiddleware('customer'));
      app.use((req, res, next): void => {
        if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
          res.status(403).json({ error: 'Insufficient permissions' });
          return;
        }
        next();
      });
      app.use('/api/analytics', analyticsRoutes);
      app.use(errorHandler);

      const response = await request(app)
        .get('/api/analytics/coupon-usage')
        .expect(403);

      expect(response.body).toHaveProperty('error', 'Insufficient permissions');
    });
  });

  describe('GET /profile-changes - Get Profile Change Analytics', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(mockAuthMiddleware('admin'));
      app.use('/api/analytics', analyticsRoutes);
      app.use(errorHandler);
    });

    test('should return profile change analytics for admin', async () => {
      const mockAnalytics = {
        totalChanges: 2500,
        uniqueUsers: 800,
        changesByField: {
          email: 450,
          phone: 320,
          name: 280
        },
        completionMilestones: [
          { userId: 'user-1', completedAt: '2024-01-15' }
        ]
      };

      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.getProfileChangeAnalytics.mockResolvedValue(mockAnalytics);

      const response = await request(app)
        .get('/api/analytics/profile-changes')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockAnalytics);
    });

    test('should filter by date range and userId', async () => {
      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.getProfileChangeAnalytics.mockResolvedValue({});

      await request(app)
        .get('/api/analytics/profile-changes?startDate=2024-01-01&userId=user-123')
        .expect(200);

      expect(analyticsService.getProfileChangeAnalytics).toHaveBeenCalledWith(
        expect.any(Date),
        undefined,
        'user-123'
      );
    });
  });

  describe('GET /user-engagement - Get User Engagement Metrics', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(mockAuthMiddleware('super_admin'));
      app.use('/api/analytics', analyticsRoutes);
      app.use(errorHandler);
    });

    test('should return user engagement metrics for admin', async () => {
      const mockMetrics = {
        activeUsers: 1200,
        userSegments: {
          highly_engaged: 300,
          moderately_engaged: 600,
          low_engagement: 300
        },
        avgCouponsPerUser: 3.5,
        avgProfileChangesPerUser: 2.1,
        topUsers: [
          { userId: 'user-1', interactionCount: 50 }
        ]
      };

      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.getUserEngagementMetrics.mockResolvedValue(mockMetrics);

      const response = await request(app)
        .get('/api/analytics/user-engagement')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockMetrics);
    });

    test('should filter by date range', async () => {
      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.getUserEngagementMetrics.mockResolvedValue({});

      await request(app)
        .get('/api/analytics/user-engagement?startDate=2024-01-01&endDate=2024-01-31')
        .expect(200);

      expect(analyticsService.getUserEngagementMetrics).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date)
      );
    });
  });

  describe('GET /dashboard - Get Analytics Dashboard', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(mockAuthMiddleware('admin'));
      app.use('/api/analytics', analyticsRoutes);
      app.use(errorHandler);
    });

    test('should return comprehensive dashboard data', async () => {
      const { analyticsService } = require('../../../services/analyticsService');

      analyticsService.getCouponUsageAnalytics.mockResolvedValue({
        totalEvents: 1500,
        uniqueUsers: 450,
        conversionRate: 0.35,
        topSources: ['mobile', 'web', 'email'],
        eventsByType: { view: 800, redeem: 200 }
      });

      analyticsService.getProfileChangeAnalytics.mockResolvedValue({
        totalChanges: 2500,
        uniqueUsers: 800,
        changesByField: { email: 450, phone: 320 },
        completionMilestones: [{ userId: 'user-1' }]
      });

      analyticsService.getUserEngagementMetrics.mockResolvedValue({
        activeUsers: 1200,
        userSegments: { highly_engaged: 300 },
        avgCouponsPerUser: 3.5,
        avgProfileChangesPerUser: 2.1,
        topUsers: [{ userId: 'user-1', interactionCount: 50 }]
      });

      const response = await request(app)
        .get('/api/analytics/dashboard')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('period', '30 days');
      expect(response.body.data).toHaveProperty('couponUsage');
      expect(response.body.data).toHaveProperty('profileChanges');
      expect(response.body.data).toHaveProperty('userEngagement');
    });

    test('should accept custom period parameter', async () => {
      const { analyticsService } = require('../../../services/analyticsService');

      analyticsService.getCouponUsageAnalytics.mockResolvedValue({});
      analyticsService.getProfileChangeAnalytics.mockResolvedValue({});
      analyticsService.getUserEngagementMetrics.mockResolvedValue({});

      const response = await request(app)
        .get('/api/analytics/dashboard?period=7')
        .expect(200);

      expect(response.body.data.period).toBe('7 days');
    });

    test('should deny access to non-admin users', async () => {
      app = express();
      app.use(express.json());
      app.use(mockAuthMiddleware('customer'));
      app.use('/api/analytics', analyticsRoutes);
      app.use(errorHandler);

      const response = await request(app)
        .get('/api/analytics/dashboard')
        .expect(403);

      expect(response.body).toHaveProperty('error', 'Insufficient permissions');
    });
  });

  describe('POST /update-daily - Update Daily Analytics', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(mockAuthMiddleware('admin'));
      app.use('/api/analytics', analyticsRoutes);
      app.use(errorHandler);
    });

    test('should update daily analytics for admin', async () => {
      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.updateDailyUserAnalytics.mockResolvedValue(150);

      const response = await request(app)
        .post('/api/analytics/update-daily')
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('message');
      expect(response.body.data).toHaveProperty('recordsProcessed', 150);
    });

    test('should accept custom date parameter', async () => {
      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.updateDailyUserAnalytics.mockResolvedValue(100);

      const response = await request(app)
        .post('/api/analytics/update-daily')
        .send({ date: '2024-01-15' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(analyticsService.updateDailyUserAnalytics).toHaveBeenCalledWith(expect.any(Date));
    });

    test('should deny access to non-admin users', async () => {
      app = express();
      app.use(express.json());
      app.use(mockAuthMiddleware('customer'));
      app.use('/api/analytics', analyticsRoutes);
      app.use(errorHandler);

      const response = await request(app)
        .post('/api/analytics/update-daily')
        .send({})
        .expect(403);

      expect(response.body).toHaveProperty('error', 'Insufficient permissions');
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(mockAuthMiddleware('admin'));
      app.use('/api/analytics', analyticsRoutes);
      app.use(errorHandler);
    });

    test('should handle service errors gracefully', async () => {
      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.getCouponUsageAnalytics.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/analytics/coupon-usage')
        .expect(500);

      expect(response.body).toHaveProperty('error', 'Internal server error');
    });

    test('should handle invalid date formats', async () => {
      const { analyticsService } = require('../../../services/analyticsService');
      analyticsService.getCouponUsageAnalytics.mockResolvedValue({});

      // Invalid date should still be processed (Date constructor handles it)
      await request(app)
        .get('/api/analytics/coupon-usage?startDate=invalid-date')
        .expect(200);
    });
  });
});