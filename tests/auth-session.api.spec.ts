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
        expect([401, 403]).toContain(response.status());
      }
    });

    test('Protected endpoints should reject invalid tokens', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/auth/me`, {
        headers: {
          'Authorization': 'Bearer invalid-token-here',
        },
      });

      expect([401, 403]).toContain(response.status());
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

        expect([401, 403]).toContain(response.status());
      }
    });
  });

  test.describe('OAuth Endpoints', () => {
    test('Google OAuth endpoint should be accessible', async ({ request }) => {
      const response = await retryRequest(request, `${backendUrl}/api/oauth/google`, 3, {
        maxRedirects: 0,
      });

      // Should redirect to Google or return error if not configured
      // 303 is used by Axum's Redirect::to() (See Other)
      expect([200, 302, 303, 400, 500]).toContain(response.status());
    });

    test('LINE OAuth endpoint should be accessible', async ({ request }) => {
      const response = await retryRequest(request, `${backendUrl}/api/oauth/line`, 3, {
        maxRedirects: 0,
      });

      // Should redirect to LINE or return error if not configured
      // 303 is used by Axum's Redirect::to() (See Other)
      expect([200, 302, 303, 400, 500]).toContain(response.status());
    });

    test('OAuth me endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/oauth/me`);
      expect([401, 403]).toContain(response.status());
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
      expect([401, 403]).toContain(response.status());
    });

    test('Refresh endpoint should require refresh token', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/auth/refresh`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });

      // Should return 400 or 401 for missing token (422 from Axum JSON extractor)
      expect([400, 401, 422]).toContain(response.status());
    });

    test('Refresh endpoint should reject expired refresh token with 401', async ({ request }) => {
      // Simulate an expired refresh token (malformed JWT that looks like it could be valid)
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6InRlc3QtdXNlciIsImlhdCI6MTYwMDAwMDAwMCwiZXhwIjoxNjAwMDAwMDAxfQ.invalid';

      const response = await request.post(`${backendUrl}/api/auth/refresh`, {
        data: {
          refreshToken: expiredToken,
        },
        headers: { 'Content-Type': 'application/json' },
      });

      // Should return 401 for expired/invalid token - not 500 or other errors
      expect([401, 403]).toContain(response.status());

      // Response should have error details
      const body = await response.json();
      expect(body.error || body.message).toBeTruthy();
    });

    test('Refresh endpoint should return proper error structure on failure', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/auth/refresh`, {
        data: {
          refreshToken: 'completely-invalid-token',
        },
        headers: { 'Content-Type': 'application/json' },
      });

      expect([401, 403]).toContain(response.status());

      // Error response should be properly formatted JSON
      const body = await response.json();
      expect(typeof body).toBe('object');
      // Should have error message
      expect(body.error || body.message).toBeTruthy();
    });

    test('Multiple rapid refresh requests with invalid token should all return 401', async ({ request }) => {
      // This test ensures the backend handles rapid requests properly
      // (simulates what happens when frontend accidentally makes multiple refresh calls)
      const invalidToken = 'invalid-refresh-token';

      const requests = Array(3).fill(null).map(() =>
        request.post(`${backendUrl}/api/auth/refresh`, {
          data: { refreshToken: invalidToken },
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const responses = await Promise.all(requests);

      // All requests should return 401, not cause server errors
      for (const response of responses) {
        expect([401, 403]).toContain(response.status());
      }
    });
  });

  test.describe('Role-Based Access', () => {
    test('Admin endpoints should require admin role', async ({ request }) => {
      const adminEndpoints = [
        { method: 'GET', path: '/api/admin/users' },
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
        expect([401, 403]).toContain(response.status());
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

      // Should return 400 for invalid email format (422 from Axum JSON extractor)
      expect([400, 401, 422]).toContain(response.status());
    });

    test('Login should require password', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/auth/login`, {
        data: {
          email: 'test@example.com',
        },
        headers: { 'Content-Type': 'application/json' },
      });

      // Should return 400 for missing password (422 from Axum JSON extractor)
      expect([400, 401, 422]).toContain(response.status());
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
      expect([401, 403]).toContain(response.status());
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

        // Should return 400 for validation errors (422 from Axum JSON extractor)
        expect([400, 401, 409, 422]).toContain(response.status());
      }
    });
  });

  test.describe('Registration creates notification preferences', () => {
    test('New user registration should create notification preferences', async ({ request }) => {
      // Get CSRF token and cookies first
      const csrfResponse = await request.get(`${backendUrl}/api/csrf-token`);
      const csrfCookies = csrfResponse.headers()['set-cookie'];
      const cookies = csrfCookies
        ? (Array.isArray(csrfCookies) ? csrfCookies : [csrfCookies])
        : [];

      let csrfToken = '';
      if (csrfResponse.ok()) {
        const csrfData = await csrfResponse.json();
        csrfToken = csrfData.csrfToken || '';
      }

      // Register a new user with unique email
      const uniqueEmail = `test-notif-${Date.now()}@example.com`;
      const requestData = {
        email: uniqueEmail,
        password: 'TestPass123!',
        firstName: 'Notif',
        lastName: 'Test',
      };

      const registerResponse = await request.post(`${backendUrl}/api/auth/register`, {
        data: requestData,
        headers: {
          'Content-Type': 'application/json',
          ...(cookies.length > 0 && { 'Cookie': cookies.join('; ') }),
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      // Registration should succeed
      expect(registerResponse.ok()).toBeTruthy();
      const registerData = await registerResponse.json();
      const authToken = registerData.tokens?.accessToken || registerData.accessToken;
      expect(authToken).toBeTruthy();

      // Fetch notification preferences using the token
      const prefsResponse = await request.get(`${backendUrl}/api/notifications/preferences`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      expect(prefsResponse.ok()).toBeTruthy();
      const prefsData = await prefsResponse.json();

      // Should have 11 notification preferences created
      // The trigger migration ensures explicit creation in authService
      expect(Array.isArray(prefsData.preferences)).toBeTruthy();
      expect(prefsData.preferences.length).toBeGreaterThanOrEqual(11);
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
    expect(health.services.database).toBeTruthy();
  });
});
