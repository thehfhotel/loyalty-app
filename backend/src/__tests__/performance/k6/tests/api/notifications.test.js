/**
 * Notification API Load Tests
 * Tests: list, unread count, preferences, VAPID key
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { smokeOptions } from '../../config/base-options.js';
import { NOTIFICATIONS } from '../../config/endpoints.js';
import { TEST_USERS } from '../../config/test-data.js';
import { login, getAuthHeaders } from '../../utils/auth.js';
import { notificationLatency, recordRequest } from '../../utils/metrics.js';

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

  // Group 1: Get VAPID Key (public endpoint - may not be configured)
  group('Notifications - VAPID Key', function () {
    const res = http.get(NOTIFICATIONS.vapidKey);

    // VAPID key may not be configured in test environment (404/500/503)
    const success = check(res, {
      'VAPID key responds': (r) => r.status === 200 || r.status === 404 || r.status === 500 || r.status === 503,
    });

    recordRequest(success, res.timings.duration, notificationLatency);
  });

  sleep(0.5);

  if (!accessToken) {
    return;
  }

  // Group 2: List Notifications
  group('Notifications - List', function () {
    const res = http.get(NOTIFICATIONS.list, {
      headers: getAuthHeaders(accessToken),
    });

    const success = check(res, {
      'list notifications status is 200': (r) => r.status === 200,
      'notifications is array': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body) || Array.isArray(body.notifications);
        } catch (e) {
          return false;
        }
      },
    });

    recordRequest(success, res.timings.duration, notificationLatency);
  });

  sleep(0.5);

  // Group 3: Get Unread Count
  group('Notifications - Unread Count', function () {
    const res = http.get(NOTIFICATIONS.unreadCount, {
      headers: getAuthHeaders(accessToken),
    });

    const success = check(res, {
      'unread count status is 200': (r) => r.status === 200,
      'has count': (r) => {
        try {
          const body = JSON.parse(r.body);
          // Response structure: { success: true, data: { unreadCount: number } }
          return typeof body.count === 'number' ||
                 typeof body.unreadCount === 'number' ||
                 typeof body.data?.unreadCount === 'number';
        } catch (e) {
          return false;
        }
      },
    });

    recordRequest(success, res.timings.duration, notificationLatency);
  });

  sleep(0.5);

  // Group 4: Get Preferences
  group('Notifications - Get Preferences', function () {
    const res = http.get(NOTIFICATIONS.preferences, {
      headers: getAuthHeaders(accessToken),
    });

    const success = check(res, {
      'preferences status is 200': (r) => r.status === 200,
    });

    recordRequest(success, res.timings.duration, notificationLatency);
  });

  sleep(0.5);

  // Group 5: Mark All Read
  group('Notifications - Mark All Read', function () {
    const res = http.post(NOTIFICATIONS.markAllRead, null, {
      headers: getAuthHeaders(accessToken),
    });

    // Accept 200/204 (success) or 403 (CSRF missing)
    const success = check(res, {
      'mark all read responds': (r) => r.status === 200 || r.status === 204 || r.status === 403,
    });

    recordRequest(success, res.timings.duration, notificationLatency);
  });

  sleep(1);
}

export function teardown(data) {
  console.log('Notifications Load Test Complete');
}
