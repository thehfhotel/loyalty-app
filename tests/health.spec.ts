import { test, expect } from '@playwright/test';
import { retryRequest, retryPageGoto } from './helpers/retry';

test.describe('Application Health Checks', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test('Backend health endpoint should respond', async ({ request }) => {
    // Retry connection attempts with exponential backoff
    const response = await retryRequest(request, `${backendUrl}/api/health`, 5);

    expect(response.status()).toBe(200);

    const health = await response.json();
    expect(health.status).toBeTruthy();
    expect(health.timestamp).toBeTruthy();
  });

  test('API endpoints should be accessible', async ({ request }) => {
    // Test that API endpoints are reachable (but may require auth)
    const endpoints = [
      '/api/health',
      '/api/auth/health', // This should return 404 or method not allowed, not connection error
    ];

    for (const endpoint of endpoints) {
      const response = await retryRequest(request, `${backendUrl}${endpoint}`, 3);
      // Should get a response (not a connection error), even if 404 or 405
      expect(response.status()).not.toBe(0); // 0 means connection failed
    }
  });
});

test.describe('OAuth Integration Tests', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3201';  // Used for E2E environment validation

  test('OAuth endpoints should be accessible', async ({ request }) => {
    // Test that OAuth endpoints don't return connection errors
    const oauthEndpoints = [
      '/api/oauth/google',
      '/api/oauth/line'
    ];

    for (const endpoint of oauthEndpoints) {
      // Disable redirects so we only validate the backend response and don't follow external providers
      const response = await retryRequest(request, `${backendUrl}${endpoint}`, 3, {
        maxRedirects: 0
      });
      // Should get a redirect or OAuth flow, not connection error
      expect([200, 302, 401, 403]).toContain(response.status());
    }
  });
});
