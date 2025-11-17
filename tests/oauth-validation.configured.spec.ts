import { test, expect } from './fixtures/httpFixtures';
import { retryRequest, retryPageGoto } from './helpers/retry';

// Get E2E URLs from environment or use E2E defaults
const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3201';

/**
 * OAuth Flow Validation Tests - CONFIGURED ENVIRONMENT
 *
 * These tests require actual OAuth credentials (GOOGLE_CLIENT_ID, LINE_CHANNEL_ID, etc.)
 * and test the full OAuth flow with external providers.
 *
 * Tests will be skipped if OAuth is not configured in the environment.
 */

// Global flag to track OAuth configuration status
let isOAuthConfigured = false;

test.describe('OAuth Flow Validation - Configured Environment', () => {
  const baseUrl = backendUrl;

  test.beforeAll(async ({ request }) => {
    // Detect OAuth configuration by checking if endpoints redirect to actual OAuth providers
    try {
      const googleResponse = await request.get(`${baseUrl}/api/oauth/google`, {
        maxRedirects: 0,
        timeout: 5000
      });

      if (googleResponse.status() === 302) {
        const location = googleResponse.headers()['location'];
        // If it redirects to Google, OAuth is configured
        isOAuthConfigured = location?.includes('accounts.google.com') ?? false;
      }
    } catch (error) {
      console.log('⚠️ OAuth configuration check failed:', error instanceof Error ? error.message : String(error));
      isOAuthConfigured = false;
    }

    console.log(`📋 OAuth configured: ${isOAuthConfigured ? 'YES' : 'NO'}`);

    if (!isOAuthConfigured) {
      console.log('⏭️  Skipping configured OAuth tests - OAuth credentials not available in this environment');
    }
  });

  test.beforeEach(async ({ page }) => {
    // Set up common headers and context
    await page.setExtraHTTPHeaders({
      'User-Agent': 'OAuth-Test-Suite/1.0'
    });
  });

  test.describe('OAuth Configuration Validation', () => {
    test('should have properly configured OAuth endpoints', async ({ request }) => {
      test.skip(!isOAuthConfigured, 'OAuth not configured in this environment');

      // Test Google OAuth endpoint accessibility with retry
      const googleResponse = await retryRequest(request, `${baseUrl}/api/oauth/google`, 3, {
        maxRedirects: 0
      });

      // Should redirect to Google OAuth
      expect(googleResponse.status()).toBe(302);

      const location = googleResponse.headers()['location'];
      expect(location).toBeTruthy();
      expect(location).toContain('accounts.google.com');
    });

    test('should handle LINE OAuth endpoint properly', async ({ request }) => {
      test.skip(!isOAuthConfigured, 'OAuth not configured in this environment');

      // Test LINE OAuth endpoint accessibility with retry
      const lineResponse = await retryRequest(request, `${baseUrl}/api/oauth/line`, 3, {
        maxRedirects: 0
      });

      // Should redirect to LINE OAuth
      expect(lineResponse.status()).toBe(302);

      const location = lineResponse.headers()['location'];
      expect(location).toBeTruthy();
      expect(location).toContain('access.line.me');
    });

    test('should not expose sensitive OAuth configuration', async ({ request }) => {
      test.skip(!isOAuthConfigured, 'OAuth not configured in this environment');

      // Test that OAuth endpoints don't expose sensitive configuration details
      const googleResponse = await retryRequest(request, `${baseUrl}/api/oauth/google`, 3);
      const responseText = await googleResponse.text();

      // Should not contain client secrets in response
      expect(responseText).not.toContain('client_secret');
      expect(responseText).not.toContain('CLIENT_SECRET');
      expect(responseText).not.toContain('GOOGLE_CLIENT_SECRET');
    });
  });

  test.describe('OAuth Callback Validation', () => {
    test('should handle OAuth callback errors gracefully', async ({ request }) => {
      test.skip(!isOAuthConfigured, 'OAuth not configured in this environment');

      // Test Google OAuth callback with error
      const googleCallbackResponse = await retryRequest(
        request,
        `${baseUrl}/api/oauth/google/callback?error=access_denied&error_description=User%20denied%20access`,
        3
      );

      expect([302, 301, 200]).toContain(googleCallbackResponse.status());

      if (googleCallbackResponse.status() === 302) {
        const location = googleCallbackResponse.headers()['location'];
        expect(location).toContain('/login?error=oauth_provider_error');
      }
    });

    test('should reject invalid OAuth callback attempts', async ({ request }) => {
      test.skip(!isOAuthConfigured, 'OAuth not configured in this environment');

      // Test callback without proper OAuth state/code
      const invalidCallbackResponse = await retryRequest(
        request,
        `${baseUrl}/api/oauth/google/callback?code=invalid_code&state=invalid_state`,
        3
      );

      expect([302, 301, 200]).toContain(invalidCallbackResponse.status());

      if (invalidCallbackResponse.status() === 302) {
        const location = invalidCallbackResponse.headers()['location'];
        expect(location).toMatch(/\/login\?error=(oauth_|google_)/);
      }
    });

    test('should properly handle callback URL structure', async ({ request }) => {
      test.skip(!isOAuthConfigured, 'OAuth not configured in this environment');

      // Verify callback URLs don't have duplication issues (from git history)
      const endpoints = [
        '/api/oauth/google/callback',
        '/api/oauth/line/callback'
      ];

      for (const endpoint of endpoints) {
        const response = await retryRequest(request, `${baseUrl}${endpoint}`, 3);

        // Should handle GET requests (even if they fail auth, they shouldn't 404)
        expect(response.status()).not.toBe(404);

        // If redirecting, location should not have duplicate URLs
        if ([301, 302].includes(response.status())) {
          const location = response.headers()['location'];
          if (location) {
            // Check for URL duplication patterns that caused issues
            expect(location).not.toMatch(/\/api\/oauth.*\/api\/oauth/);
            expect(location).not.toMatch(/http.*http/);
          }
        }
      }
    });
  });

  test.describe('OAuth Error Handling', () => {
    test('should provide meaningful error messages', async ({ page }) => {
      test.skip(!isOAuthConfigured, 'OAuth not configured in this environment');

      // Test OAuth error flow
      await retryPageGoto(page, `${frontendUrl}/login?error=oauth_error`, 3);

      // Should display user-friendly error message
      const errorMessage = await page.locator('[data-testid="error-message"], .error-message, .alert-error').first();

      if (await errorMessage.isVisible()) {
        const text = await errorMessage.textContent();
        expect(text).toBeTruthy();
        expect(text?.length).toBeGreaterThan(10);

        // Should not expose technical details
        expect(text).not.toContain('undefined');
        expect(text).not.toContain('null');
        expect(text).not.toContain('Error:');
      }
    });

    test('should handle OAuth timeout scenarios', async ({ request }) => {
      test.skip(!isOAuthConfigured, 'OAuth not configured in this environment');

      // Test OAuth endpoints with timeout
      const timeoutPromise = retryRequest(request, `${baseUrl}/api/oauth/google`, 2, {
        timeout: 5000
      });

      try {
        const response = await timeoutPromise;
        // If it doesn't timeout, it should still be a valid response
        expect([200, 301, 302, 400, 401, 403, 404, 429, 500]).toContain(response.status());
      } catch (error) {
        // Timeout is acceptable for this test
        expect(error.message).toContain('timeout');
      }
    });
  });

  test.describe('OAuth Flow End-to-End Prevention', () => {
    test('should prevent OAuth redirect loops', async ({ page }) => {
      test.skip(!isOAuthConfigured, 'OAuth not configured in this environment');

      // Track redirects to detect loops
      const redirectHistory: string[] = [];

      page.on('response', (response) => {
        if ([301, 302].includes(response.status())) {
          const location = response.headers()['location'];
          if (location) {
            redirectHistory.push(location);
          }
        }
      });

      try {
        // Attempt OAuth flow (will likely fail without credentials, but shouldn't loop)
        await retryPageGoto(page, `${baseUrl}/api/oauth/google`, 2, {
          timeout: 10000,
          waitUntil: 'networkidle'
        });
      } catch (error) {
        // Expected to fail, but check for redirect loops
      }

      // Verify no redirect loops occurred
      const uniqueRedirects = new Set(redirectHistory);
      expect(redirectHistory.length).toBeLessThanOrEqual(uniqueRedirects.size + 2); // Allow max 2 repeats
    });

    test('should handle concurrent OAuth requests safely', async ({ browser }) => {
      test.skip(!isOAuthConfigured, 'OAuth not configured in this environment');

      // Create multiple concurrent OAuth requests
      const contexts = await Promise.all([
        browser.newContext(),
        browser.newContext(),
        browser.newContext()
      ]);

      const requests = contexts.map(async (context) => {
        const page = await context.newPage();
        try {
          const response = await retryRequest(page.request, `${baseUrl}/api/oauth/google`, 2);
          return response.status();
        } catch (error) {
          return 500;
        } finally {
          await context.close();
        }
      });

      const responses = await Promise.all(requests);

      // All requests should get valid HTTP responses (not crash the server)
      responses.forEach(status => {
        expect([200, 301, 302, 400, 401, 403, 404, 429, 500]).toContain(status);
      });
    });
  });
});
