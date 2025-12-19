/**
 * API endpoint constants for k6 load tests
 * Organized by domain
 */

// Base URLs from environment or defaults
export const BASE_URL = __ENV.BACKEND_URL || 'http://localhost:4202';
export const FRONTEND_URL = __ENV.FRONTEND_URL || 'http://localhost:3201';

// Auth endpoints (7 total, 7 tested)
export const AUTH = {
  register: `${BASE_URL}/api/auth/register`,
  login: `${BASE_URL}/api/auth/login`,
  logout: `${BASE_URL}/api/auth/logout`,
  refresh: `${BASE_URL}/api/auth/refresh`,
  me: `${BASE_URL}/api/auth/me`,
  resetPasswordRequest: `${BASE_URL}/api/auth/reset-password/request`,
  resetPassword: `${BASE_URL}/api/auth/reset-password`,
};

// User endpoints (8 user-facing, skip 9 admin)
export const USERS = {
  profile: `${BASE_URL}/api/users/profile`,
  profileCompletionStatus: `${BASE_URL}/api/users/profile-completion-status`,
  completeProfile: `${BASE_URL}/api/users/complete-profile`,
  avatar: `${BASE_URL}/api/users/avatar`,
  avatarEmoji: `${BASE_URL}/api/users/avatar/emoji`,
  email: `${BASE_URL}/api/users/email`,
};

// Loyalty endpoints (5 user-facing, skip 10 admin)
export const LOYALTY = {
  tiers: `${BASE_URL}/api/loyalty/tiers`,
  status: `${BASE_URL}/api/loyalty/status`,
  pointsCalculation: `${BASE_URL}/api/loyalty/points/calculation`,
  history: `${BASE_URL}/api/loyalty/history`,
  simulateStay: `${BASE_URL}/api/loyalty/simulate-stay`,
};

// Coupon endpoints (5 user-facing, skip 11 admin)
export const COUPONS = {
  list: `${BASE_URL}/api/coupons`,
  myCoupons: `${BASE_URL}/api/coupons/my-coupons`,
  validate: (qrCode) => `${BASE_URL}/api/coupons/validate/${qrCode}`,
  get: (id) => `${BASE_URL}/api/coupons/${id}`,
  redeem: `${BASE_URL}/api/coupons/redeem`,
};

// Survey endpoints (10 user-facing, skip 14 admin)
export const SURVEYS = {
  list: `${BASE_URL}/api/surveys`,
  get: (id) => `${BASE_URL}/api/surveys/${id}`,
  availableForUser: `${BASE_URL}/api/surveys/available/user`,
  publicForUser: `${BASE_URL}/api/surveys/public/user`,
  invitedForUser: `${BASE_URL}/api/surveys/invited/user`,
  responses: `${BASE_URL}/api/surveys/responses`,
  userResponse: (surveyId) => `${BASE_URL}/api/surveys/responses/${surveyId}/user`,
};

// Notification endpoints (10 user-facing, skip 2 admin)
export const NOTIFICATIONS = {
  vapidKey: `${BASE_URL}/api/notifications/vapid-key`,
  list: `${BASE_URL}/api/notifications`,
  unreadCount: `${BASE_URL}/api/notifications/unread-count`,
  preferences: `${BASE_URL}/api/notifications/preferences`,
  markRead: `${BASE_URL}/api/notifications/mark-read`,
  markAllRead: `${BASE_URL}/api/notifications/mark-all-read`,
  test: `${BASE_URL}/api/notifications/test`,
  pushSubscribe: `${BASE_URL}/api/notifications/push/subscribe`,
  pushUnsubscribe: `${BASE_URL}/api/notifications/push/unsubscribe`,
  delete: (id) => `${BASE_URL}/api/notifications/${id}`,
};

// OAuth endpoints (7 total)
export const OAUTH = {
  google: `${BASE_URL}/api/oauth/google`,
  googleCallback: `${BASE_URL}/api/oauth/google/callback`,
  line: `${BASE_URL}/api/oauth/line`,
  lineCallback: `${BASE_URL}/api/oauth/line/callback`,
  me: `${BASE_URL}/api/oauth/me`,
  stateHealth: `${BASE_URL}/api/oauth/state/health`,
  stateCleanup: `${BASE_URL}/api/oauth/state/cleanup`,
};

// Analytics endpoints (2 user-facing, skip 5 admin)
export const ANALYTICS = {
  couponUsage: `${BASE_URL}/api/analytics/coupon-usage`,
  profileChange: `${BASE_URL}/api/analytics/profile-change`,
};

// Membership endpoints (1 user-facing, skip 3 admin)
export const MEMBERSHIP = {
  myId: `${BASE_URL}/api/membership/my-id`,
};

// Translation endpoints (7 total)
export const TRANSLATION = {
  translate: `${BASE_URL}/api/translation/translate`,
  surveyTranslate: (id) => `${BASE_URL}/api/translation/survey/${id}/translate`,
  surveyTranslations: (id) => `${BASE_URL}/api/translation/survey/${id}/translations`,
  couponTranslate: (id) => `${BASE_URL}/api/translation/coupon/${id}/translate`,
  couponTranslations: (id) => `${BASE_URL}/api/translation/coupon/${id}/translations`,
  job: (id) => `${BASE_URL}/api/translation/job/${id}`,
  jobs: `${BASE_URL}/api/translation/jobs`,
};

// Health endpoints (3 total)
export const HEALTH = {
  root: `${BASE_URL}/health`,
  api: `${BASE_URL}/api/health`,
  csrfToken: `${BASE_URL}/api/csrf-token`,
};

// Frontend pages (for browser tests)
export const PAGES = {
  login: `${FRONTEND_URL}/login`,
  register: `${FRONTEND_URL}/register`,
  dashboard: `${FRONTEND_URL}/dashboard`,
  profile: `${FRONTEND_URL}/profile`,
  coupons: `${FRONTEND_URL}/coupons`,
  surveys: `${FRONTEND_URL}/surveys`,
};
