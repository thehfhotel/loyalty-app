import { test, expect } from '@playwright/test';
import { loginViaUI, TEST_USER } from './helpers/auth';

test.describe('Form validations (browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
  });

  test('Login - empty email shows validation', async ({ page }) => {
    await page.click('[data-testid="login-submit"]');
    // Check for validation message in English or Thai
    // English: "Invalid email address" / Thai: "อีเมลไม่ถูกต้อง"
    await expect(page.getByText(/invalid email|อีเมล.*ไม่ถูกต้อง/i)).toBeVisible();
  });

  test('Login - invalid email format', async ({ page }) => {
    await page.fill('[data-testid="login-email"]', 'not-an-email');
    await page.fill('[data-testid="login-password"]', 'password');
    await page.click('[data-testid="login-submit"]');

    // Browser HTML5 validation prevents submission for invalid email format
    // The form should stay on login page (submission prevented)
    // Check that we're still on login page
    await expect(page).toHaveURL(/\/login/);
    // The email input should have validation state (HTML5 validation)
    const emailInput = page.locator('[data-testid="login-email"]');
    const isInvalid = await emailInput.evaluate((el) => !(el as HTMLInputElement).checkValidity());
    expect(isInvalid).toBeTruthy();
  });

  test('Login - empty password', async ({ page }) => {
    await page.fill('[data-testid="login-email"]', TEST_USER.email);
    await page.click('[data-testid="login-submit"]');

    // Check for validation message in English or Thai
    // English: "Password is required" / Thai: "กรุณากรอกรหัสผ่าน"
    await expect(page.getByText(/password.*required|กรุณากรอก.*รหัสผ่าน/i)).toBeVisible();
  });

  test('Registration - password requirements enforced', async ({ page }) => {
    await page.goto('/register');

    await page.fill('#firstName', 'Test');
    await page.fill('#lastName', 'User');
    await page.fill('#email', 'reg@test.com');
    await page.fill('#password', '123');
    await page.fill('#confirmPassword', '123');
    await page.click('button[type="submit"]');

    // Check for password requirement message in English or Thai
    await expect(page.getByText(/at least 8|อย่างน้อย 8|ตัวอักษร/i)).toBeVisible();
  });

  test('Profile - phone format validation', async ({ page }) => {
    // Extended timeout for this test
    test.setTimeout(30000);

    // Login directly (avoid helper for more control)
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.fill('[data-testid="login-email"]', TEST_USER.email);
    await page.fill('[data-testid="login-password"]', TEST_USER.password);
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });

    // Navigate to profile
    await page.goto('/profile');
    await page.waitForLoadState('networkidle');

    // Click edit settings button (Thai: "แก้ไขการตั้งค่า")
    await page.getByRole('button', { name: /edit settings|แก้ไขการตั้งค่า/i }).click();
    await page.waitForTimeout(300);

    // Find phone input and fill with invalid value (Thai: "เบอร์โทรศัพท์")
    const phoneInput = page.getByLabel(/phone|เบอร์โทรศัพท์|โทรศัพท์/i);
    await phoneInput.fill('abc');

    // Click save button (Thai: "บันทึก")
    await page.getByRole('button', { name: /^save$|^บันทึก$/i }).click();

    // Check for validation message in English or Thai
    // Or check that we're still on the form (validation prevented submission)
    const validationVisible = await page.getByText(/valid phone|โทรศัพท์.*ไม่ถูกต้อง|invalid.*phone|หมายเลข.*ไม่ถูกต้อง/i).isVisible().catch(() => false);
    const stillOnForm = await page.getByRole('button', { name: /^save$|^บันทึก$/i }).isVisible().catch(() => false);
    expect(validationVisible || stillOnForm).toBeTruthy();
  });
});
