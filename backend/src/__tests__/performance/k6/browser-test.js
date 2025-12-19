/**
 * Full Browser Load Test Suite
 * Tests frontend pages with real browser rendering
 *
 * Requires: k6 with browser module (k6 v0.46+)
 * Run: k6 run browser-test.js
 * With env: k6 run -e FRONTEND_URL=http://localhost:3201 browser-test.js
 */

import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

import { browserOptions, browserSmokeOptions } from './config/base-options.js';
import { PAGES } from './config/endpoints.js';
import { TEST_USERS } from './config/test-data.js';

// Use smoke options for quick tests (SMOKE=true k6 run browser-test.js)
export const options = __ENV.SMOKE === 'true' ? browserSmokeOptions : browserOptions;

// Custom metrics for browser tests
const pageLoadTime = new Trend('page_load_time');
const lcpMetric = new Trend('lcp');
const browserErrors = new Rate('browser_errors');
const pagesLoaded = new Counter('pages_loaded');

async function loginAndGetPage() {
  const page = await browser.newPage();

  try {
    // Navigate to login
    await page.goto(PAGES.login, { waitUntil: 'networkidle' });
    await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 10000 });

    // Fill and submit form
    await page.locator('input[name="email"], input[type="email"]').fill(TEST_USERS.primary.email);
    await page.locator('input[name="password"], input[type="password"]').fill(TEST_USERS.primary.password);
    await page.locator('button[type="submit"]').click();

    // Wait for redirect
    await page.waitForNavigation({ timeout: 15000 });

    return page;
  } catch (error) {
    console.error(`Login failed: ${error.message}`);
    await page.close();
    browserErrors.add(1);
    return null;
  }
}

async function measurePageLoad(page, pageName) {
  try {
    const startTime = Date.now();
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - startTime;

    pageLoadTime.add(loadTime);
    pagesLoaded.add(1);

    // Try to measure LCP
    try {
      const lcp = await page.evaluate(() => {
        return new Promise((resolve) => {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length > 0) {
              resolve(entries[entries.length - 1].startTime);
            }
          }).observe({ entryTypes: ['largest-contentful-paint'] });
          setTimeout(() => resolve(0), 2000);
        });
      });
      if (lcp > 0) {
        lcpMetric.add(lcp);
      }
    } catch (e) {
      // LCP measurement not supported
    }

    console.log(`${pageName} loaded in ${loadTime}ms`);
    return true;
  } catch (error) {
    console.error(`${pageName} load failed: ${error.message}`);
    browserErrors.add(1);
    return false;
  }
}

export default async function () {
  let page;

  try {
    // Login
    page = await loginAndGetPage();
    if (!page) {
      return;
    }

    // Test Dashboard
    if (!page.url().includes('/dashboard')) {
      await page.goto(PAGES.dashboard);
    }
    check(page, { 'dashboard loaded': () => page.url().includes('/dashboard') });
    await measurePageLoad(page, 'Dashboard');
    sleep(0.5);

    // Test Profile
    await page.goto(PAGES.profile);
    check(page, { 'profile loaded': () => page.url().includes('/profile') });
    await measurePageLoad(page, 'Profile');
    sleep(0.5);

    // Test Coupons
    await page.goto(PAGES.coupons);
    check(page, { 'coupons loaded': () => page.url().includes('/coupon') });
    await measurePageLoad(page, 'Coupons');
    sleep(0.5);

    // Test Surveys
    await page.goto(PAGES.surveys);
    check(page, { 'surveys loaded': () => page.url().includes('/survey') });
    await measurePageLoad(page, 'Surveys');
    sleep(0.5);

  } catch (error) {
    console.error(`Browser test error: ${error.message}`);
    browserErrors.add(1);
  } finally {
    if (page) {
      await page.close();
    }
  }

  sleep(1);
}

export function setup() {
  console.log('========================================');
  console.log('Browser Load Test Starting...');
  console.log(`Frontend URL: ${PAGES.login.replace('/login', '')}`);
  console.log('========================================');
}

export function teardown() {
  console.log('========================================');
  console.log('Browser Load Test Complete');
  console.log('========================================');
}
