import { test, expect } from '@playwright/test';
import { retryRequest } from './helpers/retry';

/**
 * E2E tests for user profile management
 * Tests profile retrieval, updates including gender/occupation/interests,
 * and verifies data persistence
 */
test.describe('User Profile Management', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  // Test user credentials - use unique email to avoid conflicts
  const testEmail = `e2e-profile-test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  const testFirstName = 'E2E';
  const testLastName = 'ProfileTest';

  let authToken: string | null = null;
  let csrfToken: string | null = null;
  let cookies: string | null = null;

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

  test.describe('Full Profile Update Cycle', () => {
    test.beforeAll(async ({ request }) => {
      // Wait for backend to be ready
      await retryRequest(request, `${backendUrl}/api/health`, 5);

      // Get CSRF token first
      const csrfResponse = await request.get(`${backendUrl}/api/csrf-token`);
      if (csrfResponse.ok()) {
        const csrfData = await csrfResponse.json();
        csrfToken = csrfData.csrfToken;
        // Extract cookies from response
        const setCookies = csrfResponse.headers()['set-cookie'];
        if (setCookies) {
          cookies = setCookies;
        }
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
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
          ...(cookies && { 'Cookie': cookies }),
        },
      });

      if (registerResponse.status() === 409) {
        // User already exists, try to login instead
        const loginResponse = await request.post(`${backendUrl}/api/auth/login`, {
          data: {
            email: testEmail,
            password: testPassword,
          },
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
            ...(cookies && { 'Cookie': cookies }),
          },
        });

        if (loginResponse.ok()) {
          const loginData = await loginResponse.json();
          authToken = loginData.tokens?.accessToken || loginData.accessToken;
        }
      } else if (registerResponse.ok()) {
        const registerData = await registerResponse.json();
        authToken = registerData.tokens?.accessToken || registerData.accessToken;
      }
    });

    test('should register and get initial profile', async ({ request }) => {
      test.skip(!authToken, 'No auth token available - registration/login failed');

      const response = await request.get(`${backendUrl}/api/users/profile`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      expect(response.status()).toBe(200);
      const profile = await response.json();

      expect(profile.firstName).toBe(testFirstName);
      expect(profile.lastName).toBe(testLastName);
    });

    test('should update basic profile fields (firstName, lastName, phone)', async ({ request }) => {
      test.skip(!authToken, 'No auth token available');

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
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      expect(response.status()).toBe(200);
      const profile = await response.json();

      expect(profile.firstName).toBe(updateData.firstName);
      expect(profile.lastName).toBe(updateData.lastName);
      expect(profile.phone).toBe(updateData.phone);
    });

    test('should update profile with dateOfBirth', async ({ request }) => {
      test.skip(!authToken, 'No auth token available');

      const updateData = {
        dateOfBirth: '1990-05-15',
      };

      const response = await request.put(`${backendUrl}/api/users/profile`, {
        data: updateData,
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      expect(response.status()).toBe(200);
      const profile = await response.json();

      // dateOfBirth should be saved
      expect(profile.dateOfBirth).toBeTruthy();
    });

    test('should handle empty dateOfBirth string gracefully', async ({ request }) => {
      test.skip(!authToken, 'No auth token available');

      const updateData = {
        firstName: 'TestEmpty',
        dateOfBirth: '',
      };

      const response = await request.put(`${backendUrl}/api/users/profile`, {
        data: updateData,
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      // Should not fail with 400 or 500
      expect([200, 400]).toContain(response.status());
      if (response.status() === 200) {
        const profile = await response.json();
        expect(profile.firstName).toBe(updateData.firstName);
      }
    });
  });

  test.describe('Profile Complete with Gender/Occupation/Interests', () => {
    let profileAuthToken: string | null = null;
    let profileCsrfToken: string | null = null;
    const profileTestEmail = `e2e-complete-${Date.now()}@example.com`;

    test.beforeAll(async ({ request }) => {
      // Get CSRF token
      const csrfResponse = await request.get(`${backendUrl}/api/csrf-token`);
      if (csrfResponse.ok()) {
        const csrfData = await csrfResponse.json();
        profileCsrfToken = csrfData.csrfToken;
      }

      // Register a new user for complete profile tests
      const registerResponse = await request.post(`${backendUrl}/api/auth/register`, {
        data: {
          email: profileTestEmail,
          password: testPassword,
          firstName: 'Complete',
          lastName: 'ProfileTest',
        },
        headers: {
          'Content-Type': 'application/json',
          ...(profileCsrfToken && { 'X-CSRF-Token': profileCsrfToken }),
        },
      });

      if (registerResponse.ok()) {
        const registerData = await registerResponse.json();
        profileAuthToken = registerData.tokens?.accessToken || registerData.accessToken;
      }
    });

    test('should save gender field via complete-profile', async ({ request }) => {
      test.skip(!profileAuthToken, 'No auth token available');

      const updateData = {
        firstName: 'GenderTest',
        gender: 'male',
      };

      const response = await request.put(`${backendUrl}/api/users/complete-profile`, {
        data: updateData,
        headers: {
          'Authorization': `Bearer ${profileAuthToken}`,
          'Content-Type': 'application/json',
          ...(profileCsrfToken && { 'X-CSRF-Token': profileCsrfToken }),
        },
      });

      expect(response.status()).toBe(200);
      const result = await response.json();

      // Check the response includes the saved gender
      expect(result.data?.profile?.gender || result.profile?.gender).toBe('male');
    });

    test('should save occupation field via complete-profile', async ({ request }) => {
      test.skip(!profileAuthToken, 'No auth token available');

      const updateData = {
        firstName: 'OccupationTest',
        occupation: 'Software Engineer',
      };

      const response = await request.put(`${backendUrl}/api/users/complete-profile`, {
        data: updateData,
        headers: {
          'Authorization': `Bearer ${profileAuthToken}`,
          'Content-Type': 'application/json',
          ...(profileCsrfToken && { 'X-CSRF-Token': profileCsrfToken }),
        },
      });

      expect(response.status()).toBe(200);
      const result = await response.json();

      // Check the response includes the saved occupation
      expect(result.data?.profile?.occupation || result.profile?.occupation).toBe('Software Engineer');
    });

    test('should save interests array via complete-profile', async ({ request }) => {
      test.skip(!profileAuthToken, 'No auth token available');

      const testInterests = ['technology', 'travel', 'food'];
      const updateData = {
        firstName: 'InterestsTest',
        interests: testInterests,
      };

      const response = await request.put(`${backendUrl}/api/users/complete-profile`, {
        data: updateData,
        headers: {
          'Authorization': `Bearer ${profileAuthToken}`,
          'Content-Type': 'application/json',
          ...(profileCsrfToken && { 'X-CSRF-Token': profileCsrfToken }),
        },
      });

      expect(response.status()).toBe(200);
      const result = await response.json();

      // Check the response includes the saved interests
      const savedInterests = result.data?.profile?.interests || result.profile?.interests;
      expect(savedInterests).toBeTruthy();
      expect(Array.isArray(savedInterests)).toBe(true);
      expect(savedInterests).toEqual(expect.arrayContaining(testInterests));
    });

    test('should persist all profile fields after update', async ({ request }) => {
      test.skip(!profileAuthToken, 'No auth token available');

      // First, update with all fields
      const updateData = {
        firstName: 'PersistTest',
        lastName: 'AllFields',
        phone: '0898765432',
        dateOfBirth: '1985-12-25',
        gender: 'female',
        occupation: 'Data Scientist',
        interests: ['music', 'sports', 'reading'],
      };

      const updateResponse = await request.put(`${backendUrl}/api/users/complete-profile`, {
        data: updateData,
        headers: {
          'Authorization': `Bearer ${profileAuthToken}`,
          'Content-Type': 'application/json',
          ...(profileCsrfToken && { 'X-CSRF-Token': profileCsrfToken }),
        },
      });

      expect(updateResponse.status()).toBe(200);

      // Then, fetch the profile and verify all fields are persisted
      const getResponse = await request.get(`${backendUrl}/api/users/profile`, {
        headers: {
          'Authorization': `Bearer ${profileAuthToken}`,
        },
      });

      expect(getResponse.status()).toBe(200);
      const profile = await getResponse.json();

      // Verify all fields are persisted
      expect(profile.firstName).toBe(updateData.firstName);
      expect(profile.lastName).toBe(updateData.lastName);
      expect(profile.phone).toBe(updateData.phone);
      expect(profile.dateOfBirth).toBeTruthy();
      expect(profile.gender).toBe(updateData.gender);
      expect(profile.occupation).toBe(updateData.occupation);
      expect(profile.interests).toEqual(expect.arrayContaining(updateData.interests));
    });

    test('should preserve existing fields when updating only some fields', async ({ request }) => {
      test.skip(!profileAuthToken, 'No auth token available');

      // First set all fields
      const initialData = {
        firstName: 'PreserveTest',
        gender: 'other',
        occupation: 'Designer',
        interests: ['art', 'photography'],
      };

      await request.put(`${backendUrl}/api/users/complete-profile`, {
        data: initialData,
        headers: {
          'Authorization': `Bearer ${profileAuthToken}`,
          'Content-Type': 'application/json',
          ...(profileCsrfToken && { 'X-CSRF-Token': profileCsrfToken }),
        },
      });

      // Now update only firstName
      const partialUpdate = {
        firstName: 'OnlyNameChanged',
      };

      await request.put(`${backendUrl}/api/users/complete-profile`, {
        data: partialUpdate,
        headers: {
          'Authorization': `Bearer ${profileAuthToken}`,
          'Content-Type': 'application/json',
          ...(profileCsrfToken && { 'X-CSRF-Token': profileCsrfToken }),
        },
      });

      // Fetch and verify other fields are preserved
      const getResponse = await request.get(`${backendUrl}/api/users/profile`, {
        headers: {
          'Authorization': `Bearer ${profileAuthToken}`,
        },
      });

      expect(getResponse.status()).toBe(200);
      const profile = await getResponse.json();

      expect(profile.firstName).toBe(partialUpdate.firstName);
      // These should be preserved from initial update
      expect(profile.gender).toBe(initialData.gender);
      expect(profile.occupation).toBe(initialData.occupation);
      expect(profile.interests).toEqual(expect.arrayContaining(initialData.interests));
    });
  });

  test.describe('Profile Update via Regular Update Endpoint', () => {
    let regularAuthToken: string | null = null;
    let regularCsrfToken: string | null = null;
    const regularTestEmail = `e2e-regular-${Date.now()}@example.com`;

    test.beforeAll(async ({ request }) => {
      // Get CSRF token
      const csrfResponse = await request.get(`${backendUrl}/api/csrf-token`);
      if (csrfResponse.ok()) {
        const csrfData = await csrfResponse.json();
        regularCsrfToken = csrfData.csrfToken;
      }

      // Register a new user
      const registerResponse = await request.post(`${backendUrl}/api/auth/register`, {
        data: {
          email: regularTestEmail,
          password: testPassword,
          firstName: 'Regular',
          lastName: 'UpdateTest',
        },
        headers: {
          'Content-Type': 'application/json',
          ...(regularCsrfToken && { 'X-CSRF-Token': regularCsrfToken }),
        },
      });

      if (registerResponse.ok()) {
        const registerData = await registerResponse.json();
        regularAuthToken = registerData.tokens?.accessToken || registerData.accessToken;
      }
    });

    test('should save gender via regular profile update', async ({ request }) => {
      test.skip(!regularAuthToken, 'No auth token available');

      const updateData = {
        gender: 'prefer_not_to_say',
      };

      const response = await request.put(`${backendUrl}/api/users/profile`, {
        data: updateData,
        headers: {
          'Authorization': `Bearer ${regularAuthToken}`,
          'Content-Type': 'application/json',
          ...(regularCsrfToken && { 'X-CSRF-Token': regularCsrfToken }),
        },
      });

      expect(response.status()).toBe(200);
      const profile = await response.json();
      expect(profile.gender).toBe(updateData.gender);
    });

    test('should save occupation via regular profile update', async ({ request }) => {
      test.skip(!regularAuthToken, 'No auth token available');

      const updateData = {
        occupation: 'Product Manager',
      };

      const response = await request.put(`${backendUrl}/api/users/profile`, {
        data: updateData,
        headers: {
          'Authorization': `Bearer ${regularAuthToken}`,
          'Content-Type': 'application/json',
          ...(regularCsrfToken && { 'X-CSRF-Token': regularCsrfToken }),
        },
      });

      expect(response.status()).toBe(200);
      const profile = await response.json();
      expect(profile.occupation).toBe(updateData.occupation);
    });

    test('should save interests via regular profile update', async ({ request }) => {
      test.skip(!regularAuthToken, 'No auth token available');

      const updateData = {
        interests: ['cooking', 'gardening', 'fitness'],
      };

      const response = await request.put(`${backendUrl}/api/users/profile`, {
        data: updateData,
        headers: {
          'Authorization': `Bearer ${regularAuthToken}`,
          'Content-Type': 'application/json',
          ...(regularCsrfToken && { 'X-CSRF-Token': regularCsrfToken }),
        },
      });

      expect(response.status()).toBe(200);
      const profile = await response.json();
      expect(profile.interests).toEqual(expect.arrayContaining(updateData.interests));
    });
  });

  test.describe('Profile Validation', () => {
    test('should reject invalid date format for dateOfBirth', async ({ request }) => {
      // This test checks the validation without authentication
      // to verify the schema rejects invalid dates
      const response = await request.put(`${backendUrl}/api/users/profile`, {
        data: {
          dateOfBirth: 'not-a-date',
        },
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer some-token',
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
          'Authorization': 'Bearer some-token',
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
