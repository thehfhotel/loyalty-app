/**
 * OAuth API Load Tests
 * Tests: OAuth initiation, state health, state cleanup
 * Note: Actual OAuth flow requires browser - we test API accessibility
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { smokeOptions } from '../../config/base-options.js';
import { OAUTH } from '../../config/endpoints.js';
import { oauthLatency, recordRequest } from '../../utils/metrics.js';

export const options = smokeOptions;

export default function () {
  // Group 1: OAuth State Health
  group('OAuth - State Health', function () {
    const res = http.get(OAUTH.stateHealth);

    const success = check(res, {
      'state health status is 200': (r) => r.status === 200,
    });

    recordRequest(success, res.timings.duration, oauthLatency);
  });

  sleep(0.5);

  // Group 2: Google OAuth Initiation (expect redirect)
  group('OAuth - Google Initiation', function () {
    const res = http.get(OAUTH.google, {
      redirects: 0, // Don't follow redirects
    });

    // Should return redirect (302) or success with URL
    const success = check(res, {
      'google OAuth status is redirect or 200': (r) =>
        r.status === 302 || r.status === 301 || r.status === 200,
    });

    recordRequest(success, res.timings.duration, oauthLatency);
  });

  sleep(0.5);

  // Group 3: LINE OAuth Initiation (expect redirect)
  group('OAuth - LINE Initiation', function () {
    const res = http.get(OAUTH.line, {
      redirects: 0,
    });

    const success = check(res, {
      'line OAuth status is redirect or 200': (r) =>
        r.status === 302 || r.status === 301 || r.status === 200,
    });

    recordRequest(success, res.timings.duration, oauthLatency);
  });

  sleep(0.5);

  // Group 4: State Cleanup
  group('OAuth - State Cleanup', function () {
    const res = http.post(OAUTH.stateCleanup, null, {
      headers: { 'Content-Type': 'application/json' },
    });

    const success = check(res, {
      'state cleanup status is 200': (r) => r.status === 200 || r.status === 204,
    });

    recordRequest(success, res.timings.duration, oauthLatency);
  });

  sleep(1);
}

export function teardown(data) {
  console.log('OAuth Load Test Complete');
}
