const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 2000 
  });
  
  try {
    console.log('🔄 Testing login and coupon wallet access...\n');
    
    const page = await browser.newPage();
    
    // Enable console logging
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('🔥 Browser Error:', msg.text());
      }
    });
    
    // Step 1: Go to login page
    console.log('1️⃣ Navigating to login...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    
    // Take screenshot of login page
    await page.screenshot({ path: 'login-page-docker.png' });
    console.log('✅ Login page loaded and screenshot taken');
    
    // Step 2: Attempt login with detailed error checking
    console.log('\n2️⃣ Attempting login...');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'password123');
    
    // Listen for network responses
    let loginResponse = null;
    page.on('response', response => {
      if (response.url().includes('/api/auth/login')) {
        loginResponse = response;
        console.log(`📊 Login API response: ${response.status()}`);
      }
    });
    
    await page.click('button[type="submit"]');
    
    // Wait for either success or error
    await page.waitForTimeout(3000);
    
    // Check if we're still on login page or moved to dashboard
    const currentUrl = page.url();
    console.log(`📊 Current URL after login attempt: ${currentUrl}`);
    
    if (currentUrl.includes('dashboard')) {
      console.log('✅ Login successful - redirected to dashboard');
    } else {
      console.log('❌ Login failed - still on login page');
      
      // Look for error messages
      const errorMessages = await page.locator('.text-red-600, .text-red-500, [class*="error"]').allTextContents();
      if (errorMessages.length > 0) {
        console.log('📊 Error messages found:');
        errorMessages.forEach((msg, index) => {
          console.log(`   ${index + 1}. ${msg}`);
        });
      }
      
      // Check if form fields are still there
      const emailFilled = await page.locator('input[type="email"]').inputValue();
      const passwordFilled = await page.locator('input[type="password"]').inputValue();
      console.log(`📊 Form state - Email: "${emailFilled}", Password: "${passwordFilled ? '****' : 'empty'}"`);
      
      // Try a different approach - register if login fails
      console.log('\n🔄 Trying registration instead...');
      await page.goto('http://localhost:3000/register');
      await page.waitForLoadState('networkidle');
      
      await page.fill('input[type="email"]', 'test-user@example.com');
      await page.fill('input[name="firstName"], input[placeholder*="ชื่อ"]', 'Test');
      await page.fill('input[name="lastName"], input[placeholder*="นามสกุล"]', 'User');
      await page.fill('input[type="password"]', 'password123');
      await page.fill('input[name="confirmPassword"], input[placeholder*="ยืนยันรหัสผ่าน"]', 'password123');
      
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);
      
      const regUrl = page.url();
      console.log(`📊 URL after registration: ${regUrl}`);
      
      if (regUrl.includes('dashboard')) {
        console.log('✅ Registration successful');
      } else {
        console.log('❌ Registration also failed');
        await page.screenshot({ path: 'registration-failed.png' });
        return;
      }
    }
    
    // Step 3: Navigate to coupons wallet
    console.log('\n3️⃣ Navigating to coupon wallet...');
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: 'wallet-page.png' });
    console.log('✅ Wallet page screenshot taken');
    
    // Check what's displayed
    const walletTitle = await page.locator('h1').textContent().catch(() => 'No title found');
    console.log(`📊 Wallet page title: "${walletTitle}"`);
    
    // Count coupon cards
    const couponCards = await page.locator('.bg-white.shadow').count();
    console.log(`📊 Coupon cards found: ${couponCards}`);
    
    // Look for specific text patterns
    const pageText = await page.textContent('body');
    const has1FREE1 = pageText.includes('1FREE1');
    const hasNoCoupons = pageText.includes('No coupons') || pageText.includes('ไม่มีคูปอง');
    const hasLoading = pageText.includes('Loading') || pageText.includes('กำลังโหลด');
    
    console.log(`📊 Page contains:`);
    console.log(`   - 1FREE1 coupon: ${has1FREE1}`);
    console.log(`   - "No coupons" message: ${hasNoCoupons}`);
    console.log(`   - Loading indicator: ${hasLoading}`);
    
    // Check API calls by evaluating in page context
    const apiResult = await page.evaluate(async () => {
      try {
        const token = localStorage.getItem('accessToken');
        console.log('Token found:', !!token);
        
        if (!token) {
          return { error: 'No access token found in localStorage' };
        }
        
        const response = await fetch('/api/coupons/my-coupons', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        const data = await response.json();
        return { 
          status: response.status, 
          success: data.success, 
          couponCount: data.data?.coupons?.length || 0,
          coupons: data.data?.coupons || []
        };
      } catch (error) {
        return { error: error.message };
      }
    });
    
    console.log(`📊 API Test Result:`, apiResult);
    
    if (apiResult.coupons && apiResult.coupons.length > 0) {
      console.log('📋 Coupons from API:');
      apiResult.coupons.forEach((coupon, index) => {
        console.log(`   ${index + 1}. ${coupon.code} - ${coupon.name} (${coupon.status})`);
      });
    }
    
    // Step 4: Final diagnosis
    console.log('\n📊 DIAGNOSIS RESULTS:');
    
    if (apiResult.couponCount > 0) {
      console.log('✅ Backend is working - API returns coupons');
      
      if (couponCards > 0 || has1FREE1) {
        console.log('✅ Frontend is working - coupons are displayed');
        console.log('🎉 SUCCESS: Full coupon assignment flow is working!');
      } else {
        console.log('⚠️ Frontend issue - API has coupons but they are not displayed');
        console.log('🔧 ISSUE: Frontend coupon rendering problem');
      }
    } else if (apiResult.error) {
      console.log(`❌ Authentication issue: ${apiResult.error}`);
      console.log('🔧 ISSUE: User authentication or token problem');
    } else {
      console.log('❌ No coupons found via API');
      console.log('🔧 ISSUE: Coupon assignment or backend problem');
    }
    
    // Show final recommendation
    if (apiResult.couponCount > 0 && (couponCards === 0 && !has1FREE1)) {
      console.log('\n🎯 RECOMMENDED FIXES:');
      console.log('1. Check frontend coupon component rendering logic');
      console.log('2. Verify CSS classes and layout issues');
      console.log('3. Check console for JavaScript errors');
      console.log('4. Review CouponWallet.tsx component');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: 'final-error.png' });
    }
  } finally {
    console.log('\n⏸️ Test complete. Browser staying open for 15 seconds...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    await browser.close();
  }
})();