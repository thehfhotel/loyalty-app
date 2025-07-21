const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing Thai language for Coupon Management card...');
    
    // Login as admin (needed to see the Coupon Management card)
    await page.goto('http://localhost:3003/login');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    
    console.log('✅ Logged in successfully');
    
    // Wait for dashboard to load
    await page.waitForSelector('h1', { timeout: 5000 });
    
    // Switch to Thai language
    const languageSwitcher = await page.locator('button[aria-label="Change language"]').isVisible();
    if (languageSwitcher) {
      await page.click('button[aria-label="Change language"]');
      await page.waitForTimeout(500);
      
      const thaiOption = await page.locator('button:has-text("ไทย")').isVisible();
      if (thaiOption) {
        await page.click('button:has-text("ไทย")');
        await page.waitForTimeout(1000);
        console.log('✅ Switched to Thai language');
      }
    }
    
    // Find the 5th child in the grid (Coupon Management card)
    const selector = '#root > div.min-h-screen.bg-gray-50 > main > div > div.grid.grid-cols-1.gap-6.sm\\:grid-cols-2.lg\\:grid-cols-3 > a:nth-child(5) > div';
    
    // Check if the selector exists
    const couponManagementCard = await page.locator(selector).isVisible();
    console.log(`📊 Coupon Management card visible: ${couponManagementCard}`);
    
    if (couponManagementCard) {
      // Get the text content of the card
      const titleText = await page.locator(selector + ' dt').textContent();
      const descriptionText = await page.locator(selector + ' dd').textContent();
      
      console.log(`📊 Title text: "${titleText}"`);
      console.log(`📊 Description text: "${descriptionText}"`);
      
      // Check if texts are in Thai
      const titleInThai = titleText === 'จัดการคูปอง';
      const descriptionInThai = descriptionText === 'สร้างและจัดการคูปอง';
      
      console.log(`📊 Title in Thai: ${titleInThai}`);
      console.log(`📊 Description in Thai: ${descriptionInThai}`);
      
      // Test clicking on the card
      await page.click(selector);
      await page.waitForURL('**/admin/coupons', { timeout: 5000 });
      console.log('✅ Successfully navigated to admin coupons page');
      
      // Take screenshot
      await page.screenshot({ path: 'thai-coupon-management-test.png' });
      console.log('📸 Screenshot saved as thai-coupon-management-test.png');
      
      // Summary
      if (titleInThai && descriptionInThai) {
        console.log('🎉 SUCCESS: Coupon Management card is properly localized in Thai!');
        console.log('   - Title: "จัดการคูปอง"');
        console.log('   - Description: "สร้างและจัดการคูปอง"');
      } else {
        console.log('⚠️ PARTIAL SUCCESS: Some texts may not be properly translated');
        if (!titleInThai) console.log('   - Title not in Thai');
        if (!descriptionInThai) console.log('   - Description not in Thai');
      }
    } else {
      console.log('❌ ERROR: Coupon Management card not found');
      console.log('   - This card is only visible for admin users');
      console.log('   - Make sure the test user has admin role');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'thai-coupon-management-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 5 seconds for review...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();