/**
 * Login Flow Browser Load Test
 * Tests: Navigate to login, fill form, submit, verify redirect
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { browserOptions } from '../../config/base-options.js';
import { PAGES } from '../../config/endpoints.js';
import { TEST_USERS } from '../../config/test-data.js';

export const options = browserOptions;

export default async function () {
  const page = await browser.newPage();

  try {
    // Navigate to login page
    await page.goto(PAGES.login, { waitUntil: 'networkidle' });

    // Wait for login form to load
    await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 10000 });

    // Fill login form
    const emailInput = page.locator('input[name="email"], input[type="email"]');
    await emailInput.fill(TEST_USERS.primary.email);

    const passwordInput = page.locator('input[name="password"], input[type="password"]');
    await passwordInput.fill(TEST_USERS.primary.password);

    // Submit form
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // Wait for navigation to dashboard
    await page.waitForNavigation({ timeout: 15000 });

    // Verify redirect to dashboard
    check(page, {
      'redirected to dashboard': () => page.url().includes('/dashboard'),
    });

    // Measure page load performance
    const performanceMetrics = await page.evaluate(() => {
      const timing = performance.timing;
      return {
        loadTime: timing.loadEventEnd - timing.navigationStart,
        domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
      };
    });

    console.log(`Login flow completed. Load time: ${performanceMetrics.loadTime}ms`);

  } catch (error) {
    console.error(`Login flow error: ${error.message}`);
  } finally {
    await page.close();
  }

  sleep(1);
}
