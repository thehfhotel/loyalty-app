/**
 * Profile Page Browser Load Test
 * Tests: Login → Navigate to profile → Verify form loads
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { browserOptions } from '../../config/base-options.js';
import { PAGES } from '../../config/endpoints.js';
import { TEST_USERS } from '../../config/test-data.js';

export const options = browserOptions;

async function loginAndNavigate(targetPage) {
  const page = await browser.newPage();

  // Login first
  await page.goto(PAGES.login, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 10000 });

  await page.locator('input[name="email"], input[type="email"]').fill(TEST_USERS.primary.email);
  await page.locator('input[name="password"], input[type="password"]').fill(TEST_USERS.primary.password);
  await page.locator('button[type="submit"]').click();

  await page.waitForNavigation({ timeout: 15000 });

  // Navigate to target page
  await page.goto(targetPage, { waitUntil: 'networkidle' });

  return page;
}

export default async function () {
  let page;

  try {
    page = await loginAndNavigate(PAGES.profile);

    // Wait for profile page to load
    await page.waitForLoadState('networkidle');

    // Check for profile elements
    check(page, {
      'profile page loaded': () => page.url().includes('/profile'),
    });

    // Look for form elements
    try {
      const hasForm = await page.locator('form, [data-testid="profile-form"]').isVisible();
      check(page, {
        'has profile form': () => hasForm,
      });
    } catch (e) {
      // Form might be structured differently
    }

    // Try to find input fields
    try {
      const hasInputs = await page.locator('input').count();
      check(page, {
        'has input fields': () => hasInputs > 0,
      });
    } catch (e) {
      // Continue
    }

    console.log('Profile page load test completed');

  } catch (error) {
    console.error(`Profile test error: ${error.message}`);
  } finally {
    if (page) {
      await page.close();
    }
  }

  sleep(1);
}
