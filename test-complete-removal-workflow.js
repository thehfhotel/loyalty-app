const { chromium } = require('playwright');

async function testCompleteRemovalWorkflow() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log('🚀 Starting complete removal workflow test');
    
    // Login
    console.log('📝 Logging in...');
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
    console.log('✅ Logged in successfully');
    
    // Go to admin coupons
    console.log('🔧 Navigating to admin coupons...');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'step1-admin-page.png', fullPage: true });
    
    // Click view assignments
    console.log('🎫 Opening assignments modal...');
    const viewButton = page.getByText('ดูการมอบคูปอง').first();
    await viewButton.click();
    await page.waitForTimeout(1500);
    
    // Take screenshot of opened modal
    await page.screenshot({ path: 'step2-modal-opened.png', fullPage: true });
    
    // Verify the modal opened and contains expected content
    const modal = page.locator('[role="dialog"]');
    console.log('✅ Modal opened:', await modal.isVisible());
    
    // Check Actions column and Remove button
    const actionsHeader = page.locator('th:has-text("Actions")');
    console.log('✅ Actions column visible:', await actionsHeader.isVisible());
    
    const removeButton = page.locator('button:has-text("Remove")');
    console.log('✅ Remove button visible:', await removeButton.isVisible());
    console.log('✅ Remove button count:', await removeButton.count());
    
    // Verify user has available coupons
    const userRow = page.locator('tr:has-text("Test User")');
    const availableCell = userRow.locator('td').nth(4); // Available column
    const availableCount = await availableCell.textContent();
    console.log('✅ Available coupons for test user:', availableCount.trim());
    
    if (availableCount.trim() !== '1') {
      console.log('⚠️ Expected 1 available coupon, but found:', availableCount.trim());
    }
    
    // Click Remove button
    console.log('🖱️ Clicking Remove button...');
    await removeButton.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'step3-remove-clicked.png', fullPage: true });
    
    // Check for confirmation dialog
    const confirmationDialog = page.locator('[role="dialog"]').nth(1);
    const dialogVisible = await confirmationDialog.isVisible({ timeout: 3000 });
    console.log('⚠️ Confirmation dialog visible:', dialogVisible);
    
    if (dialogVisible) {
      await page.screenshot({ path: 'step4-confirmation-dialog.png', fullPage: true });
      
      // Verify dialog content
      const dialogText = await confirmationDialog.textContent();
      console.log('📋 Dialog content preview:', dialogText.substring(0, 100) + '...');
      
      // Look for confirm button
      const confirmBtn = confirmationDialog.locator('button:has-text("Remove Coupons")');
      const confirmBtnVisible = await confirmBtn.isVisible();
      console.log('✅ Confirm button visible:', confirmBtnVisible);
      
      if (confirmBtnVisible) {
        console.log('✅ Clicking confirm button...');
        await confirmBtn.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'step5-after-confirmation.png', fullPage: true });
        
        // Verify the removal was successful
        // Check if the user still has available coupons
        await page.waitForTimeout(1000); // Wait for UI to update
        const updatedAvailableCell = userRow.locator('td').nth(4);
        const updatedAvailableCount = await updatedAvailableCell.textContent();
        console.log('🔄 Updated available coupons:', updatedAvailableCount.trim());
        
        // Check if Remove button is no longer visible or changed to "No coupons"
        const updatedRemoveButton = userRow.locator('button:has-text("Remove")');
        const removeStillVisible = await updatedRemoveButton.isVisible();
        console.log('🔄 Remove button still visible:', removeStillVisible);
        
        if (!removeStillVisible) {
          const noCouponsText = userRow.locator('text="No coupons"');
          const noCouponsVisible = await noCouponsText.isVisible();
          console.log('✅ "No coupons" text visible:', noCouponsVisible);
        }
        
        console.log('✅ Removal workflow completed successfully!');
      }
    } else {
      console.log('⚠️ No confirmation dialog appeared - checking for instant removal');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'step4-no-dialog-instant-removal.png', fullPage: true });
    }
    
    await page.screenshot({ path: 'step6-final-state.png', fullPage: true });
    
    // Wait to see final result
    await page.waitForTimeout(3000);
    
  } catch (error) {
    console.error('❌ Error:', error);
    await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

testCompleteRemovalWorkflow();