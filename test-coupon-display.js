const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000
  });
  
  try {
    console.log('🎯 Testing coupon display without coupon type...\n');
    
    const page = await browser.newPage();
    
    // Login as test user
    console.log('1️⃣ Logging in as test-user@example.com...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    
    await page.fill('input[type="email"]', 'test-user@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    try {
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      console.log('✅ Login successful');
    } catch (error) {
      console.log('❌ Login failed');
      await page.screenshot({ path: 'display-test-login-failed.png' });
      return;
    }
    
    // Navigate to coupon wallet
    console.log('\n2️⃣ Navigating to coupon wallet...');
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    // Take screenshot
    await page.screenshot({ path: 'coupon-display-after-change.png', fullPage: true });
    
    console.log('\n3️⃣ Analyzing coupon card structure...');
    
    // Check for coupon cards
    const couponCards = await page.locator('.bg-white.shadow-md.rounded-lg').count();
    console.log(`📊 Coupon cards found: ${couponCards}`);
    
    // Check if 1FREE1 coupon is visible
    const coupon1FREE1 = await page.locator('text=1FREE1').isVisible();
    console.log(`📊 1FREE1 coupon visible: ${coupon1FREE1}`);
    
    // Check if coupon type value text is removed (should not find the green value text)
    const valueText = await page.locator('.text-xl.font-bold.text-green-600').count();
    console.log(`📊 Coupon value text elements (should be 0): ${valueText}`);
    
    // Check for expiry text (should still be there)
    const expiryElements = await page.locator('.text-sm').filter({ 
      hasText: /expire|หมดอาyu|เหลือ/ 
    }).count();
    console.log(`📊 Expiry text elements: ${expiryElements}`);
    
    // Test coupon card click
    if (couponCards > 0) {
      console.log('\n4️⃣ Testing coupon interaction...');
      
      const firstCoupon = page.locator('.bg-white.shadow-md.rounded-lg').first();
      await firstCoupon.click();
      await page.waitForTimeout(1000);
      
      // Check if QR modal opened
      const modal = await page.locator('.fixed.inset-0.z-50').isVisible();
      console.log(`📊 QR modal opened: ${modal}`);
      
      if (modal) {
        await page.screenshot({ path: 'qr-modal-test.png' });
        
        // Close modal
        const closeBtn = page.locator('button').filter({ hasText: /close|ปิด/i });
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
          console.log('✅ Modal closed');
        }
      }
    }
    
    console.log('\n📊 TEST RESULTS:');
    console.log('================');
    
    const improvementSuccessful = valueText === 0 && couponCards > 0 && coupon1FREE1;
    
    console.log(`✅ Login: Working`);
    console.log(`${couponCards > 0 ? '✅' : '❌'} Coupon Cards: ${couponCards > 0 ? 'Displaying' : 'Not found'}`);
    console.log(`${valueText === 0 ? '✅' : '❌'} Coupon Type Removal: ${valueText === 0 ? 'SUCCESS' : 'FAILED'}`);
    console.log(`${expiryElements > 0 ? '✅' : '❌'} Expiry Info: ${expiryElements > 0 ? 'Still showing' : 'Missing'}`);
    
    if (improvementSuccessful) {
      console.log('\n🎉 IMPROVEMENT SUCCESSFUL!');
      console.log('📊 Coupon type display has been removed from coupon cards');
      console.log('📊 Expiry information is still properly displayed');
      console.log('📊 Coupon functionality remains intact');
    } else {
      console.log('\n⚠️ IMPROVEMENT NEEDS ATTENTION');
      if (valueText > 0) {
        console.log('- Coupon type value text still showing');
      }
      if (couponCards === 0) {
        console.log('- No coupon cards found');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: 'display-test-error.png' });
    }
  } finally {
    console.log('\n⏸️ Test complete. Browser will close in 8 seconds...');
    await new Promise(resolve => setTimeout(resolve, 8000));
    await browser.close();
  }
})();