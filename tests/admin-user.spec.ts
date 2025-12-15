import { test, expect } from '@playwright/test';
import { retryRequest } from './helpers/retry';

/**
 * E2E tests for admin user management operations
 * Tests user listing, status updates, role management, and user deletion
 */
test.describe('Admin User Management', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('User Listing Endpoints', () => {
    test('Admin user list endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/users/admin/users`);
      expect(response.status()).toBe(401);
    });

    test('Admin user list endpoint should reject invalid tokens', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/users/admin/users`, {
        headers: {
          'Authorization': 'Bearer invalid-token',
        },
      });
      expect(response.status()).toBe(401);
    });

    test('Admin user list endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/users/admin/users`);
      // Should return 401 (auth required), not 404 (route exists)
      expect(response.status()).not.toBe(404);
    });

    test('Admin user list should support pagination parameters', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/users/admin/users?page=1&limit=10&search=test`);
      // Without auth, returns 401, but route should exist
      expect(response.status()).toBe(401);
    });
  });

  test.describe('User Statistics', () => {
    test('Admin stats endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/users/admin/stats`);
      expect(response.status()).toBe(401);
    });

    test('Admin stats endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/users/admin/stats`);
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('User Details', () => {
    test('Get user by ID endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/users/admin/users/00000000-0000-0000-0000-000000000001`);
      expect(response.status()).toBe(401);
    });

    test('Get user by ID endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/users/admin/users/some-user-id`);
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('User Status Management', () => {
    test('Update user status endpoint should require authentication', async ({ request }) => {
      const response = await request.patch(`${backendUrl}/api/users/admin/users/00000000-0000-0000-0000-000000000001/status`, {
        data: { isActive: false },
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).toBe(401);
    });

    test('Update user status endpoint should exist', async ({ request }) => {
      const response = await request.patch(`${backendUrl}/api/users/admin/users/test-id/status`, {
        data: { isActive: true },
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('User Role Management', () => {
    test('Update user role endpoint should require authentication', async ({ request }) => {
      const response = await request.patch(`${backendUrl}/api/users/admin/users/00000000-0000-0000-0000-000000000001/role`, {
        data: { role: 'admin' },
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).toBe(401);
    });

    test('Update user role endpoint should exist', async ({ request }) => {
      const response = await request.patch(`${backendUrl}/api/users/admin/users/test-id/role`, {
        data: { role: 'customer' },
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('User Deletion', () => {
    test('Delete user endpoint should require authentication', async ({ request }) => {
      const response = await request.delete(`${backendUrl}/api/users/admin/users/00000000-0000-0000-0000-000000000001`);
      expect(response.status()).toBe(401);
    });

    test('Delete user endpoint should exist', async ({ request }) => {
      const response = await request.delete(`${backendUrl}/api/users/admin/users/test-id`);
      expect(response.status()).not.toBe(404);
    });
  });

  test.describe('New Member Coupon Settings', () => {
    test('Get new member coupon settings should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/users/admin/new-member-coupon-settings`);
      expect(response.status()).toBe(401);
    });

    test('Update new member coupon settings should require authentication', async ({ request }) => {
      const response = await request.put(`${backendUrl}/api/users/admin/new-member-coupon-settings`, {
        data: { enabled: true },
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).toBe(401);
    });

    test('New member coupon settings endpoints should exist', async ({ request }) => {
      const getResponse = await request.get(`${backendUrl}/api/users/admin/new-member-coupon-settings`);
      expect(getResponse.status()).not.toBe(404);

      const putResponse = await request.put(`${backendUrl}/api/users/admin/new-member-coupon-settings`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect(putResponse.status()).not.toBe(404);
    });
  });

  test.describe('Admin Coupon Status', () => {
    test('Get coupon status endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/users/admin/coupon-status/00000000-0000-0000-0000-000000000001`);
      expect(response.status()).toBe(401);
    });

    test('Get coupon status endpoint should exist', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/users/admin/coupon-status/test-coupon-id`);
      expect(response.status()).not.toBe(404);
    });
  });
});

test.describe('Admin User API Contract Tests', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test('User management routes should be properly registered', async ({ request }) => {
    const routes = [
      { method: 'GET', path: '/api/users/admin/users' },
      { method: 'GET', path: '/api/users/admin/stats' },
      { method: 'GET', path: '/api/users/admin/users/test-id' },
      { method: 'PATCH', path: '/api/users/admin/users/test-id/status' },
      { method: 'PATCH', path: '/api/users/admin/users/test-id/role' },
      { method: 'DELETE', path: '/api/users/admin/users/test-id' },
      { method: 'GET', path: '/api/users/admin/new-member-coupon-settings' },
      { method: 'PUT', path: '/api/users/admin/new-member-coupon-settings' },
    ];

    for (const route of routes) {
      let response;
      switch (route.method) {
        case 'GET':
          response = await request.get(`${backendUrl}${route.path}`);
          break;
        case 'POST':
          response = await request.post(`${backendUrl}${route.path}`, {
            data: {},
            headers: { 'Content-Type': 'application/json' },
          });
          break;
        case 'PUT':
          response = await request.put(`${backendUrl}${route.path}`, {
            data: {},
            headers: { 'Content-Type': 'application/json' },
          });
          break;
        case 'PATCH':
          response = await request.patch(`${backendUrl}${route.path}`, {
            data: {},
            headers: { 'Content-Type': 'application/json' },
          });
          break;
        case 'DELETE':
          response = await request.delete(`${backendUrl}${route.path}`);
          break;
      }

      // Routes should exist (not 404)
      expect(response?.status()).not.toBe(404);
    }
  });

  test('Health check should pass before testing admin endpoints', async ({ request }) => {
    const response = await retryRequest(request, `${backendUrl}/api/health`, 5);
    expect(response.status()).toBe(200);

    const health = await response.json();
    expect(health.status).toBeTruthy();
    expect(health.database).toBeTruthy();
  });
});
