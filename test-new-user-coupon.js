const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1500
  });
  
  try {
    console.log('🔄 Testing coupon assignment for test-user@example.com...\n');
    
    const testUser = {
      email: 'test-user@example.com',
      password: 'password123'
    };
    
    console.log('📊 Test Parameters:');
    console.log(`   User: ${testUser.email}`);
    console.log(`   Expected Coupon: 1FREE1`);
    console.log(`   Testing via: http://localhost:3000\n`);
    
    const page = await browser.newPage();
    
    // Enable console and error logging
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`🔥 Browser Error: ${msg.text()}`);
      }
    });
    
    page.on('response', response => {
      if (response.url().includes('/api/coupons/my-coupons')) {
        console.log(`📊 Coupons API Response: ${response.status()}`);
      }
    });
    
    // Step 1: Login as test user
    console.log('1️⃣ Logging in as test user...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    
    await page.fill('input[type="email"]', testUser.email);
    await page.fill('input[type="password"]', testUser.password);
    await page.click('button[type="submit"]');
    
    // Wait for login to complete
    try {
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      console.log('✅ Login successful - redirected to dashboard');
    } catch (error) {
      console.log('❌ Login failed or timeout');
      await page.screenshot({ path: 'login-failed-test-user.png' });
      throw new Error('Login failed');
    }
    
    // Step 2: Navigate to coupon wallet
    console.log('\n2️⃣ Navigating to coupon wallet...');
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Wait for API calls to complete
    
    // Take screenshot of wallet page
    await page.screenshot({ path: 'test-user-wallet.png', fullPage: true });
    console.log('✅ Wallet page loaded and screenshot taken');
    
    // Step 3: Analyze coupon wallet content
    console.log('\n3️⃣ Analyzing wallet content...');
    
    const walletTitle = await page.locator('h1').textContent();
    console.log(`📊 Wallet title: "${walletTitle}"`);
    
    // Count different types of content
    const couponCards = await page.locator('.bg-white.shadow.rounded-lg').count();
    const loadingIndicators = await page.locator('text=Loading').or(page.locator('text=กำลังโหลด')).count();
    const emptyStateElements = await page.locator('text=No coupons').or(page.locator('text=ไม่มีคูปอง')).count();
    
    console.log(`📊 Content analysis:`);
    console.log(`   - Coupon cards: ${couponCards}`);
    console.log(`   - Loading indicators: ${loadingIndicators}`);
    console.log(`   - Empty state messages: ${emptyStateElements}`);
    
    // Step 4: Search for 1FREE1 coupon specifically
    console.log('\n4️⃣ Searching for 1FREE1 coupon...');
    
    const coupon1FREE1Visible = await page.locator('text=1FREE1').isVisible();
    console.log(`📊 1FREE1 coupon visible: ${coupon1FREE1Visible}`);
    
    // Look for coupon codes in various formats
    const couponCodePatterns = [
      'text=1FREE1',
      'text*=FREE',  
      '.font-mono:has-text("1FREE1")',
      '[data-coupon-code="1FREE1"]'
    ];
    
    let foundCouponCode = false;
    for (const pattern of couponCodePatterns) {
      const found = await page.locator(pattern).isVisible();
      if (found) {
        console.log(`✅ Found coupon using pattern: ${pattern}`);
        foundCouponCode = true;
        break;
      }
    }
    
    if (!foundCouponCode) {
      console.log('❌ 1FREE1 coupon not found in UI');
    }
    
    // Step 5: Test API directly to verify backend
    console.log('\n5️⃣ Testing API directly...');
    
    const apiResponse = await page.evaluate(async () => {
      try {
        const token = localStorage.getItem('accessToken');
        if (!token) {
          return { error: 'No access token in localStorage' };
        }
        
        const response = await fetch('/api/coupons/my-coupons', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          return { error: `API returned ${response.status}: ${response.statusText}` };
        }
        
        const data = await response.json();
        return {
          success: data.success,
          couponCount: data.data?.coupons?.length || 0,
          coupons: data.data?.coupons || [],
          totalPages: data.data?.totalPages || 0,
          currentPage: data.data?.page || 1
        };
      } catch (error) {
        return { error: error.message };
      }
    });
    
    console.log('📊 API Response:', apiResponse);
    
    if (apiResponse.coupons && apiResponse.coupons.length > 0) {
      console.log('\n📋 Coupons returned by API:');
      apiResponse.coupons.forEach((coupon, index) => {
        console.log(`   ${index + 1}. Code: ${coupon.code}`);
        console.log(`      Name: ${coupon.name}`);
        console.log(`      Status: ${coupon.status}`);
        console.log(`      QR Code: ${coupon.qrCode}`);
        console.log(`      Expires: ${coupon.expiresAt || 'No expiry'}`);
        console.log(`      Expiring Soon: ${coupon.expiringSoon ? 'Yes' : 'No'}`);
        console.log('');
      });
      
      // Check if 1FREE1 is in the API response
      const has1FREE1 = apiResponse.coupons.some(c => c.code === '1FREE1');
      console.log(`📊 1FREE1 found in API response: ${has1FREE1}`);
    }
    
    // Step 6: Test coupon interaction (if visible)
    console.log('\n6️⃣ Testing coupon interaction...');
    
    if (coupon1FREE1Visible || foundCouponCode) {
      console.log('🔄 Attempting to click on 1FREE1 coupon...');
      
      try {
        // Try to click on the coupon card
        const couponCard = page.locator('.bg-white.shadow').filter({ hasText: '1FREE1' });
        if (await couponCard.isVisible()) {
          await couponCard.click();
          await page.waitForTimeout(1000);
          console.log('✅ Clicked on coupon card');
          
          // Check if QR modal opened
          const qrModal = await page.locator('.fixed.inset-0').isVisible();
          console.log(`📊 QR code modal opened: ${qrModal}`);
          
          if (qrModal) {
            await page.screenshot({ path: 'coupon-qr-modal.png' });
            console.log('✅ QR modal screenshot taken');
            
            // Close modal
            const closeButton = page.locator('button:has-text("Close")').or(page.locator('button:has-text("ปิด")'));
            if (await closeButton.isVisible()) {
              await closeButton.click();
              console.log('✅ Closed QR modal');
            }
          }
        }
      } catch (error) {
        console.log(`⚠️ Could not interact with coupon: ${error.message}`);
      }
    }
    
    // Step 7: Check page source for debugging
    console.log('\n7️⃣ Debugging page content...');
    
    // Get page text content to search for coupon mentions
    const pageText = await page.textContent('body');
    const textIncludes1FREE1 = pageText.includes('1FREE1');
    const textIncludesFREE = pageText.includes('FREE');
    
    console.log(`📊 Page text analysis:`);
    console.log(`   - Contains "1FREE1": ${textIncludes1FREE1}`);
    console.log(`   - Contains "FREE": ${textIncludesFREE}`);
    
    // Look for any Thai text that might be the coupon name
    const thaiTextMatches = pageText.match(/[ก-๙]+/g);
    if (thaiTextMatches) {
      console.log(`📊 Thai text found: ${thaiTextMatches.slice(0, 10).join(', ')}...`);
    }
    
    // Step 8: Final assessment
    console.log('\n📊 FINAL TEST RESULTS:');
    console.log('================================');
    
    const backendWorking = apiResponse.couponCount > 0 && !apiResponse.error;
    const frontendWorking = couponCards > 0;
    const couponAssigned = apiResponse.coupons?.some(c => c.code === '1FREE1') || false;
    const couponVisible = coupon1FREE1Visible || foundCouponCode || textIncludes1FREE1;
    
    console.log(`✅ Login System: Working`);
    console.log(`${backendWorking ? '✅' : '❌'} Backend API: ${backendWorking ? 'Working' : 'Issues detected'}`);
    console.log(`${frontendWorking ? '✅' : '❌'} Frontend UI: ${frontendWorking ? 'Working' : 'Issues detected'}`);
    console.log(`${couponAssigned ? '✅' : '❌'} Coupon Assignment: ${couponAssigned ? 'Success' : 'Failed'}`);
    console.log(`${couponVisible ? '✅' : '❌'} Coupon Display: ${couponVisible ? 'Working' : 'Issues detected'}`);
    
    if (backendWorking && frontendWorking && couponAssigned && couponVisible) {
      console.log('\n🎉 OVERALL STATUS: SUCCESS!');
      console.log('📊 Complete coupon assignment workflow is functional');
      console.log('📊 User can successfully view assigned coupons');
    } else if (backendWorking && couponAssigned) {
      console.log('\n⚠️ OVERALL STATUS: PARTIAL SUCCESS');
      console.log('📊 Backend coupon assignment is working');
      console.log('📊 Frontend display may need investigation');
    } else {
      console.log('\n❌ OVERALL STATUS: ISSUES DETECTED');
      console.log('📊 Coupon assignment workflow needs attention');
    }
    
    // Recommendations
    console.log('\n🎯 RECOMMENDATIONS:');
    if (!couponAssigned) {
      console.log('1. Verify coupon was properly assigned in database');
      console.log('2. Check user ID matches between assignment and login');
    }
    if (couponAssigned && !couponVisible) {
      console.log('1. Check frontend coupon rendering logic');
      console.log('2. Verify CSS classes and component structure');
      console.log('3. Check browser console for JavaScript errors');
    }
    if (apiResponse.error) {
      console.log('1. Check authentication token handling');
      console.log('2. Verify API endpoint accessibility');
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: 'test-error-new-user.png' });
    }
  } finally {
    console.log('\n⏸️ Keeping browser open for 15 seconds for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    await browser.close();
  }
})();