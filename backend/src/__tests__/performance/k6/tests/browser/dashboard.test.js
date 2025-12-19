/**
 * Dashboard Page Browser Load Test
 * Tests: Login → Navigate to dashboard → Verify elements load
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { browserOptions } from '../../config/base-options.js';
import { PAGES } from '../../config/endpoints.js';
import { TEST_USERS } from '../../config/test-data.js';

export const options = browserOptions;

async function loginAndGetPage() {
  const page = await browser.newPage();

  // Login first
  await page.goto(PAGES.login, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 10000 });

  const emailInput = page.locator('input[name="email"], input[type="email"]');
  await emailInput.fill(TEST_USERS.primary.email);

  const passwordInput = page.locator('input[name="password"], input[type="password"]');
  await passwordInput.fill(TEST_USERS.primary.password);

  const submitButton = page.locator('button[type="submit"]');
  await submitButton.click();

  await page.waitForNavigation({ timeout: 15000 });

  return page;
}

export default async function () {
  let page;

  try {
    page = await loginAndGetPage();

    // Navigate to dashboard (might already be there after login)
    if (!page.url().includes('/dashboard')) {
      await page.goto(PAGES.dashboard, { waitUntil: 'networkidle' });
    }

    // Wait for dashboard content to load
    await page.waitForLoadState('networkidle');

    // Check for key dashboard elements
    const checks = {
      'dashboard page loaded': () => page.url().includes('/dashboard'),
      'page has content': async () => {
        const body = await page.locator('body').textContent();
        return body && body.length > 0;
      },
    };

    // Try to find loyalty-related elements
    try {
      const hasLoyaltyInfo = await page.locator('[data-testid="loyalty-status"], [class*="loyalty"], [class*="tier"], [class*="points"]').isVisible();
      checks['has loyalty info'] = () => hasLoyaltyInfo;
    } catch (e) {
      // Element might not exist
    }

    check(page, checks);

    // Measure Core Web Vitals
    const webVitals = await page.evaluate(() => {
      return new Promise((resolve) => {
        const metrics = {};

        // LCP
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            metrics.lcp = entries[entries.length - 1].startTime;
          }
        }).observe({ entryTypes: ['largest-contentful-paint'] });

        // CLS
        new PerformanceObserver((list) => {
          let clsValue = 0;
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
            }
          }
          metrics.cls = clsValue;
        }).observe({ entryTypes: ['layout-shift'] });

        setTimeout(() => resolve(metrics), 3000);
      });
    });

    console.log(`Dashboard Web Vitals - LCP: ${webVitals.lcp}ms, CLS: ${webVitals.cls}`);

  } catch (error) {
    console.error(`Dashboard test error: ${error.message}`);
  } finally {
    if (page) {
      await page.close();
    }
  }

  sleep(1);
}
