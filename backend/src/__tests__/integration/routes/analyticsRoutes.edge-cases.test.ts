/**
 * Analytics Routes Edge Cases Integration Tests
 * Tests edge cases for analytics endpoints including date validation,
 * large data sets, concurrent operations, partial failures, and authorization
 *
 * Coverage Target: Edge case scenarios not covered in main test suite
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test file uses any for mock data coercion */

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

describe('Analytics Routes Edge Cases Integration Tests', () => {
  let app: Express;
  const mockAnalyticsService = analyticsService as jest.Mocked<typeof analyticsService>;

  beforeAll(() => {
    app = createTestApp(routes, '/api/analytics');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to customer user by default
    currentUser = {
      id: 'test-user-id',
      email: 'test@example.com',
      role: 'customer',
    };
  });

  describe('Date Range Filtering Edge Cases', () => {
    beforeEach(() => {
      currentUser = {
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin',
      };
    });

    it('should handle invalid date format', async () => {
      mockAnalyticsService.getCouponUsageAnalytics.mockRejectedValue(
        new Error('Invalid date format')
      );

      const response = await request(app)
        .get('/api/analytics/coupon-usage')
        .query({
          startDate: 'not-a-date',
          endDate: '2025-01-31',
        });

      expect(response.status).toBe(500);
    });

    it('should handle future dates', async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue({
        totalEvents: 0,
        uniqueUsers: 0,
        conversionRate: 0,
        eventsByType: {},
        topSources: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/coupon-usage')
        .query({
          startDate: futureDate.toISOString(),
          endDate: futureDate.toISOString(),
        });

      expect(response.status).toBe(200);
      expect(response.body.data.totalEvents).toBe(0);
    });

    it('should handle startDate after endDate', async () => {
      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue({
        totalEvents: 0,
        uniqueUsers: 0,
        conversionRate: 0,
        eventsByType: {},
        topSources: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/coupon-usage')
        .query({
          startDate: '2025-12-31',
          endDate: '2025-01-01',
        });

      expect(response.status).toBe(200);
      // Service should handle logic validation
    });

    it('should handle very old dates (year 1970)', async () => {
      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue({
        totalChanges: 0,
        uniqueUsers: 0,
        changesByField: {},
        completionMilestones: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/profile-changes')
        .query({
          startDate: '1970-01-01',
          endDate: '1970-12-31',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.totalChanges).toBe(0);
    });

    it('should handle date with timezone information', async () => {
      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue({
        activeUsers: 100,
        userSegments: {},
        avgCouponsPerUser: 2,
        avgProfileChangesPerUser: 1,
        topUsers: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/user-engagement')
        .query({
          startDate: '2025-01-01T00:00:00.000Z',
          endDate: '2025-01-31T23:59:59.999Z',
        });

      expect(response.status).toBe(200);
      expect(mockAnalyticsService.getUserEngagementMetrics).toHaveBeenCalled();
    });

    it('should handle missing endDate with only startDate', async () => {
      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue({
        totalEvents: 50,
        uniqueUsers: 25,
        conversionRate: 0.5,
        eventsByType: {},
        topSources: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/coupon-usage')
        .query({
          startDate: '2025-01-01',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.totalEvents).toBe(50);
    });
  });

  describe('Large Data Set Handling', () => {
    beforeEach(() => {
      currentUser = {
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin',
      };
    });

    it('should handle large number of events in coupon analytics', async () => {
      const largeEventsByType: Record<string, number> = {};
      for (let i = 0; i < 1000; i++) {
        largeEventsByType[`event-${i}`] = Math.floor(Math.random() * 10000);
      }

      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue({
        totalEvents: 5000000,
        uniqueUsers: 250000,
        conversionRate: 0.45,
        eventsByType: largeEventsByType,
        topSources: Array(100).fill(null).map((_, i) => ({
          source: `source-${i}`,
          count: Math.floor(Math.random() * 50000),
        })),
      } as any);

      const response = await request(app)
        .get('/api/analytics/coupon-usage');

      expect(response.status).toBe(200);
      expect(response.body.data.totalEvents).toBe(5000000);
      expect(Object.keys(response.body.data.eventsByType).length).toBe(1000);
    });

    it('should handle large number of profile changes', async () => {
      const largeChangesByField: Record<string, number> = {};
      for (let i = 0; i < 500; i++) {
        largeChangesByField[`field-${i}`] = Math.floor(Math.random() * 1000);
      }

      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue({
        totalChanges: 1000000,
        uniqueUsers: 50000,
        changesByField: largeChangesByField,
        completionMilestones: Array(10000).fill(null).map((_, i) => ({
          userId: `user-${i}`,
          completedAt: new Date(),
        })),
      } as any);

      const response = await request(app)
        .get('/api/analytics/profile-changes');

      expect(response.status).toBe(200);
      expect(response.body.data.totalChanges).toBe(1000000);
      expect(Object.keys(response.body.data.changesByField).length).toBe(500);
    });

    it('should handle large topUsers array in engagement metrics', async () => {
      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue({
        activeUsers: 100000,
        userSegments: {
          high: 10000,
          medium: 50000,
          low: 40000,
        },
        avgCouponsPerUser: 4.5,
        avgProfileChangesPerUser: 2.3,
        topUsers: Array(5000).fill(null).map((_, i) => ({
          userId: `user-${i}`,
          score: 100 - i * 0.02,
        })),
      } as any);

      const response = await request(app)
        .get('/api/analytics/user-engagement');

      expect(response.status).toBe(200);
      expect(response.body.data.activeUsers).toBe(100000);
      expect(response.body.data.topUsers.length).toBe(5000);
    });
  });

  describe('Concurrent Tracking Events', () => {
    it('should handle multiple concurrent coupon tracking requests', async () => {
      mockAnalyticsService.trackCouponUsage.mockResolvedValue(undefined);

      const requests = Array(10).fill(null).map((_, i) =>
        request(app)
          .post('/api/analytics/coupon-usage')
          .send({
            couponId: `coupon-${i}`,
            eventType: 'view',
            source: 'mobile_app',
          })
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      expect(mockAnalyticsService.trackCouponUsage).toHaveBeenCalledTimes(10);
    });

    it('should handle multiple concurrent profile change tracking requests', async () => {
      mockAnalyticsService.trackProfileChange.mockResolvedValue(undefined);

      const requests = Array(10).fill(null).map((_, i) =>
        request(app)
          .post('/api/analytics/profile-change')
          .send({
            field: `field-${i}`,
            newValue: `value-${i}`,
            changeSource: 'user',
          })
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      expect(mockAnalyticsService.trackProfileChange).toHaveBeenCalledTimes(10);
    });

    it('should handle race condition with same coupon tracking', async () => {
      mockAnalyticsService.trackCouponUsage.mockResolvedValue(undefined);

      const sameCouponRequests = Array(5).fill(null).map(() =>
        request(app)
          .post('/api/analytics/coupon-usage')
          .send({
            couponId: 'same-coupon-123',
            eventType: 'view',
          })
      );

      const responses = await Promise.all(sameCouponRequests);

      responses.forEach(response => {
        expect(response.status).toBe(201);
      });

      expect(mockAnalyticsService.trackCouponUsage).toHaveBeenCalledTimes(5);
    });
  });

  describe('Dashboard with Partial Data Failures', () => {
    beforeEach(() => {
      currentUser = {
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin',
      };
    });

    it('should fail entire dashboard if coupon analytics fails', async () => {
      mockAnalyticsService.getCouponUsageAnalytics.mockRejectedValue(
        new Error('Database connection error')
      );
      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue({
        totalChanges: 100,
        uniqueUsers: 50,
        changesByField: {},
        completionMilestones: [],
      } as any);
      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue({
        activeUsers: 50,
        userSegments: {},
        avgCouponsPerUser: 2,
        avgProfileChangesPerUser: 1,
        topUsers: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/dashboard');

      expect(response.status).toBe(500);
    });

    it('should fail entire dashboard if profile analytics fails', async () => {
      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue({
        totalEvents: 100,
        uniqueUsers: 50,
        conversionRate: 0.5,
        eventsByType: {},
        topSources: [],
      } as any);
      mockAnalyticsService.getProfileChangeAnalytics.mockRejectedValue(
        new Error('Query timeout')
      );
      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue({
        activeUsers: 50,
        userSegments: {},
        avgCouponsPerUser: 2,
        avgProfileChangesPerUser: 1,
        topUsers: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/dashboard');

      expect(response.status).toBe(500);
    });

    it('should fail entire dashboard if engagement metrics fails', async () => {
      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue({
        totalEvents: 100,
        uniqueUsers: 50,
        conversionRate: 0.5,
        eventsByType: {},
        topSources: [],
      } as any);
      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue({
        totalChanges: 100,
        uniqueUsers: 50,
        changesByField: {},
        completionMilestones: [],
      } as any);
      mockAnalyticsService.getUserEngagementMetrics.mockRejectedValue(
        new Error('Service unavailable')
      );

      const response = await request(app)
        .get('/api/analytics/dashboard');

      expect(response.status).toBe(500);
    });
  });

  describe('Super Admin Role Authorization', () => {
    it('should allow super_admin access to coupon usage analytics', async () => {
      currentUser = {
        id: 'super-admin-id',
        email: 'superadmin@example.com',
        role: 'super_admin',
      };

      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue({
        totalEvents: 100,
        uniqueUsers: 50,
        conversionRate: 0.5,
        eventsByType: {},
        topSources: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/coupon-usage');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should allow super_admin access to profile changes analytics', async () => {
      currentUser = {
        id: 'super-admin-id',
        email: 'superadmin@example.com',
        role: 'super_admin',
      };

      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue({
        totalChanges: 100,
        uniqueUsers: 50,
        changesByField: {},
        completionMilestones: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/profile-changes');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should allow super_admin access to user engagement metrics', async () => {
      currentUser = {
        id: 'super-admin-id',
        email: 'superadmin@example.com',
        role: 'super_admin',
      };

      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue({
        activeUsers: 50,
        userSegments: {},
        avgCouponsPerUser: 2,
        avgProfileChangesPerUser: 1,
        topUsers: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/user-engagement');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should allow super_admin access to dashboard', async () => {
      currentUser = {
        id: 'super-admin-id',
        email: 'superadmin@example.com',
        role: 'super_admin',
      };

      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue({
        totalEvents: 100,
        uniqueUsers: 50,
        conversionRate: 0.5,
        eventsByType: {},
        topSources: [],
      } as any);
      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue({
        totalChanges: 100,
        uniqueUsers: 50,
        changesByField: {},
        completionMilestones: [],
      } as any);
      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue({
        activeUsers: 50,
        userSegments: {},
        avgCouponsPerUser: 2,
        avgProfileChangesPerUser: 1,
        topUsers: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/dashboard');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should allow super_admin to update daily analytics', async () => {
      currentUser = {
        id: 'super-admin-id',
        email: 'superadmin@example.com',
        role: 'super_admin',
      };

      mockAnalyticsService.updateDailyUserAnalytics.mockResolvedValue(100);

      const response = await request(app)
        .post('/api/analytics/update-daily')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Empty Analytics Responses', () => {
    beforeEach(() => {
      currentUser = {
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin',
      };
    });

    it('should handle empty coupon usage analytics', async () => {
      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue({
        totalEvents: 0,
        uniqueUsers: 0,
        conversionRate: 0,
        eventsByType: {},
        topSources: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/coupon-usage');

      expect(response.status).toBe(200);
      expect(response.body.data.totalEvents).toBe(0);
      expect(response.body.data.uniqueUsers).toBe(0);
      expect(response.body.data.topSources).toEqual([]);
    });

    it('should handle empty profile change analytics', async () => {
      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue({
        totalChanges: 0,
        uniqueUsers: 0,
        changesByField: {},
        completionMilestones: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/profile-changes');

      expect(response.status).toBe(200);
      expect(response.body.data.totalChanges).toBe(0);
      expect(response.body.data.uniqueUsers).toBe(0);
      expect(response.body.data.changesByField).toEqual({});
    });

    it('should handle empty user engagement metrics', async () => {
      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue({
        activeUsers: 0,
        userSegments: { high: 0, medium: 0, low: 0 },
        avgCouponsPerUser: 0,
        avgProfileChangesPerUser: 0,
        topUsers: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/user-engagement');

      expect(response.status).toBe(200);
      expect(response.body.data.activeUsers).toBe(0);
      expect(response.body.data.topUsers).toEqual([]);
    });

    it('should handle dashboard with all empty data', async () => {
      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue({
        totalEvents: 0,
        uniqueUsers: 0,
        conversionRate: 0,
        eventsByType: {},
        topSources: [],
      } as any);
      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue({
        totalChanges: 0,
        uniqueUsers: 0,
        changesByField: {},
        completionMilestones: [],
      } as any);
      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue({
        activeUsers: 0,
        userSegments: {},
        avgCouponsPerUser: 0,
        avgProfileChangesPerUser: 0,
        topUsers: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/dashboard');

      expect(response.status).toBe(200);
      expect(response.body.data.couponUsage.totalEvents).toBe(0);
      expect(response.body.data.profileChanges.totalChanges).toBe(0);
      expect(response.body.data.userEngagement.activeUsers).toBe(0);
    });

    it('should handle zero records processed in daily update', async () => {
      currentUser = {
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin',
      };

      mockAnalyticsService.updateDailyUserAnalytics.mockResolvedValue(0);

      const response = await request(app)
        .post('/api/analytics/update-daily')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.recordsProcessed).toBe(0);
    });
  });

  describe('Additional Edge Cases', () => {
    it('should handle extremely long metadata in coupon tracking', async () => {
      mockAnalyticsService.trackCouponUsage.mockResolvedValue(undefined);

      const largeMetadata = {
        description: 'A'.repeat(10000),
        details: Array(1000).fill('data'),
        nested: {
          level1: {
            level2: {
              level3: 'deep value',
            },
          },
        },
      };

      const response = await request(app)
        .post('/api/analytics/coupon-usage')
        .send({
          couponId: 'coupon-123',
          eventType: 'view',
          metadata: largeMetadata,
        });

      expect(response.status).toBe(201);
    });

    it('should handle special characters in field names for profile tracking', async () => {
      mockAnalyticsService.trackProfileChange.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/analytics/profile-change')
        .send({
          field: 'email@special!#$%',
          newValue: 'value',
          changeSource: 'user',
        });

      expect(response.status).toBe(201);
    });

    it('should handle invalid period parameter in dashboard (non-numeric)', async () => {
      currentUser = {
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin',
      };

      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue({
        totalEvents: 0,
        uniqueUsers: 0,
        conversionRate: 0,
        eventsByType: {},
        topSources: [],
      } as any);
      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue({
        totalChanges: 0,
        uniqueUsers: 0,
        changesByField: {},
        completionMilestones: [],
      } as any);
      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue({
        activeUsers: 0,
        userSegments: {},
        avgCouponsPerUser: 0,
        avgProfileChangesPerUser: 0,
        topUsers: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/dashboard')
        .query({ period: 'not-a-number' });

      // NaN will be handled by parseInt, resulting in default or NaN behavior
      expect(response.status).toBe(200);
    });

    it('should handle negative period parameter in dashboard', async () => {
      currentUser = {
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin',
      };

      mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue({
        totalEvents: 0,
        uniqueUsers: 0,
        conversionRate: 0,
        eventsByType: {},
        topSources: [],
      } as any);
      mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue({
        totalChanges: 0,
        uniqueUsers: 0,
        changesByField: {},
        completionMilestones: [],
      } as any);
      mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue({
        activeUsers: 0,
        userSegments: {},
        avgCouponsPerUser: 0,
        avgProfileChangesPerUser: 0,
        topUsers: [],
      } as any);

      const response = await request(app)
        .get('/api/analytics/dashboard')
        .query({ period: '-30' });

      expect(response.status).toBe(200);
      expect(response.body.data.period).toBe('-30 days');
    });

    it('should handle null values in profile change oldValue', async () => {
      mockAnalyticsService.trackProfileChange.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/analytics/profile-change')
        .send({
          field: 'email',
          oldValue: null,
          newValue: 'new@example.com',
          changeSource: 'user',
        });

      expect(response.status).toBe(201);
    });

    it('should handle undefined ipAddress and userAgent', async () => {
      mockAnalyticsService.trackCouponUsage.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/analytics/coupon-usage')
        .send({
          couponId: 'coupon-123',
          eventType: 'view',
        });

      expect(response.status).toBe(201);
      expect(mockAnalyticsService.trackCouponUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          couponId: 'coupon-123',
          eventType: 'view',
        })
      );
    });
  });
});
