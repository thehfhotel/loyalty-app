const { test, expect } = require('@playwright/test');

test.describe('User Registration Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the registration page
    await page.goto('/register');
  });

  test('should display registration form correctly', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Loyalty App/);
    
    // Check form elements are present
    await expect(page.locator('h2:has-text("Join Our Loyalty Program")')).toBeVisible();
    await expect(page.locator('input[name="firstName"]')).toBeVisible();
    await expect(page.locator('input[name="lastName"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('input[name="confirmPassword"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should validate required fields', async ({ page }) => {
    // Click submit button without filling any fields
    await page.locator('button[type="submit"]').click();
    
    // HTML5 validation should prevent form submission
    const firstNameInput = page.locator('input[name="firstName"]');
    await expect(firstNameInput).toHaveAttribute('required');
    
    const lastNameInput = page.locator('input[name="lastName"]');
    await expect(lastNameInput).toHaveAttribute('required');
    
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toHaveAttribute('required');
    
    const passwordInput = page.locator('input[name="password"]');
    await expect(passwordInput).toHaveAttribute('required');
  });

  test('should show error for password mismatch', async ({ page }) => {
    // Fill form with mismatched passwords
    await page.locator('input[name="firstName"]').fill('John');
    await page.locator('input[name="lastName"]').fill('Doe');
    await page.locator('input[name="email"]').fill('john.doe@example.com');
    await page.locator('input[name="password"]').fill('Password123!');
    await page.locator('input[name="confirmPassword"]').fill('Password123@');
    
    // Submit the form
    await page.locator('button[type="submit"]').click();
    
    // Should show password mismatch error
    await expect(page.locator('.alert-error:has-text("Passwords do not match")')).toBeVisible();
  });

  test('should successfully register a new user', async ({ page }) => {
    // Generate unique email to avoid conflicts
    const uniqueEmail = `test.user.${Date.now()}@example.com`;
    
    // Fill the registration form
    await page.locator('input[name="firstName"]').fill('Test');
    await page.locator('input[name="lastName"]').fill('User');
    await page.locator('input[name="email"]').fill(uniqueEmail);
    await page.locator('input[name="phoneNumber"]').fill('+1234567890');
    await page.locator('input[name="dateOfBirth"]').fill('1990-01-01');
    await page.locator('input[name="password"]').fill('TestPassword123@');
    await page.locator('input[name="confirmPassword"]').fill('TestPassword123@');
    
    // Submit the form
    await page.locator('button[type="submit"]').click();
    
    // Should redirect to dashboard after successful registration
    await expect(page).toHaveURL('/');
    
    // Should show welcome message on dashboard
    await expect(page.locator('h1:has-text("Welcome back, Test!")')).toBeVisible();
    
    // Should show loyalty information
    await expect(page.locator('.loyalty-card')).toBeVisible();
    await expect(page.locator('.tier-badge')).toBeVisible();
    await expect(page.locator('.points-display')).toBeVisible();
  });

  test('should handle duplicate email registration', async ({ page }) => {
    // Use a known existing email
    const existingEmail = 'demo.user.final@example.com';
    
    // Fill the registration form
    await page.locator('input[name="firstName"]').fill('Test');
    await page.locator('input[name="lastName"]').fill('User');
    await page.locator('input[name="email"]').fill(existingEmail);
    await page.locator('input[name="password"]').fill('TestPassword123@');
    await page.locator('input[name="confirmPassword"]').fill('TestPassword123@');
    
    // Submit the form
    await page.locator('button[type="submit"]').click();
    
    // Should show error for duplicate email
    await expect(page.locator('.alert-error:has-text("Email address is already registered")')).toBeVisible();
  });

  test('should validate email format', async ({ page }) => {
    // Fill form with invalid email
    await page.locator('input[name="firstName"]').fill('Test');
    await page.locator('input[name="lastName"]').fill('User');
    await page.locator('input[name="email"]').fill('invalid-email');
    await page.locator('input[name="password"]').fill('TestPassword123@');
    await page.locator('input[name="confirmPassword"]').fill('TestPassword123@');
    
    // Submit the form
    await page.locator('button[type="submit"]').click();
    
    // HTML5 validation should prevent form submission for invalid email
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toHaveAttribute('type', 'email');
  });

  test('should show loading state during registration', async ({ page }) => {
    // Generate unique email
    const uniqueEmail = `test.loading.${Date.now()}@example.com`;
    
    // Fill the registration form
    await page.locator('input[name="firstName"]').fill('Test');
    await page.locator('input[name="lastName"]').fill('User');
    await page.locator('input[name="email"]').fill(uniqueEmail);
    await page.locator('input[name="password"]').fill('TestPassword123@');
    await page.locator('input[name="confirmPassword"]').fill('TestPassword123@');
    
    // Submit the form and check loading state
    await page.locator('button[type="submit"]').click();
    
    // Should show loading text (might be brief)
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeDisabled();
  });

  test('should have proper navigation links', async ({ page }) => {
    // Check login link
    await expect(page.locator('a[href="/login"]:has-text("Sign in")')).toBeVisible();
    
    // Click login link
    await page.locator('a[href="/login"]').click();
    await expect(page).toHaveURL('/login');
    
    // Navigate back to registration
    await page.goto('/register');
    await expect(page).toHaveURL('/register');
  });
});

test.describe('Registration Form Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/register');
  });

  test('should validate password strength requirements', async ({ page }) => {
    // Fill form with weak password
    await page.locator('input[name="firstName"]').fill('Test');
    await page.locator('input[name="lastName"]').fill('User');
    await page.locator('input[name="email"]').fill('test@example.com');
    await page.locator('input[name="password"]').fill('weakpass');
    await page.locator('input[name="confirmPassword"]').fill('weakpass');
    
    // Submit the form
    await page.locator('button[type="submit"]').click();
    
    // Should show password strength error from backend
    await expect(page.locator('.alert-error')).toBeVisible();
  });

  test('should show password requirements help text', async ({ page }) => {
    // Check that password help text is shown
    await expect(page.locator('.form-help:has-text("Must contain at least 8 characters")')).toBeVisible();
  });
});

test.describe('Registration API Integration', () => {
  test('should handle network errors gracefully', async ({ page }) => {
    // Mock network failure
    await page.route('**/api/v1/auth/register', route => {
      route.abort('failed');
    });
    
    await page.goto('/register');
    
    // Fill the registration form
    await page.locator('input[name="firstName"]').fill('Test');
    await page.locator('input[name="lastName"]').fill('User');
    await page.locator('input[name="email"]').fill('test@example.com');
    await page.locator('input[name="password"]').fill('TestPassword123@');
    await page.locator('input[name="confirmPassword"]').fill('TestPassword123@');
    
    // Submit the form
    await page.locator('button[type="submit"]').click();
    
    // Should show network error
    await expect(page.locator('.alert-error')).toBeVisible();
  });
});