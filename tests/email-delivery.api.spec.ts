import { test, expect } from '@playwright/test';

/**
 * E2E tests for email delivery verification
 * Tests that admin endpoints require authentication and that
 * the health endpoint reports service status.
 *
 * Note: Email delivery verification tests are skipped because the
 * Rust backend does not yet have email test endpoints (migrated from tRPC).
 *
 * These tests require:
 * - Backend running at BACKEND_URL (default: http://localhost:4202)
 * - For delivery tests (currently skipped): SMTP/IMAP credentials and admin user
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

  test.describe('Admin Endpoints Require Auth', () => {
    test('Admin broadcast endpoint should require authentication', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/admin/notifications/broadcast`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      expect([401, 403]).toContain(response.status());
    });

    test('Admin broadcast endpoint should reject unauthenticated requests', async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/admin/notifications/broadcast`, {
        headers: {
          'Content-Type': 'application/json',
        },
        data: {
          title: 'Test',
          message: 'Test broadcast',
        },
      });

      expect([401, 403]).toContain(response.status());
    });
  });

  // Skipped: The Rust backend does not have email delivery test endpoints yet.
  // Re-enable when /api/admin/email/test or equivalent is implemented.
  test.describe.skip('Email Delivery Verification', () => {
    test('Should verify email delivery end-to-end', async ({ request }) => {
      // First check if email is configured
      const healthResponse = await request.get(`${backendUrl}/api/health`);
      const health = await healthResponse.json();

      if (health.services?.email !== 'configured') {
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

      // TODO: Replace with Rust backend email test endpoint when implemented
      // e.g., POST /api/admin/email/test
      const testResponse = await request.post(`${backendUrl}/api/admin/email/test`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'X-CSRF-Token': csrfToken,
          'Content-Type': 'application/json',
          ...(cookies && { 'Cookie': Array.isArray(cookies) ? cookies.join('; ') : cookies }),
        },
        data: {
          timeout: 60000,
        },
      });

      expect(testResponse.ok()).toBeTruthy();
      const result = await testResponse.json();

      console.log('Email delivery test result:', JSON.stringify(result, null, 2));

      expect(result.success).toBe(true);
      expect(result.smtpSent).toBe(true);
      expect(result.imapReceived).toBe(true);
      expect(result.deliveryTimeMs).toBeGreaterThan(0);
    });
  });
});
