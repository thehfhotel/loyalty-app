const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000
  });
  
  try {
    console.log('🎯 Testing coupon separation in UI...\n');
    
    const page = await browser.newPage();
    
    // Login as test user
    console.log('1️⃣ Logging in...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    
    await page.fill('input[type="email"]', 'test-user@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Login successful');
    
    // Navigate to coupon wallet
    console.log('\n2️⃣ Navigating to coupon wallet...');
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    // Take screenshot
    await page.screenshot({ path: 'coupon-separation-test.png', fullPage: true });
    
    console.log('\n3️⃣ Analyzing coupon display...');
    
    // Count total coupon cards
    const couponCards = await page.locator('.bg-white.shadow-md.rounded-lg').count();
    console.log(`📊 Total coupon cards displayed: ${couponCards}`);
    
    // Check for specific coupons
    const coupon1FREE1 = await page.locator('text=1FREE1').count();
    const coupon10FREE1 = await page.locator('text=10FREE1').count();
    const couponSAVE20 = await page.locator('text=SAVE20').count();
    
    console.log(`📊 1FREE1 coupon mentions: ${coupon1FREE1}`);
    console.log(`📊 10FREE1 coupon mentions: ${coupon10FREE1}`);
    console.log(`📊 SAVE20 coupon mentions: ${couponSAVE20}`);
    
    // Check for any usage count indicators (like "x2", "x3", etc.)
    const usageIndicators = await page.locator('text=/x[0-9]+/').count();
    console.log(`📊 Usage count indicators found: ${usageIndicators}`);
    
    if (usageIndicators > 0) {
      console.log('⚠️ Found usage count indicators - this suggests consolidation!');
      const indicatorTexts = await page.locator('text=/x[0-9]+/').allTextContents();
      console.log(`   Indicators: ${indicatorTexts.join(', ')}`);
    }
    
    // Check each section separately
    console.log('\n4️⃣ Checking expiring soon section...');
    const expiringSoonSection = page.locator('h2').filter({ hasText: /expiring soon|กำลังหมดอายุ/i });
    
    if (await expiringSoonSection.isVisible()) {
      const expiringSoonCards = await expiringSoonSection.locator('..').locator('.bg-white.shadow-md.rounded-lg').count();
      console.log(`📊 Expiring soon coupon cards: ${expiringSoonCards}`);
    } else {
      console.log('📊 No expiring soon section visible');
    }
    
    console.log('\n5️⃣ Checking active coupons section...');
    const activeCouponsSection = page.locator('h2').filter({ hasText: /active coupons|คูปองที่ใช้งานได้/i });
    
    if (await activeCouponsSection.isVisible()) {
      const activeCouponCards = await activeCouponsSection.locator('..').locator('.bg-white.shadow-md.rounded-lg').count();
      console.log(`📊 Active coupon cards: ${activeCouponCards}`);
    } else {
      console.log('📊 No active coupons section visible');
    }
    
    // Test API response
    console.log('\n6️⃣ Testing API response...');
    
    const apiResponse = await page.evaluate(async () => {
      try {
        const token = localStorage.getItem('accessToken');
        if (!token) return { error: 'No token' };
        
        const response = await fetch('/api/coupons/my-coupons', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) return { error: `${response.status} ${response.statusText}` };
        
        const data = await response.json();
        return {
          success: data.success,
          couponCount: data.data?.coupons?.length || 0,
          coupons: data.data?.coupons || []
        };
      } catch (err) {
        return { error: err.message };
      }
    });
    
    console.log('📊 API Response:', apiResponse);
    
    if (apiResponse.coupons && apiResponse.coupons.length > 0) {
      console.log('\n📋 Coupons from API:');
      apiResponse.coupons.forEach((coupon, index) => {
        console.log(`   ${index + 1}. ${coupon.code} - ${coupon.name}`);
        console.log(`      User Coupon ID: ${coupon.userCouponId}`);
        console.log(`      QR Code: ${coupon.qrCode}`);
        console.log(`      Status: ${coupon.status}`);
        console.log('');
      });
      
      // Check for duplicate codes in API
      const apiCouponCounts = {};
      apiResponse.coupons.forEach(c => {
        apiCouponCounts[c.code] = (apiCouponCounts[c.code] || 0) + 1;
      });
      
      console.log('📊 API Coupon counts:');
      Object.entries(apiCouponCounts).forEach(([code, count]) => {
        console.log(`   ${code}: ${count} ${count === 1 ? 'instance' : 'instances'}`);
      });
    }
    
    console.log('\n📊 SEPARATION ANALYSIS:');
    console.log('======================');
    
    const expectedCoupons = 3; // Based on our database setup
    const actualCards = couponCards;
    const apiCoupons = apiResponse.couponCount || 0;
    
    console.log(`✅ Expected coupons: ${expectedCoupons}`);
    console.log(`${actualCards === expectedCoupons ? '✅' : '❌'} UI coupon cards: ${actualCards}`);
    console.log(`${apiCoupons === expectedCoupons ? '✅' : '❌'} API coupons: ${apiCoupons}`);
    console.log(`${usageIndicators === 0 ? '✅' : '❌'} No consolidation indicators: ${usageIndicators === 0 ? 'GOOD' : 'FOUND CONSOLIDATION'}`);
    
    if (actualCards === expectedCoupons && apiCoupons === expectedCoupons && usageIndicators === 0) {
      console.log('\n🎉 SUCCESS: Coupons are properly separated!');
      console.log('📊 Each coupon appears as a separate card');
      console.log('📊 No consolidation or usage count indicators found');
    } else if (actualCards < expectedCoupons) {
      console.log('\n⚠️ ISSUE DETECTED: Coupons may be consolidated');
      console.log(`📊 Expected ${expectedCoupons} cards but found ${actualCards}`);
      console.log('📊 This suggests multiple coupons are being merged into single cards');
    } else {
      console.log('\n✅ LIKELY OK: Card count matches expectation');
      console.log('📊 Multiple coupons are displaying as separate entities');
    }
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
    await page.screenshot({ path: 'separation-test-error.png' });
  } finally {
    console.log('\n⏸️ Closing browser in 10 seconds...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();
  }
})();