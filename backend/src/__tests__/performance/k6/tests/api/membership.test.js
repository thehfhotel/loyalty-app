/**
 * Membership API Load Tests
 * Tests: get my membership ID
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { smokeOptions } from '../../config/base-options.js';
import { MEMBERSHIP } from '../../config/endpoints.js';
import { TEST_USERS } from '../../config/test-data.js';
import { login, getAuthHeaders } from '../../utils/auth.js';
import { errorRate, membershipLatency, recordRequest } from '../../utils/metrics.js';

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

  // Group 1: Get My Membership ID
  group('Membership - Get My ID', function () {
    const res = http.get(MEMBERSHIP.myId, {
      headers: getAuthHeaders(accessToken),
    });

    const success = check(res, {
      'my membership ID status is 200': (r) => r.status === 200,
      'has membership ID': (r) => {
        try {
          const body = JSON.parse(r.body);
          // Response structure: { success: true, data: { membershipId } }
          return !!body.membershipId || !!body.data?.membershipId || !!body.id;
        } catch (e) {
          return false;
        }
      },
    });

    recordRequest(success, res.timings.duration, membershipLatency);
  });

  sleep(1);
}

export function teardown(data) {
  console.log('Membership Load Test Complete');
}
