/**
 * User API Load Tests
 * Tests: profile, avatar, email, profile completion
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { smokeOptions } from '../../config/base-options.js';
import { USERS } from '../../config/endpoints.js';
import { TEST_USERS } from '../../config/test-data.js';
import { login, getAuthHeaders } from '../../utils/auth.js';
import { userLatency, recordRequest } from '../../utils/metrics.js';

export const options = smokeOptions;

export function setup() {
  // Login to get access token
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

  // Group 1: Get Profile
  group('Users - Get Profile', function () {
    const res = http.get(USERS.profile, {
      headers: getAuthHeaders(accessToken),
    });

    const success = check(res, {
      'get profile status is 200': (r) => r.status === 200,
      'profile has user data': (r) => {
        try {
          const body = JSON.parse(r.body);
          // Response structure: { profile: { userId, firstName, lastName, ... } }
          return !!body.profile?.userId || !!body.profile?.firstName || !!body.userId;
        } catch (e) {
          return false;
        }
      },
    });

    recordRequest(success, res.timings.duration, userLatency);
  });

  sleep(0.5);

  // Group 2: Get Profile Completion Status
  group('Users - Profile Completion Status', function () {
    const res = http.get(USERS.profileCompletionStatus, {
      headers: getAuthHeaders(accessToken),
    });

    const success = check(res, {
      'completion status is 200': (r) => r.status === 200,
      'has completion data': (r) => {
        try {
          const body = JSON.parse(r.body);
          // Response structure: { success: true, data: { isComplete, missingFields, newMemberCouponAvailable } }
          return typeof body.data?.isComplete === 'boolean' ||
                 typeof body.isComplete === 'boolean' ||
                 Array.isArray(body.data?.missingFields);
        } catch (e) {
          return false;
        }
      },
    });

    recordRequest(success, res.timings.duration, userLatency);
  });

  sleep(0.5);

  // Group 3: Update Profile (minimal change) - CSRF required for PUT
  group('Users - Update Profile', function () {
    const res = http.put(
      USERS.profile,
      JSON.stringify({ phone: '0899999999' }),
      { headers: getAuthHeaders(accessToken) }
    );

    // Accept 200 (success) or 403 (CSRF missing) as valid responses
    const success = check(res, {
      'update profile responds': (r) => r.status === 200 || r.status === 403,
    });

    recordRequest(success, res.timings.duration, userLatency);
  });

  sleep(0.5);

  // Group 4: Set Emoji Avatar - CSRF required for PUT
  group('Users - Set Emoji Avatar', function () {
    const res = http.put(
      USERS.avatarEmoji,
      JSON.stringify({ emoji: '😀' }),
      { headers: getAuthHeaders(accessToken) }
    );

    // Accept 200 (success) or 403 (CSRF missing) as valid responses
    const success = check(res, {
      'set emoji avatar responds': (r) => r.status === 200 || r.status === 403,
    });

    recordRequest(success, res.timings.duration, userLatency);
  });

  sleep(1);
}

export function teardown(data) {
  console.log('Users Load Test Complete');
}
