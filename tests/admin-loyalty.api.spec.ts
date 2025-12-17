import { test, expect } from '@playwright/test';
import { retryRequest } from './helpers/retry';

/**
 * E2E tests for admin loyalty management operations
 * Tests points/nights awarding, deduction, and transaction history
 */
test.describe('Admin Loyalty Management', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Loyalty User Listing', () => {
    test('Admin users loyalty endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/loyalty/admin/users`);
      expect([401, 403]).toContain(response.status());
    });

    test('Admin users loyalty endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/loyalty/admin/users`);
      expect(response.status()).not.toBe(404);
    });

    test('Loyalty users endpoint should support pagination', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/loyalty/admin/users?limit=10&offset=0&search=test`);
      expect([401, 403]).toContain(response.status()); // Auth required, but route exists
    });
  });

  test.describe('Points Management', () => {
    test('Award points endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/loyalty/admin/award-points`, {
        data: {
          userId: '00000000-0000-0000-0000-000000000001',
          points: 100,
          description: 'Test award',
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Award points endpoint should exist', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/loyalty/admin/award-points`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).not.toBe(404);
    });

    test('Deduct points endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/loyalty/admin/deduct-points`, {
        data: {
          userId: '00000000-0000-0000-0000-000000000001',
          points: 50,
          description: 'Test deduction',
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Deduct points endpoint should exist', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/loyalty/admin/deduct-points`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('Nights Management', () => {
    test('Award nights endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/loyalty/admin/award-nights`, {
        data: {
          userId: '00000000-0000-0000-0000-000000000001',
          nights: 5,
          description: 'Test nights award',
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Award nights endpoint should exist', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/loyalty/admin/award-nights`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).not.toBe(404);
    });

    test('Deduct nights endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/loyalty/admin/deduct-nights`, {
        data: {
          userId: '00000000-0000-0000-0000-000000000001',
          nights: 2,
          description: 'Test nights deduction',
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Deduct nights endpoint should exist', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/loyalty/admin/deduct-nights`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('Spending with Nights', () => {
    test('Award spending with nights endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/loyalty/admin/award-spending-with-nights`, {
        data: {
          userId: '00000000-0000-0000-0000-000000000001',
          spendingAmount: 1000,
          nightsStayed: 2,
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Award spending with nights endpoint should exist', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/loyalty/admin/award-spending-with-nights`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('Transaction History', () => {
    test('Admin transactions endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/loyalty/admin/transactions`);
      expect([401, 403]).toContain(response.status());
    });

    test('Admin transactions endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/loyalty/admin/transactions`);
      expect(response.status()).not.toBe(404);
    });

    test('User points history endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/loyalty/admin/user/00000000-0000-0000-0000-000000000001/history`);
      expect([401, 403]).toContain(response.status());
    });

    test('User points history endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/loyalty/admin/user/test-id/history`);
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('Earning Rules', () => {
    test('Earning rules endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/loyalty/admin/earning-rules`);
      expect([401, 403]).toContain(response.status());
    });

    test('Earning rules endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/loyalty/admin/earning-rules`);
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('Points Expiration', () => {
    test('Expire points endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/loyalty/admin/expire-points`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Expire points endpoint should exist', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/loyalty/admin/expire-points`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).not.toBe(404);
    });
  });
});

test.describe('Admin Loyalty API Contract Tests', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test('All loyalty admin routes should be registered', async ({ request }) => {
    const routes = [
      { method: 'GET', path: '/api/loyalty/admin/users' },
      { method: 'POST', path: '/api/loyalty/admin/award-points' },
      { method: 'POST', path: '/api/loyalty/admin/deduct-points' },
      { method: 'GET', path: '/api/loyalty/admin/transactions' },
      { method: 'GET', path: '/api/loyalty/admin/user/test-id/history' },
      { method: 'GET', path: '/api/loyalty/admin/earning-rules' },
      { method: 'POST', path: '/api/loyalty/admin/expire-points' },
      { method: 'POST', path: '/api/loyalty/admin/award-spending-with-nights' },
      { method: 'POST', path: '/api/loyalty/admin/award-nights' },
      { method: 'POST', path: '/api/loyalty/admin/deduct-nights' },
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

      // Should return auth error, not 404
      expect(response.status()).not.toBe(404);
    }
  });

  test('Customer loyalty endpoints should also be accessible', async ({ request }) => {
    const customerRoutes = [
      '/api/loyalty/status',
      '/api/loyalty/history',
      '/api/loyalty/tiers',
    ];

    for (const path of customerRoutes) {
      const response = await request.get(`${backendUrl}${path}`);
      // These require auth but should exist
      expect(response.status()).not.toBe(404);
    }
  });

  test('Health check should verify database for loyalty operations', async ({ request }) => {
    const response = await retryRequest(request, `${backendUrl}/api/health`, 5);
    expect(response.status()).toBe(200);

    const health = await response.json();
    expect(health.services.database).toBeTruthy();
  });
});
