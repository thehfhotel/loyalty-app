/**
 * Full API Load Test Suite
 * Combines all API domain tests into a comprehensive load test
 *
 * Run: k6 run load-test-full.js
 * With env: k6 run -e BACKEND_URL=http://localhost:4202 load-test-full.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';

// Configuration
import { fullApiOptions as options } from './config/base-options.js';
import { AUTH, USERS, LOYALTY, COUPONS, SURVEYS, NOTIFICATIONS, OAUTH, ANALYTICS, MEMBERSHIP, TRANSLATION, HEALTH } from './config/endpoints.js';
import { TEST_USERS } from './config/test-data.js';

// Utils
import { login, getAuthHeaders, getJsonHeaders } from './utils/auth.js';
import { healthLatency, authLatency, userLatency, loyaltyLatency, couponLatency, surveyLatency, notificationLatency, oauthLatency, analyticsLatency, membershipLatency, translationLatency, recordRequest } from './utils/metrics.js';

export { options };

export function setup() {
  console.log('========================================');
  console.log('Full API Load Test Starting...');
  console.log(`Backend URL: ${AUTH.login.replace('/api/auth/login', '')}`);
  console.log('========================================');

  // Pre-login to get token
  const authData = login(TEST_USERS.primary.email, TEST_USERS.primary.password);
  if (!authData) {
    console.error('SETUP FAILED: Could not login');
    return { accessToken: null };
  }

  console.log('Setup complete - authentication successful');
  return { accessToken: authData.accessToken };
}

export default function (data) {
  const { accessToken } = data;

  // ============================================
  // HEALTH ENDPOINTS (Public)
  // ============================================
  group('Health Checks', function () {
    // Root health
    let res = http.get(HEALTH.root);
    check(res, { 'root health 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, healthLatency);

    // API health
    res = http.get(HEALTH.api);
    check(res, { 'api health 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, healthLatency);

    // CSRF token
    res = http.get(HEALTH.csrfToken);
    check(res, { 'csrf token 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, healthLatency);
  });

  sleep(0.3);

  // ============================================
  // AUTH ENDPOINTS
  // ============================================
  group('Authentication', function () {
    // Login
    let res = http.post(AUTH.login, JSON.stringify(TEST_USERS.primary), { headers: getJsonHeaders() });
    const loginSuccess = res.status === 200;
    check(res, { 'login 200': () => loginSuccess });
    recordRequest(loginSuccess, res.timings.duration, authLatency);

    let token = accessToken;
    if (loginSuccess) {
      try {
        const body = JSON.parse(res.body);
        token = body.tokens?.accessToken || body.accessToken || accessToken;
      } catch (e) {}
    }

    // Get me
    if (token) {
      res = http.get(AUTH.me, { headers: getAuthHeaders(token) });
      check(res, { 'get me 200': (r) => r.status === 200 });
      recordRequest(res.status === 200, res.timings.duration, authLatency);
    }

    // Password reset request
    res = http.post(AUTH.resetPasswordRequest, JSON.stringify({ email: 'test@test.com' }), { headers: getJsonHeaders() });
    check(res, { 'reset request 200/404': (r) => r.status === 200 || r.status === 404 });
    recordRequest(res.status === 200 || res.status === 404, res.timings.duration, authLatency);
  });

  sleep(0.3);

  if (!accessToken) {
    console.error('No access token - skipping authenticated endpoints');
    return;
  }

  // ============================================
  // USER ENDPOINTS
  // ============================================
  group('User Profile', function () {
    // Get profile
    let res = http.get(USERS.profile, { headers: getAuthHeaders(accessToken) });
    check(res, { 'get profile 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, userLatency);

    // Profile completion status
    res = http.get(USERS.profileCompletionStatus, { headers: getAuthHeaders(accessToken) });
    check(res, { 'completion status 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, userLatency);

    // Set emoji avatar (CSRF required)
    res = http.put(USERS.avatarEmoji, JSON.stringify({ emoji: '😀' }), { headers: getAuthHeaders(accessToken) });
    check(res, { 'set emoji responds': (r) => r.status === 200 || r.status === 403 });
    recordRequest(res.status === 200 || res.status === 403, res.timings.duration, userLatency);
  });

  sleep(0.3);

  // ============================================
  // LOYALTY ENDPOINTS
  // ============================================
  group('Loyalty', function () {
    // Get tiers
    let res = http.get(LOYALTY.tiers, { headers: getAuthHeaders(accessToken) });
    check(res, { 'get tiers 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, loyaltyLatency);

    // Get status
    res = http.get(LOYALTY.status, { headers: getAuthHeaders(accessToken) });
    check(res, { 'get status 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, loyaltyLatency);

    // Get history
    res = http.get(LOYALTY.history, { headers: getAuthHeaders(accessToken) });
    check(res, { 'get history 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, loyaltyLatency);

    // Simulate stay (CSRF required)
    res = http.post(LOYALTY.simulateStay, JSON.stringify({ amount: 1000, nights: 1 }), { headers: getAuthHeaders(accessToken) });
    check(res, { 'simulate stay responds': (r) => r.status === 200 || r.status === 403 });
    recordRequest(res.status === 200 || res.status === 403, res.timings.duration, loyaltyLatency);
  });

  sleep(0.3);

  // ============================================
  // COUPON ENDPOINTS
  // ============================================
  group('Coupons', function () {
    // List coupons
    let res = http.get(COUPONS.list, { headers: getAuthHeaders(accessToken) });
    check(res, { 'list coupons 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, couponLatency);

    // My coupons
    res = http.get(COUPONS.myCoupons, { headers: getAuthHeaders(accessToken) });
    check(res, { 'my coupons 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, couponLatency);

    // Validate QR (public)
    res = http.get(COUPONS.validate('TEST-QR'));
    check(res, { 'validate QR 200/404': (r) => r.status === 200 || r.status === 404 });
    recordRequest(res.status === 200 || res.status === 404, res.timings.duration, couponLatency);
  });

  sleep(0.3);

  // ============================================
  // SURVEY ENDPOINTS
  // ============================================
  group('Surveys', function () {
    // List surveys (admin-only, 403 expected for regular users)
    let res = http.get(SURVEYS.list, { headers: getAuthHeaders(accessToken) });
    check(res, { 'list surveys responds': (r) => r.status === 200 || r.status === 403 });
    recordRequest(res.status === 200 || res.status === 403, res.timings.duration, surveyLatency);

    // Available for user
    res = http.get(SURVEYS.availableForUser, { headers: getAuthHeaders(accessToken) });
    check(res, { 'available surveys 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, surveyLatency);

    // Public surveys
    res = http.get(SURVEYS.publicForUser, { headers: getAuthHeaders(accessToken) });
    check(res, { 'public surveys 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, surveyLatency);

    // Invited surveys
    res = http.get(SURVEYS.invitedForUser, { headers: getAuthHeaders(accessToken) });
    check(res, { 'invited surveys 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, surveyLatency);
  });

  sleep(0.3);

  // ============================================
  // NOTIFICATION ENDPOINTS
  // ============================================
  group('Notifications', function () {
    // VAPID key (public, may not be configured)
    let res = http.get(NOTIFICATIONS.vapidKey);
    const vapidOk = res.status === 200 || res.status === 404 || res.status === 500 || res.status === 503;
    check(res, { 'vapid key responds': () => vapidOk });
    recordRequest(vapidOk, res.timings.duration, notificationLatency);

    // List notifications
    res = http.get(NOTIFICATIONS.list, { headers: getAuthHeaders(accessToken) });
    check(res, { 'list notifications 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, notificationLatency);

    // Unread count
    res = http.get(NOTIFICATIONS.unreadCount, { headers: getAuthHeaders(accessToken) });
    check(res, { 'unread count 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, notificationLatency);

    // Preferences
    res = http.get(NOTIFICATIONS.preferences, { headers: getAuthHeaders(accessToken) });
    check(res, { 'preferences 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, notificationLatency);
  });

  sleep(0.3);

  // ============================================
  // OAUTH ENDPOINTS
  // ============================================
  group('OAuth', function () {
    // State health
    let res = http.get(OAUTH.stateHealth);
    check(res, { 'oauth state health 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, oauthLatency);

    // Google initiation (expect redirect)
    res = http.get(OAUTH.google, { redirects: 0 });
    check(res, { 'google oauth redirect': (r) => r.status === 302 || r.status === 301 || r.status === 200 });
    recordRequest(res.status === 302 || res.status === 301 || res.status === 200, res.timings.duration, oauthLatency);
  });

  sleep(0.3);

  // ============================================
  // ANALYTICS ENDPOINTS
  // ============================================
  group('Analytics', function () {
    // Profile change tracking (CSRF required)
    let res = http.post(ANALYTICS.profileChange, JSON.stringify({ field: 'phone', action: 'update' }), { headers: getAuthHeaders(accessToken) });
    check(res, { 'profile change responds': (r) => r.status === 200 || r.status === 201 || r.status === 403 });
    recordRequest(res.status === 200 || res.status === 201 || res.status === 403, res.timings.duration, analyticsLatency);
  });

  sleep(0.3);

  // ============================================
  // MEMBERSHIP ENDPOINTS
  // ============================================
  group('Membership', function () {
    // Get my ID
    let res = http.get(MEMBERSHIP.myId, { headers: getAuthHeaders(accessToken) });
    check(res, { 'my membership id 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, membershipLatency);
  });

  sleep(0.3);

  // ============================================
  // TRANSLATION ENDPOINTS
  // ============================================
  group('Translation', function () {
    // List jobs
    let res = http.get(TRANSLATION.jobs, { headers: getAuthHeaders(accessToken) });
    check(res, { 'translation jobs 200': (r) => r.status === 200 });
    recordRequest(res.status === 200, res.timings.duration, translationLatency);
  });

  sleep(1);
}

export function teardown(data) {
  console.log('========================================');
  console.log('Full API Load Test Complete');
  console.log('========================================');
}
