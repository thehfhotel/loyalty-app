/**
 * Analytics Routes Integration Tests
 * Tests analytics tracking, retrieval, and dashboard functionality
 *
 * Following service-based mocking pattern from notifications.test.ts
 * Coverage Target: Comprehensive route testing
 */

import request from 'supertest';
import { Express, Request, Response, NextFunction } from 'express';
import routes from '../../../routes/analyticsRoutes';
import { createTestApp } from '../../fixtures';
import { TestUser, TestRequest, TestMiddlewareFunction } from '../../utils/testTypes';

// Mock dependencies - Service-based mocking
jest.mock('../../../services/analyticsService', () => ({
  analyticsService: {
    trackCouponUsage: jest.fn(),
    trackProfileChange: jest.fn(),
    getCouponUsageAnalytics: jest.fn(),
    getProfileChangeAnalytics: jest.fn(),
    getUserEngagementMetrics: jest.fn(),
    updateDailyUserAnalytics: jest.fn(),
  },
}));

// Create a mutable auth implementation
let currentUser: TestUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  role: 'customer',
};

jest.mock('../../../middleware/auth', () => ({
  authenticate: (req: TestRequest, _res: Response, next: NextFunction) => {
    req.user = { ...currentUser };
    next();
  },
  authorize: (...roles: string[]): TestMiddlewareFunction =>
    (req: TestRequest, res: Response, next: NextFunction) => {
      // Check if user role matches authorized roles
      if (req.user && roles.includes(req.user.role)) {
        next();
      } else {
        res.status(403).json({ error: 'Forbidden' });
      }
    },
}));

