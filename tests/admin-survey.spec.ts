import { test, expect } from '@playwright/test';
import { retryRequest } from './helpers/retry';

/**
 * E2E tests for admin survey management operations
 * Tests survey CRUD, invitations, analytics, and coupon assignments
 */
test.describe('Admin Survey Management', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Survey CRUD Operations', () => {
    test('Create survey endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/surveys`, {
        data: {
          title: 'Test Survey',
          description: 'E2E Test',
          questions: [
            {
              id: 'q1',
              type: 'single_choice',
              text: 'Test question?',
              required: true,
              order: 1,
              options: [
                { id: 'o1', text: 'Yes', value: 'yes' },
                { id: 'o2', text: 'No', value: 'no' },
              ],
            },
          ],
          access_type: 'public',
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Create survey endpoint should exist', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/surveys`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).not.toBe(404);
    });

    test('List surveys endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/surveys`);
      expect([401, 403]).toContain(response.status());
    });

    test('Get survey by ID endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/surveys/00000000-0000-0000-0000-000000000001`);
      expect([401, 403]).toContain(response.status());
    });

    test('Update survey endpoint should require authentication', async ({ request }) => {
      const response = await request.put(`${backendUrl}/api/surveys/00000000-0000-0000-0000-000000000001`, {
        data: { title: 'Updated Title' },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Delete survey endpoint should require authentication', async ({ request }) => {
      const response = await request.delete(`${backendUrl}/api/surveys/00000000-0000-0000-0000-000000000001`);
      expect([401, 403]).toContain(response.status());
    });
  });

  test.describe('Survey Analytics', () => {
    test('Survey analytics endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/surveys/00000000-0000-0000-0000-000000000001/analytics`);
      expect([401, 403]).toContain(response.status());
    });

    test('Export survey responses endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/surveys/00000000-0000-0000-0000-000000000001/export`);
      expect([401, 403]).toContain(response.status());
    });

    test('Analytics endpoints should exist', async ({ request }) => {
      const analyticsResponse = await request.get(`${backendUrl}/api/surveys/test-id/analytics`);
      expect(analyticsResponse.status()).not.toBe(404);

      const exportResponse = await request.get(`${backendUrl}/api/surveys/test-id/export`);
      expect(exportResponse.status()).not.toBe(404);
    });
  });

  test.describe('Survey Invitations', () => {
    test('Get survey invitations endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/surveys/00000000-0000-0000-0000-000000000001/invitations`);
      expect([401, 403]).toContain(response.status());
    });

    test('Send survey invitations endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/surveys/00000000-0000-0000-0000-000000000001/invitations/send`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Send invitations to specific users endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/surveys/00000000-0000-0000-0000-000000000001/invitations/send-to-users`, {
        data: { userIds: ['00000000-0000-0000-0000-000000000001'] },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Resend invitation endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/surveys/invitations/00000000-0000-0000-0000-000000000001/resend`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Invitation endpoints should exist', async ({ request }) => {
      const getResponse = await request.get(`${backendUrl}/api/surveys/test-id/invitations`);
      expect(getResponse.status()).not.toBe(404);

      const sendResponse = await request.post(`${backendUrl}/api/surveys/test-id/invitations/send`, {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      });
      expect(sendResponse.status()).not.toBe(404);
    });
  });

  test.describe('Survey Coupon Assignments', () => {
    test('Assign coupon to survey endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/surveys/coupon-assignments`, {
        data: {
          survey_id: '00000000-0000-0000-0000-000000000001',
          coupon_id: '00000000-0000-0000-0000-000000000002',
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Get survey coupon assignments endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/surveys/00000000-0000-0000-0000-000000000001/coupon-assignments`);
      expect([401, 403]).toContain(response.status());
    });

    test('Update survey coupon assignment endpoint should require authentication', async ({ request }) => {
      const response = await request.put(`${backendUrl}/api/surveys/00000000-0000-0000-0000-000000000001/coupon-assignments/00000000-0000-0000-0000-000000000002`, {
        data: { is_active: false },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Remove coupon from survey endpoint should require authentication', async ({ request }) => {
      const response = await request.delete(`${backendUrl}/api/surveys/00000000-0000-0000-0000-000000000001/coupon-assignments/00000000-0000-0000-0000-000000000002`);
      expect([401, 403]).toContain(response.status());
    });

    test('Get survey reward history endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/surveys/00000000-0000-0000-0000-000000000001/reward-history`);
      expect([401, 403]).toContain(response.status());
    });

    test('Admin coupon assignments overview endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/surveys/admin/coupon-assignments`);
      expect([401, 403]).toContain(response.status());
    });

    test('Coupon assignment endpoints should exist', async ({ request }) => {
      const routes = [
        { method: 'POST', path: '/api/surveys/coupon-assignments' },
        { method: 'GET', path: '/api/surveys/test-id/coupon-assignments' },
        { method: 'PUT', path: '/api/surveys/test-id/coupon-assignments/test-coupon' },
        { method: 'DELETE', path: '/api/surveys/test-id/coupon-assignments/test-coupon' },
        { method: 'GET', path: '/api/surveys/test-id/reward-history' },
        { method: 'GET', path: '/api/surveys/admin/coupon-assignments' },
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
          case 'DELETE':
            response = await request.delete(`${backendUrl}${route.path}`);
            break;
        }
        expect(response?.status()).not.toBe(404);
      }
    });
  });

  test.describe('Survey Responses', () => {
    test('Submit survey response endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/surveys/responses`, {
        data: {
          survey_id: '00000000-0000-0000-0000-000000000001',
          answers: {},
        },
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(response.status());
    });

    test('Get user survey response endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/surveys/responses/00000000-0000-0000-0000-000000000001/user`);
      expect([401, 403]).toContain(response.status());
    });

    test('Get all survey responses endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/surveys/00000000-0000-0000-0000-000000000001/responses`);
      expect([401, 403]).toContain(response.status());
    });
  });

  test.describe('Customer Survey Endpoints', () => {
    test('Get available surveys endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/surveys/available/user`);
      expect([401, 403]).toContain(response.status());
    });

    test('Get public surveys endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/surveys/public/user`);
      expect([401, 403]).toContain(response.status());
    });

    test('Get invited surveys endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/surveys/invited/user`);
      expect([401, 403]).toContain(response.status());
    });

    test('Customer survey endpoints should exist', async ({ request }) => {
      const endpoints = [
        '/api/surveys/available/user',
        '/api/surveys/public/user',
        '/api/surveys/invited/user',
      ];

      for (const path of endpoints) {
        const response = await request.get(`${backendUrl}${path}`);
        expect(response.status()).not.toBe(404);
      }
    });
  });
});

