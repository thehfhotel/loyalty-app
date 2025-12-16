import { Request, Response } from 'express';
import { analyticsController } from '../../../controllers/analyticsController';
import { analyticsService } from '../../../services/analyticsService';
import { AppError } from '../../../middleware/errorHandler';

jest.mock('../../../services/analyticsService');
jest.mock('../../../utils/logger');

const mockAnalyticsService = analyticsService as jest.Mocked<typeof analyticsService>;

describe('AnalyticsController', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      user: { id: 'user-123', email: 'user@example.com', role: 'customer' },
      body: {},
      query: {},
      ip: '192.168.1.1',
      get: jest.fn().mockReturnValue('Mozilla/5.0')
    };

    mockResponse = {
      status: statusMock,
      json: jsonMock
    };

    jest.clearAllMocks();
  });

  describe('trackCouponUsage', () => {
    describe('Authentication and Validation', () => {
      it('should return 401 when user is not authenticated', async () => {
        mockRequest.user = undefined;

        await analyticsController.trackCouponUsage(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(401);
        expect(jsonMock).toHaveBeenCalledWith({ error: 'User not authenticated' });
      });

      it('should return 400 when couponId is missing', async () => {
        mockRequest.body = { eventType: 'view' };

        await analyticsController.trackCouponUsage(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'couponId and eventType are required'
        });
      });

      it('should return 400 when eventType is missing', async () => {
        mockRequest.body = { couponId: 'coupon-123' };

        await analyticsController.trackCouponUsage(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'couponId and eventType are required'
        });
      });

      it('should return 400 for invalid eventType', async () => {
        mockRequest.body = {
          couponId: 'coupon-123',
          eventType: 'invalid_event'
        };

        await analyticsController.trackCouponUsage(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith({
          error: expect.stringContaining('Invalid eventType')
        });
      });
    });

    describe('Valid Event Types', () => {
      const validEventTypes = [
        'view',
        'assign',
        'redeem_attempt',
        'redeem_success',
        'redeem_fail',
        'expire',
        'revoke'
      ];

      validEventTypes.forEach(eventType => {
        it(`should accept valid eventType: ${eventType}`, async () => {
          mockRequest.body = {
            couponId: 'coupon-123',
            eventType,
            source: 'mobile_app'
          };

          mockAnalyticsService.trackCouponUsage.mockResolvedValue(undefined);

          await analyticsController.trackCouponUsage(
            mockRequest as Request,
            mockResponse as Response
          );

          expect(mockAnalyticsService.trackCouponUsage).toHaveBeenCalledWith({
            userId: 'user-123',
            couponId: 'coupon-123',
            userCouponId: undefined,
            eventType,
            source: 'mobile_app',
            metadata: undefined,
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0'
          });

          expect(statusMock).toHaveBeenCalledWith(201);
          expect(jsonMock).toHaveBeenCalledWith({
            success: true,
            message: 'Coupon usage event tracked successfully'
          });
        });
      });
    });

    describe('Success Cases', () => {
      it('should track coupon usage with all optional fields', async () => {
        mockRequest.body = {
          couponId: 'coupon-123',
          userCouponId: 'user-coupon-456',
          eventType: 'redeem_success',
          source: 'web',
          metadata: { location: 'restaurant-A', discount: '20%' }
        };

        mockAnalyticsService.trackCouponUsage.mockResolvedValue(undefined);

        await analyticsController.trackCouponUsage(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.trackCouponUsage).toHaveBeenCalledWith({
          userId: 'user-123',
          couponId: 'coupon-123',
          userCouponId: 'user-coupon-456',
          eventType: 'redeem_success',
          source: 'web',
          metadata: { location: 'restaurant-A', discount: '20%' },
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0'
        });

        expect(statusMock).toHaveBeenCalledWith(201);
      });

      it('should track coupon usage with minimal required fields', async () => {
        mockRequest.body = {
          couponId: 'coupon-123',
          eventType: 'view'
        };

        mockAnalyticsService.trackCouponUsage.mockResolvedValue(undefined);

        await analyticsController.trackCouponUsage(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.trackCouponUsage).toHaveBeenCalledWith({
          userId: 'user-123',
          couponId: 'coupon-123',
          userCouponId: undefined,
          eventType: 'view',
          source: undefined,
          metadata: undefined,
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0'
        });

        expect(statusMock).toHaveBeenCalledWith(201);
      });
    });

    describe('Error Handling', () => {
      it('should return 500 on service error', async () => {
        mockRequest.body = {
          couponId: 'coupon-123',
          eventType: 'view'
        };

        mockAnalyticsService.trackCouponUsage.mockRejectedValue(
          new Error('Database connection failed')
        );

        await analyticsController.trackCouponUsage(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Internal server error'
        });
      });

      it('should handle AppError with custom status code', async () => {
        mockRequest.body = {
          couponId: 'coupon-123',
          eventType: 'view'
        };

        mockAnalyticsService.trackCouponUsage.mockRejectedValue(
          new AppError(404, 'Coupon not found')
        );

        await analyticsController.trackCouponUsage(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(404);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Coupon not found'
        });
      });
    });
  });

  describe('trackProfileChange', () => {
    describe('Authentication and Validation', () => {
      it('should return 401 when user is not authenticated', async () => {
        mockRequest.user = undefined;

        await analyticsController.trackProfileChange(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(401);
        expect(jsonMock).toHaveBeenCalledWith({ error: 'User not authenticated' });
      });

      it('should return 400 when field is missing', async () => {
        mockRequest.body = { newValue: 'test@example.com' };

        await analyticsController.trackProfileChange(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'field and newValue are required'
        });
      });

      it('should return 400 when newValue is missing', async () => {
        mockRequest.body = { field: 'email' };

        await analyticsController.trackProfileChange(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'field and newValue are required'
        });
      });

      it('should accept newValue as empty string', async () => {
        mockRequest.body = {
          field: 'bio',
          newValue: ''
        };

        mockAnalyticsService.trackProfileChange.mockResolvedValue(undefined);

        await analyticsController.trackProfileChange(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.trackProfileChange).toHaveBeenCalled();
        expect(statusMock).toHaveBeenCalledWith(201);
      });

      it('should return 400 for invalid changeSource', async () => {
        mockRequest.body = {
          field: 'email',
          newValue: 'test@example.com',
          changeSource: 'invalid_source'
        };

        await analyticsController.trackProfileChange(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith({
          error: expect.stringContaining('Invalid changeSource')
        });
      });
    });

    describe('Valid Change Sources', () => {
      const validSources = ['user', 'admin', 'system'];

      validSources.forEach(changeSource => {
        it(`should accept valid changeSource: ${changeSource}`, async () => {
          mockRequest.body = {
            field: 'email',
            newValue: 'test@example.com',
            oldValue: 'old@example.com',
            changeSource
          };

          mockAnalyticsService.trackProfileChange.mockResolvedValue(undefined);

          await analyticsController.trackProfileChange(
            mockRequest as Request,
            mockResponse as Response
          );

          expect(mockAnalyticsService.trackProfileChange).toHaveBeenCalledWith({
            userId: 'user-123',
            field: 'email',
            oldValue: 'old@example.com',
            newValue: 'test@example.com',
            changeSource,
            metadata: undefined,
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0'
          });

          expect(statusMock).toHaveBeenCalledWith(201);
        });
      });
    });

    describe('Success Cases', () => {
      it('should track profile change with all fields', async () => {
        mockRequest.body = {
          field: 'phone',
          oldValue: '1234567890',
          newValue: '0987654321',
          changeSource: 'user',
          metadata: { via: 'settings_page' }
        };

        mockAnalyticsService.trackProfileChange.mockResolvedValue(undefined);

        await analyticsController.trackProfileChange(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.trackProfileChange).toHaveBeenCalledWith({
          userId: 'user-123',
          field: 'phone',
          oldValue: '1234567890',
          newValue: '0987654321',
          changeSource: 'user',
          metadata: { via: 'settings_page' },
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0'
        });

        expect(statusMock).toHaveBeenCalledWith(201);
        expect(jsonMock).toHaveBeenCalledWith({
          success: true,
          message: 'Profile change event tracked successfully'
        });
      });

      it('should use default changeSource "user" when not provided', async () => {
        mockRequest.body = {
          field: 'name',
          newValue: 'John Doe'
        };

        mockAnalyticsService.trackProfileChange.mockResolvedValue(undefined);

        await analyticsController.trackProfileChange(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.trackProfileChange).toHaveBeenCalledWith({
          userId: 'user-123',
          field: 'name',
          oldValue: null,
          newValue: 'John Doe',
          changeSource: 'user',
          metadata: undefined,
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0'
        });
      });

      it('should convert undefined oldValue to null', async () => {
        mockRequest.body = {
          field: 'bio',
          newValue: 'New bio text'
        };

        mockAnalyticsService.trackProfileChange.mockResolvedValue(undefined);

        await analyticsController.trackProfileChange(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.trackProfileChange).toHaveBeenCalledWith(
          expect.objectContaining({
            oldValue: null
          })
        );
      });
    });

    describe('Error Handling', () => {
      it('should return 500 on service error', async () => {
        mockRequest.body = {
          field: 'email',
          newValue: 'test@example.com'
        };

        mockAnalyticsService.trackProfileChange.mockRejectedValue(
          new Error('Database error')
        );

        await analyticsController.trackProfileChange(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Internal server error'
        });
      });
    });
  });

  describe('getCouponUsageAnalytics', () => {
    describe('Success Cases', () => {
      it('should get analytics without date filters', async () => {
        const mockAnalytics = {
          totalEvents: 150,
          uniqueUsers: 45,
          conversionRate: 0.65,
          eventsByType: { view: 100, redeem_success: 30, redeem_fail: 20 },
          topSources: [{ source: 'mobile_app', count: 80 }],
          dailyStats: []
        };

        mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue(mockAnalytics);

        await analyticsController.getCouponUsageAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.getCouponUsageAnalytics).toHaveBeenCalledWith(
          undefined,
          undefined,
          undefined,
          undefined
        );

        expect(jsonMock).toHaveBeenCalledWith({
          success: true,
          data: mockAnalytics
        });
      });

      it('should get analytics with date range', async () => {
        mockRequest.query = {
          startDate: '2025-01-01',
          endDate: '2025-01-31'
        };

        const mockAnalytics = {
          totalEvents: 200,
          uniqueUsers: 50,
          conversionRate: 0.7,
          eventsByType: {},
          topSources: [],
          dailyStats: []
        };

        mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue(mockAnalytics);

        await analyticsController.getCouponUsageAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.getCouponUsageAnalytics).toHaveBeenCalledWith(
          new Date('2025-01-01'),
          new Date('2025-01-31'),
          undefined,
          undefined
        );

        expect(jsonMock).toHaveBeenCalledWith({
          success: true,
          data: mockAnalytics
        });
      });

      it('should get analytics filtered by couponId', async () => {
        mockRequest.query = {
          couponId: 'coupon-123'
        };

        const mockAnalytics = {
          totalEvents: 50,
          uniqueUsers: 20,
          conversionRate: 0.8,
          eventsByType: {},
          topSources: [],
          dailyStats: []
        };

        mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue(mockAnalytics);

        await analyticsController.getCouponUsageAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.getCouponUsageAnalytics).toHaveBeenCalledWith(
          undefined,
          undefined,
          'coupon-123',
          undefined
        );
      });

      it('should get analytics filtered by userId', async () => {
        mockRequest.query = {
          userId: 'user-456'
        };

        const mockAnalytics = {
          totalEvents: 10,
          uniqueUsers: 1,
          conversionRate: 0.9,
          eventsByType: {},
          topSources: [],
          dailyStats: []
        };

        mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue(mockAnalytics);

        await analyticsController.getCouponUsageAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.getCouponUsageAnalytics).toHaveBeenCalledWith(
          undefined,
          undefined,
          undefined,
          'user-456'
        );
      });
    });

    describe('Error Handling', () => {
      it('should return 500 on service error', async () => {
        mockAnalyticsService.getCouponUsageAnalytics.mockRejectedValue(
          new Error('Analytics service error')
        );

        await analyticsController.getCouponUsageAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Internal server error'
        });
      });
    });
  });

  describe('getProfileChangeAnalytics', () => {
    describe('Success Cases', () => {
      it('should get profile change analytics with date range', async () => {
        mockRequest.query = {
          startDate: '2025-01-01',
          endDate: '2025-01-31'
        };

        const mockAnalytics = {
          totalChanges: 300,
          uniqueUsers: 100,
          changesByField: { email: 50, phone: 80, name: 170 },
          changesBySource: { user: 250, admin: 30, system: 20 },
          completionMilestones: [],
          dailyActivity: []
        };

        mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue(mockAnalytics);

        await analyticsController.getProfileChangeAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.getProfileChangeAnalytics).toHaveBeenCalledWith(
          new Date('2025-01-01'),
          new Date('2025-01-31'),
          undefined
        );

        expect(jsonMock).toHaveBeenCalledWith({
          success: true,
          data: mockAnalytics
        });
      });

      it('should get profile change analytics filtered by userId', async () => {
        mockRequest.query = {
          userId: 'user-789'
        };

        const mockAnalytics = {
          totalChanges: 15,
          uniqueUsers: 1,
          changesByField: { email: 5, phone: 10 },
          changesBySource: { user: 15 },
          completionMilestones: [],
          dailyActivity: []
        };

        mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue(mockAnalytics);

        await analyticsController.getProfileChangeAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.getProfileChangeAnalytics).toHaveBeenCalledWith(
          undefined,
          undefined,
          'user-789'
        );
      });
    });

    describe('Error Handling', () => {
      it('should return 500 on service error', async () => {
        mockAnalyticsService.getProfileChangeAnalytics.mockRejectedValue(
          new Error('Analytics error')
        );

        await analyticsController.getProfileChangeAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Internal server error'
        });
      });
    });
  });

  describe('getUserEngagementMetrics', () => {
    describe('Success Cases', () => {
      it('should get engagement metrics with date range', async () => {
        mockRequest.query = {
          startDate: '2025-01-01',
          endDate: '2025-01-31'
        };

        const mockMetrics = {
          activeUsers: 250,
          totalSessions: 1000,
          userSegments: { highEngagement: 50, mediumEngagement: 100, lowEngagement: 100 },
          avgCouponsPerUser: 3.5,
          avgProfileChangesPerUser: 2.1,
          topUsers: []
        };

        mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue(mockMetrics);

        await analyticsController.getUserEngagementMetrics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.getUserEngagementMetrics).toHaveBeenCalledWith(
          new Date('2025-01-01'),
          new Date('2025-01-31')
        );

        expect(jsonMock).toHaveBeenCalledWith({
          success: true,
          data: mockMetrics
        });
      });

      it('should get engagement metrics without date filters', async () => {
        const mockMetrics = {
          activeUsers: 500,
          totalSessions: 2000,
          userSegments: { highEngagement: 100, mediumEngagement: 200, lowEngagement: 200 },
          avgCouponsPerUser: 4.2,
          avgProfileChangesPerUser: 3.0,
          topUsers: []
        };

        mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue(mockMetrics);

        await analyticsController.getUserEngagementMetrics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.getUserEngagementMetrics).toHaveBeenCalledWith(
          undefined,
          undefined
        );
      });
    });

    describe('Error Handling', () => {
      it('should return 500 on service error', async () => {
        mockAnalyticsService.getUserEngagementMetrics.mockRejectedValue(
          new Error('Metrics error')
        );

        await analyticsController.getUserEngagementMetrics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Internal server error'
        });
      });
    });
  });

  describe('updateDailyAnalytics', () => {
    describe('Authorization', () => {
      it('should return 403 when user is not authenticated', async () => {
        mockRequest.user = undefined;

        await analyticsController.updateDailyAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(403);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Insufficient permissions'
        });
      });

      it('should return 403 when user is not admin', async () => {
        mockRequest.user = { id: 'user-123', email: 'user@example.com', role: 'customer' };

        await analyticsController.updateDailyAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(403);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Insufficient permissions'
        });
      });

      it('should allow admin role', async () => {
        mockRequest.user = { id: 'admin-123', email: 'admin@example.com', role: 'admin' };
        mockRequest.body = {};

        mockAnalyticsService.updateDailyUserAnalytics.mockResolvedValue(42);

        await analyticsController.updateDailyAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.updateDailyUserAnalytics).toHaveBeenCalled();
        expect(statusMock).not.toHaveBeenCalledWith(403);
      });

      it('should allow super_admin role', async () => {
        mockRequest.user = { id: 'super-admin-123', email: 'superadmin@example.com', role: 'super_admin' };
        mockRequest.body = {};

        mockAnalyticsService.updateDailyUserAnalytics.mockResolvedValue(42);

        await analyticsController.updateDailyAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.updateDailyUserAnalytics).toHaveBeenCalled();
        expect(statusMock).not.toHaveBeenCalledWith(403);
      });
    });

    describe('Success Cases', () => {
      beforeEach(() => {
        mockRequest.user = { id: 'admin-123', email: 'admin@example.com', role: 'admin' };
      });

      it('should update daily analytics without date parameter', async () => {
        mockRequest.body = {};

        mockAnalyticsService.updateDailyUserAnalytics.mockResolvedValue(100);

        await analyticsController.updateDailyAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.updateDailyUserAnalytics).toHaveBeenCalledWith(undefined);

        expect(jsonMock).toHaveBeenCalledWith({
          success: true,
          message: 'Daily analytics updated successfully',
          data: {
            recordsProcessed: 100,
            date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
          }
        });
      });

      it('should update daily analytics with specific date', async () => {
        const targetDate = '2025-01-15';
        mockRequest.body = { date: targetDate };

        mockAnalyticsService.updateDailyUserAnalytics.mockResolvedValue(75);

        await analyticsController.updateDailyAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.updateDailyUserAnalytics).toHaveBeenCalledWith(
          new Date(targetDate)
        );

        expect(jsonMock).toHaveBeenCalledWith({
          success: true,
          message: 'Daily analytics updated successfully',
          data: {
            recordsProcessed: 75,
            date: '2025-01-15'
          }
        });
      });
    });

    describe('Error Handling', () => {
      beforeEach(() => {
        mockRequest.user = { id: 'admin-123', email: 'admin@example.com', role: 'admin' };
      });

      it('should return 500 on service error', async () => {
        mockRequest.body = {};

        mockAnalyticsService.updateDailyUserAnalytics.mockRejectedValue(
          new Error('Update failed')
        );

        await analyticsController.updateDailyAnalytics(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Internal server error'
        });
      });
    });
  });

  describe('getAnalyticsDashboard', () => {
    describe('Authorization', () => {
      it('should return 403 when user is not authenticated', async () => {
        mockRequest.user = undefined;

        await analyticsController.getAnalyticsDashboard(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(403);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Insufficient permissions'
        });
      });

      it('should return 403 when user is not admin', async () => {
        mockRequest.user = { id: 'user-123', email: 'user@example.com', role: 'customer' };

        await analyticsController.getAnalyticsDashboard(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(403);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Insufficient permissions'
        });
      });

      it('should allow admin role', async () => {
        mockRequest.user = { id: 'admin-123', email: 'admin@example.com', role: 'admin' };
        mockRequest.query = {};

        const mockData = {
          couponAnalytics: {
            totalEvents: 100,
            uniqueUsers: 50,
            conversionRate: 0.7,
            topSources: [],
            eventsByType: {},
            dailyStats: []
          },
          profileAnalytics: {
            totalChanges: 200,
            uniqueUsers: 80,
            changesByField: {},
            changesBySource: {},
            completionMilestones: [],
            dailyActivity: []
          },
          engagementMetrics: {
            activeUsers: 150,
            totalSessions: 500,
            userSegments: { highEngagement: 30, mediumEngagement: 60, lowEngagement: 60 },
            avgCouponsPerUser: 3.0,
            avgProfileChangesPerUser: 2.5,
            topUsers: []
          }
        };

        mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue(
          mockData.couponAnalytics
        );
        mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue(
          mockData.profileAnalytics
        );
        mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue(
          mockData.engagementMetrics
        );

        await analyticsController.getAnalyticsDashboard(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockAnalyticsService.getCouponUsageAnalytics).toHaveBeenCalled();
        expect(statusMock).not.toHaveBeenCalledWith(403);
      });
    });

    describe('Success Cases', () => {
      beforeEach(() => {
        mockRequest.user = { id: 'admin-123', email: 'admin@example.com', role: 'admin' };
      });

      it('should get dashboard with default period (30 days)', async () => {
        mockRequest.query = {};

        const mockCouponData = {
          totalEvents: 500,
          uniqueUsers: 150,
          conversionRate: 0.65,
          topSources: [
            { source: 'mobile_app', count: 200 },
            { source: 'web', count: 150 }
          ],
          eventsByType: {
            view: 300,
            redeem_success: 150,
            redeem_fail: 50
          },
          dailyStats: []
        };

        const mockProfileData = {
          totalChanges: 800,
          uniqueUsers: 200,
          changesByField: {
            email: 100,
            phone: 200,
            name: 300,
            bio: 150,
            interests: 50
          },
          changesBySource: { user: 700, admin: 50, system: 50 },
          completionMilestones: [
            { userId: 'user-1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', completedAt: new Date(), fieldsCompleted: ['email', 'phone'] }
          ],
          dailyActivity: []
        };

        const mockEngagementData = {
          activeUsers: 250,
          totalSessions: 1000,
          userSegments: { highEngagement: 50, mediumEngagement: 100, lowEngagement: 100 },
          avgCouponsPerUser: 3.5,
          avgProfileChangesPerUser: 4.0,
          topUsers: [
            { userId: 'user-1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', totalInteractions: 50, couponsViewed: 30, couponsRedeemed: 10, profileChanges: 10 }
          ]
        };

        mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue(mockCouponData);
        mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue(mockProfileData);
        mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue(mockEngagementData);

        await analyticsController.getAnalyticsDashboard(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(jsonMock).toHaveBeenCalledWith({
          success: true,
          data: {
            period: '30 days',
            couponUsage: {
              totalEvents: 500,
              uniqueUsers: 150,
              conversionRate: 0.65,
              topSources: mockCouponData.topSources,
              eventBreakdown: mockCouponData.eventsByType
            },
            profileChanges: {
              totalChanges: 800,
              uniqueUsers: 200,
              topFields: [
                { field: 'name', count: 300 },
                { field: 'phone', count: 200 },
                { field: 'bio', count: 150 },
                { field: 'email', count: 100 },
                { field: 'interests', count: 50 }
              ],
              recentCompletions: mockProfileData.completionMilestones.slice(0, 10)
            },
            userEngagement: {
              activeUsers: 250,
              userSegments: mockEngagementData.userSegments,
              avgInteractions: {
                coupons: 3.5,
                profileChanges: 4.0
              },
              topUsers: mockEngagementData.topUsers.slice(0, 10)
            }
          }
        });
      });

      it('should get dashboard with custom period', async () => {
        mockRequest.query = { period: '7' };

        const mockCouponData = {
          totalEvents: 100,
          uniqueUsers: 30,
          conversionRate: 0.7,
          topSources: [],
          eventsByType: {},
          dailyStats: []
        };

        const mockProfileData = {
          totalChanges: 150,
          uniqueUsers: 40,
          changesByField: {},
          changesBySource: {},
          completionMilestones: [],
          dailyActivity: []
        };

        const mockEngagementData = {
          activeUsers: 50,
          totalSessions: 200,
          userSegments: { highEngagement: 10, mediumEngagement: 20, lowEngagement: 20 },
          avgCouponsPerUser: 3.3,
          avgProfileChangesPerUser: 3.8,
          topUsers: []
        };

        mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue(mockCouponData);
        mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue(mockProfileData);
        mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue(mockEngagementData);

        await analyticsController.getAnalyticsDashboard(
          mockRequest as Request,
          mockResponse as Response
        );

        const calls = mockAnalyticsService.getCouponUsageAnalytics.mock.calls[0];
        if (calls?.[0]) {
          const startDate = calls[0] as Date;
          const now = new Date();
          const daysDiff = Math.round((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
          expect(daysDiff).toBe(7);
        }

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            data: expect.objectContaining({
              period: '7 days'
            })
          })
        );
      });

      it('should limit topSources to 5 items', async () => {
        mockRequest.user = { id: 'admin-123', email: 'admin@example.com', role: 'admin' };
        mockRequest.query = {};

        const mockCouponData = {
          totalEvents: 500,
          uniqueUsers: 150,
          conversionRate: 0.65,
          topSources: [
            { source: 'mobile_app', count: 200 },
            { source: 'web', count: 150 },
            { source: 'tablet', count: 100 },
            { source: 'desktop', count: 30 },
            { source: 'api', count: 15 },
            { source: 'other', count: 5 }
          ],
          eventsByType: {},
          dailyStats: []
        };

        mockAnalyticsService.getCouponUsageAnalytics.mockResolvedValue(mockCouponData);
        mockAnalyticsService.getProfileChangeAnalytics.mockResolvedValue({
          totalChanges: 0,
          uniqueUsers: 0,
          changesByField: {},
          changesBySource: {},
          completionMilestones: [],
          dailyActivity: []
        });
        mockAnalyticsService.getUserEngagementMetrics.mockResolvedValue({
          activeUsers: 0,
          totalSessions: 0,
          userSegments: { highEngagement: 0, mediumEngagement: 0, lowEngagement: 0 },
          avgCouponsPerUser: 0,
          avgProfileChangesPerUser: 0,
          topUsers: []
        });

        await analyticsController.getAnalyticsDashboard(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              couponUsage: expect.objectContaining({
                topSources: expect.arrayContaining([
                  { source: 'mobile_app', count: 200 },
                  { source: 'web', count: 150 },
                  { source: 'tablet', count: 100 },
                  { source: 'desktop', count: 30 },
                  { source: 'api', count: 15 }
                ])
              })
            })
          })
        );

        const response = jsonMock.mock.calls[0][0];
        expect(response.data.couponUsage.topSources).toHaveLength(5);
      });
    });

    describe('Error Handling', () => {
      beforeEach(() => {
        mockRequest.user = { id: 'admin-123', email: 'admin@example.com', role: 'admin' };
        mockRequest.query = {};
      });

      it('should return 500 on service error', async () => {
        mockAnalyticsService.getCouponUsageAnalytics.mockRejectedValue(
          new Error('Dashboard error')
        );

        await analyticsController.getAnalyticsDashboard(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Internal server error'
        });
      });

      it('should handle AppError from service', async () => {
        mockAnalyticsService.getCouponUsageAnalytics.mockRejectedValue(
          new AppError(503, 'Service temporarily unavailable')
        );

        await analyticsController.getAnalyticsDashboard(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(statusMock).toHaveBeenCalledWith(503);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Service temporarily unavailable'
        });
      });
    });
  });
});
