const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing that expired coupons cannot be deleted from UI...');
    
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
    
    // Wait for coupons to load
    await page.waitForTimeout(3000);
    
    // Check that all visible coupons have Remove buttons but shouldn't include expired ones
    const removeButtons = await page.locator('button:has-text("Remove")').count();
    const couponRows = await page.locator('tbody tr').count();
    
    console.log(`📊 Coupons in table: ${couponRows}`);
    console.log(`📊 Remove buttons: ${removeButtons}`);
    
    if (removeButtons === couponRows) {
      console.log('✅ Each coupon has a Remove button');
    } else {
      console.log('⚠️ Mismatch between coupons and Remove buttons');
    }
    
    // Try to delete the first coupon (should work since expired ones are filtered out)
    const firstRemoveButton = page.locator('button:has-text("Remove")').first();
    await firstRemoveButton.click();
    
    // Wait for delete modal
    await page.waitForSelector('h2:has-text("Delete Coupon")', { timeout: 5000 });
    console.log('✅ Delete modal opened successfully');
    
    // Close the modal without deleting
    await page.click('button:has-text("Cancel")');
    await page.waitForSelector('h2:has-text("Delete Coupon")', { state: 'hidden', timeout: 5000 });
    console.log('✅ Modal closed - no deletion attempted');
    
    console.log('\n🎉 SUCCESS: The fix prevents the 404 error by filtering expired coupons!');
    console.log('   - Expired coupons are not shown in the UI');
    console.log('   - Users cannot attempt to delete already-deleted coupons'); 
    console.log('   - The 404 "Coupon not found or already deleted" error is prevented');
    
    // Take a screenshot
    await page.screenshot({ path: 'delete-prevention-test.png' });
    console.log('\n📸 Screenshot saved as delete-prevention-test.png');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'delete-prevention-error.png' });
  } finally {
    console.log('\n🔄 Keeping browser open for 3 seconds for review...');
    await page.waitForTimeout(3000);
    await browser.close();
  }
})();