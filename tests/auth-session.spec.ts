import { test, expect } from '@playwright/test';
import { retryRequest } from './helpers/retry';

/**
 * E2E tests for authentication and session management
 * Tests token validation, role-based access, and session persistence
 */
test.describe('Authentication and Session Tests', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Token Validation', () => {
    test('Auth endpoints should be accessible', async ({ request }) => {
      const authEndpoints = [
        '/api/auth/register',
        '/api/auth/login',
        '/api/auth/refresh',
      ];

      for (const endpoint of authEndpoints) {
        const response = await request.post(`${backendUrl}${endpoint}`, {
          data: {},
          headers: { 'Content-Type': 'application/json' },
        });

        // Should return validation error, not 404 (route exists)
        expect(response.status()).not.toBe(404);
      }
    });

    test('Protected endpoints should reject missing tokens', async ({ request }) => {
      const protectedEndpoints = [
        '/api/auth/me',
        '/api/coupons/my-coupons',
        '/api/users/profile',
      ];

      for (const endpoint of protectedEndpoints) {
        const response = await request.get(`${backendUrl}${endpoint}`);
        expect(response.status()).toBe(401);
      }
    });

    test('Protected endpoints should reject invalid tokens', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/auth/me`, {
        headers: {
          'Authorization': 'Bearer invalid-token-here',
        },
      });

      expect(response.status()).toBe(401);
    });

    test('Protected endpoints should reject malformed authorization header', async ({ request }) => {
      const malformedHeaders = [
        'invalid-token',
        'Basic dXNlcjpwYXNz',
        'Bearer',
        '',
      ];

      for (const header of malformedHeaders) {
        const response = await request.get(`${backendUrl}/api/auth/me`, {
          headers: {
            'Authorization': header,
          },
        });

        expect(response.status()).toBe(401);
      }
    });
  });

  test.describe('OAuth Endpoints', () => {
    test('Google OAuth endpoint should be accessible', async ({ request }) => {
      const response = await retryRequest(request, `${backendUrl}/api/oauth/google`, 3, {
        maxRedirects: 0,
      });

      // Should redirect to Google or return error if not configured
      expect([200, 302, 400, 500]).toContain(response.status());
    });

    test('LINE OAuth endpoint should be accessible', async ({ request }) => {
      const response = await retryRequest(request, `${backendUrl}/api/oauth/line`, 3, {
        maxRedirects: 0,
      });

      // Should redirect to LINE or return error if not configured
      expect([200, 302, 400, 500]).toContain(response.status());
    });

    test('OAuth me endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/oauth/me`);
      expect(response.status()).toBe(401);
    });
  });

  test.describe('Token Refresh', () => {
    test('Refresh endpoint should validate refresh token', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/auth/refresh`, {
        data: {
          refreshToken: 'invalid-refresh-token',
        },
        headers: { 'Content-Type': 'application/json' },
      });

      // Should return 401 for invalid refresh token
      expect(response.status()).toBe(401);
    });

    test('Refresh endpoint should require refresh token', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/auth/refresh`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });

      // Should return 400 or 401 for missing token
      expect([400, 401]).toContain(response.status());
    });
  });

  test.describe('Role-Based Access', () => {
    test('Admin endpoints should require admin role', async ({ request }) => {
      const adminEndpoints = [
        { method: 'GET', path: '/api/users/admin/list' },
        { method: 'GET', path: '/api/coupons/analytics/stats' },
        { method: 'POST', path: '/api/coupons/assign' },
      ];

      for (const endpoint of adminEndpoints) {
        let response;
        if (endpoint.method === 'GET') {
          response = await request.get(`${backendUrl}${endpoint.path}`);
        } else {
          response = await request.post(`${backendUrl}${endpoint.path}`, {
            data: {},
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Should return 401 without token
        expect(response.status()).toBe(401);
      }
    });
  });

  test.describe('Login Validation', () => {
    test('Login should validate email format', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/auth/login`, {
        data: {
          email: 'invalid-email',
          password: 'password123',
        },
        headers: { 'Content-Type': 'application/json' },
      });

      // Should return 400 for invalid email format
      expect([400, 401]).toContain(response.status());
    });

    test('Login should require password', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/auth/login`, {
        data: {
          email: 'test@example.com',
        },
        headers: { 'Content-Type': 'application/json' },
      });

      // Should return 400 for missing password
      expect([400, 401]).toContain(response.status());
    });

    test('Login should reject wrong credentials', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/auth/login`, {
        data: {
          email: 'nonexistent@example.com',
          password: 'wrongpassword',
        },
        headers: { 'Content-Type': 'application/json' },
      });

      // Should return 401 for wrong credentials
      expect(response.status()).toBe(401);
    });
  });

  test.describe('Registration Validation', () => {
    test('Registration should validate required fields', async ({ request }) => {
      const invalidRegistrations = [
        { email: '', password: 'Pass123!' },
        { email: 'test@test.com', password: '' },
        { email: 'invalid-email', password: 'Pass123!' },
        { email: 'test@test.com', password: '123' }, // Too short
      ];

      for (const data of invalidRegistrations) {
        const response = await request.post(`${backendUrl}/api/auth/register`, {
          data,
          headers: { 'Content-Type': 'application/json' },
        });

        // Should return 400 for validation errors
        expect([400, 401, 409]).toContain(response.status());
      }
    });
  });
});

test.describe('Session Persistence Checks', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test('Health endpoint should always be accessible', async ({ request }) => {
    const response = await retryRequest(request, `${backendUrl}/api/health`, 5);
    expect(response.status()).toBe(200);

    const health = await response.json();
    expect(health.status).toBeTruthy();
  });

  test('Database should be connected', async ({ request }) => {
    const response = await retryRequest(request, `${backendUrl}/api/health`, 3);
    expect(response.status()).toBe(200);

    const health = await response.json();
    expect(health.database).toBeTruthy();
  });
});
