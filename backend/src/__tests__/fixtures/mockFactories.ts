/**
 * Mock Service Factories
 * Provides pre-configured mock instances of common services
 */

import { AuthService } from '../../services/authService';
import { UserService } from '../../services/userService';
import { SurveyService } from '../../services/surveyService';

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
  mockService.login.mockResolvedValue({
    user: {
      id: 'test-user-123',
      email: 'test@example.com',
      role: 'customer',
      isActive: true,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
    tokens: {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    },
  });

  mockService.register.mockResolvedValue({
    user: {
      id: 'new-user-123',
      email: 'newuser@example.com',
      role: 'customer',
      isActive: true,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
    tokens: {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    },
  });

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
  mockService.getUserById.mockResolvedValue({
    email: 'test@example.com',
    role: 'customer',
    isActive: true,
    emailVerified: true,
    password: 'hashed-password',
    createdAt: new Date(),
    updatedAt: new Date(),
    user_profiles: {
      firstName: 'Test',
      lastName: 'User',
      phoneNumber: null,
      dateOfBirth: null,
      preferredLanguage: 'en',
      avatarUrl: null,
    },
  } as any);

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
  mockService.createSurvey.mockResolvedValue({
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
  } as any);

  mockService.getSurveyById.mockResolvedValue({
    id: 'survey-123',
    title: 'Test Survey',
    description: 'Test Description',
    questions: [],
    target_segment: {},
    access_type: 'public',
    status: 'active',
    created_by: 'admin-123',
    created_at: new Date(),
    updated_at: new Date(),
  } as any);

  mockService.getSurveys.mockResolvedValue({
    surveys: [],
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 0,
  } as any);

  mockService.updateSurvey.mockResolvedValue({
    id: 'survey-123',
    title: 'Updated Survey',
    status: 'active',
  } as any);

  mockService.deleteSurvey.mockResolvedValue(true);

  mockService.submitResponse.mockResolvedValue({
    id: 'response-123',
    survey_id: 'survey-123',
    user_id: 'user-123',
    answers: {},
    is_completed: true,
    submitted_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  } as any);

  mockService.getUserResponse.mockResolvedValue(null);

  mockService.getSurveyResponses.mockResolvedValue({
    responses: [],
    total: 0,
  } as any);

  mockService.getAvailableSurveys.mockResolvedValue([]);
  mockService.getPublicSurveys.mockResolvedValue([]);
  mockService.getInvitedSurveys.mockResolvedValue([]);

  mockService.getSurveyAnalytics.mockResolvedValue({
    survey_id: 'survey-123',
    total_responses: 0,
    completion_rate: 0,
    questions: [],
  } as any);

  mockService.sendSurveyInvitations.mockResolvedValue({ sent: 0 });

  mockService.assignCouponToSurvey.mockResolvedValue({
    id: 'assignment-123',
    survey_id: 'survey-123',
    coupon_id: 'coupon-123',
    is_active: true,
  } as any);

  mockService.getSurveyCouponAssignments.mockResolvedValue({
    assignments: [],
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 0,
  } as any);

  mockService.getSurveyRewardHistory.mockResolvedValue({
    rewards: [],
    total: 0,
    totalPages: 0,
  } as any);
  mockService.getAllSurveyCouponAssignments.mockResolvedValue({
    assignments: [],
    total: 0,
  } as any);

  return mockService;
};

/**
 * Create a mocked CouponService with all methods
 */
export const createMockCouponService = (): jest.Mocked<any> => {
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
  } as unknown as jest.Mocked<any>;
};

/**
 * Setup common mock implementations for CouponService
 */
export const setupCouponServiceMocks = (mockService: jest.Mocked<any>) => {
  mockService.createCoupon.mockResolvedValue({
    id: 'coupon-123',
    code: 'WELCOME10',
    name: 'Welcome Discount',
    type: 'percentage',
    value: 10,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  mockService.getCouponById.mockResolvedValue({
    id: 'coupon-123',
    code: 'WELCOME10',
    name: 'Welcome Discount',
    type: 'percentage',
    value: 10,
    status: 'active',
  });

  mockService.listCoupons.mockResolvedValue({
    coupons: [],
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 0,
  });

  mockService.updateCoupon.mockResolvedValue({
    id: 'coupon-123',
    code: 'UPDATED',
    status: 'active',
  });

  mockService.deleteCoupon.mockResolvedValue(true);

  mockService.redeemCoupon.mockResolvedValue({
    success: true,
    redemptionId: 'redemption-123',
    discountAmount: 50,
    finalAmount: 450,
  });

  mockService.getUserCouponByQR.mockResolvedValue(null);

  mockService.getUserActiveCoupons.mockResolvedValue({
    coupons: [],
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 0,
  });

  mockService.getUserCouponsByStatus.mockResolvedValue({
    coupons: [],
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 0,
  });

  mockService.getCouponRedemptions.mockResolvedValue({
    redemptions: [],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });

  mockService.getCouponAnalytics.mockResolvedValue({
    couponId: 'coupon-123',
    totalRedemptions: 0,
    totalDiscountGiven: 0,
  });

  mockService.getCouponStats.mockResolvedValue({
    totalCoupons: 0,
    activeCoupons: 0,
    totalRedemptions: 0,
  });

  mockService.assignCouponToUsers.mockResolvedValue([]);
  mockService.getCouponAssignments.mockResolvedValue([]);
  mockService.revokeUserCoupon.mockResolvedValue(true);

  return mockService;
};

/**
 * Create a mocked LoyaltyService with all methods
 */
export const createMockLoyaltyService = (): jest.Mocked<any> => {
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
  } as unknown as jest.Mocked<any>;
};

/**
 * Create a mocked AnalyticsService with all methods
 */
export const createMockAnalyticsService = (): jest.Mocked<any> => {
  return {
    trackCouponUsage: jest.fn(),
    trackProfileChange: jest.fn(),
    trackMultipleProfileChanges: jest.fn(),
    getCouponUsageAnalytics: jest.fn(),
    getProfileChangeAnalytics: jest.fn(),
    updateDailyUserAnalytics: jest.fn(),
    getUserEngagementMetrics: jest.fn(),
  } as unknown as jest.Mocked<any>;
};

/**
 * Create a mocked NotificationService with all methods
 */
export const createMockNotificationService = (): jest.Mocked<any> => {
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
  } as unknown as jest.Mocked<any>;
};

/**
 * Create a mocked MembershipIdService with all methods
 */
export const createMockMembershipIdService = (): jest.Mocked<any> => {
  return {
    generateUniqueMembershipId: jest.fn(),
    getUserByMembershipId: jest.fn(),
    getMembershipIdByUserId: jest.fn(),
    regenerateMembershipId: jest.fn(),
    getMembershipIdStats: jest.fn(),
  } as unknown as jest.Mocked<any>;
};

/**
 * Create a mocked StorageService with all methods
 */
export const createMockStorageService = (): jest.Mocked<any> => {
  return {
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
    getFileUrl: jest.fn(),
    listFiles: jest.fn(),
  } as unknown as jest.Mocked<any>;
};

/**
 * Reset all mocks in a service
 */
export const resetServiceMocks = (mockService: any) => {
  Object.keys(mockService).forEach((key) => {
    if (typeof mockService[key]?.mockClear === 'function') {
      mockService[key].mockClear();
    }
  });
};
