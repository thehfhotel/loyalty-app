import { test, expect } from '@playwright/test';
import { retryRequest } from './helpers/retry';

/**
 * E2E tests for miscellaneous admin operations
 * Tests analytics, storage, notifications, and membership admin endpoints
 */
test.describe('Admin Analytics Operations', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Analytics Dashboard', () => {
    test('Analytics dashboard endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/analytics/dashboard`);
      expect([401, 403]).toContain(response.status());
    });

    test('Analytics dashboard endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/analytics/dashboard`);
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('Coupon Usage Analytics', () => {
    test('Coupon usage analytics endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/analytics/coupon-usage`);
      expect([401, 403]).toContain(response.status());
    });

    test('Coupon usage analytics endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/analytics/coupon-usage`);
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('Profile Change Analytics', () => {
    test('Profile changes analytics endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/analytics/profile-changes`);
      expect([401, 403]).toContain(response.status());
    });

    test('Profile changes analytics endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/analytics/profile-changes`);
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('User Engagement Analytics', () => {
    test('User engagement metrics endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/analytics/user-engagement`);
      expect([401, 403]).toContain(response.status());
    });

    test('User engagement metrics endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/analytics/user-engagement`);
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('Daily Analytics Update', () => {
    test('Update daily analytics endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/analytics/update-daily`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Update daily analytics endpoint should exist', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/analytics/update-daily`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).not.toBe(404);
    });
  });
});

test.describe('Admin Storage Operations', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Storage Statistics', () => {
    test('Storage stats endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/storage/stats`);
      expect([401, 403]).toContain(response.status());
    });

    test('Storage stats endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/storage/stats`);
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('Backup Operations', () => {
    test('Backup endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/storage/backup`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Backup endpoint should exist', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/storage/backup`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).not.toBe(404);
    });
  });
});

test.describe('Admin Notifications Operations', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Notification Cleanup', () => {
    test('Cleanup notifications endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/notifications/admin/cleanup`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Cleanup notifications endpoint should exist', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/notifications/admin/cleanup`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('Customer Notification Endpoints', () => {
    test('Get notifications endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/notifications`);
      expect([401, 403]).toContain(response.status());
    });

    test('Mark notification as read endpoint should require authentication', async ({ request }) => {
      const response = await request.patch(`${backendUrl}/api/notifications/00000000-0000-0000-0000-000000000001/read`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Notification endpoints should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/notifications`);
      expect(response.status()).not.toBe(404);
    });
  });
});

test.describe('Admin Membership Operations', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Membership Lookup', () => {
    test('Membership lookup endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/membership/lookup/M12345678`);
      expect([401, 403]).toContain(response.status());
    });

    test('Membership lookup endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/membership/lookup/TEST123`);
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('Membership Statistics', () => {
    test('Membership stats endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/membership/stats`);
      expect([401, 403]).toContain(response.status());
    });

    test('Membership stats endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/membership/stats`);
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('Membership ID Regeneration', () => {
    test('Regenerate membership ID endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/membership/00000000-0000-0000-0000-000000000001/regenerate`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Regenerate membership ID endpoint should exist', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/membership/test-user-id/regenerate`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).not.toBe(404);
    });
  });
});

test.describe('Admin API Contract Tests', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test('All analytics admin routes should be registered', async ({ request }) => {
    const routes = [
      { method: 'GET', path: '/api/analytics/dashboard' },
      { method: 'GET', path: '/api/analytics/coupon-usage' },
      { method: 'GET', path: '/api/analytics/profile-changes' },
      { method: 'GET', path: '/api/analytics/user-engagement' },
      { method: 'POST', path: '/api/analytics/update-daily' },
    ];

    for (const route of routes) {
      let response;
      if (route.method === 'GET') {
        response = await request.get(`${backendUrl}${route.path}`);
      } else {
        response = await request.post(`${backendUrl}${route.path}`, {
          data: {},
          headers: { 'Content-Type': 'application/json' },
        });
      }
      expect(response.status()).not.toBe(404);
    }
  });

  test('All storage admin routes should be registered', async ({ request }) => {
    const routes = [
      { method: 'GET', path: '/api/storage/stats' },
      { method: 'POST', path: '/api/storage/backup' },
    ];

    for (const route of routes) {
      let response;
      if (route.method === 'GET') {
        response = await request.get(`${backendUrl}${route.path}`);
      } else {
        response = await request.post(`${backendUrl}${route.path}`, {
          data: {},
          headers: { 'Content-Type': 'application/json' },
        });
      }
      expect(response.status()).not.toBe(404);
    }
  });

  test('All membership admin routes should be registered', async ({ request }) => {
    const routes = [
      { method: 'GET', path: '/api/membership/lookup/TEST123' },
      { method: 'GET', path: '/api/membership/stats' },
      { method: 'POST', path: '/api/membership/test-id/regenerate' },
    ];

    for (const route of routes) {
      let response;
      if (route.method === 'GET') {
        response = await request.get(`${backendUrl}${route.path}`);
      } else {
        response = await request.post(`${backendUrl}${route.path}`, {
          data: {},
          headers: { 'Content-Type': 'application/json' },
        });
      }
      expect(response.status()).not.toBe(404);
    }
  });

  test('Health check should pass before admin operations', async ({ request }) => {
    const response = await retryRequest(request, `${backendUrl}/api/health`, 5);
    expect(response.status()).toBe(200);

    const health = await response.json();
    expect(health.status).toBeTruthy();
    expect(health.services.database).toBeTruthy();
  });
});
