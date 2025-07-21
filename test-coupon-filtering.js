const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing coupon filtering fix...');
    
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
    
    // Count visible coupons in the table
    const couponRows = await page.locator('tbody tr').count();
    console.log(`📊 Coupons visible in UI: ${couponRows}`);
    
    // Expected: 9 coupons (7 active + 2 draft), filtered out 2 expired
    if (couponRows === 9) {
      console.log('✅ SUCCESS: Expired coupons filtered out correctly!');
    } else if (couponRows === 11) {
      console.log('❌ ISSUE: All coupons are showing (including expired ones)');
    } else {
      console.log(`⚠️ UNEXPECTED: Found ${couponRows} coupons, expected 9`);
    }
    
    // Check for any coupons with "expired" status showing
    const expiredCoupons = await page.locator('tbody tr').locator('text=Expired').count();
    if (expiredCoupons === 0) {
      console.log('✅ No expired coupons visible in the list');
    } else {
      console.log(`❌ Found ${expiredCoupons} expired coupons still showing`);
    }
    
    // List the statuses of visible coupons
    console.log('\n📋 Visible coupon statuses:');
    const statusElements = await page.locator('tbody tr .rounded-full').allTextContents();
    statusElements.forEach((status, index) => {
      console.log(`  ${index + 1}. ${status}`);
    });
    
    // Take a screenshot
    await page.screenshot({ path: 'coupon-filtering-test.png' });
    console.log('\n📸 Screenshot saved as coupon-filtering-test.png');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'coupon-filtering-error.png' });
  } finally {
    console.log('\n🔄 Keeping browser open for 3 seconds for review...');
    await page.waitForTimeout(3000);
    await browser.close();
  }
})();