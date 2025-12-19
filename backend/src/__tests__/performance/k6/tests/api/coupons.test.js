/**
 * Coupon API Load Tests
 * Tests: list coupons, my coupons, validate QR, get coupon details
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { smokeOptions } from '../../config/base-options.js';
import { COUPONS } from '../../config/endpoints.js';
import { TEST_USERS, TEST_DATA } from '../../config/test-data.js';
import { login, getAuthHeaders } from '../../utils/auth.js';
import { errorRate, couponLatency, recordRequest } from '../../utils/metrics.js';

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

  // Group 1: List Available Coupons
  group('Coupons - List Available', function () {
    const res = http.get(COUPONS.list, {
      headers: getAuthHeaders(accessToken),
    });

    const success = check(res, {
      'list coupons status is 200': (r) => r.status === 200,
      'coupons is array': (r) => {
        try {
          const body = JSON.parse(r.body);
          // Response: { success: true, data: { coupons: [...], total, page, limit } }
          return Array.isArray(body) || Array.isArray(body.coupons) ||
                 Array.isArray(body.data) || Array.isArray(body.data?.coupons);
        } catch (e) {
          return false;
        }
      },
    });

    recordRequest(success, res.timings.duration, couponLatency);
  });

  sleep(0.5);

  // Group 2: Get My Coupons
  group('Coupons - My Coupons', function () {
    const res = http.get(COUPONS.myCoupons, {
      headers: getAuthHeaders(accessToken),
    });

    const success = check(res, {
      'my coupons status is 200': (r) => r.status === 200,
      'my coupons is array': (r) => {
        try {
          const body = JSON.parse(r.body);
          // Response: { success: true, data: { coupons: [...], total, page, limit } }
          return Array.isArray(body) || Array.isArray(body.coupons) ||
                 Array.isArray(body.data) || Array.isArray(body.data?.coupons);
        } catch (e) {
          return false;
        }
      },
    });

    recordRequest(success, res.timings.duration, couponLatency);
  });

  sleep(0.5);

  // Group 3: Validate QR Code (public endpoint)
  group('Coupons - Validate QR', function () {
    const res = http.get(COUPONS.validate(TEST_DATA.coupons.sampleQrCode));

    // May return 404 if QR code doesn't exist - that's OK
    const success = check(res, {
      'validate QR status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    recordRequest(success, res.timings.duration, couponLatency);
  });

  sleep(1);
}

export function teardown(data) {
  console.log('Coupons Load Test Complete');
}
