/**
 * Survey API Load Tests
 * Tests: list surveys, available surveys, public surveys, get survey details
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { smokeOptions } from '../../config/base-options.js';
import { SURVEYS } from '../../config/endpoints.js';
import { TEST_USERS, TEST_DATA } from '../../config/test-data.js';
import { login, getAuthHeaders } from '../../utils/auth.js';
import { surveyLatency, recordRequest } from '../../utils/metrics.js';

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

  // Group 1: List All Surveys (Admin only - 403 expected for regular users)
  group('Surveys - List All', function () {
    const res = http.get(SURVEYS.list, {
      headers: getAuthHeaders(accessToken),
    });

    // This endpoint is admin-only, so 403 is expected for regular users
    const success = check(res, {
      'list surveys responds': (r) => r.status === 200 || r.status === 403,
    });

    recordRequest(success, res.timings.duration, surveyLatency);
  });

  sleep(0.5);

  // Group 2: Get Available Surveys for User
  group('Surveys - Available for User', function () {
    const res = http.get(SURVEYS.availableForUser, {
      headers: getAuthHeaders(accessToken),
    });

    const success = check(res, {
      'available surveys status is 200': (r) => r.status === 200,
    });

    recordRequest(success, res.timings.duration, surveyLatency);
  });

  sleep(0.5);

  // Group 3: Get Public Surveys
  group('Surveys - Public Surveys', function () {
    const res = http.get(SURVEYS.publicForUser, {
      headers: getAuthHeaders(accessToken),
    });

    const success = check(res, {
      'public surveys status is 200': (r) => r.status === 200,
    });

    recordRequest(success, res.timings.duration, surveyLatency);
  });

  sleep(0.5);

  // Group 4: Get Invited Surveys
  group('Surveys - Invited Surveys', function () {
    const res = http.get(SURVEYS.invitedForUser, {
      headers: getAuthHeaders(accessToken),
    });

    const success = check(res, {
      'invited surveys status is 200': (r) => r.status === 200,
    });

    recordRequest(success, res.timings.duration, surveyLatency);
  });

  sleep(0.5);

  // Group 5: Get Specific Survey (if exists)
  group('Surveys - Get Survey Details', function () {
    const res = http.get(SURVEYS.get(TEST_DATA.surveys.publicSurveyId), {
      headers: getAuthHeaders(accessToken),
    });

    // May return 404 if survey doesn't exist
    const success = check(res, {
      'get survey status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    recordRequest(success, res.timings.duration, surveyLatency);
  });

  sleep(0.5);

  // Group 6: Get User's Response to Survey
  group('Surveys - Get User Response', function () {
    const res = http.get(SURVEYS.userResponse(TEST_DATA.surveys.publicSurveyId), {
      headers: getAuthHeaders(accessToken),
    });

    // May return 404 if no response exists
    const success = check(res, {
      'user response status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    recordRequest(success, res.timings.duration, surveyLatency);
  });

  sleep(1);
}

export function teardown(data) {
  console.log('Surveys Load Test Complete');
}
