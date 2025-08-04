import { test, expect } from '@playwright/test';

test.describe('Application Health Checks', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4001';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4001';

  test('Backend health endpoint should respond', async ({ request }) => {
    const response = await request.get(`${backendUrl}/api/health`);
    expect(response.status()).toBe(200);
    
    const health = await response.json();
    expect(health.status).toBeTruthy();
    expect(health.timestamp).toBeTruthy();
  });

  test('Frontend should load successfully', async ({ page }) => {
    await page.goto(frontendUrl);
    // Check for either English or Thai title (loyalty app supports i18n)
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    expect(title).toMatch(/loyalty app|แอปสะสมคะแนน|hotel|โรงแรม/i);
  });

  test('API endpoints should be accessible', async ({ request }) => {
    // Test that API endpoints are reachable (but may require auth)
    const endpoints = [
      '/api/health',
      '/api/auth/health', // This should return 404 or method not allowed, not connection error
    ];

    for (const endpoint of endpoints) {
      const response = await request.get(`${backendUrl}${endpoint}`);
      // Should get a response (not a connection error), even if 404 or 405
      expect(response.status()).not.toBe(0); // 0 means connection failed
    }
  });
});

test.describe('OAuth Integration Tests', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4001';

  test('OAuth endpoints should be accessible', async ({ request }) => {
    // Test that OAuth endpoints don't return connection errors
    const oauthEndpoints = [
      '/api/oauth/google',
      '/api/oauth/line'
    ];

    for (const endpoint of oauthEndpoints) {
      const response = await request.get(`${backendUrl}${endpoint}`);
      // Should get a redirect or OAuth flow, not connection error
      expect([200, 302, 401, 403]).toContain(response.status());
    }
  });
});