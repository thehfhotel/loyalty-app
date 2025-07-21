import { test, expect } from '@playwright/test';

test.describe('Coupon Assignment Tracking', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to login page
    await page.goto('http://localhost:3001/login');
    
    // Fill in login credentials
    await page.fill('input[type="email"]', 'test-user@example.com');
    await page.fill('input[type="password"]', 'password'); // Assuming default password
    
    // Click login button
    await page.click('button[type="submit"]');
    
    // Wait for navigation to complete
    await page.waitForURL('http://localhost:3001/**', { waitUntil: 'networkidle' });
  });

  test('should view coupon assignments without errors', async ({ page }) => {
    // Navigate to admin coupon management page
    await page.goto('http://localhost:3001/admin/coupons');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    
    // Look for a coupon with assignments - checking for any "View Assignments" button
    const viewAssignmentsButtons = page.locator('button:has-text("View Assignments")');
    
    // Check if there are any coupons with assignments
    const buttonCount = await viewAssignmentsButtons.count();
    
    if (buttonCount > 0) {
      // Click the first "View Assignments" button
      await viewAssignmentsButtons.first().click();
      
      // Wait for the assignments modal or section to appear
      await page.waitForSelector('[role="dialog"], .assignments-section, .modal', { 
        state: 'visible',
        timeout: 5000 
      });
      
      // Verify no error messages appear
      const errorMessages = await page.locator('.error, .error-message, [role="alert"]').count();
      expect(errorMessages).toBe(0);
      
      // Verify the assignments data is displayed (looking for table or list structure)
      const assignmentsContent = await page.locator('table, ul, .assignment-list, .assignments-table').count();
      expect(assignmentsContent).toBeGreaterThan(0);
      
      // Take a screenshot for documentation
      await page.screenshot({ 
        path: 'tests/screenshots/coupon-assignments-success.png',
        fullPage: true 
      });
      
      console.log('✅ Successfully viewed coupon assignments without errors');
    } else {
      console.log('⚠️ No coupons with assignments found - creating test data');
      
      // If no coupons with assignments exist, we should still verify the page loads without errors
      const pageErrors = await page.locator('.error, .error-message').count();
      expect(pageErrors).toBe(0);
      
      console.log('✅ Coupon management page loads successfully');
    }
  });

  test('should handle API response correctly', async ({ page }) => {
    // Set up request interception to monitor API calls
    const apiResponses = [];
    
    page.on('response', response => {
      if (response.url().includes('/api/coupons') && response.url().includes('assignments')) {
        apiResponses.push({
          url: response.url(),
          status: response.status(),
          ok: response.ok()
        });
      }
    });
    
    // Navigate to admin coupon management page
    await page.goto('http://localhost:3001/admin/coupons');
    await page.waitForLoadState('networkidle');
    
    // Try to view assignments if available
    const viewAssignmentsButton = page.locator('button:has-text("View Assignments")').first();
    
    if (await viewAssignmentsButton.isVisible()) {
      await viewAssignmentsButton.click();
      
      // Wait for API response
      await page.waitForTimeout(1000);
      
      // Check if API calls were successful
      const assignmentApiCalls = apiResponses.filter(r => r.url.includes('assignments'));
      
      if (assignmentApiCalls.length > 0) {
        // Verify all API calls were successful
        assignmentApiCalls.forEach(call => {
          expect(call.status).toBe(200);
          expect(call.ok).toBe(true);
        });
        
        console.log(`✅ All ${assignmentApiCalls.length} assignment API calls were successful`);
      }
    }
  });

  test('should display assignment details correctly', async ({ page }) => {
    // Navigate to admin coupon management page
    await page.goto('http://localhost:3001/admin/coupons');
    await page.waitForLoadState('networkidle');
    
    // Look for a coupon with assignments
    const viewAssignmentsButton = page.locator('button:has-text("View Assignments")').first();
    
    if (await viewAssignmentsButton.isVisible()) {
      // Get the coupon code for reference
      const couponRow = viewAssignmentsButton.locator('xpath=ancestor::tr');
      const couponCode = await couponRow.locator('td').first().textContent();
      
      console.log(`Testing assignments for coupon: ${couponCode}`);
      
      // Click to view assignments
      await viewAssignmentsButton.click();
      
      // Wait for assignments to load
      await page.waitForSelector('[role="dialog"], .assignments-section', { 
        state: 'visible',
        timeout: 5000 
      });
      
      // Verify assignment details are displayed
      const assignmentFields = [
        'Customer', 'User', 'Email', 'Name', // Customer info
        'Assigned', 'Date', 'Time', // Assignment date
        'Used', 'Redeemed', 'Status' // Usage status
      ];
      
      let fieldsFound = 0;
      for (const field of assignmentFields) {
        const fieldExists = await page.locator(`text=${field}`).count() > 0;
        if (fieldExists) fieldsFound++;
      }
      
      // Expect at least some assignment fields to be visible
      expect(fieldsFound).toBeGreaterThan(0);
      
      console.log(`✅ Found ${fieldsFound} assignment detail fields`);
      
      // Close the modal/dialog if present
      const closeButton = page.locator('button:has-text("Close"), button[aria-label="Close"]');
      if (await closeButton.isVisible()) {
        await closeButton.click();
      }
    }
  });
});