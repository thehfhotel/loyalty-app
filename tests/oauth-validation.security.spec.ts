import { test, expect } from '@playwright/test';
import { retryRequest } from './helpers/retry';

// Get E2E URLs from environment or use E2E defaults
const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

/**
 * OAuth Security Validation Tests
 *
 * These tests validate OAuth security measures regardless of OAuth configuration.
 * They test security boundaries, proxy header handling, and redirect URI validation.
 *
 * These tests run in ALL environments (with or without OAuth configured).
 */

test.describe('OAuth Security Validation', () => {
  const baseUrl = backendUrl;

  test.beforeEach(async ({ page }) => {
    // Set up common headers and context
    await page.setExtraHTTPHeaders({
      'User-Agent': 'OAuth-Test-Suite/1.0'
    });
  });

  test('should use HTTPS in production environment', async ({ request }) => {
    // Skip this test in local development
    if (baseUrl.startsWith('http://localhost')) {
      test.skip('Skipping HTTPS test for localhost');
    }

    // In production, OAuth endpoints should redirect to HTTPS
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
      const response = await retryRequest(
        request,
        `${baseUrl}/api/oauth/google/callback?redirect_uri=${encodeURIComponent(redirect)}`,
        3
      );

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
