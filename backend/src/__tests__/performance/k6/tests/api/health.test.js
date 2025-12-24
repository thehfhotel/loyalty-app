/**
 * Health Check API Load Tests
 * Tests: basic health, API health, CSRF token
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { smokeOptions } from '../../config/base-options.js';
import { HEALTH } from '../../config/endpoints.js';
import { healthLatency, recordRequest } from '../../utils/metrics.js';

export const options = smokeOptions;

export default function () {
  // Group 1: Root Health Check
  group('Health - Root', function () {
    const res = http.get(HEALTH.root);

    const success = check(res, {
      'root health status is 200': (r) => r.status === 200,
    });

    recordRequest(success, res.timings.duration, healthLatency);
  });

  sleep(0.3);

  // Group 2: API Health Check
  group('Health - API', function () {
    const res = http.get(HEALTH.api);

    const success = check(res, {
      'api health status is 200': (r) => r.status === 200,
      'has status field': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.status !== undefined;
        } catch (e) {
          return false;
        }
      },
    });

    recordRequest(success, res.timings.duration, healthLatency);
  });

  sleep(0.3);

  // Group 3: CSRF Token
  group('Health - CSRF Token', function () {
    const res = http.get(HEALTH.csrfToken);

    const success = check(res, {
      'csrf token status is 200': (r) => r.status === 200,
      'has csrf token': (r) => {
        try {
          const body = JSON.parse(r.body);
          return !!body.csrfToken || !!body.token;
        } catch (e) {
          return false;
        }
      },
    });

    recordRequest(success, res.timings.duration, healthLatency);
  });

  sleep(0.5);
}

export function teardown(data) {
  console.log('Health Load Test Complete');
}
