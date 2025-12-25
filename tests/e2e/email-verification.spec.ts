import { test, expect } from '@playwright/test';
import { retryPageGoto } from '../helpers/retry';

/**
 * Email Verification E2E Tests
 *
 * Tests the email verification flow including:
 * - Registration verification (new user email verification)
 * - Modal display after email change
 * - Invalid verification code handling
 * - Resend code functionality
 * - Cancel verification
 *
 * Note: Full verification success test requires backend test endpoint to retrieve codes
 */

test.describe('Email Verification Flow', () => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3201';
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:4202';

  let page: any;
  let authToken: string;
  let userId: string;

  test.beforeAll(async ({ browser }) => {
    // Create a new page for authentication setup
    page = await browser.newPage();

    // Register a test user
    const timestamp = Date.now();
    const testEmail = `test-email-verify-${timestamp}@example.com`;
    const testPassword = 'TestPassword123!';

    const registerResponse = await page.request.post(`${backendUrl}/api/auth/register`, {
      data: {
        email: testEmail,
        password: testPassword,
        firstName: 'Email',
        lastName: 'Tester',
      },
    });

    expect(registerResponse.ok()).toBeTruthy();
    const registerData = await registerResponse.json();
    authToken = registerData.accessToken;
    userId = registerData.user.id;

    // Set authentication cookie
    await page.context().addCookies([{
      name: 'accessToken',
      value: authToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    }]);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test.describe('Registration Verification', () => {
    test('should show "not verified" indicator on profile for unverified user', async () => {
      // Navigate to profile page
      await retryPageGoto(page, `${frontendUrl}/profile`, 2);

      // Wait for page to load
      await page.waitForSelector('[data-testid="profile-email"]', { timeout: 10000 });

      // Check for not verified indicator (ยังไม่ยืนยัน)
      const emailSection = page.locator('[data-testid="profile-email"]');
      const sectionText = await emailSection.textContent();

      // Should contain the "not verified" text in Thai
      const hasNotVerifiedText = sectionText && (
        sectionText.includes('ยังไม่ยืนยัน') ||
        sectionText.includes('not verified') ||
        sectionText.includes('Not verified')
      );

      expect(hasNotVerifiedText).toBeTruthy();
    });

    test('should show verify button next to email label', async () => {
      await retryPageGoto(page, `${frontendUrl}/profile`, 2);

      // Wait for profile to load
      await page.waitForSelector('[data-testid="profile-email"]', { timeout: 10000 });

      // Check for verify button
      const verifyButton = page.locator('[data-testid="verify-email-button"]');
      await expect(verifyButton).toBeVisible({ timeout: 5000 });

      // Button should contain "ยืนยัน" (verify in Thai) or similar text
      const buttonText = await verifyButton.textContent();
      expect(buttonText).toMatch(/ยืนยัน|verify/i);
    });

    test('should open verification modal when clicking verify button', async () => {
      await retryPageGoto(page, `${frontendUrl}/profile`, 2);

      await page.waitForSelector('[data-testid="profile-email"]', { timeout: 10000 });

      // Click verify button
      const verifyButton = page.locator('[data-testid="verify-email-button"]');
      await verifyButton.click();

      // Verify EmailVerificationModal appears
      await page.waitForSelector('[data-testid="email-verification-modal"]', { timeout: 5000 });

      const modal = page.locator('[data-testid="email-verification-modal"]');
      await expect(modal).toBeVisible();

      // Modal should have verification code input
      const codeInput = page.locator('[data-testid="verification-code-input"]');
      await expect(codeInput).toBeVisible();

      // Verify button should exist
      const modalVerifyButton = page.locator('[data-testid="verify-button"]');
      await expect(modalVerifyButton).toBeVisible();
    });

    test('should handle invalid verification code for registration', async () => {
      await retryPageGoto(page, `${frontendUrl}/profile`, 2);

      await page.waitForSelector('[data-testid="profile-email"]', { timeout: 10000 });

      // Open verification modal
      const verifyButton = page.locator('[data-testid="verify-email-button"]');
      await verifyButton.click();

      await page.waitForSelector('[data-testid="email-verification-modal"]', { timeout: 5000 });

      // Enter invalid code
      const codeInput = page.locator('[data-testid="verification-code-input"]');
      await codeInput.fill('INVALID-CODE');

      // Click verify
      const modalVerifyButton = page.locator('[data-testid="verify-button"]');
      await modalVerifyButton.click();

      // Wait for error to appear
      await page.waitForTimeout(1000);

      // Verify error message appears
      const modalContent = await page.locator('[data-testid="email-verification-modal"]').textContent();
      const hasError = modalContent && (
        modalContent.includes('invalid') ||
        modalContent.includes('Invalid') ||
        modalContent.includes('ไม่ถูกต้อง') ||
        modalContent.includes('Verification failed')
      );

      expect(hasError).toBeTruthy();
    });
  });

  test.describe('Email Change Verification', () => {
      test('should show verification modal when updating email', async () => {
      // Navigate to profile page
      await retryPageGoto(page, `${frontendUrl}/profile`, 2);

      // Wait for page to load
      await page.waitForSelector('[data-testid="settings-button"]', { timeout: 10000 }).catch(() => {
        // Fallback: look for settings button by text or icon
        return page.waitForSelector('button:has-text("Settings")', { timeout: 5000 });
      });

      // Click settings button to open modal
      const settingsButton = await page.locator('[data-testid="settings-button"]').or(
        page.locator('button:has-text("Settings")')
      ).first();
      await settingsButton.click();

      // Wait for settings modal
      await page.waitForSelector('[data-testid="settings-modal"]', { timeout: 5000 }).catch(() => {
        // Fallback: wait for modal with heading
        return page.waitForSelector('h2:has-text("Settings")', { timeout: 5000 });
      });

      // Change email address
      const newEmail = `new-email-${Date.now()}@example.com`;
      const emailInput = await page.locator('input[type="email"]').or(
        page.locator('input[name="email"]')
      ).first();

      await emailInput.clear();
      await emailInput.fill(newEmail);

      // Submit the form
      const saveButton = await page.locator('[data-testid="save-settings-button"]').or(
        page.locator('button:has-text("Save")')
      ).first();
      await saveButton.click();

      // Verify EmailVerificationModal appears
      await page.waitForSelector('[data-testid="email-verification-modal"]', { timeout: 5000 });

      const modal = page.locator('[data-testid="email-verification-modal"]');
      await expect(modal).toBeVisible();

      // Verify the new email is displayed in the modal
      const modalText = await modal.textContent();
      expect(modalText).toContain(newEmail);

      // Verify modal contains verification code input
      const codeInput = page.locator('[data-testid="verification-code-input"]');
      await expect(codeInput).toBeVisible();

      // Verify verify button exists
      const verifyButton = page.locator('[data-testid="verify-button"]');
      await expect(verifyButton).toBeVisible();
    });

      test('should handle invalid verification code format', async () => {
      // Navigate to profile page
      await retryPageGoto(page, `${frontendUrl}/profile`, 2);

      // Open settings modal
      await page.waitForSelector('[data-testid="settings-button"]', { timeout: 10000 }).catch(() => {
        return page.waitForSelector('button:has-text("Settings")', { timeout: 5000 });
      });

      const settingsButton = await page.locator('[data-testid="settings-button"]').or(
        page.locator('button:has-text("Settings")')
      ).first();
      await settingsButton.click();

      // Change email to trigger verification
      const newEmail = `invalid-test-${Date.now()}@example.com`;
      const emailInput = await page.locator('input[type="email"]').or(
        page.locator('input[name="email"]')
      ).first();

      await emailInput.clear();
      await emailInput.fill(newEmail);

      // Submit
      const saveButton = await page.locator('[data-testid="save-settings-button"]').or(
        page.locator('button:has-text("Save")')
      ).first();
      await saveButton.click();

      // Wait for verification modal
      await page.waitForSelector('[data-testid="email-verification-modal"]', { timeout: 5000 });

      // Enter invalid code format (too short)
      const codeInput = page.locator('[data-testid="verification-code-input"]');
      await codeInput.fill('ABCD');

      // Click verify button
      const verifyButton = page.locator('[data-testid="verify-button"]');
      await verifyButton.click();

      // Wait a bit for error to appear
      await page.waitForTimeout(500);

      // Verify error message appears (checking for common error text patterns)
      const modalContent = await page.locator('[data-testid="email-verification-modal"]').textContent();
      const hasError = modalContent && (
        modalContent.includes('invalid') ||
        modalContent.includes('Invalid') ||
        modalContent.includes('format') ||
        modalContent.includes('XXXX-XXXX')
      );

      expect(hasError).toBeTruthy();
    });

      test('should handle invalid verification code from backend', async () => {
      // Navigate to profile page
      await retryPageGoto(page, `${frontendUrl}/profile`, 2);

      // Open settings modal
      await page.waitForSelector('[data-testid="settings-button"]', { timeout: 10000 }).catch(() => {
        return page.waitForSelector('button:has-text("Settings")', { timeout: 5000 });
      });

      const settingsButton = await page.locator('[data-testid="settings-button"]').or(
        page.locator('button:has-text("Settings")')
      ).first();
      await settingsButton.click();

      // Change email to trigger verification
      const newEmail = `backend-invalid-${Date.now()}@example.com`;
      const emailInput = await page.locator('input[type="email"]').or(
        page.locator('input[name="email"]')
      ).first();

      await emailInput.clear();
      await emailInput.fill(newEmail);

      // Submit
      const saveButton = await page.locator('[data-testid="save-settings-button"]').or(
        page.locator('button:has-text("Save")')
      ).first();
      await saveButton.click();

      // Wait for verification modal
      await page.waitForSelector('[data-testid="email-verification-modal"]', { timeout: 5000 });

      // Enter valid format but wrong code
      const codeInput = page.locator('[data-testid="verification-code-input"]');
      await codeInput.fill('ABCD-1234');

      // Click verify button
      const verifyButton = page.locator('[data-testid="verify-button"]');
      await verifyButton.click();

      // Wait for backend response
      await page.waitForTimeout(1000);

      // Verify error message appears from backend
      const modalContent = await page.locator('[data-testid="email-verification-modal"]').textContent();
      const hasError = modalContent && (
        modalContent.includes('invalid') ||
        modalContent.includes('Invalid') ||
        modalContent.includes('expired') ||
        modalContent.includes('Expired') ||
        modalContent.includes('Verification failed') ||
        modalContent.includes('verification failed')
      );

      expect(hasError).toBeTruthy();
    });

      test('should show resend button that is enabled (no cooldown)', async () => {
      // Navigate to profile page
      await retryPageGoto(page, `${frontendUrl}/profile`, 2);

      // Open settings modal
      await page.waitForSelector('[data-testid="settings-button"]', { timeout: 10000 }).catch(() => {
        return page.waitForSelector('button:has-text("Settings")', { timeout: 5000 });
      });

      const settingsButton = await page.locator('[data-testid="settings-button"]').or(
        page.locator('button:has-text("Settings")')
      ).first();
      await settingsButton.click();

      // Change email to trigger verification
      const newEmail = `resend-test-${Date.now()}@example.com`;
      const emailInput = await page.locator('input[type="email"]').or(
        page.locator('input[name="email"]')
      ).first();

      await emailInput.clear();
      await emailInput.fill(newEmail);

      // Submit
      const saveButton = await page.locator('[data-testid="save-settings-button"]').or(
        page.locator('button:has-text("Save")')
      ).first();
      await saveButton.click();

      // Wait for verification modal
      await page.waitForSelector('[data-testid="email-verification-modal"]', { timeout: 5000 });

      // Resend button should be visible and enabled (no cooldown)
      const resendButton = page.locator('[data-testid="resend-code-button"]');
      await expect(resendButton).toBeVisible();
      await expect(resendButton).toBeEnabled();
    });

      test('should show confirmation message after resending code', async () => {
      // Navigate to profile page
      await retryPageGoto(page, `${frontendUrl}/profile`, 2);

      // Open settings modal
      await page.waitForSelector('[data-testid="settings-button"]', { timeout: 10000 }).catch(() => {
        return page.waitForSelector('button:has-text("Settings")', { timeout: 5000 });
      });

      const settingsButton = await page.locator('[data-testid="settings-button"]').or(
        page.locator('button:has-text("Settings")')
      ).first();
      await settingsButton.click();

      // Change email to trigger verification
      const newEmail = `resend-confirm-${Date.now()}@example.com`;
      const emailInput = await page.locator('input[type="email"]').or(
        page.locator('input[name="email"]')
      ).first();

      await emailInput.clear();
      await emailInput.fill(newEmail);

      // Submit
      const saveButton = await page.locator('[data-testid="save-settings-button"]').or(
        page.locator('button:has-text("Save")')
      ).first();
      await saveButton.click();

      // Wait for verification modal
      await page.waitForSelector('[data-testid="email-verification-modal"]', { timeout: 5000 });

      // Click resend button
      const resendButton = page.locator('[data-testid="resend-code-button"]');
      await resendButton.click();

      // Wait for success confirmation to appear
      const successMessage = page.locator('[data-testid="resend-success"]');
      await expect(successMessage).toBeVisible({ timeout: 5000 });

      // Check that success message contains confirmation text
      const successText = await successMessage.textContent();
      expect(successText).toMatch(/sent|ส่ง|发送/i); // "sent" in EN, TH, or CN
    });

      test('should close verification modal and keep email unchanged when cancelled', async () => {
      // Get current email before test
      const profileResponse = await page.request.get(`${backendUrl}/api/users/profile`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const initialProfile = await profileResponse.json();
      const initialEmail = initialProfile.email;

      // Navigate to profile page
      await retryPageGoto(page, `${frontendUrl}/profile`, 2);

      // Open settings modal
      await page.waitForSelector('[data-testid="settings-button"]', { timeout: 10000 }).catch(() => {
        return page.waitForSelector('button:has-text("Settings")', { timeout: 5000 });
      });

      const settingsButton = await page.locator('[data-testid="settings-button"]').or(
        page.locator('button:has-text("Settings")')
      ).first();
      await settingsButton.click();

      // Change email to trigger verification
      const newEmail = `cancel-test-${Date.now()}@example.com`;
      const emailInput = await page.locator('input[type="email"]').or(
        page.locator('input[name="email"]')
      ).first();

      await emailInput.clear();
      await emailInput.fill(newEmail);

      // Submit
      const saveButton = await page.locator('[data-testid="save-settings-button"]').or(
        page.locator('button:has-text("Save")')
      ).first();
      await saveButton.click();

      // Wait for verification modal
      await page.waitForSelector('[data-testid="email-verification-modal"]', { timeout: 5000 });

      // Close the modal (look for X button or close button)
      const closeButton = await page.locator('[data-testid="email-verification-modal"] button[aria-label="Close"]').or(
        page.locator('[data-testid="email-verification-modal"] button:has-text("Close")')
      ).first();

      await closeButton.click();

      // Wait for modal to close
      await page.waitForSelector('[data-testid="email-verification-modal"]', {
        state: 'hidden',
        timeout: 2000
      });

      // Verify modal is no longer visible
      const modal = page.locator('[data-testid="email-verification-modal"]');
      await expect(modal).not.toBeVisible();

      // Verify email hasn't changed in backend
      const finalProfileResponse = await page.request.get(`${backendUrl}/api/users/profile`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const finalProfile = await finalProfileResponse.json();

      expect(finalProfile.email).toBe(initialEmail);
      expect(finalProfile.email).not.toBe(newEmail);
    });

      test.skip('should update email after successful verification', async () => {
      // This test requires a backend test endpoint to retrieve the verification code
      // Skip until such endpoint is available

      // Example implementation if test endpoint existed:
      /*
      await retryPageGoto(page, `${frontendUrl}/profile`, 2);

      // ... trigger email change and open verification modal ...

      const newEmail = `success-test-${Date.now()}@example.com`;

      // Get verification code from test endpoint
      const codeResponse = await page.request.get(`${backendUrl}/api/test/get-verification-code`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const { code } = await codeResponse.json();

      // Enter the correct code
      const codeInput = page.locator('[data-testid="verification-code-input"]');
      await codeInput.fill(code);

      // Click verify
      const verifyButton = page.locator('[data-testid="verify-button"]');
      await verifyButton.click();

      // Wait for success
      await page.waitForTimeout(1000);

      // Modal should close
      const modal = page.locator('[data-testid="email-verification-modal"]');
      await expect(modal).not.toBeVisible();

      // Verify email was updated
      const profileResponse = await page.request.get(`${backendUrl}/api/users/profile`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const profile = await profileResponse.json();
      expect(profile.email).toBe(newEmail);

      // Verify success notification appears
      await expect(page.locator('text=/email.*updated/i')).toBeVisible();
      */
    });
  });
});
