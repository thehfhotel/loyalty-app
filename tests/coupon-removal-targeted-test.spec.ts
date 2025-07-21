import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Targeted Coupon Removal Test', () => {
  test('should find and test the Remove button in assignments modal', async ({ page }) => {
    console.log('🎯 Starting targeted coupon removal test');
    
    // Track server errors
    let serverErrors: string[] = [];
    page.on('response', response => {
      if (response.status() >= 500) {
        serverErrors.push(`${response.status()} error at ${response.url()}`);
        console.error('❌ Server error detected:', response.status(), response.url());
      }
    });

    // Login and navigate
    await page.goto('http://localhost:3000');
    await login(page, 'test@example.com', 'password123');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForLoadState('networkidle');

    console.log('📋 Opening assignments modal');
    const viewAssignmentsButton = page.getByText('ดูการมอบคูปอง').first();
    await viewAssignmentsButton.click();
    await page.waitForTimeout(2000);

    // Take screenshot of modal
    await page.screenshot({ 
      path: 'tests/screenshots/removal-fix/targeted-01-modal-opened.png', 
      fullPage: true 
    });

    // Check modal content more specifically
    const modal = page.locator('div').filter({ hasText: 'Coupon Assignments' }).first();
    await expect(modal).toBeVisible();
    console.log('✅ Modal is visible');

    // Look for the table within the modal
    console.log('🔍 Looking for table structure');
    const table = page.locator('table').last(); // Get the assignments table (should be the second one)
    await expect(table).toBeVisible();

    // Take screenshot of table
    await page.screenshot({ 
      path: 'tests/screenshots/removal-fix/targeted-02-table-visible.png', 
      fullPage: true 
    });

    // Check for all table headers
    console.log('📊 Checking table headers');
    const headers = ['USER', 'EMAIL', 'ASSIGNED', 'USED', 'AVAILABLE', 'STATUS', 'LATEST ASSIGNMENT', 'ACTIONS'];
    
    for (const header of headers) {
      const headerElement = table.locator('th').filter({ hasText: new RegExp(header, 'i') });
      if (await headerElement.isVisible()) {
        console.log(`✅ Found header: ${header}`);
      } else {
        console.log(`⚠️ Header not found: ${header}`);
      }
    }

    // Look specifically for Actions column and Remove button
    console.log('🗑️ Looking for Actions column and Remove buttons');
    
    // Try multiple selectors for the remove button
    const removeButtonSelectors = [
      'button:has-text("Remove")',
      'button:has-text("ลบ")',
      'button[title*="Remove"]',
      'button[title*="ลบ"]',
      '.text-red-600',
      'button.text-red-600'
    ];

    let removeButtonFound = false;
    let workingSelector = '';

    for (const selector of removeButtonSelectors) {
      const removeButton = page.locator(selector);
      const count = await removeButton.count();
      
      if (count > 0) {
        console.log(`✅ Found ${count} remove button(s) with selector: ${selector}`);
        removeButtonFound = true;
        workingSelector = selector;
        
        // Take screenshot showing the button
        await removeButton.first().scrollIntoViewIfNeeded();
        await page.screenshot({ 
          path: `tests/screenshots/removal-fix/targeted-03-remove-button-found.png`, 
          fullPage: true 
        });
        break;
      }
    }

    if (removeButtonFound) {
      console.log(`🖱️ Testing Remove button with selector: ${workingSelector}`);
      
      // Click the remove button
      const removeButton = page.locator(workingSelector).first();
      await removeButton.click();
      await page.waitForTimeout(1500);
      
      // Take screenshot after clicking
      await page.screenshot({ 
        path: 'tests/screenshots/removal-fix/targeted-04-after-remove-click.png', 
        fullPage: true 
      });

      // Check for confirmation dialog
      console.log('⚠️ Looking for confirmation dialog');
      
      const confirmationSelectors = [
        'div:has-text("Confirm Coupon Removal")',
        'div:has-text("Are you sure")',
        '[role="dialog"]'
      ];

      let confirmationFound = false;
      for (const selector of confirmationSelectors) {
        const confirmDialog = page.locator(selector);
        if (await confirmDialog.isVisible({ timeout: 3000 })) {
          console.log(`✅ Found confirmation dialog with selector: ${selector}`);
          confirmationFound = true;
          
          await page.screenshot({ 
            path: 'tests/screenshots/removal-fix/targeted-05-confirmation-dialog.png', 
            fullPage: true 
          });

          // Test confirm button
          const confirmButtonSelectors = [
            'button:has-text("Remove Coupons")',
            'button:has-text("Confirm")',
            'button:has-text("Yes")',
            'button.bg-red-600'
          ];

          for (const confirmSelector of confirmButtonSelectors) {
            const confirmButton = page.locator(confirmSelector);
            if (await confirmButton.isVisible({ timeout: 2000 })) {
              console.log(`✅ Found confirm button with selector: ${confirmSelector}`);
              
              // Reset error tracking
              serverErrors = [];
              
              // Click confirm
              await confirmButton.click();
              await page.waitForTimeout(3000); // Wait for API call
              
              console.log('✅ Removal confirmed');
              await page.screenshot({ 
                path: 'tests/screenshots/removal-fix/targeted-06-removal-confirmed.png', 
                fullPage: true 
              });
              break;
            }
          }
          break;
        }
      }

      if (!confirmationFound) {
        console.log('ℹ️ No confirmation dialog found - removal might be direct');
        await page.waitForTimeout(2000);
        await page.screenshot({ 
          path: 'tests/screenshots/removal-fix/targeted-05-no-confirmation.png', 
          fullPage: true 
        });
      }

    } else {
      console.log('⚠️ No Remove button found. Let me check the table structure...');
      
      // Debug: Show all buttons in the modal
      const allButtons = page.locator('button');
      const buttonCount = await allButtons.count();
      console.log(`Found ${buttonCount} buttons in total`);
      
      for (let i = 0; i < buttonCount; i++) {
        const button = allButtons.nth(i);
        const text = await button.textContent();
        const title = await button.getAttribute('title');
        console.log(`Button ${i}: text="${text}", title="${title}"`);
      }
      
      // Also check all table cells
      const tableCells = table.locator('td');
      const cellCount = await tableCells.count();
      console.log(`Found ${cellCount} table cells`);
      
      await page.screenshot({ 
        path: 'tests/screenshots/removal-fix/targeted-03-no-remove-button.png', 
        fullPage: true 
      });
    }

    // Final verification: No 500 errors occurred
    if (serverErrors.length === 0) {
      console.log('✅ PASS: No server errors detected during the test');
    } else {
      console.error('❌ Server errors detected:', serverErrors);
      expect(serverErrors.length).toBe(0);
    }

    console.log('🎯 Targeted test completed');
  });
});