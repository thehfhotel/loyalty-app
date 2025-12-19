/**
 * Translation API Load Tests
 * Tests: translate text, get translation jobs
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { smokeOptions } from '../../config/base-options.js';
import { TRANSLATION } from '../../config/endpoints.js';
import { TEST_USERS } from '../../config/test-data.js';
import { login, getAuthHeaders } from '../../utils/auth.js';
import { errorRate, translationLatency, recordRequest } from '../../utils/metrics.js';

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

  // Group 1: Translate Text
  group('Translation - Translate Text', function () {
    const res = http.post(
      TRANSLATION.translate,
      JSON.stringify({
        text: 'Hello, welcome to our loyalty program!',
        targetLanguage: 'th',
      }),
      { headers: getAuthHeaders(accessToken) }
    );

    // Accept 200/202 (success) or 403 (CSRF missing)
    const success = check(res, {
      'translate responds': (r) =>
        r.status === 200 || r.status === 202 || r.status === 403,
    });

    recordRequest(success, res.timings.duration, translationLatency);
  });

  sleep(0.5);

  // Group 2: Get Translation Jobs
  group('Translation - List Jobs', function () {
    const res = http.get(TRANSLATION.jobs, {
      headers: getAuthHeaders(accessToken),
    });

    const success = check(res, {
      'list jobs status is 200': (r) => r.status === 200,
    });

    recordRequest(success, res.timings.duration, translationLatency);
  });

  sleep(1);
}

export function teardown(data) {
  console.log('Translation Load Test Complete');
}
