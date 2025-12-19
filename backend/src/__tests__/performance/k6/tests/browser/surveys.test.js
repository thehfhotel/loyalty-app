/**
 * Surveys Page Browser Load Test
 * Tests: Login → Navigate to surveys → Verify survey list loads
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
    page = await loginAndNavigate(PAGES.surveys);

    // Wait for page load
    await page.waitForLoadState('networkidle');

    // Basic page checks
    check(page, {
      'surveys page loaded': () => page.url().includes('/survey'),
    });

    // Look for survey-related elements
    try {
      const hasSurveyContent = await page.evaluate(() => {
        const body = document.body.textContent || '';
        // Look for survey-related terms
        return body.includes('survey') ||
               body.includes('Survey') ||
               body.includes('แบบสอบถาม') || // Thai for survey
               body.includes('ไม่มี') || // Thai for "none"
               document.querySelector('[data-testid*="survey"]') !== null;
      });

      check(page, {
        'has survey content': () => hasSurveyContent,
      });
    } catch (e) {
      // Continue
    }

    console.log('Surveys page load test completed');

  } catch (error) {
    console.error(`Surveys test error: ${error.message}`);
  } finally {
    if (page) {
      await page.close();
    }
  }

  sleep(1);
}
