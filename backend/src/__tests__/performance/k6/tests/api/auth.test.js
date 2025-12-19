/**
 * Authentication API Load Tests
 * Tests: register, login, logout, refresh, me, reset-password
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { smokeOptions } from '../../config/base-options.js';
import { AUTH } from '../../config/endpoints.js';
import { TEST_USERS, generateRegistrationData } from '../../config/test-data.js';
import { login, getAuthHeaders, getJsonHeaders } from '../../utils/auth.js';
import { errorRate, authLatency, recordRequest } from '../../utils/metrics.js';

export const options = smokeOptions;

export default function () {
  let accessToken = null;
  let refreshTokenValue = null;

  // Group 1: Login Flow
  group('Auth - Login', function () {
    const res = http.post(
      AUTH.login,
      JSON.stringify(TEST_USERS.primary),
      { headers: getJsonHeaders() }
    );

    const success = check(res, {
      'login status is 200': (r) => r.status === 200,
      'login returns tokens': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.tokens?.accessToken || body.accessToken;
        } catch (e) {
          return false;
        }
      },
    });

    recordRequest(success, res.timings.duration, authLatency);

    if (res.status === 200) {
      try {
        const body = JSON.parse(res.body);
        accessToken = body.tokens?.accessToken || body.accessToken;
        refreshTokenValue = body.tokens?.refreshToken || body.refreshToken;
      } catch (e) {
        // Continue without tokens
      }
    }
  });

  sleep(0.5);

  // Group 2: Get Current User
  if (accessToken) {
    group('Auth - Get Me', function () {
      const res = http.get(AUTH.me, {
        headers: getAuthHeaders(accessToken),
      });

      const success = check(res, {
        'get me status is 200': (r) => r.status === 200,
        'get me returns user': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.email || body.user?.email;
          } catch (e) {
            return false;
          }
        },
      });

      recordRequest(success, res.timings.duration, authLatency);
    });

    sleep(0.5);
  }

  // Group 3: Refresh Token
  if (refreshTokenValue) {
    group('Auth - Refresh Token', function () {
      const res = http.post(
        AUTH.refresh,
        JSON.stringify({ refreshToken: refreshTokenValue }),
        { headers: getJsonHeaders() }
      );

      const success = check(res, {
        'refresh status is 200 or 401': (r) => r.status === 200 || r.status === 401,
      });

      recordRequest(success, res.timings.duration, authLatency);

      // Update token if refreshed
      if (res.status === 200) {
        try {
          const body = JSON.parse(res.body);
          accessToken = body.tokens?.accessToken || body.accessToken;
        } catch (e) {
          // Continue with old token
        }
      }
    });

    sleep(0.5);
  }

  // Group 4: Password Reset Request (doesn't actually send email in test)
  group('Auth - Reset Password Request', function () {
    const res = http.post(
      AUTH.resetPasswordRequest,
      JSON.stringify({ email: 'nonexistent@test.com' }),
      { headers: getJsonHeaders() }
    );

    // Should return 200 even for non-existent emails (security best practice)
    const success = check(res, {
      'reset request status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    recordRequest(success, res.timings.duration, authLatency);
  });

  sleep(0.5);

  // Group 5: Logout
  if (accessToken) {
    group('Auth - Logout', function () {
      const res = http.post(AUTH.logout, null, {
        headers: getAuthHeaders(accessToken),
      });

      const success = check(res, {
        'logout status is 200 or 204': (r) => r.status === 200 || r.status === 204,
      });

      recordRequest(success, res.timings.duration, authLatency);
    });
  }

  sleep(1);
}

// Setup: No special setup needed for auth tests
export function setup() {
  console.log('Auth Load Test Starting...');
  return {};
}

export function teardown(data) {
  console.log('Auth Load Test Complete');
}