test.describe('Admin Survey API Contract Tests', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test('All survey routes should be properly registered', async ({ request }) => {
    const routes = [
      { method: 'POST', path: '/api/surveys' },
      { method: 'GET', path: '/api/surveys' },
      { method: 'GET', path: '/api/surveys/test-id' },
      { method: 'PUT', path: '/api/surveys/test-id' },
      { method: 'DELETE', path: '/api/surveys/test-id' },
      { method: 'POST', path: '/api/surveys/responses' },
      { method: 'GET', path: '/api/surveys/test-id/analytics' },
      { method: 'GET', path: '/api/surveys/test-id/export' },
      { method: 'GET', path: '/api/surveys/test-id/invitations' },
    ];

    for (const route of routes) {
      let response;
      if (route.method === 'GET') {
        response = await request.get(`${backendUrl}${route.path}`);
      } else if (route.method === 'POST') {
        response = await request.post(`${backendUrl}${route.path}`, {
          data: {},
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (route.method === 'PUT') {
        response = await request.put(`${backendUrl}${route.path}`, {
          data: {},
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (route.method === 'DELETE') {
        response = await request.delete(`${backendUrl}${route.path}`);
      }

      expect(response?.status()).not.toBe(404);
    }
  });

  test('Health check should pass for survey operations', async ({ request }) => {
    const response = await retryRequest(request, `${backendUrl}/api/health`, 5);
    expect(response.status()).toBe(200);

    const health = await response.json();
    expect(health.services.database).toBeTruthy();
  });
});
