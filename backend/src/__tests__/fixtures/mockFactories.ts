/**
 * Mock Service Factories
 * Provides pre-configured mock instances of common services
 */

import { AuthService } from '../../services/authService';
import { UserService } from '../../services/userService';
import { SurveyService } from '../../services/surveyService';
import { CouponService } from '../../services/couponService';
import { LoyaltyService } from '../../services/loyaltyService';
import { AnalyticsService } from '../../services/analyticsService';
import { NotificationService } from '../../services/notificationService';
import { MembershipIdService } from '../../services/membershipIdService';
import { StorageService } from '../../services/storageService';

// Import types for proper mock data
import { CouponType, CouponStatus } from '../../types/coupon';

// Mock data interfaces for better type safety
interface MockUserResponse {
  user: Partial<any>;
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}

interface MockSurveyResponse {
  id: string;
  title: string;
  description: string;
  questions: unknown[];
  target_segment: Record<string, unknown>;
  access_type: 'public' | 'private' | 'invited';
  status: 'draft' | 'active' | 'paused' | 'archived';
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

interface MockSurveyListResponse {
  surveys: MockSurveyResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface MockCouponResponse {
  id: string;
  code: string;
  name: string;
  type: CouponType;
  value: number;
  status: CouponStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface MockCouponListResponse {
  coupons: MockCouponResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface MockSurveyAnalyticsResponse {
  survey_id: string;
  total_responses: number;
  completion_rate: number;
  questions: unknown[];
}

interface MockRedemptionResponse {
  success: boolean;
  redemptionId: string;
  discountAmount: number;
  finalAmount: number;
}

/**
 * Create a mocked AuthService with common methods
 */
export const createMockAuthService = (): jest.Mocked<AuthService> => {
  return {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refreshToken: jest.fn(),
    verifyToken: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
  } as unknown as jest.Mocked<AuthService>;
};

/**
 * Create a mocked UserService with common methods
 */
export const createMockUserService = (): jest.Mocked<UserService> => {
  return {
    getUserById: jest.fn(),
    getUserByEmail: jest.fn(),
    updateUser: jest.fn(),
    deleteUser: jest.fn(),
    getAllUsers: jest.fn(),
    uploadAvatar: jest.fn(),
    deleteAvatar: jest.fn(),
  } as unknown as jest.Mocked<UserService>;
};

/**
 * Setup common mock implementations for AuthService
 */
export const setupAuthServiceMocks = (mockService: jest.Mocked<AuthService>) => {
  const mockUser: Partial<any> = {
    id: 'test-user-123',
    email: 'test@example.com',
    role: 'customer',
    isActive: true,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockNewUser: Partial<any> = {
    id: 'new-user-123',
    email: 'newuser@example.com',
    role: 'customer',
    isActive: true,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const loginResponse: MockUserResponse = {
    user: mockUser,
    tokens: {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    },
  };

  const registerResponse: MockUserResponse = {
    user: mockNewUser,
    tokens: {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    },
  };

  mockService.login.mockResolvedValue(loginResponse as any);
  mockService.register.mockResolvedValue(registerResponse as any);
  mockService.verifyToken.mockResolvedValue({
    id: 'test-user-123',
    email: 'test@example.com',
    role: 'customer',
  });

  return mockService;
};

/**
 * Setup common mock implementations for UserService
 */
export const setupUserServiceMocks = (mockService: jest.Mocked<UserService>) => {
  const mockany: Partial<any> = {
    firstName: 'Test',
    lastName: 'User',
    phoneNumber: null,
    dateOfBirth: null,
    preferredLanguage: 'en',
    avatarUrl: null,
  };

  const mockUserWithProfile = {
    userId: 'test-user-id',
    email: 'test@example.com',
    role: 'customer',
    isActive: true,
    emailVerified: true,
    password: 'hashed-password',
    createdAt: new Date(),
    updatedAt: new Date(),
    user_profiles: mockany,
  };

  mockService.getUserById.mockResolvedValue(mockUserWithProfile as any as any);

  return mockService;
};

/**
 * Create a mocked SurveyService with all methods
 */
export const createMockSurveyService = (): jest.Mocked<SurveyService> => {
  return {
    createSurvey: jest.fn(),
    getSurveyById: jest.fn(),
    getSurveyWithTranslations: jest.fn(),
    getAllSurveyTranslations: jest.fn(),
    getSurveys: jest.fn(),
    updateSurvey: jest.fn(),
    deleteSurvey: jest.fn(),
    submitResponse: jest.fn(),
    getUserResponse: jest.fn(),
    getSurveyResponses: jest.fn(),
    getPublicSurveys: jest.fn(),
    getInvitedSurveys: jest.fn(),
    getAvailableSurveys: jest.fn(),
    canUserAccessSurvey: jest.fn(),
    getSurveyAnalytics: jest.fn(),
    getSurveyInvitations: jest.fn(),
    sendSurveyInvitations: jest.fn(),
    sendSurveyInvitationsToUsers: jest.fn(),
    resendInvitation: jest.fn(),
    assignCouponToSurvey: jest.fn(),
    getSurveyCouponAssignments: jest.fn(),
    updateSurveyCouponAssignment: jest.fn(),
    removeCouponFromSurvey: jest.fn(),
    getSurveyRewardHistory: jest.fn(),
    getAllSurveyCouponAssignments: jest.fn(),
    exportSurveyResponses: jest.fn(),
  } as unknown as jest.Mocked<SurveyService>;
};

/**
 * Setup common mock implementations for SurveyService
 */
export const setupSurveyServiceMocks = (mockService: jest.Mocked<SurveyService>) => {
  // Default successful responses for common operations
  const mockSurvey: MockSurveyResponse = {
    id: 'survey-123',
    title: 'Test Survey',
    description: 'Test Description',
    questions: [],
    target_segment: {},
    access_type: 'public',
    status: 'draft',
    created_by: 'admin-123',
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockActiveSurvey: MockSurveyResponse = {
    ...mockSurvey,
    status: 'active',
  };

  const mockSurveyList: MockSurveyListResponse = {
    surveys: [],
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 0,
  };

  const mockSurveyUpdate = {
    id: 'survey-123',
    title: 'Updated Survey',
    status: 'active' as const,
  };

  const mockSurveyResponse = {
    id: 'response-123',
    survey_id: 'survey-123',
    user_id: 'user-123',
    answers: {},
    is_completed: true,
    submitted_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockSurveyResponses = {
    responses: [],
    total: 0,
  };

  const mockSurveyAnalytics: MockSurveyAnalyticsResponse = {
    survey_id: 'survey-123',
    total_responses: 0,
    completion_rate: 0,
    questions: [],
  };

  const mockCouponAssignment = {
    id: 'assignment-123',
    survey_id: 'survey-123',
    coupon_id: 'coupon-123',
    is_active: true,
  };

  const mockCouponAssignments = {
    assignments: [],
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 0,
  };

  const mockRewardHistory = {
    rewards: [],
    total: 0,
    totalPages: 0,
  };

  const mockAllAssignments = {
    assignments: [],
    total: 0,
  };

  // Apply mocks
  mockService.createSurvey.mockResolvedValue(mockSurvey as any);
  mockService.getSurveyById.mockResolvedValue(mockActiveSurvey as any);
  mockService.getSurveys.mockResolvedValue(mockSurveyList as any);
  mockService.updateSurvey.mockResolvedValue(mockSurveyUpdate as any);
  mockService.deleteSurvey.mockResolvedValue(true as any);
  mockService.submitResponse.mockResolvedValue(mockSurveyResponse as any);
  mockService.getUserResponse.mockResolvedValue(null as any);
  mockService.getSurveyResponses.mockResolvedValue(mockSurveyResponses as any);
  mockService.getAvailableSurveys.mockResolvedValue([] as any);
  mockService.getPublicSurveys.mockResolvedValue([] as any);
  mockService.getInvitedSurveys.mockResolvedValue([] as any);
  mockService.getSurveyAnalytics.mockResolvedValue(mockSurveyAnalytics as any);
  mockService.sendSurveyInvitations.mockResolvedValue({ sent: 0 } as any);
  mockService.assignCouponToSurvey.mockResolvedValue(mockCouponAssignment as any);
  mockService.getSurveyCouponAssignments.mockResolvedValue(mockCouponAssignments as any);
  mockService.getSurveyRewardHistory.mockResolvedValue(mockRewardHistory as any);
  mockService.getAllSurveyCouponAssignments.mockResolvedValue(mockAllAssignments as any);

  return mockService;
};

/**
 * Create a mocked CouponService with all methods
 */
export const createMockCouponService = (): jest.Mocked<CouponService> => {
  return {
    createCoupon: jest.fn(),
    updateCoupon: jest.fn(),
    getCouponById: jest.fn(),
    getCouponWithTranslations: jest.fn(),
    getCouponByCode: jest.fn(),
    listCoupons: jest.fn(),
    assignCouponToUsers: jest.fn(),
    redeemCoupon: jest.fn(),
    getUserCouponByQR: jest.fn(),
    getUserActiveCoupons: jest.fn(),
    getUserCouponsByStatus: jest.fn(),
    getCouponRedemptions: jest.fn(),
    getCouponAnalytics: jest.fn(),
    getCouponStats: jest.fn(),
    updateDailyAnalytics: jest.fn(),
    deleteCoupon: jest.fn(),
    getCouponAssignments: jest.fn(),
    revokeUserCouponsForCoupon: jest.fn(),
    revokeUserCoupon: jest.fn(),
  } as unknown as jest.Mocked<CouponService>;
};

/**
 * Setup common mock implementations for CouponService
 */
export const setupCouponServiceMocks = (mockService: jest.Mocked<CouponService>) => {
  const mockCoupon: MockCouponResponse = {
    id: 'coupon-123',
    code: 'WELCOME10',
    name: 'Welcome Discount',
    type: 'percentage',
    value: 10,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCouponList: MockCouponListResponse = {
    coupons: [],
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 0,
  };

  const mockCouponUpdate = {
    id: 'coupon-123',
    code: 'UPDATED',
    status: 'active' as const,
  };

  const mockRedemption: MockRedemptionResponse = {
    success: true,
    redemptionId: 'redemption-123',
    discountAmount: 50,
    finalAmount: 450,
  };

  const mockUserCouponList: MockCouponListResponse = {
    coupons: [],
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 0,
  };

  const mockCouponRedemptions = {
    redemptions: [],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  };

  const mockCouponAnalytics = {
    couponId: 'coupon-123',
    totalRedemptions: 0,
    totalDiscountGiven: 0,
  };

  const mockCouponStats = {
    totalCoupons: 0,
    activeCoupons: 0,
    totalRedemptions: 0,
  };

  // Apply mocks
  mockService.createCoupon.mockResolvedValue(mockCoupon as any);
  mockService.getCouponById.mockResolvedValue(mockCoupon as any);
  mockService.listCoupons.mockResolvedValue(mockCouponList as any);
  mockService.updateCoupon.mockResolvedValue(mockCouponUpdate as any);
  mockService.deleteCoupon.mockResolvedValue(true as any);
  mockService.redeemCoupon.mockResolvedValue(mockRedemption as any);
  mockService.getUserCouponByQR.mockResolvedValue(null as any);
  mockService.getUserActiveCoupons.mockResolvedValue(mockUserCouponList as any);
  mockService.getUserCouponsByStatus.mockResolvedValue(mockUserCouponList as any);
  mockService.getCouponRedemptions.mockResolvedValue(mockCouponRedemptions as any);
  mockService.getCouponAnalytics.mockResolvedValue(mockCouponAnalytics as any);
  mockService.getCouponStats.mockResolvedValue(mockCouponStats as any);
  mockService.assignCouponToUsers.mockResolvedValue([] as any);
  mockService.getCouponAssignments.mockResolvedValue([] as any as any);
  mockService.revokeUserCoupon.mockResolvedValue(true as any);

  return mockService;
};

/**
 * Create a mocked LoyaltyService with all methods
 */
export const createMockLoyaltyService = (): jest.Mocked<LoyaltyService> => {
  return {
    getAllTiers: jest.fn(),
    getUserLoyaltyStatus: jest.fn(),
    initializeUserLoyalty: jest.fn(),
    ensureUserLoyaltyEnrollment: jest.fn(),
    awardPoints: jest.fn(),
    deductPoints: jest.fn(),
    getUserPointsHistory: jest.fn(),
    getAdminTransactions: jest.fn(),
    calculateUserPoints: jest.fn(),
    getAllUsersLoyaltyStatus: jest.fn(),
    getPointsEarningRules: jest.fn(),
    addStayNightsAndPoints: jest.fn(),
    awardNights: jest.fn(),
    deductNights: jest.fn(),
    earnPointsForStay: jest.fn(),
    expireOldPoints: jest.fn(),
    getTransactionHistory: jest.fn(),
    getTierConfiguration: jest.fn(),
    updateTierConfiguration: jest.fn(),
  } as unknown as jest.Mocked<LoyaltyService>;
};

/**
 * Create a mocked AnalyticsService with all methods
 */
export const createMockAnalyticsService = (): jest.Mocked<AnalyticsService> => {
  return {
    trackCouponUsage: jest.fn(),
    trackProfileChange: jest.fn(),
    trackMultipleProfileChanges: jest.fn(),
    getCouponUsageAnalytics: jest.fn(),
    getProfileChangeAnalytics: jest.fn(),
    updateDailyUserAnalytics: jest.fn(),
    getUserEngagementMetrics: jest.fn(),
  } as unknown as jest.Mocked<AnalyticsService>;
};

/**
 * Create a mocked NotificationService with all methods
 */
export const createMockNotificationService = (): jest.Mocked<NotificationService> => {
  return {
    createNotification: jest.fn(),
    getUserNotifications: jest.fn(),
    getUnreadCount: jest.fn(),
    markNotificationsRead: jest.fn(),
    markAllNotificationsRead: jest.fn(),
    deleteNotification: jest.fn(),
    cleanupExpiredNotifications: jest.fn(),
    getUserPreferences: jest.fn(),
    updateUserPreferences: jest.fn(),
    createProfileCompletionNotification: jest.fn(),
    createCouponNotification: jest.fn(),
    createPointsNotification: jest.fn(),
    createBulkNotifications: jest.fn(),
  } as unknown as jest.Mocked<NotificationService>;
};

/**
 * Create a mocked MembershipIdService with all methods
 */
export const createMockMembershipIdService = (): jest.Mocked<MembershipIdService> => {
  return {
    generateUniqueMembershipId: jest.fn(),
    getUserByMembershipId: jest.fn(),
    getMembershipIdByUserId: jest.fn(),
    regenerateMembershipId: jest.fn(),
    getMembershipIdStats: jest.fn(),
  } as unknown as jest.Mocked<MembershipIdService>;
};

/**
 * Create a mocked StorageService with all methods
 */
export const createMockStorageService = (): jest.Mocked<StorageService> => {
  return {
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
    getFileUrl: jest.fn(),
    listFiles: jest.fn(),
  } as unknown as jest.Mocked<StorageService>;
};

/**
 * Type guard to check if a property is a Jest mock function
 */
const isJestMock = (property: unknown): property is jest.Mock => {
  return typeof property === 'function' &&
         typeof (property as jest.Mock).mockClear === 'function' &&
         typeof (property as jest.Mock).mockReset === 'function';
};

/**
 * Type guard to check if a key is safe (not a prototype property)
 */
const isSafePropertyKey = (key: string): boolean => {
  // Exclude prototype chain properties that could lead to pollution
  const dangerousKeys = [
    '__proto__',
    'constructor',
    'prototype',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    'toString',
    'valueOf'
  ];
  return !dangerousKeys.includes(key) && key !== '__defineGetter__' && key !== '__defineSetter__';
};

/**
 * Reset all mocks in a service (secure version)
 * Uses proper type guards and safe property access to prevent object injection
 */
export const resetServiceMocks = <T extends Record<string, unknown>>(mockService: T): void => {
  // Validate input is an object and not null
  if (!mockService || typeof mockService !== 'object') {
    throw new Error('resetServiceMocks: Invalid mockService provided');
  }

  // Use Object.getOwnPropertyNames to only iterate over own properties
  // This prevents prototype chain pollution
  const ownProperties = Object.getOwnPropertyNames(mockService);

  for (const key of ownProperties) {
    // Skip dangerous properties that could lead to prototype pollution
    if (!isSafePropertyKey(key)) {
      continue;
    }

    try {
      // Use Object.getOwnPropertyDescriptor for safer property access
      const descriptor = Object.getOwnPropertyDescriptor(mockService, key);

      // Only process if property exists and is a data property
      if (descriptor?.value !== undefined) {
        // Use type guard to ensure we only call mockClear on actual Jest mocks
        if (isJestMock(descriptor.value)) {
          descriptor.value.mockClear();
        }
      }
    } catch {
      // Continue silently - in test context, we don't want noisy logging
      // If a property can't be reset, it's not critical for test functionality
    }
  }
};
