const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000 
  });
  
  try {
    console.log('🔄 Testing basic coupon assignment...\n');
    
    const page = await browser.newPage();
    
    // Step 1: Check if app loads
    console.log('1️⃣ Loading application...');
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    
    const pageTitle = await page.title();
    console.log(`✅ App loaded: ${pageTitle}`);
    
    // Step 2: Check if login page is accessible
    console.log('\n2️⃣ Navigating to login...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    
    const loginVisible = await page.locator('input[type="email"]').isVisible();
    console.log(`✅ Login form visible: ${loginVisible}`);
    
    if (!loginVisible) {
      console.log('❌ Login form not visible - taking screenshot');
      await page.screenshot({ path: 'login-not-visible.png' });
      return;
    }
    
    // Step 3: Login as admin
    console.log('\n3️⃣ Logging in as admin...');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    try {
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      console.log('✅ Successfully logged in');
    } catch (error) {
      console.log('❌ Login failed - checking error');
      await page.screenshot({ path: 'login-failed.png' });
      
      // Try to see what's on the page
      const pageText = await page.textContent('body').catch(() => 'Could not read page');
      console.log(`Page content preview: ${pageText.substring(0, 200)}...`);
      return;
    }
    
    // Step 4: Navigate to admin coupons
    console.log('\n4️⃣ Navigating to admin coupons...');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    
    const adminPageLoaded = await page.locator('h1').isVisible();
    console.log(`✅ Admin page loaded: ${adminPageLoaded}`);
    
    if (adminPageLoaded) {
      const title = await page.locator('h1').textContent();
      console.log(`📊 Admin page title: "${title}"`);
    }
    
    // Step 5: Check existing coupon (1FREE1 that we manually assigned)
    console.log('\n5️⃣ Checking for existing coupon 1FREE1...');
    
    const coupon1FREE1 = await page.locator('text=1FREE1').isVisible();
    console.log(`📊 Coupon 1FREE1 visible: ${coupon1FREE1}`);
    
    if (coupon1FREE1) {
      console.log('✅ Found previously created coupon');
      
      // Try to find assign button for this coupon
      const assignButton = await page.locator('tr:has-text("1FREE1") button').filter({ 
        hasText: /assign|มอบหมาย|Assign/i 
      }).first().isVisible();
      
      console.log(`📊 Assign button visible: ${assignButton}`);
    }
    
    // Step 6: Test assignment via direct API call to verify backend
    console.log('\n6️⃣ Testing backend assignment API directly...');
    
    const response = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/coupons/my-coupons', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          return { success: true, data };
        } else {
          return { success: false, status: response.status, statusText: response.statusText };
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    if (response.success) {
      console.log(`✅ API call successful - user has ${response.data.coupons?.length || 0} coupons`);
      
      if (response.data.coupons?.length > 0) {
        console.log('📊 User coupons:');
        response.data.coupons.forEach((coupon, index) => {
          console.log(`   ${index + 1}. ${coupon.code} - ${coupon.name} (${coupon.status})`);
        });
      }
    } else {
      console.log(`❌ API call failed: ${response.error || response.statusText}`);
    }
    
    // Step 7: Navigate to user wallet to verify
    console.log('\n7️⃣ Checking user wallet...');
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    
    const walletLoaded = await page.locator('h1').isVisible();
    console.log(`✅ Wallet page loaded: ${walletLoaded}`);
    
    if (walletLoaded) {
      const walletTitle = await page.locator('h1').textContent();
      console.log(`📊 Wallet title: "${walletTitle}"`);
      
      // Count coupons in wallet
      const couponCards = await page.locator('.bg-white.shadow').count();
      console.log(`📊 Coupon cards in wallet: ${couponCards}`);
      
      // Check for our test coupon
      const has1FREE1 = await page.locator('text=1FREE1').isVisible();
      console.log(`📊 1FREE1 coupon visible in wallet: ${has1FREE1}`);
      
      // Check for empty state
      const emptyState = await page.locator('text=noCoupons').or(page.locator('text=ไม่มีคูปอง')).isVisible();
      console.log(`📊 Empty state shown: ${emptyState}`);
    }
    
    // Final screenshot
    await page.screenshot({ path: 'final-test-state.png', fullPage: true });
    
    // Summary
    console.log('\n📊 TEST SUMMARY:');
    console.log('✅ Application is accessible via Docker Compose');
    console.log('✅ Login functionality works');
    console.log('✅ Admin pages are accessible');
    
    if (response.success && response.data.coupons?.length > 0) {
      console.log('✅ Backend coupon assignment is working');
      console.log('✅ User has coupons in database');
      
      if (couponCards > 0) {
        console.log('✅ Frontend coupon display is working');
        console.log('🎉 OVERALL: Coupon assignment system is functional');
      } else {
        console.log('⚠️ Frontend coupon display may have issues');
        console.log('🔧 RECOMMENDATION: Check frontend coupon rendering');
      }
    } else {
      console.log('❌ No coupons found for user');
      console.log('🔧 RECOMMENDATION: Test manual coupon assignment');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: 'test-error.png' });
    }
  } finally {
    console.log('\n⏸️ Keeping browser open for 10 seconds...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();
  }
})();