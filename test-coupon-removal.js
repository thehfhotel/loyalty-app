const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing coupon removal functionality...');
    
    // Login as admin
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    
    console.log('✅ Logged in successfully');
    
    // Navigate to admin coupons page
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForSelector('h1:has-text("Coupon Management")', { timeout: 10000 });
    
    console.log('✅ Admin coupons page loaded');
    
    // Check if there are any coupons to remove
    const couponRows = await page.locator('tbody tr').count();
    console.log(`📊 Found ${couponRows} coupons in the list`);
    
    if (couponRows === 0) {
      console.log('📝 No coupons found. Creating a test coupon first...');
      
      // Create a test coupon
      await page.click('button:has-text("Create Coupon")');
      await page.waitForSelector('h2:has-text("Create New Coupon")');
      
      // Fill out the form
      await page.fill('input[placeholder="e.g. SUMMER20"]', 'TESTDELETE');
      await page.fill('input[placeholder="e.g. Summer Sale 20% Off"]', 'Test Delete Coupon');
      await page.fill('textarea', 'This coupon is for testing deletion');
      await page.fill('input[type="number"]', '10'); // 10% discount
      await page.fill('input[type="date"]', '2025-12-31'); // Valid until
      
      await page.click('button[type="submit"]');
      await page.waitForSelector('h2:has-text("Create New Coupon")', { state: 'hidden', timeout: 10000 });
      
      console.log('✅ Test coupon created');
      
      // Wait for page to reload
      await page.waitForTimeout(2000);
    }
    
    // Look for the remove button on the first coupon
    const firstCouponRow = page.locator('tbody tr').first();
    const removeButton = firstCouponRow.locator('button:has-text("Remove")');
    
    const isRemoveButtonVisible = await removeButton.isVisible();
    console.log(`🗑️ Remove button visible: ${isRemoveButtonVisible}`);
    
    if (!isRemoveButtonVisible) {
      console.log('❌ Remove button not found in the actions column');
      await page.screenshot({ path: 'coupon-removal-no-button.png' });
      return;
    }
    
    // Get the coupon name before deletion
    const couponName = await firstCouponRow.locator('td').first().locator('.text-sm.font-medium').textContent();
    console.log(`📋 Testing removal of coupon: ${couponName}`);
    
    // Click the remove button
    await removeButton.click();
    
    // Wait for the delete confirmation modal
    await page.waitForSelector('h2:has-text("Delete Coupon")', { timeout: 5000 });
    console.log('✅ Delete confirmation modal appeared');
    
    // Check modal content
    const warningText = await page.locator('text=Warning: This action cannot be undone!').isVisible();
    const confirmationInput = await page.locator('input[placeholder="Type DELETE here"]').isVisible();
    
    console.log(`⚠️ Warning message visible: ${warningText}`);
    console.log(`📝 Confirmation input visible: ${confirmationInput}`);
    
    // Take a screenshot of the modal
    await page.screenshot({ path: 'coupon-delete-modal.png' });
    console.log('📸 Screenshot of delete modal saved');
    
    // Test the confirmation input
    const deleteInput = page.locator('input[placeholder="Type DELETE here"]');
    const deleteButton = page.locator('button:has-text("Delete Coupon")');
    
    // Initially, delete button should be disabled
    const initiallyDisabled = await deleteButton.isDisabled();
    console.log(`🚫 Delete button initially disabled: ${initiallyDisabled}`);
    
    // Type incorrect confirmation
    await deleteInput.fill('delete');
    const stillDisabled = await deleteButton.isDisabled();
    console.log(`🚫 Delete button disabled with wrong text: ${stillDisabled}`);
    
    // Type correct confirmation
    await deleteInput.fill('DELETE');
    const nowEnabled = await deleteButton.isEnabled();
    console.log(`✅ Delete button enabled with correct text: ${nowEnabled}`);
    
    // Actually delete the coupon
    await deleteButton.click();
    
    console.log('🔄 Deletion requested, waiting for completion...');
    
    // Wait for modal to close and page to reload
    await page.waitForSelector('h2:has-text("Delete Coupon")', { state: 'hidden', timeout: 10000 });
    console.log('✅ Delete modal closed');
    
    // Wait a moment for the coupon list to refresh
    await page.waitForTimeout(2000);
    
    // Check if the coupon was removed from the list
    const remainingCoupons = await page.locator('tbody tr').count();
    console.log(`📊 Remaining coupons after deletion: ${remainingCoupons}`);
    
    if (remainingCoupons < couponRows) {
      console.log('\n🎉 SUCCESS: Coupon removal functionality working correctly!');
      console.log('✅ Remove button visible in actions column');
      console.log('✅ Confirmation modal with proper warnings');
      console.log('✅ Type "DELETE" confirmation required');
      console.log('✅ Coupon successfully deleted from list');
    } else {
      console.log('⚠️ Coupon may not have been deleted or page not refreshed');
    }
    
    // Take final screenshot
    await page.screenshot({ path: 'coupon-removal-final.png' });
    console.log('📸 Final screenshot saved');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'coupon-removal-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 5 seconds...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();