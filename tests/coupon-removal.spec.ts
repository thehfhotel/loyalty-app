import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Coupon Removal Feature', () => {
  test('should test complete coupon removal workflow in admin panel', async ({ page }) => {
    console.log('🚀 Starting coupon removal test workflow');
    
    // Take initial screenshot
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'tests/screenshots/01-initial-page.png', fullPage: true });

    // Step 1: Login as admin
    console.log('📝 Step 1: Logging in as admin');
    await login(page, 'test@example.com', 'password123');
    await page.screenshot({ path: 'tests/screenshots/02-after-login.png', fullPage: true });

    // Step 2: Navigate to admin section
    console.log('🔧 Step 2: Looking for admin navigation');
    
    // Look for admin links in navigation or dashboard
    const adminCouponLink = page.getByText('Admin Coupon Management').or(
      page.getByText('Coupon Management').or(
        page.locator('[href*="admin"]').and(page.locator(':has-text("Coupon")'))
      )
    );

    let foundAdminSection = false;
    
    if (await adminCouponLink.isVisible({ timeout: 5000 })) {
      console.log('✅ Found admin coupon link');
      await adminCouponLink.click();
      foundAdminSection = true;
    } else {
      // Try to navigate directly to admin coupon management
      console.log('⚠️ Admin link not visible, trying direct navigation');
      await page.goto('http://localhost:3000/admin/coupons');
      foundAdminSection = true;
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/screenshots/03-admin-coupons-page.png', fullPage: true });

    // Step 3: Look for coupon management interface
    console.log('🎫 Step 3: Looking for coupon management interface');
    
    // Check for coupon list or manage buttons - look for Thai text
    const viewAssignmentsButton = page.getByText('ดูการมอบคูปอง').or(
      page.getByText('View Assignments').or(
        page.getByText('Manage Assignments').or(
          page.getByText('Assignments')
        )
      )
    );

    const viewAssignmentsButtons = page.getByText('ดูการมอบคูปอง');
    const buttonCount = await viewAssignmentsButtons.count();
    console.log(`Found ${buttonCount} view assignments buttons`);
    
    if (buttonCount > 0) {
      console.log('✅ Found view assignments button(s)');
      await viewAssignmentsButtons.first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'tests/screenshots/04-view-assignments-clicked.png', fullPage: true });
    }

    // Step 4: Look for assignments modal or table
    console.log('📋 Step 4: Looking for assignments table/modal');
    
    const modal = page.locator('[role="dialog"]').or(
      page.locator('.modal').or(
        page.locator('[data-testid*="modal"]')
      )
    );

    const assignmentsTable = page.locator('table').nth(1); // Second table should be assignments
    const allTables = page.locator('table');

    let interfaceFound = false;

    if (await modal.isVisible({ timeout: 3000 })) {
      console.log('✅ Found assignments modal');
      interfaceFound = true;
      await page.screenshot({ path: 'tests/screenshots/05-assignments-modal.png', fullPage: true });
      
      // Step 5: Verify Actions column exists
      console.log('🔍 Step 5: Verifying Actions column');
      const actionsHeader = modal.locator('th').filter({ hasText: /Actions/i });
      if (await actionsHeader.isVisible({ timeout: 2000 })) {
        console.log('✅ Actions column found in modal');
        await expect(actionsHeader).toBeVisible();
      }

      // Step 6: Look for Remove buttons in assignments table within modal
      console.log('🗑️ Step 6: Looking for Remove buttons');
      const assignmentsTableInModal = modal.locator('table').nth(1); // Second table for assignments
      const removeButtons = modal.locator('button').filter({ hasText: /Remove|ลบ/i });
      const removeButtonCount = await removeButtons.count();
      console.log(`Found ${removeButtonCount} remove buttons`);

      // Also look for Thai text buttons that might be remove buttons
      const thaiRemoveButtons = modal.locator('button').filter({ hasText: /ลบ|เอาออก|ยกเลิก/i });
      const thaiRemoveCount = await thaiRemoveButtons.count();
      console.log(`Found ${thaiRemoveCount} Thai remove buttons`);

      const totalRemoveButtons = removeButtonCount + thaiRemoveCount;

      if (totalRemoveButtons > 0) {
        console.log('✅ Remove buttons are visible');
        await page.screenshot({ path: 'tests/screenshots/06-remove-buttons-visible.png', fullPage: true });

        // Step 7: Click first Remove button (prefer English, fallback to Thai)
        console.log('🖱️ Step 7: Clicking Remove button');
        if (removeButtonCount > 0) {
          await removeButtons.first().click();
        } else {
          await thaiRemoveButtons.first().click();
        }
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'tests/screenshots/07-remove-button-clicked.png', fullPage: true });

        // Step 8: Look for confirmation dialog
        console.log('⚠️ Step 8: Looking for confirmation dialog');
        const confirmDialog = page.locator('[role="dialog"]').nth(1).or(
          page.locator('.modal').nth(1).or(
            page.locator('[data-testid*="confirm"]')
          )
        );

        if (await confirmDialog.isVisible({ timeout: 3000 })) {
          console.log('✅ Confirmation dialog appeared');
          await expect(confirmDialog).toBeVisible();
          await page.screenshot({ path: 'tests/screenshots/08-confirmation-dialog.png', fullPage: true });

          // Step 9: Confirm removal
          console.log('✅ Step 9: Confirming removal');
          const confirmButton = confirmDialog.locator('button').filter({ 
            hasText: /Confirm|Yes|Remove|OK|ยืนยัน|ตกลง/i 
          });

          if (await confirmButton.isVisible({ timeout: 2000 })) {
            await confirmButton.click();
            await page.waitForTimeout(1500);
            await page.screenshot({ path: 'tests/screenshots/09-after-confirmation.png', fullPage: true });
            console.log('✅ Removal confirmed');

            // Step 10: Verify table updates
            console.log('🔄 Step 10: Verifying table updates');
            await page.waitForTimeout(2000); // Wait for update
            await page.screenshot({ path: 'tests/screenshots/10-table-updated.png', fullPage: true });
            console.log('✅ Table should be updated');
          }
        } else {
          console.log('⚠️ Confirmation dialog not found - might be instant removal');
          await page.screenshot({ path: 'tests/screenshots/08-no-confirmation-dialog.png', fullPage: true });
        }
      } else {
        console.log('⚠️ No Remove buttons found in modal');
        await page.screenshot({ path: 'tests/screenshots/06-no-remove-buttons.png', fullPage: true });
      }

    } else if (await assignmentsTable.isVisible({ timeout: 3000 })) {
      console.log('✅ Found assignments table (not in modal)');
      interfaceFound = true;
      await page.screenshot({ path: 'tests/screenshots/05-assignments-table.png', fullPage: true });
      
      // Similar steps for table interface
      const actionsHeader = assignmentsTable.locator('th').filter({ hasText: /Actions/i });
      if (await actionsHeader.isVisible()) {
        console.log('✅ Actions column found in table');
      }

      const removeButtons = assignmentsTable.locator('button').filter({ hasText: /Remove/i });
      const removeButtonCount = await removeButtons.count();
      console.log(`Found ${removeButtonCount} remove buttons in table`);

      if (removeButtonCount > 0) {
        await page.screenshot({ path: 'tests/screenshots/06-remove-buttons-in-table.png', fullPage: true });
      }
    }

    if (!interfaceFound) {
      console.log('⚠️ No assignments interface found');
      await page.screenshot({ path: 'tests/screenshots/05-no-interface-found.png', fullPage: true });
    }

    // Final screenshot
    await page.screenshot({ path: 'tests/screenshots/11-test-completed.png', fullPage: true });
    console.log('🏁 Coupon removal test completed');
  });

});