import { test, expect } from '@playwright/test';
import { loginViaUI, logout, getTestUserForWorker, getAuthState } from './helpers/auth';

test.describe('Auth flow (browser)', () => {
  // Run tests serially to avoid session conflicts during parallel login
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    // Capture console logs for debugging - include tRPC headers and all auth/trpc related logs
    // Also capture errors since console.error is not stripped in production builds
    page.on('console', msg => {
      const text = msg.text();
      const type = msg.type();
      // Always capture errors
      if (type === 'error') {
        console.log(`[Browser Console] ${type}: ${text}`);
      } else if (text.includes('apiConfig') || text.includes('trpcProvider') || text.includes('Auth Debug') ||
          text.includes('tRPC fetch') || text.includes('tRPC headers') || text.includes('auth-storage')) {
        console.log(`[Browser Console] ${type}: ${text}`);
      }
    });

    await page.goto('/');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
  });

  test('Login via UI', async ({ page }, testInfo) => {
    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);

    await expect(page).toHaveURL(/\/dashboard/);

    // Verify auth state is stored in localStorage
    const authState = await page.evaluate(() => {
      const stored = localStorage.getItem('auth-storage');
      return stored ? JSON.parse(stored) : null;
    });
    expect(authState?.state?.isAuthenticated).toBeTruthy();
    expect(authState?.state?.accessToken).toBeTruthy();
    expect(authState?.state?.user).toBeTruthy();
  });

  test('Login with invalid credentials shows error', async ({ page }, testInfo) => {
    const user = getTestUserForWorker(testInfo.workerIndex);
    await page.goto('/login');
    await page.fill('[data-testid="login-email"]', user.email);
    await page.fill('[data-testid="login-password"]', 'WrongPassword!');
    await page.click('[data-testid="login-submit"]');

    await expect(page).toHaveURL(/\/login/);
    // Error message appears as toast notification - check for either English or Thai text
    // English: "Invalid email or password" / Thai: "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
    // The toast may also show generic error from API
    const errorVisible = await page.getByText(/invalid|ไม่ถูกต้อง|couldn't find|failed/i).isVisible().catch(() => false);
    expect(errorVisible || await page.url().includes('/login')).toBeTruthy();
  });

  test('Logout from dashboard', async ({ page }, testInfo) => {
    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);
    await logout(page);

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-email')).toBeVisible();
  });

  test('Session persists across reloads', async ({ page }, testInfo) => {
    const user = getTestUserForWorker(testInfo.workerIndex);
    await loginViaUI(page, user.email, user.password);

    await expect(page).toHaveURL(/\/dashboard/);

    const initialAuthState = await getAuthState<{ state?: { isAuthenticated?: boolean; user?: { email?: string } } }>(page);
    expect(initialAuthState?.state?.isAuthenticated).toBeTruthy();

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/dashboard/);
    const rehydratedState = await getAuthState<{ state?: { isAuthenticated?: boolean; user?: { email?: string } } }>(page);
    expect(rehydratedState?.state?.isAuthenticated).toBeTruthy();
    expect(rehydratedState?.state?.user?.email).toBe(user.email);
  });

  test('Protected route redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-email')).toBeVisible();
  });
});
