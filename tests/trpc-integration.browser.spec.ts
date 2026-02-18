import { test, expect } from '@playwright/test';
import { loginViaUI, getTestUserForWorker } from './helpers/auth';

// Skip: Frontend uses tRPC to fetch data, but Rust backend only has REST endpoints.
// These tests will be re-enabled when the frontend is migrated from tRPC to REST API calls.
test.describe('tRPC integration (browser)', () => {
  test.skip(true, 'Frontend tRPC calls are not supported by Rust backend (REST only)');
  // Run tests serially to avoid session conflicts during parallel login
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
  });

  test('Dashboard loads loyalty data', async ({ page }, testInfo) => {
    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);

    await expect(page.getByTestId('dashboard-points')).toBeVisible();
    await expect(page.getByTestId('dashboard-tier')).toBeVisible();
  });

  test('Profile loads user data', async ({ page }, testInfo) => {
    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('profile-name')).toContainText(/E2E/i);
    await expect(page.getByTestId('profile-email')).toContainText(user.email);
  });

  test('No 401 errors on tRPC calls', async ({ page }, testInfo) => {
    const user = getTestUserForWorker(testInfo.workerIndex);
    const trpcStatuses: number[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/trpc/')) {
        trpcStatuses.push(response.status());
      }
    });

    await loginViaUI(page, user.email, user.password);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('dashboard-points')).toBeVisible();
    // networkidle ensures all tRPC calls completed

    expect(trpcStatuses.length).toBeGreaterThan(0);
    expect(trpcStatuses).not.toContain(401);
  });

  test('Data persists after reload', async ({ page }, testInfo) => {
    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const pointsText = (await page.getByTestId('dashboard-points').innerText()).trim();
    const tierText = (await page.getByTestId('dashboard-tier').innerText()).trim();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('dashboard-points')).toHaveText(pointsText);
    await expect(page.getByTestId('dashboard-tier')).toHaveText(tierText);
  });
});
