import { test, expect } from './fixtures/httpFixtures';
import { retryRequest } from './helpers/retry';

// Get E2E URLs from environment or use E2E defaults
const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

/**
 * OAuth Flow Validation Tests - UNCONFIGURED ENVIRONMENT
 *
 * These tests validate OAuth behavior when credentials are NOT configured.
 * They ensure graceful degradation and proper error handling without external OAuth providers.
 *
 * These tests run in ALL environments (with or without OAuth configured).
 */

test.describe('OAuth Flow Validation - Unconfigured Environment', () => {
  const baseUrl = backendUrl;

  test.beforeEach(async ({ page }) => {
    // Set up common headers and context
    await page.setExtraHTTPHeaders({
      'User-Agent': 'OAuth-Test-Suite/1.0'
    });
  });

  test.describe('OAuth Me Endpoint Validation', () => {
    test('should require authentication for /oauth/me endpoint', async ({ request }) => {
      const response = await retryRequest(request, `${baseUrl}/api/oauth/me`, 3);

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('No token provided');
    });

    test('should reject invalid tokens', async ({ request }) => {
      const response = await retryRequest(request, `${baseUrl}/api/oauth/me`, 3, {
        headers: {
          'Authorization': 'Bearer invalid_token_here'
        }
      });

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Invalid token');
    });

    test('should handle malformed authorization headers', async ({ request }) => {
      const malformedHeaders = [
        'invalid_format',
        'Bearer',
        'Basic token_here',
        'Bearer ',
        ''
      ];

      for (const authHeader of malformedHeaders) {
        const response = await retryRequest(request, `${baseUrl}/api/oauth/me`, 3, {
          headers: {
            'Authorization': authHeader
          }
        });

        expect(response.status()).toBe(401);
      }
    });
  });
});
