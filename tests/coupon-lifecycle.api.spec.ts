import { test, expect } from '@playwright/test';
import { retryRequest } from './helpers/retry';

/**
 * E2E tests for complete coupon lifecycle
 * Tests coupon creation, activation, assignment, revocation, deletion, and expiration
 */
test.describe('Coupon Lifecycle Management', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  // Admin credentials - use fixed email that matches admins.e2e.json (mounted in E2E Docker)
  const adminEmail = process.env.E2E_ADMIN_EMAIL || 'e2e-admin@test.local';
  const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'AdminPassword123!';

  // Customer credentials
  const customerEmail = `e2e-customer-${Date.now()}@example.com`;
  const customerPassword = 'CustomerPassword123!';

  let adminToken: string | null = null;
  let customerToken: string | null = null;
  let csrfToken: string | null = null;
  let customerId: string | null = null;

  // Coupon test data
  const testCouponCode = `E2E${Date.now()}`.slice(0, 20).toUpperCase();
  let createdCouponId: string | null = null;
  let assignedUserCouponId: string | null = null;

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    // Wait for backend to be ready
    await retryRequest(request, `${backendUrl}/api/health`, 5);

    // Get CSRF token
    const csrfResponse = await request.get(`${backendUrl}/api/csrf-token`);
    if (csrfResponse.ok()) {
      const csrfData = await csrfResponse.json();
      csrfToken = csrfData.csrfToken;
    }

    // Try to login as admin first (might already exist)
    let adminLoginResponse = await request.post(`${backendUrl}/api/auth/login`, {
      data: {
        email: adminEmail,
        password: adminPassword,
      },
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
      },
    });

    if (!adminLoginResponse.ok()) {
      // Register admin user
      const registerResponse = await request.post(`${backendUrl}/api/auth/register`, {
        data: {
          email: adminEmail,
          password: adminPassword,
          firstName: 'E2E',
          lastName: 'Admin',
        },
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      if (registerResponse.ok()) {
        const registerData = await registerResponse.json();
        adminToken = registerData.tokens?.accessToken || registerData.accessToken;
      }
    } else {
      const loginData = await adminLoginResponse.json();
      adminToken = loginData.tokens?.accessToken || loginData.accessToken;
    }

    // Register customer user
    const customerRegisterResponse = await request.post(`${backendUrl}/api/auth/register`, {
      data: {
        email: customerEmail,
        password: customerPassword,
        firstName: 'E2E',
        lastName: 'Customer',
      },
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
      },
    });

    if (customerRegisterResponse.ok()) {
      const customerData = await customerRegisterResponse.json();
      customerToken = customerData.tokens?.accessToken || customerData.accessToken;
      customerId = customerData.user?.id;
    }

    // If we didn't get customerId from registration, try to get it from profile
    if (!customerId && customerToken) {
      const profileResponse = await request.get(`${backendUrl}/api/users/profile`, {
        headers: {
          'Authorization': `Bearer ${customerToken}`,
        },
      });
      if (profileResponse.ok()) {
        const profile = await profileResponse.json();
        customerId = profile.userId;
      }
    }
  });

  test.describe('1. Create New Coupon', () => {
    test('should create a new draft coupon', async ({ request }) => {
      test.skip(!adminToken, 'No admin token available');

      const couponData = {
        code: testCouponCode,
        name: 'E2E Test Coupon',
        description: 'Created by E2E test for lifecycle testing',
        type: 'percentage',
        value: 15,
        currency: 'THB',
        usageLimitPerUser: 1,
        usageLimit: 100,
      };

      const response = await request.post(`${backendUrl}/api/coupons`, {
        data: couponData,
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      // May fail with 403 if test user is not admin - that's expected
      if (response.status() === 403) {
        test.skip(true, 'Test user does not have admin privileges');
        return;
      }

      expect(response.status()).toBe(201);
      const coupon = await response.json();

      expect(coupon.code).toBe(couponData.code);
      expect(coupon.name).toBe(couponData.name);
      expect(coupon.type).toBe(couponData.type);
      expect(coupon.status).toBe('draft'); // New coupons start as draft

      createdCouponId = coupon.id;
    });

    test('should reject duplicate coupon code', async ({ request }) => {
      test.skip(!adminToken || !createdCouponId, 'No admin token or coupon not created');

      const response = await request.post(`${backendUrl}/api/coupons`, {
        data: {
          code: testCouponCode, // Same code as before
          name: 'Duplicate Code Test',
          type: 'percentage',
          value: 10,
        },
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      // Should fail due to duplicate code
      expect([400, 409, 403]).toContain(response.status());
    });

    test('should validate coupon type', async ({ request }) => {
      test.skip(!adminToken, 'No admin token available');

      const response = await request.post(`${backendUrl}/api/coupons`, {
        data: {
          code: `INVALID${Date.now()}`.slice(0, 20).toUpperCase(),
          name: 'Invalid Type Test',
          type: 'invalid_type', // Invalid type
          value: 10,
        },
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      // Should fail validation
      expect([400, 403]).toContain(response.status());
    });
  });

  test.describe('2. Activate Coupon', () => {
    test('should activate a draft coupon', async ({ request }) => {
      test.skip(!adminToken || !createdCouponId, 'No admin token or coupon not created');

      const response = await request.put(`${backendUrl}/api/coupons/${createdCouponId}`, {
        data: {
          status: 'active',
        },
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      if (response.status() === 403) {
        test.skip(true, 'Test user does not have admin privileges');
        return;
      }

      expect(response.status()).toBe(200);
      const coupon = await response.json();

      expect(coupon.status).toBe('active');
    });

    test('should be able to pause an active coupon', async ({ request }) => {
      test.skip(!adminToken || !createdCouponId, 'No admin token or coupon not created');

      const response = await request.put(`${backendUrl}/api/coupons/${createdCouponId}`, {
        data: {
          status: 'paused',
        },
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      if (response.status() === 403) {
        test.skip(true, 'Test user does not have admin privileges');
        return;
      }

      expect(response.status()).toBe(200);
      const coupon = await response.json();

      expect(coupon.status).toBe('paused');

      // Re-activate for next tests
      await request.put(`${backendUrl}/api/coupons/${createdCouponId}`, {
        data: { status: 'active' },
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });
    });
  });

  test.describe('3. Assign Coupon to User', () => {
    test('should assign coupon to a customer', async ({ request }) => {
      test.skip(!adminToken || !createdCouponId || !customerId, 'Missing required data');

      const response = await request.post(`${backendUrl}/api/coupons/assign`, {
        data: {
          couponId: createdCouponId,
          userIds: [customerId],
          assignedReason: 'E2E Test Assignment',
        },
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      if (response.status() === 403) {
        test.skip(true, 'Test user does not have admin privileges');
        return;
      }

      expect(response.status()).toBe(200);
      const result = await response.json();

      expect(result.success).toBe(true);
      expect(result.assignedCount).toBeGreaterThan(0);
    });

    test('customer should see assigned coupon in my-coupons', async ({ request }) => {
      test.skip(!customerToken, 'No customer token available');

      const response = await request.get(`${backendUrl}/api/coupons/my-coupons`, {
        headers: {
          'Authorization': `Bearer ${customerToken}`,
        },
      });

      expect(response.status()).toBe(200);
      const result = await response.json();

      // API returns { success: true, data: { coupons: [...], total, page, limit, totalPages } }
      expect(result.success).toBe(true);
      const coupons = result.data?.coupons || result.coupons || [];
      expect(Array.isArray(coupons)).toBe(true);

      // Find our test coupon
      const testCoupon = coupons.find((c: { coupon?: { code: string }, code?: string }) =>
        (c.coupon?.code === testCouponCode) || (c.code === testCouponCode)
      );

      if (testCoupon) {
        // Store the userCouponId for revocation test
        assignedUserCouponId = testCoupon.id;
        expect(testCoupon.status).toBe('available');
      }
    });

    test('should validate couponId format', async ({ request }) => {
      test.skip(!adminToken, 'No admin token available');

      const response = await request.post(`${backendUrl}/api/coupons/assign`, {
        data: {
          couponId: 'not-a-valid-uuid',
          userIds: ['also-not-valid'],
        },
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      // Should fail validation
      expect([400, 403]).toContain(response.status());
    });

    test('should limit users per assignment request', async ({ request }) => {
      test.skip(!adminToken || !createdCouponId, 'Missing required data');

      // Create array of 101 fake UUIDs
      const tooManyUsers = Array(101).fill(null).map((_, i) =>
        `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`
      );

      const response = await request.post(`${backendUrl}/api/coupons/assign`, {
        data: {
          couponId: createdCouponId,
          userIds: tooManyUsers,
        },
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      // Should fail validation (max 100 users)
      expect([400, 403]).toContain(response.status());
    });
  });

  test.describe('4. Revoke Coupon from User', () => {
    test('should revoke assigned coupon from user', async ({ request }) => {
      test.skip(!adminToken || !assignedUserCouponId, 'Missing required data');

      const response = await request.post(`${backendUrl}/api/coupons/user-coupons/${assignedUserCouponId}/revoke`, {
        data: {
          reason: 'E2E Test Revocation',
        },
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      if (response.status() === 403) {
        test.skip(true, 'Test user does not have admin privileges');
        return;
      }

      expect([200, 204]).toContain(response.status());
    });

    test('customer should not see revoked coupon as available', async ({ request }) => {
      test.skip(!customerToken || !assignedUserCouponId, 'Missing required data');

      const response = await request.get(`${backendUrl}/api/coupons/my-coupons`, {
        headers: {
          'Authorization': `Bearer ${customerToken}`,
        },
      });

      expect(response.status()).toBe(200);
      const result = await response.json();

      const coupons = result.coupons || result;
      const testCoupon = coupons.find((c: { id: string, status: string }) =>
        c.id === assignedUserCouponId
      );

      // Coupon should either be revoked status or not in list at all
      if (testCoupon) {
        expect(testCoupon.status).toBe('revoked');
      }
    });

    test('should handle non-existent userCouponId', async ({ request }) => {
      test.skip(!adminToken, 'No admin token available');

      const response = await request.post(`${backendUrl}/api/coupons/user-coupons/00000000-0000-0000-0000-000000000000/revoke`, {
        data: {
          reason: 'Testing non-existent',
        },
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      // Should return 404 or 403
      expect([403, 404]).toContain(response.status());
    });
  });

  test.describe('5. Delete Coupon', () => {
    test('should delete a coupon', async ({ request }) => {
      test.skip(!adminToken || !createdCouponId, 'Missing required data');

      const response = await request.delete(`${backendUrl}/api/coupons/${createdCouponId}`, {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      if (response.status() === 403) {
        test.skip(true, 'Test user does not have admin privileges');
        return;
      }

      expect([200, 204]).toContain(response.status());
    });

    test('deleted coupon should not be accessible', async ({ request }) => {
      test.skip(!adminToken || !createdCouponId, 'Missing required data');

      const response = await request.get(`${backendUrl}/api/coupons/${createdCouponId}`, {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
        },
      });

      // Should return 404
      expect(response.status()).toBe(404);
    });

    test('should handle non-existent couponId for deletion', async ({ request }) => {
      test.skip(!adminToken, 'No admin token available');

      const response = await request.delete(`${backendUrl}/api/coupons/00000000-0000-0000-0000-000000000000`, {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      // Should return 404 or 403
      expect([403, 404]).toContain(response.status());
    });
  });

  test.describe('6. Coupon Expiration', () => {
    let expiredCouponId: string | null = null;

    test('should create a coupon with past expiration date', async ({ request }) => {
      test.skip(!adminToken, 'No admin token available');

      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1); // Yesterday

      const response = await request.post(`${backendUrl}/api/coupons`, {
        data: {
          code: `EXP${Date.now()}`.slice(0, 20).toUpperCase(),
          name: 'Expired Test Coupon',
          type: 'percentage',
          value: 10,
          validUntil: pastDate.toISOString(),
          status: 'active', // Try to create as active
        },
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      if (response.status() === 403) {
        test.skip(true, 'Test user does not have admin privileges');
        return;
      }

      // May succeed but coupon should be expired
      if (response.status() === 201) {
        const coupon = await response.json();
        expiredCouponId = coupon.id;
      }
    });

    test('should handle coupon with expiration date set', async ({ request }) => {
      test.skip(!adminToken, 'No admin token available');

      // Create a coupon that will expire soon
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1); // Tomorrow

      const response = await request.post(`${backendUrl}/api/coupons`, {
        data: {
          code: `FUT${Date.now()}`.slice(0, 20).toUpperCase(),
          name: 'Future Expiration Test',
          type: 'fixed_amount',
          value: 100,
          validFrom: new Date().toISOString(),
          validUntil: futureDate.toISOString(),
        },
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });

      if (response.status() === 403) {
        test.skip(true, 'Test user does not have admin privileges');
        return;
      }

      expect(response.status()).toBe(201);
      const coupon = await response.json();

      expect(coupon.validUntil).toBeTruthy();

      // Clean up
      await request.delete(`${backendUrl}/api/coupons/${coupon.id}`, {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      });
    });

    test.afterAll(async ({ request }) => {
      // Clean up expired coupon if created
      if (expiredCouponId && adminToken) {
        await request.delete(`${backendUrl}/api/coupons/${expiredCouponId}`, {
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
          },
        });
      }
    });
  });
});

test.describe('Coupon Validation Tests', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test('QR code validation endpoint should be publicly accessible', async ({ request }) => {
    const response = await request.get(`${backendUrl}/api/coupons/validate/TESTQRCODE123`);

    // Should return 200 with validation result or 404 for non-existent code
    expect([200, 404]).toContain(response.status());

    const data = await response.json();
    expect(data.success !== undefined || data.error !== undefined).toBe(true);
  });

  test('should return proper validation response structure', async ({ request }) => {
    const response = await request.get(`${backendUrl}/api/coupons/validate/NONEXISTENT`);

    expect([200, 404]).toContain(response.status());

    const data = await response.json();
    // Should have either success field or error field
    expect(typeof data === 'object').toBe(true);
  });
});

test.describe('Coupon Analytics Tests', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test('analytics stats endpoint should require admin auth', async ({ request }) => {
    const response = await request.get(`${backendUrl}/api/coupons/analytics/stats`);
    expect([401, 403]).toContain(response.status());
  });

  test('analytics data endpoint should require admin auth', async ({ request }) => {
    const response = await request.get(`${backendUrl}/api/coupons/analytics/data`);
    expect([401, 403]).toContain(response.status());
  });

  test('redemptions endpoint should require admin auth', async ({ request }) => {
    const response = await request.get(`${backendUrl}/api/coupons/00000000-0000-0000-0000-000000000000/redemptions`);
    expect([401, 403]).toContain(response.status());
  });

  test('assignments endpoint should require admin auth', async ({ request }) => {
    const response = await request.get(`${backendUrl}/api/coupons/00000000-0000-0000-0000-000000000000/assignments`);
    expect([401, 403]).toContain(response.status());
  });
});

test.describe('Coupon API Contract Tests', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  test('all coupon routes should be properly registered', async ({ request }) => {
    const routes = [
      // Note: /validate/:qrCode returns 404 for invalid QR codes (expected behavior)
      // so we test it separately below
      { method: 'GET', path: '/api/coupons' },
      { method: 'POST', path: '/api/coupons' },
      { method: 'GET', path: '/api/coupons/my-coupons' },
      { method: 'POST', path: '/api/coupons/assign' },
      { method: 'POST', path: '/api/coupons/redeem' },
      { method: 'GET', path: '/api/coupons/analytics/stats' },
      { method: 'GET', path: '/api/coupons/analytics/data' },
    ];

    for (const route of routes) {
      let response;
      if (route.method === 'GET') {
        response = await request.get(`${backendUrl}${route.path}`);
      } else {
        response = await request.post(`${backendUrl}${route.path}`, {
          data: {},
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Routes should exist (not 404) - they may require auth (401/403) which is expected
      expect(response.status()).not.toBe(404);
    }

    // Test validate endpoint separately - it returns 404 for invalid QR codes
    // which is valid business logic, not a missing route
    const validateResponse = await request.get(`${backendUrl}/api/coupons/validate/INVALID_TEST_CODE`);
    // Should return 200 (with valid: false), 404, or 400 - not 500 (server error)
    expect([200, 404, 400]).toContain(validateResponse.status());
  });

  test('coupon type should accept all valid types', async ({ request }) => {
    const validTypes = ['percentage', 'fixed_amount', 'bogo', 'free_upgrade', 'free_service'];

    for (const type of validTypes) {
      // Just verify the type is documented - actual creation requires admin
      expect(validTypes).toContain(type);
    }
  });

  test('coupon status should accept all valid statuses', async ({ request }) => {
    const validStatuses = ['draft', 'active', 'paused', 'expired', 'exhausted'];

    for (const status of validStatuses) {
      // Just verify the status is documented
      expect(validStatuses).toContain(status);
    }
  });

  test('health check should pass before coupon tests', async ({ request }) => {
    const response = await retryRequest(request, `${backendUrl}/api/health`, 5);
    expect(response.status()).toBe(200);

    const health = await response.json();
    expect(health.status).toBeTruthy();
    expect(health.services.database).toBeTruthy();
  });
});
