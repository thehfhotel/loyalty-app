/**
 * Coupons Page Browser Load Test
 * Tests: Login → Navigate to coupons → Verify coupon list loads
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { browserOptions } from '../../config/base-options.js';
import { PAGES } from '../../config/endpoints.js';
import { TEST_USERS } from '../../config/test-data.js';

export const options = browserOptions;

async function loginAndNavigate(targetPage) {
  const page = await browser.newPage();

  // Login
  await page.goto(PAGES.login, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 10000 });

  await page.locator('input[name="email"], input[type="email"]').fill(TEST_USERS.primary.email);
  await page.locator('input[name="password"], input[type="password"]').fill(TEST_USERS.primary.password);
  await page.locator('button[type="submit"]').click();

  await page.waitForNavigation({ timeout: 15000 });

  // Navigate to target
  await page.goto(targetPage, { waitUntil: 'networkidle' });

  return page;
}

export default async function () {
  let page;

  try {
    page = await loginAndNavigate(PAGES.coupons);

    // Wait for page load
    await page.waitForLoadState('networkidle');

    // Basic page checks
    check(page, {
      'coupons page loaded': () => page.url().includes('/coupon'),
    });

    // Look for coupon-related elements
    try {
      // Check for coupon cards, list items, or empty state
      const hasCouponContent = await page.evaluate(() => {
        const body = document.body.textContent || '';
        // Look for common coupon-related terms
        return body.includes('coupon') ||
               body.includes('Coupon') ||
               body.includes('คูปอง') ||
               body.includes('ไม่มี') || // Thai for "none"
               document.querySelector('[data-testid*="coupon"]') !== null;
      });

      check(page, {
        'has coupon content': () => hasCouponContent,
      });
    } catch (e) {
      // Continue
    }

    console.log('Coupons page load test completed');

  } catch (error) {
    console.error(`Coupons test error: ${error.message}`);
  } finally {
    if (page) {
      await page.close();
    }
  }

  sleep(1);
}
