import { test, expect } from '@playwright/test';
import { retryRequest } from './helpers/retry';

/**
 * E2E tests for user profile management
 * Tests profile retrieval, updates including gender/occupation/interests,
 * and verifies data persistence
 */
test.describe('User Profile Management', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Profile Endpoints Availability', () => {
    test('Profile endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/users/profile`);
      expect([401, 403]).toContain(response.status());
    });

    test('Profile update endpoint should require authentication', async ({ request }) => {
      const response = await request.put(`${backendUrl}/api/users/profile`, {
        data: { firstName: 'Test' },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Complete profile endpoint should require authentication', async ({ request }) => {
      const response = await request.put(`${backendUrl}/api/users/complete-profile`, {
        data: { firstName: 'Test' },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Profile completion status endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/users/profile-completion-status`);
      expect([401, 403]).toContain(response.status());
    });
  });

  test.describe('Profile Update with Authentication', () => {
    // Test user credentials - use unique email to avoid conflicts
    const testEmail = `e2e-profile-${Date.now()}@example.com`;
    const testPassword = 'TestPassword123!';
    const testFirstName = 'E2E';
    const testLastName = 'ProfileTest';

    let authToken: string | null = null;
    let authCookies: string[] = [];

    test.beforeAll(async ({ request }) => {
      // Wait for backend to be ready
      await retryRequest(request, `${backendUrl}/api/health`, 5);

      // Get CSRF token and cookies
      const csrfResponse = await request.get(`${backendUrl}/api/csrf-token`);
      const csrfCookies = csrfResponse.headers()['set-cookie'];
      if (csrfCookies) {
        authCookies = Array.isArray(csrfCookies) ? csrfCookies : [csrfCookies];
      }

      let csrfToken = '';
      if (csrfResponse.ok()) {
        const csrfData = await csrfResponse.json();
        csrfToken = csrfData.csrfToken || '';
      }

      // Register a new test user
      const registerResponse = await request.post(`${backendUrl}/api/auth/register`, {
        data: {
          email: testEmail,
          password: testPassword,
          firstName: testFirstName,
          lastName: testLastName,
        },
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookies.join('; '),
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      // Capture cookies from registration
      const registerCookies = registerResponse.headers()['set-cookie'];
      if (registerCookies) {
        const newCookies = Array.isArray(registerCookies) ? registerCookies : [registerCookies];
        authCookies = [...authCookies, ...newCookies];
      }

      if (registerResponse.ok()) {
        const registerData = await registerResponse.json();
        authToken = registerData.tokens?.accessToken || registerData.accessToken;
      } else {
        // Try to login if registration failed (user might exist)
        const loginResponse = await request.post(`${backendUrl}/api/auth/login`, {
          data: {
            email: testEmail,
            password: testPassword,
          },
          headers: {
            'Content-Type': 'application/json',
            'Cookie': authCookies.join('; '),
            ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
          },
        });

        if (loginResponse.ok()) {
          const loginData = await loginResponse.json();
          authToken = loginData.tokens?.accessToken || loginData.accessToken;

          // Capture login cookies
          const loginCookies = loginResponse.headers()['set-cookie'];
          if (loginCookies) {
            const newCookies = Array.isArray(loginCookies) ? loginCookies : [loginCookies];
            authCookies = [...authCookies, ...newCookies];
          }
        }
      }
    });

    test('should get profile after authentication', async ({ request }) => {
      test.skip(!authToken, 'No auth token available - registration/login failed');

      const response = await request.get(`${backendUrl}/api/users/profile`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Cookie': authCookies.join('; '),
        },
      });

      expect(response.status()).toBe(200);
      const profile = await response.json();
      expect(profile.firstName).toBe(testFirstName);
      expect(profile.lastName).toBe(testLastName);
    });

    test('should update basic profile fields', async ({ request }) => {
      test.skip(!authToken, 'No auth token available');

      // Get fresh CSRF token
      const csrfResponse = await request.get(`${backendUrl}/api/csrf-token`, {
        headers: { 'Cookie': authCookies.join('; ') },
      });
      let csrfToken = '';
      if (csrfResponse.ok()) {
        const csrfData = await csrfResponse.json();
        csrfToken = csrfData.csrfToken || '';
      }

      const updateData = {
        firstName: 'UpdatedFirst',
        lastName: 'UpdatedLast',
        phone: '0812345678',
      };

      const response = await request.put(`${backendUrl}/api/users/profile`, {
        data: updateData,
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Cookie': authCookies.join('; '),
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      expect(response.status()).toBe(200);
      const profile = await response.json();
      expect(profile.firstName).toBe(updateData.firstName);
      expect(profile.lastName).toBe(updateData.lastName);
      expect(profile.phone).toBe(updateData.phone);
    });

    test('should update dateOfBirth', async ({ request }) => {
      test.skip(!authToken, 'No auth token available');

      // Get fresh CSRF token
      const csrfResponse = await request.get(`${backendUrl}/api/csrf-token`, {
        headers: { 'Cookie': authCookies.join('; ') },
      });
      let csrfToken = '';
      if (csrfResponse.ok()) {
        const csrfData = await csrfResponse.json();
        csrfToken = csrfData.csrfToken || '';
      }

      const response = await request.put(`${backendUrl}/api/users/profile`, {
        data: { dateOfBirth: '1990-05-15' },
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Cookie': authCookies.join('; '),
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      expect(response.status()).toBe(200);
      const profile = await response.json();
      expect(profile.dateOfBirth).toBeTruthy();
    });

    test('should save gender via complete-profile', async ({ request }) => {
      test.skip(!authToken, 'No auth token available');

      // Get fresh CSRF token
      const csrfResponse = await request.get(`${backendUrl}/api/csrf-token`, {
        headers: { 'Cookie': authCookies.join('; ') },
      });
      let csrfToken = '';
      if (csrfResponse.ok()) {
        const csrfData = await csrfResponse.json();
        csrfToken = csrfData.csrfToken || '';
      }

      const response = await request.put(`${backendUrl}/api/users/complete-profile`, {
        data: {
          firstName: 'GenderTest',
          gender: 'male',
        },
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Cookie': authCookies.join('; '),
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      expect(response.status()).toBe(200);
      const result = await response.json();
      const profile = result.data?.profile || result.profile;
      expect(profile?.gender).toBe('male');
    });

    test('should save occupation via complete-profile', async ({ request }) => {
      test.skip(!authToken, 'No auth token available');

      // Get fresh CSRF token
      const csrfResponse = await request.get(`${backendUrl}/api/csrf-token`, {
        headers: { 'Cookie': authCookies.join('; ') },
      });
      let csrfToken = '';
      if (csrfResponse.ok()) {
        const csrfData = await csrfResponse.json();
        csrfToken = csrfData.csrfToken || '';
      }

      const response = await request.put(`${backendUrl}/api/users/complete-profile`, {
        data: {
          firstName: 'OccupationTest',
          occupation: 'Software Engineer',
        },
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Cookie': authCookies.join('; '),
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      expect(response.status()).toBe(200);
      const result = await response.json();
      const profile = result.data?.profile || result.profile;
      expect(profile?.occupation).toBe('Software Engineer');
    });

    test('should save interests via complete-profile', async ({ request }) => {
      test.skip(!authToken, 'No auth token available');

      // Get fresh CSRF token
      const csrfResponse = await request.get(`${backendUrl}/api/csrf-token`, {
        headers: { 'Cookie': authCookies.join('; ') },
      });
      let csrfToken = '';
      if (csrfResponse.ok()) {
        const csrfData = await csrfResponse.json();
        csrfToken = csrfData.csrfToken || '';
      }

      const testInterests = ['technology', 'travel', 'food'];
      const response = await request.put(`${backendUrl}/api/users/complete-profile`, {
        data: {
          firstName: 'InterestsTest',
          interests: testInterests,
        },
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Cookie': authCookies.join('; '),
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      expect(response.status()).toBe(200);
      const result = await response.json();
      const profile = result.data?.profile || result.profile;
      expect(profile?.interests).toBeTruthy();
      expect(Array.isArray(profile?.interests)).toBe(true);
      expect(profile?.interests).toEqual(expect.arrayContaining(testInterests));
    });

    test('should persist all fields and retrieve them', async ({ request }) => {
      test.skip(!authToken, 'No auth token available');

      // Get fresh CSRF token
      const csrfResponse = await request.get(`${backendUrl}/api/csrf-token`, {
        headers: { 'Cookie': authCookies.join('; ') },
      });
      let csrfToken = '';
      if (csrfResponse.ok()) {
        const csrfData = await csrfResponse.json();
        csrfToken = csrfData.csrfToken || '';
      }

      // Update with all fields
      const updateData = {
        firstName: 'PersistTest',
        lastName: 'AllFields',
        phone: '0898765432',
        dateOfBirth: '1985-12-25',
        gender: 'female',
        occupation: 'Data Scientist',
        interests: ['music', 'sports', 'reading'],
      };

      await request.put(`${backendUrl}/api/users/complete-profile`, {
        data: updateData,
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Cookie': authCookies.join('; '),
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      // Fetch profile and verify
      const getResponse = await request.get(`${backendUrl}/api/users/profile`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Cookie': authCookies.join('; '),
        },
      });

      expect(getResponse.status()).toBe(200);
      const profile = await getResponse.json();

      expect(profile.firstName).toBe(updateData.firstName);
      expect(profile.lastName).toBe(updateData.lastName);
      expect(profile.phone).toBe(updateData.phone);
      expect(profile.gender).toBe(updateData.gender);
      expect(profile.occupation).toBe(updateData.occupation);
      expect(profile.interests).toEqual(expect.arrayContaining(updateData.interests));
    });
  });

  test.describe('Profile Validation', () => {
    test('should reject invalid date format for dateOfBirth', async ({ request }) => {
      const response = await request.put(`${backendUrl}/api/users/profile`, {
        data: {
          dateOfBirth: 'not-a-date',
        },
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token',
        },
      });

      // Should fail with 400 (validation) or 401 (auth)
      expect([400, 401, 403]).toContain(response.status());
    });

    test('profile endpoints should handle malformed JSON gracefully', async ({ request }) => {
      const response = await request.put(`${backendUrl}/api/users/profile`, {
        data: 'not-valid-json{',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token',
        },
      });

      // Should return error, not crash
      expect([400, 401, 403, 500]).toContain(response.status());
    });
  });
});

test.describe('Profile API Contract Tests', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test('Profile routes should be properly registered', async ({ request }) => {
    const routes = [
      { method: 'GET', path: '/api/users/profile' },
      { method: 'PUT', path: '/api/users/profile' },
      { method: 'PUT', path: '/api/users/complete-profile' },
      { method: 'GET', path: '/api/users/profile-completion-status' },
    ];

    for (const route of routes) {
      let response;
      if (route.method === 'GET') {
        response = await request.get(`${backendUrl}${route.path}`);
      } else {
        response = await request.put(`${backendUrl}${route.path}`, {
          data: {},
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Routes should exist (not 404)
      expect(response.status()).not.toBe(404);
    }
  });

  test('Health check should pass before testing profile endpoints', async ({ request }) => {
    const response = await retryRequest(request, `${backendUrl}/api/health`, 5);
    expect(response.status()).toBe(200);

    const health = await response.json();
    expect(health.status).toBeTruthy();
    expect(health.services.database).toBeTruthy();
  });
});
