/**
 * API Response Type Definitions
 *
 * This file contains TypeScript interfaces for all API responses used in the frontend.
 * These types ensure type safety when consuming backend API endpoints.
 */

// ===========================
// User & Authentication Types
// ===========================

export type UserRole = 'customer' | 'admin' | 'super_admin';

export interface User {
  id: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: string; // ISO 8601 date string
  updatedAt: string; // ISO 8601 date string
  firstName?: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: string; // ISO 8601 date string
  avatarUrl?: string;
  membershipId?: string;
  oauthProvider?: string;
  oauthProviderId?: string;
}

export interface UserProfile {
  userId: string;
  firstName: string;
  lastName: string;
  phone?: string;
  dateOfBirth?: string; // ISO 8601 date string
  preferences: Record<string, unknown>;
  avatarUrl?: string;
  membershipId?: string;
  gender?: string;
  occupation?: string;
  profileCompleted?: boolean;
  profileCompletedAt?: string; // ISO 8601 date string
  newMemberCouponAwarded?: boolean;
  createdAt: string; // ISO 8601 date string
  updatedAt: string; // ISO 8601 date string
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse {
  success: boolean;
  message?: string;
  user: User;
  profile?: UserProfile;
  tokens: AuthTokens;
}

export interface RegisterResponse {
  success: boolean;
  message?: string;
  user: User;
  profile: UserProfile;
  tokens: AuthTokens;
}

export interface RefreshTokenResponse {
  success: boolean;
  tokens: AuthTokens;
}

export interface LogoutResponse {
  success: boolean;
  message: string;
}

// ===========================
// Loyalty Types
// ===========================

export interface LoyaltyTier {
  id: string;
  name: string;
  level: number;
  minPoints: number;
  maxPoints: number | null;
  benefits: string[];
  color: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserLoyalty {
  userId: string;
  currentPoints: number;
  lifetimePoints: number;
  tierName: string;
  tierLevel: number;
  pointsToNextTier: number;
  nextTierName?: string;
  updatedAt: string;
}

export interface PointsTransaction {
  id: string;
  userId: string;
  points: number;
  type: 'award' | 'deduct' | 'expire';
  reason: string;
  referenceType?: string;
  referenceId?: string;
  expiresAt?: string;
  createdAt: string;
  description?: string;
}

export interface LoyaltyStatusResponse {
  success: boolean;
  data: UserLoyalty;
}

export interface PointsHistoryResponse {
  success: boolean;
  transactions: PointsTransaction[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AwardPointsRequest {
  userId: string;
  points: number;
  reason: string;
  referenceType?: string;
  referenceId?: string;
  expiresIn?: number; // days
  adminUserId?: string;
  description?: string;
}

export interface AwardPointsResponse {
  success: boolean;
  message: string;
  transaction: PointsTransaction;
  newBalance: number;
}

// ===========================
// Coupon Types
// ===========================

export interface Coupon {
  id: string;
  code: string;
  name: string;
  description?: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  minPurchaseAmount?: number;
  maxDiscountAmount?: number;
  usageLimit?: number;
  usageCount: number;
  isActive: boolean;
  validFrom: string;
  validUntil: string;
  createdAt: string;
  updatedAt: string;
  applicableProducts?: string[];
  requiredTier?: number;
}

export interface UserCoupon {
  id: string;
  userId: string;
  couponId: string;
  code: string;
  isUsed: boolean;
  usedAt?: string;
  expiresAt: string;
  createdAt: string;
  coupon?: Coupon;
}

export interface CouponRedemption {
  id: string;
  userId: string;
  couponId: string;
  userCouponId: string;
  orderTotal: number;
  discountAmount: number;
  redeemedAt: string;
  user?: User;
  coupon?: Coupon;
}

export interface CouponsListResponse {
  success: boolean;
  data: Coupon[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UserCouponsResponse {
  success: boolean;
  coupons: UserCoupon[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CouponRedemptionsResponse {
  success: boolean;
  redemptions: CouponRedemption[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AssignCouponRequest {
  couponId: string;
  userId: string;
  expiresIn?: number; // days from now
}

export interface AssignCouponResponse {
  success: boolean;
  message: string;
  userCoupon: UserCoupon;
}

export interface RedeemCouponRequest {
  code: string;
  orderTotal: number;
}

export interface RedeemCouponResponse {
  success: boolean;
  message: string;
  redemption: CouponRedemption;
  discountAmount: number;
}

// ===========================
// Survey Types
// ===========================

export interface SurveyQuestion {
  id: string;
  type: 'text' | 'multiple_choice' | 'rating' | 'yes_no';
  question: string;
  options?: string[];
  required: boolean;
  order: number;
}

export interface Survey {
  id: string;
  title: string;
  description?: string;
  questions: SurveyQuestion[];
  rewardPoints: number;
  isActive: boolean;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface SurveyResponse {
  id: string;
  surveyId: string;
  userId: string;
  answers: Record<string, unknown>;
  completedAt: string;
  pointsAwarded: number;
  createdAt: string;
}

export interface SurveysListResponse {
  success: boolean;
  surveys: Survey[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SubmitSurveyRequest {
  surveyId: string;
  answers: Record<string, unknown>;
}

export interface SubmitSurveyResponse {
  success: boolean;
  message: string;
  pointsAwarded: number;
  response: SurveyResponse;
}

// ===========================
// Membership Types
// ===========================

export interface MembershipIdSettings {
  prefix: string;
  sequenceLength: number;
  nextSequence: number;
  exampleFormat: string;
}

export interface MembershipIdSettingsResponse {
  success: boolean;
  settings: MembershipIdSettings;
}

export interface UpdateMembershipIdSettingsRequest {
  prefix?: string;
  sequenceLength?: number;
  nextSequence?: number;
}

export interface UpdateMembershipIdSettingsResponse {
  success: boolean;
  message: string;
  settings: MembershipIdSettings;
}

// ===========================
// Admin Types
// ===========================

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalPoints: number;
  totalCoupons: number;
  activeCoupons: number;
  totalRedemptions: number;
  totalSurveys: number;
  activeSurveys: number;
}

export interface AdminStatsResponse {
  success: boolean;
  stats: AdminStats;
}

export interface UsersListResponse {
  success: boolean;
  users: User[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ===========================
// Generic API Response Types
// ===========================

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface ApiError {
  success: false;
  error: string;
  message: string;
  statusCode?: number;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ===========================
// Query Parameter Types
// ===========================

export interface PaginationParams {
  page?: number;
  limit?: number;
  offset?: number;
}

export interface SortParams {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface FilterParams {
  search?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export type QueryParams = PaginationParams & SortParams & FilterParams;

// ===========================
// Type Guards
// ===========================

export function isApiError(response: unknown): response is ApiError {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    response.success === false &&
    'error' in response
  );
}

export function isUser(obj: unknown): obj is User {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'email' in obj &&
    'role' in obj
  );
}

export function isUserRole(role: string): role is UserRole {
  return ['customer', 'admin', 'super_admin'].includes(role);
}
