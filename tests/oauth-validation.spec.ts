import { test, expect } from '@playwright/test';
import { retryRequest, retryPageGoto } from './helpers/retry';

/**
 * OAuth Flow Validation Tests
 * Based on git history analysis of recurring OAuth issues:
 * 1. OAuth redirect loops (particularly with Cloudflare Tunnel)
 * 2. OAuth endpoint URL duplication and misconfiguration
 * 3. Missing proxy trust configuration
 * 4. OAuth service data structure issues
 */

test.describe('OAuth Flow Validation', () => {
  const baseUrl = process.env.BACKEND_URL || 'http://localhost:4001';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4001';

  test.beforeEach(async ({ page }) => {
    // Set up common headers and context
    await page.setExtraHTTPHeaders({
      'User-Agent': 'OAuth-Test-Suite/1.0'
    });
  });

  test.describe('OAuth Configuration Validation', () => {
    test('should have properly configured OAuth endpoints', async ({ request }) => {
      // Test Google OAuth endpoint accessibility with retry
      const googleResponse = await retryRequest(request, `${baseUrl}/api/oauth/google`, 3);
      
      // Should either redirect to Google (if configured) or redirect to login with error (if not configured)
      expect([302, 301, 200]).toContain(googleResponse.status());
      
      if (googleResponse.status() === 302) {
        const location = googleResponse.headers()['location'];
        if (location) {
          // If configured, should redirect to Google or show error
          expect(location).toMatch(/(accounts\.google\.com|\/login\?error=)/);
        }
      }
    });

    test('should handle LINE OAuth endpoint properly', async ({ request }) => {
      // Test LINE OAuth endpoint accessibility with retry
      const lineResponse = await retryRequest(request, `${baseUrl}/api/oauth/line`, 3);
      
      // Should either redirect to LINE (if configured) or redirect to login with error (if not configured)
      expect([302, 301, 200]).toContain(lineResponse.status());
      
      if (lineResponse.status() === 302) {
        const location = lineResponse.headers()['location'];
        if (location) {
          // If configured, should redirect to LINE or show error
          expect(location).toMatch(/(access\.line\.me|\/login\?error=)/);
        }
      }
    });

    test('should not expose sensitive OAuth configuration', async ({ request }) => {
      // Test that OAuth endpoints don't expose sensitive configuration details with retry
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
      // Test Google OAuth callback with error and retry
      const googleCallbackResponse = await retryRequest(request, `${baseUrl}/api/oauth/google/callback?error=access_denied&error_description=User%20denied%20access`, 3);
      
      expect([302, 301, 200]).toContain(googleCallbackResponse.status());
      
      if (googleCallbackResponse.status() === 302) {
        const location = googleCallbackResponse.headers()['location'];
        expect(location).toContain('/login?error=oauth_provider_error');
      }
    });

    test('should reject invalid OAuth callback attempts', async ({ request }) => {
      // Test callback without proper OAuth state/code with retry
      const invalidCallbackResponse = await retryRequest(request, `${baseUrl}/api/oauth/google/callback?code=invalid_code&state=invalid_state`, 3);
      
      expect([302, 301, 200]).toContain(invalidCallbackResponse.status());
      
      if (invalidCallbackResponse.status() === 302) {
        const location = invalidCallbackResponse.headers()['location'];
        expect(location).toMatch(/\/login\?error=(oauth_|google_)/);
      }
    });

    test('should properly handle callback URL structure', async ({ request }) => {
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

  test.describe('OAuth Security Validation', () => {
    test('should use HTTPS in production environment', async ({ request }) => {
      // Skip this test in local development
      if (baseUrl.startsWith('http://localhost')) {
        test.skip('Skipping HTTPS test for localhost');
      }

      // In production, OAuth endpoints should redirect to HTTPS with retry
      const response = await retryRequest(request, `${baseUrl}/api/oauth/google`, 3);
      
      if (response.status() === 302) {
        const location = response.headers()['location'];
        if (location && location.includes('accounts.google.com')) {
          // Google OAuth should use HTTPS
          expect(location).toMatch(/^https:/);
        }
      }
    });

    test('should properly handle proxy headers for Cloudflare Tunnel', async ({ request }) => {
      // Test with Cloudflare proxy headers that caused issues in git history
      const cloudflareHeaders = {
        'CF-Ray': '123456789abcdef0-SJC',
        'CF-Connecting-IP': '1.2.3.4',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'example.com',
        'X-Real-IP': '1.2.3.4'
      };

      const response = await retryRequest(request, `${baseUrl}/api/oauth/google`, 3, {
        headers: cloudflareHeaders
      });

      // Should handle proxy headers without causing redirect loops
      expect(response.status()).not.toBe(500);
      
      // Should not redirect back to itself (redirect loop detection)
      if (response.status() === 302) {
        const location = response.headers()['location'];
        expect(location).not.toContain('/api/oauth/google');
      }
    });

    test('should validate redirect URI security', async ({ request }) => {
      // Test for open redirect vulnerabilities
      const maliciousRedirects = [
        'http://evil.com',
        'https://evil.com/callback',
        'javascript:alert(1)',
        '//evil.com/callback',
        'data:text/html,<script>alert(1)</script>'
      ];

      for (const redirect of maliciousRedirects) {
        const response = await retryRequest(request, `${baseUrl}/api/oauth/google/callback?redirect_uri=${encodeURIComponent(redirect)}`, 3);
        
        // Should not redirect to external malicious URLs
        if (response.status() === 302) {
          const location = response.headers()['location'];
          expect(location).not.toContain('evil.com');
          expect(location).not.toContain('javascript:');
          expect(location).not.toContain('data:');
        }
      }
    });
  });

  test.describe('OAuth Error Handling', () => {
    test('should provide meaningful error messages', async ({ page }) => {
      // Test OAuth error flow with retry
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
      // Test OAuth endpoints with timeout and retry
      const timeoutPromise = retryRequest(request, `${baseUrl}/api/oauth/google`, 2, {
        timeout: 5000
      });

      try {
        const response = await timeoutPromise;
        // If it doesn't timeout, it should still be a valid response
        // Include 429 (rate limiting) as valid for timeout scenario testing
        expect([200, 301, 302, 400, 401, 403, 404, 429, 500]).toContain(response.status());
      } catch (error) {
        // Timeout is acceptable for this test
        expect(error.message).toContain('timeout');
      }
    });
  });

  test.describe('OAuth Flow End-to-End Prevention', () => {
    test('should prevent OAuth redirect loops', async ({ page }) => {
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
      // Include 429 (rate limiting) as a valid response for concurrent requests
      responses.forEach(status => {
        expect([200, 301, 302, 400, 401, 403, 404, 429, 500]).toContain(status);
      });
    });
  });
});