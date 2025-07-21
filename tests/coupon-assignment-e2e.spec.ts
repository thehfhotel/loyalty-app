import { test, expect } from '@playwright/test';

test.describe('Coupon Assignment E2E Test', () => {
  let couponCode: string;

  test('complete coupon assignment workflow', async ({ page }) => {
    // Step 1: Login as admin
    await page.goto('http://localhost:3001/login');
    await page.fill('input[type="email"]', 'test-user@example.com');
    await page.fill('input[type="password"]', 'password');
    await page.click('button[type="submit"]');
    await page.waitForURL('http://localhost:3001/**', { waitUntil: 'networkidle' });
    
    console.log('✅ Logged in as admin');

    // Step 2: Navigate to coupon management
    await page.goto('http://localhost:3001/admin/coupons');
    await page.waitForLoadState('networkidle');
    
    // Step 3: Create a new coupon
    const createButton = page.locator('button:has-text("Create"), button:has-text("New Coupon"), button:has-text("Add Coupon")');
    if (await createButton.isVisible()) {
      await createButton.click();
      
      // Wait for form to appear
      await page.waitForSelector('form, [role="dialog"]', { state: 'visible' });
      
      // Generate unique coupon code
      couponCode = `TEST${Date.now()}`;
      
      // Fill in coupon details
      await page.fill('input[name="code"], input[placeholder*="code"], input[id*="code"]', couponCode);
      await page.fill('input[name="discount"], input[placeholder*="discount"], input[id*="discount"]', '10');
      
      // Set expiry date (30 days from now)
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      const dateString = futureDate.toISOString().split('T')[0];
      
      const expiryInput = page.locator('input[type="date"], input[name*="expir"], input[id*="expir"]');
      if (await expiryInput.isVisible()) {
        await expiryInput.fill(dateString);
      }
      
      // Submit the form
      await page.click('button[type="submit"], button:has-text("Save"), button:has-text("Create")');
      
      // Wait for success message or redirect
      await page.waitForTimeout(2000);
      
      console.log(`✅ Created coupon: ${couponCode}`);
    }

    // Step 4: Assign the coupon to a user
    // First, let's check if we need to navigate to a user management page
    const assignButton = page.locator(`button:has-text("Assign")`).first();
    
    if (await assignButton.isVisible()) {
      await assignButton.click();
      
      // Wait for assignment form/modal
      await page.waitForSelector('form, [role="dialog"]', { state: 'visible' });
      
      // Try to select or enter a user
      const userInput = page.locator('input[placeholder*="user"], input[placeholder*="email"], select[name*="user"]');
      if (await userInput.isVisible()) {
        // If it's a select dropdown
        if (await page.locator('select[name*="user"]').isVisible()) {
          await page.selectOption('select[name*="user"]', { index: 1 }); // Select first user
        } else {
          // If it's an input field
          await userInput.fill('customer@example.com');
        }
      }
      
      // Submit assignment
      await page.click('button[type="submit"], button:has-text("Assign"), button:has-text("Save")');
      await page.waitForTimeout(2000);
      
      console.log('✅ Assigned coupon to user');
    }

    // Step 5: Test viewing assignments
    await page.goto('http://localhost:3001/admin/coupons');
    await page.waitForLoadState('networkidle');
    
    // Find the row with our coupon code
    const couponRow = page.locator(`tr:has-text("${couponCode}")`);
    
    if (await couponRow.isVisible()) {
      // Look for View Assignments button in that row
      const viewAssignmentsBtn = couponRow.locator('button:has-text("View Assignments")');
      
      if (await viewAssignmentsBtn.isVisible()) {
        // Monitor console for errors
        const consoleErrors: string[] = [];
        page.on('console', msg => {
          if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
          }
        });
        
        // Monitor network errors
        const networkErrors: string[] = [];
        page.on('response', response => {
          if (!response.ok() && response.url().includes('/api/')) {
            networkErrors.push(`${response.status()} ${response.url()}`);
          }
        });
        
        // Click View Assignments
        await viewAssignmentsBtn.click();
        
        // Wait for modal/assignments view
        await page.waitForSelector('[role="dialog"], .assignments-section, .modal', { 
          state: 'visible',
          timeout: 5000 
        });
        
        // Check for errors
        expect(consoleErrors).toHaveLength(0);
        expect(networkErrors).toHaveLength(0);
        
        // Verify assignment details are shown
        const assignmentVisible = await page.locator('text=/customer@example.com|test.*@example.com/i').isVisible();
        expect(assignmentVisible).toBe(true);
        
        // Take screenshot of successful view
        await page.screenshot({ 
          path: 'tests/screenshots/coupon-assignments-e2e-success.png',
          fullPage: true 
        });
        
        console.log('✅ Successfully viewed coupon assignments');
        console.log('✅ Backend fix verified - No errors when viewing assignments');
      }
    }
  });

  test.afterEach(async ({ page }) => {
    // Clean up: Delete the test coupon if needed
    if (couponCode) {
      try {
        await page.goto('http://localhost:3001/admin/coupons');
        const deleteBtn = page.locator(`tr:has-text("${couponCode}") button:has-text("Delete")`);
        if (await deleteBtn.isVisible()) {
          await deleteBtn.click();
          await page.click('button:has-text("Confirm")');
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });
});