jest.mock('../../../middleware/requestLogger', () => ({
  requestLogger: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Import mocked service
import { analyticsService } from '../../../services/analyticsService';

describe('Analytics Routes Integration Tests', () => {
  let app: Express;
  const mockAnalyticsService = analyticsService as jest.Mocked<typeof analyticsService>;

  beforeAll(() => {
    app = createTestApp(routes, '/api/analytics');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/analytics/coupon-usage (authenticated)', () => {
    it('should track coupon usage event', async () => {
      mockAnalyticsService.trackCouponUsage.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/analytics/coupon-usage')
        .send({
          couponId: 'coupon-123',
          userCouponId: 'uc-456',
          eventType: 'redeem_success',
          source: 'mobile_app',
          metadata: { deviceType: 'iOS' },
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        success: true,
        message: 'Coupon usage event tracked successfully',
      });
      expect(mockAnalyticsService.trackCouponUsage).toHaveBeenCalled();
    });

    it('should return 400 when couponId is missing', async () => {
      const response = await request(app)
        .post('/api/analytics/coupon-usage')
        .send({
          eventType: 'view',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('couponId and eventType are required');
    });

    it('should return 400 when eventType is missing', async () => {
      const response = await request(app)
        .post('/api/analytics/coupon-usage')
        .send({
          couponId: 'coupon-123',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('couponId and eventType are required');
    });

    it('should return 400 for invalid eventType', async () => {
      const response = await request(app)
        .post('/api/analytics/coupon-usage')
        .send({
          couponId: 'coupon-123',
          eventType: 'invalid_event',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid eventType');
    });

    it('should accept all valid event types', async () => {
      const validEvents = ['view', 'assign', 'redeem_attempt', 'redeem_success', 'redeem_fail', 'expire', 'revoke'];
      mockAnalyticsService.trackCouponUsage.mockResolvedValue(undefined);

      for (const eventType of validEvents) {
        const response = await request(app)
          .post('/api/analytics/coupon-usage')
          .send({
            couponId: 'coupon-123',
            eventType,
          });

        expect(response.status).toBe(201);
      }
    });

    it('should handle service errors', async () => {
      mockAnalyticsService.trackCouponUsage.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/analytics/coupon-usage')
        .send({
          couponId: 'coupon-123',
          eventType: 'view',
        });

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/analytics/profile-change (authenticated)', () => {
    it('should track profile change event', async () => {
      mockAnalyticsService.trackProfileChange.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/analytics/profile-change')
        .send({
          field: 'email',
          oldValue: 'old@example.com',
          newValue: 'new@example.com',
          changeSource: 'user',
          metadata: { reason: 'user_request' },
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        success: true,
        message: 'Profile change event tracked successfully',
      });
      expect(mockAnalyticsService.trackProfileChange).toHaveBeenCalled();
    });

    it('should return 400 when field is missing', async () => {
      const response = await request(app)
        .post('/api/analytics/profile-change')
        .send({
          newValue: 'value',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('field and newValue are required');
    });

    it('should return 400 when newValue is missing', async () => {
      const response = await request(app)
        .post('/api/analytics/profile-change')
        .send({
          field: 'email',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('field and newValue are required');
    });

    it('should return 400 for invalid changeSource', async () => {
      const response = await request(app)
        .post('/api/analytics/profile-change')
        .send({
          field: 'email',
          newValue: 'new@example.com',
          changeSource: 'invalid_source',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid changeSource');
    });

    it('should accept all valid change sources', async () => {
      const validSources = ['user', 'admin', 'system'];
      mockAnalyticsService.trackProfileChange.mockResolvedValue(undefined);

      for (const changeSource of validSources) {
        const response = await request(app)
          .post('/api/analytics/profile-change')
          .send({
            field: 'email',
            newValue: 'new@example.com',
            changeSource,
          });

        expect(response.status).toBe(201);
      }
    });

    it('should default changeSource to user if not provided', async () => {
      mockAnalyticsService.trackProfileChange.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/analytics/profile-change')
        .send({
          field: 'email',
          newValue: 'new@example.com',
        });

      expect(response.status).toBe(201);
    });

    it('should handle service errors', async () => {
      mockAnalyticsService.trackProfileChange.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/analytics/profile-change')
        .send({
          field: 'email',
          newValue: 'new@example.com',
        });

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/analytics/coupon-usage (admin)', () => {
    beforeEach(() => {
      // Set admin user for these tests
      currentUser = {
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin',
      };
    });

    afterEach(() => {
      // Reset to customer user
      currentUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'customer',
      };
    });

    it('should return coupon usage analytics', async () => {
      const mockAnalytics = {
        totalEvents: 150,
        uniqueUsers: 75,
        conversionRate: 0.45,
        eventsByType: {
          view: 50,
          redeem_success: 40,
          redeem_fail: 10,
        },
        topSources: [
          { source: 'mobile_app', count: 80 },
          { source: 'web', count: 70 },
        ],
      };

      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue(mockAnalytics as any);

      const response = await request(app).get('/api/analytics/coupon-usage');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: mockAnalytics,
      });
      expect(mockAnalyticsService.getCouponUsageAnalytics).toHaveBeenCalled();
    });

    it('should accept query parameters for filtering', async () => {
      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue({} as any);

      const response = await request(app)
        .get('/api/analytics/coupon-usage')
        .query({
          startDate: '2025-01-01',
          endDate: '2025-01-31',
          couponId: 'coupon-123',
          userId: 'user-456',
        });

      expect(response.status).toBe(200);
      expect(mockAnalyticsService.getCouponUsageAnalytics).toHaveBeenCalled();
    });

    it('should handle service errors', async () => {
      mockAnalyticsService.getCouponUsageAnalytics.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/analytics/coupon-usage');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/analytics/profile-changes (admin)', () => {
    beforeEach(() => {
      // Set admin user for these tests
      currentUser = {
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin',
      };
    });

    afterEach(() => {
      // Reset to customer user
      currentUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'customer',
      };
    });

    it('should return profile change analytics', async () => {
      const testDate = new Date('2025-01-01T00:00:00.000Z');
      const mockAnalytics = {
        totalChanges: 250,
        uniqueUsers: 120,
        changesByField: {
          email: 80,
          phone: 70,
          address: 50,
        },
        completionMilestones: [
          { userId: 'user-1', completedAt: testDate },
        ],
      };

      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue(mockAnalytics as any);

      const response = await request(app).get('/api/analytics/profile-changes');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.totalChanges).toBe(250);
      expect(response.body.data.uniqueUsers).toBe(120);
      expect(response.body.data.completionMilestones[0].userId).toBe('user-1');
      expect(mockAnalyticsService.getProfileChangeAnalytics).toHaveBeenCalled();
    });

    it('should accept query parameters for filtering', async () => {
      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue({} as any);

      const response = await request(app)
        .get('/api/analytics/profile-changes')
        .query({
          startDate: '2025-01-01',
          endDate: '2025-01-31',
          userId: 'user-123',
        });

      expect(response.status).toBe(200);
      expect(mockAnalyticsService.getProfileChangeAnalytics).toHaveBeenCalled();
    });

    it('should handle service errors', async () => {
      mockAnalyticsService.getProfileChangeAnalytics.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/analytics/profile-changes');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/analytics/user-engagement (admin)', () => {
    beforeEach(() => {
      // Set admin user for these tests
      currentUser = {
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin',
      };
    });

    afterEach(() => {
      // Reset to customer user
      currentUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'customer',
      };
    });

    it('should return user engagement metrics', async () => {
      const mockMetrics = {
        activeUsers: 500,
        userSegments: {
          high: 50,
          medium: 200,
          low: 250,
        },
        avgCouponsPerUser: 3.5,
        avgProfileChangesPerUser: 2.1,
        topUsers: [
          { userId: 'user-1', score: 100 },
          { userId: 'user-2', score: 95 },
        ],
      };

      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue(mockMetrics as any);

      const response = await request(app).get('/api/analytics/user-engagement');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: mockMetrics,
      });
      expect(mockAnalyticsService.getUserEngagementMetrics).toHaveBeenCalled();
    });

    it('should accept date range parameters', async () => {
      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue({} as any);

      const response = await request(app)
        .get('/api/analytics/user-engagement')
        .query({
          startDate: '2025-01-01',
          endDate: '2025-01-31',
        });

      expect(response.status).toBe(200);
      expect(mockAnalyticsService.getUserEngagementMetrics).toHaveBeenCalled();
    });

    it('should handle service errors', async () => {
      mockAnalyticsService.getUserEngagementMetrics.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/analytics/user-engagement');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/analytics/update-daily (admin)', () => {
    beforeEach(() => {
      // Set admin user for these tests
      currentUser = {
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin',
      };
    });

    afterEach(() => {
      // Reset to customer user
      currentUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'customer',
      };
    });

    it('should update daily analytics', async () => {
      mockAnalyticsService.updateDailyUserAnalytics.mockResolvedValue(150);

      const response = await request(app)
        .post('/api/analytics/update-daily')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Daily analytics updated successfully');
      expect(response.body.data.recordsProcessed).toBe(150);
      expect(mockAnalyticsService.updateDailyUserAnalytics).toHaveBeenCalled();
    });

    it('should accept specific date for update', async () => {
      mockAnalyticsService.updateDailyUserAnalytics.mockResolvedValue(100);

      const response = await request(app)
        .post('/api/analytics/update-daily')
        .send({
          date: '2025-01-15',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.recordsProcessed).toBe(100);
    });

    it('should handle service errors', async () => {
      mockAnalyticsService.updateDailyUserAnalytics.mockRejectedValue(new Error('Update failed'));

      const response = await request(app)
        .post('/api/analytics/update-daily')
        .send({});

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/analytics/dashboard (admin)', () => {
    beforeEach(() => {
      // Set admin user for these tests
      currentUser = {
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin',
      };
    });

    afterEach(() => {
      // Reset to customer user
      currentUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'customer',
      };
    });

    it('should return analytics dashboard', async () => {
      const mockCouponAnalytics = {
        totalEvents: 1000,
        uniqueUsers: 500,
        conversionRate: 0.6,
        eventsByType: {
          view: 400,
          redeem_success: 300,
        },
        topSources: [
          { source: 'mobile_app', count: 600 },
          { source: 'web', count: 400 },
        ],
      };

      const mockProfileAnalytics = {
        totalChanges: 800,
        uniqueUsers: 400,
        changesByField: {
          email: 300,
          phone: 250,
          address: 200,
        },
        completionMilestones: [],
      };

      const mockEngagementMetrics = {
        activeUsers: 500,
        userSegments: {
          high: 50,
          medium: 200,
          low: 250,
        },
        avgCouponsPerUser: 4.2,
        avgProfileChangesPerUser: 2.8,
        topUsers: [],
      };

      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue(mockCouponAnalytics as any);
      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue(mockProfileAnalytics as any);
      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue(mockEngagementMetrics as any);

      const response = await request(app).get('/api/analytics/dashboard');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('period');
      expect(response.body.data).toHaveProperty('couponUsage');
      expect(response.body.data).toHaveProperty('profileChanges');
      expect(response.body.data).toHaveProperty('userEngagement');
      expect(response.body.data.couponUsage.totalEvents).toBe(1000);
      expect(response.body.data.profileChanges.totalChanges).toBe(800);
      expect(response.body.data.userEngagement.activeUsers).toBe(500);
    });

    it('should accept custom period parameter', async () => {
      const mockCouponAnalytics = {
        totalEvents: 100,
        uniqueUsers: 50,
        conversionRate: 0.5,
        topSources: [],
        eventsByType: {},
      };

      const mockProfileAnalytics = {
        totalChanges: 100,
        uniqueUsers: 50,
        changesByField: {},
        completionMilestones: [],
      };

      const mockEngagementMetrics = {
        activeUsers: 50,
        userSegments: {},
        avgCouponsPerUser: 2,
        avgProfileChangesPerUser: 1,
        topUsers: [],
      };

      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue(mockCouponAnalytics as any);
      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue(mockProfileAnalytics as any);
      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue(mockEngagementMetrics as any);

      const response = await request(app)
        .get('/api/analytics/dashboard')
        .query({ period: '60' });

      expect(response.status).toBe(200);
      expect(response.body.data.period).toBe('60 days');
    });

    it('should handle service errors', async () => {
      mockAnalyticsService.getCouponUsageAnalytics.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/analytics/dashboard');

      expect(response.status).toBe(500);
    });
  });

  describe('Authorization', () => {
    beforeEach(() => {
      // Reset to customer user for these tests
      currentUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'customer',
      };
    });

    it('should deny customer access to admin GET endpoints', async () => {
      const adminEndpoints = [
        '/api/analytics/coupon-usage',
        '/api/analytics/profile-changes',
        '/api/analytics/user-engagement',
        '/api/analytics/dashboard',
      ];

      for (const endpoint of adminEndpoints) {
        const response = await request(app).get(endpoint);
        expect(response.status).toBe(403);
        expect(response.body.error).toBe('Forbidden');
      }
    });

    it('should deny customer access to admin POST endpoints', async () => {
      const response = await request(app)
        .post('/api/analytics/update-daily')
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Forbidden');
    });

    it('should allow customer access to tracking endpoints', async () => {
      mockAnalyticsService.trackCouponUsage.mockResolvedValue(undefined);
      mockAnalyticsService.trackProfileChange.mockResolvedValue(undefined);

      const couponResponse = await request(app)
        .post('/api/analytics/coupon-usage')
        .send({
          couponId: 'coupon-123',
          eventType: 'view',
        });

      const profileResponse = await request(app)
        .post('/api/analytics/profile-change')
        .send({
          field: 'email',
          newValue: 'new@example.com',
        });

      expect(couponResponse.status).toBe(201);
      expect(profileResponse.status).toBe(201);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/analytics/coupon-usage')
        .set('Content-Type', 'application/json')
        .send('{invalid: json}');

      expect(response.status).toBe(400);
    });
  });
});
