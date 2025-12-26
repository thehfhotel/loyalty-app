import { test, expect } from '@playwright/test';

/**
 * E2E tests for email delivery verification
 * Tests that the email service can send and receive emails
 *
 * These tests require:
 * - SMTP_USER, SMTP_PASS, SMTP_HOST, SMTP_FROM configured
 * - IMAP_USER, IMAP_PASS, IMAP_HOST configured
 * - A super admin user for authentication
 */
test.describe('Email Delivery Tests', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test.describe('Email Configuration Check', () => {
    test('Health endpoint should report email configuration status', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/health`);

      expect(response.ok()).toBeTruthy();
      const health = await response.json();

      // Email status should be present in health check
      expect(health.services).toHaveProperty('email');
      expect(['configured', 'not_configured', 'error']).toContain(health.services.email);

      console.log(`Email service status: ${health.services.email}`);
    });
  });

  test.describe('Email Admin Endpoints', () => {
    test('Email status endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/admin/email/status`);

      expect([401, 403]).toContain(response.status());
    });

    test('Email config endpoint should require authentication', async ({ request }) => {
      const response = await request.get(`${backendUrl}/api/admin/email/config`);

      expect([401, 403]).toContain(response.status());
    });

    test('Email test endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/admin/email/test`);

      expect([401, 403]).toContain(response.status());
    });
  });

  // This test is conditional - only runs if email is fully configured
  test.describe('Email Delivery Verification', () => {
    test.skip(
      !process.env.SMTP_USER || !process.env.IMAP_HOST,
      'Skipping email delivery test - SMTP/IMAP not configured'
    );

    test('Should verify email delivery end-to-end', async ({ request }) => {
      // First check if email is configured
      const healthResponse = await request.get(`${backendUrl}/api/health`);
      const health = await healthResponse.json();

      if (health.services.email !== 'configured') {
        test.skip(true, 'Email service not configured');
        return;
      }

      // Login as super admin (requires E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD)
      const adminEmail = process.env.E2E_ADMIN_EMAIL;
      const adminPassword = process.env.E2E_ADMIN_PASSWORD;

      if (!adminEmail || !adminPassword) {
        test.skip(true, 'Admin credentials not configured');
        return;
      }

      // Get CSRF token
      const csrfResponse = await request.get(`${backendUrl}/api/csrf-token`);
      const csrfData = await csrfResponse.json();
      const csrfToken = csrfData.csrfToken;
      const cookies = csrfResponse.headers()['set-cookie'];

      // Login as admin
      const loginResponse = await request.post(`${backendUrl}/api/auth/login`, {
        data: {
          email: adminEmail,
          password: adminPassword,
        },
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          ...(cookies && { 'Cookie': Array.isArray(cookies) ? cookies.join('; ') : cookies }),
        },
      });

      if (!loginResponse.ok()) {
        test.skip(true, 'Admin login failed');
        return;
      }

      const loginData = await loginResponse.json();
      const authToken = loginData.tokens?.accessToken || loginData.accessToken;

      if (!authToken) {
        test.skip(true, 'No auth token received');
        return;
      }

      // Test email delivery
      const testResponse = await request.post(`${backendUrl}/api/admin/email/test?timeout=60000`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'X-CSRF-Token': csrfToken,
          ...(cookies && { 'Cookie': Array.isArray(cookies) ? cookies.join('; ') : cookies }),
        },
      });

      expect(testResponse.ok()).toBeTruthy();
      const result = await testResponse.json();

      console.log('Email delivery test result:', JSON.stringify(result, null, 2));

      expect(result.success).toBe(true);
      expect(result.result.smtpSent).toBe(true);
      expect(result.result.imapReceived).toBe(true);
      expect(result.result.deliveryTimeMs).toBeGreaterThan(0);
    });
  });
});
