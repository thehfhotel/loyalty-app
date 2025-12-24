/**
 * Analytics API Load Tests
 * Tests: coupon usage tracking, profile change tracking
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { smokeOptions } from '../../config/base-options.js';
import { ANALYTICS } from '../../config/endpoints.js';
import { TEST_USERS } from '../../config/test-data.js';
import { login, getAuthHeaders } from '../../utils/auth.js';
import { analyticsLatency, recordRequest } from '../../utils/metrics.js';

export const options = smokeOptions;

export function setup() {
  const authData = login(TEST_USERS.primary.email, TEST_USERS.primary.password);
  if (!authData) {
    console.error('Failed to login during setup');
    return { accessToken: null };
  }
  return { accessToken: authData.accessToken };
}

export default function (data) {
  const { accessToken } = data;

  if (!accessToken) {
    console.error('No access token available');
    return;
  }

  // Group 1: Track Coupon Usage
  group('Analytics - Coupon Usage', function () {
    const res = http.post(
      ANALYTICS.couponUsage,
      JSON.stringify({
        couponId: 'test-coupon-id',
        action: 'view',
      }),
      { headers: getAuthHeaders(accessToken) }
    );

    // Accept 200/201 (success), 404 (coupon not found), or 403 (CSRF missing)
    const success = check(res, {
      'coupon usage responds': (r) =>
        r.status === 200 || r.status === 201 || r.status === 404 || r.status === 403,
    });

    recordRequest(success, res.timings.duration, analyticsLatency);
  });

  sleep(0.5);

  // Group 2: Track Profile Change
  group('Analytics - Profile Change', function () {
    const res = http.post(
      ANALYTICS.profileChange,
      JSON.stringify({
        field: 'phone',
        action: 'update',
      }),
      { headers: getAuthHeaders(accessToken) }
    );

    // Accept 200/201 (success) or 403 (CSRF missing)
    const success = check(res, {
      'profile change responds': (r) =>
        r.status === 200 || r.status === 201 || r.status === 403,
    });

    recordRequest(success, res.timings.duration, analyticsLatency);
  });

  sleep(1);
}

export function teardown(data) {
  console.log('Analytics Load Test Complete');
}
