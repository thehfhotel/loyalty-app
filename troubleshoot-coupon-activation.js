const { chromium } = require('playwright');

async function troubleshootCouponActivation() {
  console.log('🔍 Troubleshooting Coupon Activation Issue...\n');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const consoleMessages = [];
  const networkErrors = [];
  const apiCalls = [];
  
  // Monitor console messages
  page.on('console', msg => {
    const log = {
      type: msg.type(),
      text: msg.text(),
      location: msg.location()
    };
    consoleMessages.push(log);
    if (msg.type() === 'error') {
      console.log(`🔴 Console Error: ${msg.text()}`);
    }
  });
  
  // Monitor network requests
  page.on('response', response => {
    const url = response.url();
    if (url.includes('/api/')) {
      apiCalls.push({
        url: url,
        status: response.status(),
        method: response.request().method()
      });
      
      if (!response.ok()) {
        networkErrors.push({
          url: url,
          status: response.status(),
          statusText: response.statusText()
        });
        console.log(`🔴 API Error: ${response.status()} ${url}`);
      } else if (url.includes('coupon')) {
        console.log(`✅ API Success: ${response.status()} ${url}`);
      }
    }
  });
  
  try {
    // Step 1: Login as admin and create a test coupon
    console.log('🔐 Step 1: Logging in as admin...');
    await page.goto('http://localhost:3000/login');
    
    await page.fill('input[type="email"]', 'admin@hotel.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('http://localhost:3000/dashboard', { timeout: 10000 });
    console.log('✅ Admin login successful');
    
    // Step 2: Create a test coupon
    console.log('\\n🎫 Step 2: Creating a test coupon...');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForLoadState('networkidle');
    
    await page.click('button:has-text("Create Coupon")');
    await page.waitForTimeout(1000);
    
    const timestamp = Date.now();
    const couponCode = `TEST${timestamp.toString().slice(-6)}`;
    
    // Fill coupon form
    const inputs = await page.locator('input[type="text"]').all();
    if (inputs.length >= 2) {
      await inputs[0].fill(couponCode);
      await inputs[1].fill(`Test Coupon ${couponCode}`);
    }
    
    await page.fill('textarea', `Test coupon for activation troubleshooting`);
    await page.selectOption('select', 'percentage');
    
    const numberInputs = await page.locator('input[type="number"]').all();
    if (numberInputs.length > 0) await numberInputs[0].fill('20');
    
    // Set dates
    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + 30);
    
    const dateInputs = await page.locator('input[type="date"]').all();
    if (dateInputs.length >= 2) {
      await dateInputs[0].fill(today.toISOString().split('T')[0]);
      await dateInputs[1].fill(futureDate.toISOString().split('T')[0]);
    }
    
    console.log(`📝 Creating coupon: ${couponCode} (20% off)`);
    
    // Submit the form
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    
    // Check if coupon was created
    const couponCreated = await page.locator(`text=${couponCode}`).first().isVisible();
    if (couponCreated) {
      console.log('✅ Test coupon created successfully');
    } else {
      console.log('❌ Failed to create test coupon');
      return;
    }
    
    // Step 3: Assign coupon to a user
    console.log('\\n👥 Step 3: Assigning coupon to user...');
    const row = await page.locator(`tr:has-text("${couponCode}")`);
    await row.locator('button:has-text("Assign")').click();
    await page.waitForTimeout(1000);
    
    // Select first user
    const checkboxes = await page.locator('input[type="checkbox"]').all();
    if (checkboxes.length > 0) {
      await checkboxes[0].check();
      console.log('✅ Selected user for assignment');
      
      // Assign
      await page.click('button:has-text("Assign to 1 users")');
      await page.waitForTimeout(2000);
      console.log('✅ Coupon assigned to user');
    }
    
    // Step 4: Login as regular user and test activation
    console.log('\\n🔄 Step 4: Switching to regular user...');
    
    // Logout admin
    const logoutButton = await page.locator('button:has-text("Logout")');
    if (await logoutButton.isVisible()) {
      await logoutButton.click();
      await page.waitForURL('http://localhost:3000/login', { timeout: 5000 });
    } else {
      await page.goto('http://localhost:3000/login');
    }
    
    // Login as regular user
    await page.fill('input[type="email"]', 'user@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('http://localhost:3000/dashboard', { timeout: 10000 });
    console.log('✅ User login successful');
    
    // Step 5: Navigate to coupon wallet and test activation
    console.log('\\n🎫 Step 5: Testing coupon activation...');
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle');
    
    // Take screenshot of coupon wallet
    await page.screenshot({ 
      path: './coupon-wallet-debug.png',
      fullPage: true 
    });
    console.log('📷 Coupon wallet screenshot saved');
    
    // Check if user has any coupons
    const noCouponsMessage = await page.locator('text=No coupons').isVisible();
    const hasCoupons = await page.locator('.coupon-card, [class*="coupon"]').count() > 0;
    
    if (noCouponsMessage) {
      console.log('❌ User has no coupons - assignment may have failed');
    } else if (hasCoupons) {
      console.log('✅ User has coupons available');
      
      // Try to activate/use a coupon
      const useCouponButton = page.locator('button:has-text("Use Coupon"), button:has-text("View Details")').first();
      if (await useCouponButton.isVisible()) {
        console.log('🔍 Testing coupon activation...');
        await useCouponButton.click();
        await page.waitForTimeout(2000);
        
        // Check if QR code modal appears
        const qrCodeModal = await page.locator('[class*="qr"], [class*="modal"]').isVisible();
        if (qrCodeModal) {
          console.log('✅ QR code modal appeared - activation working');
          
          // Take screenshot of QR modal
          await page.screenshot({ 
            path: './qr-code-modal-debug.png',
            fullPage: true 
          });
          console.log('📷 QR code modal screenshot saved');
        } else {
          console.log('❌ QR code modal did not appear');
        }
      } else {
        console.log('❌ No "Use Coupon" button found');
      }
    } else {
      console.log('⚠️ Could not determine if user has coupons');
    }
    
    // Step 6: Check API calls and data
    console.log('\\n📊 Step 6: Analyzing API calls...');
    
    // Test direct API call to get user coupons
    const userCouponsResponse = await page.evaluate(async () => {
      try {
        const authStorage = localStorage.getItem('auth-storage');
        let token = '';
        
        if (authStorage) {
          const parsedAuth = JSON.parse(authStorage);
          token = parsedAuth.state?.accessToken || '';
        }
        
        const response = await fetch('http://localhost:4000/api/coupons/my-coupons', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        const data = await response.json();
        return { status: response.status, data };
      } catch (error) {
        return { error: error.message };
      }
    });
    
    console.log('📊 User coupons API response:', JSON.stringify(userCouponsResponse, null, 2));
    
    // Step 7: Summary
    console.log('\\n📋 Step 7: Troubleshooting Summary:');
    console.log('='.repeat(50));
    
    console.log('\\n🔗 API Calls Made:');
    apiCalls.slice(-10).forEach((call, index) => {
      console.log(`  ${index + 1}. ${call.method} ${call.url} - ${call.status}`);
    });
    
    if (networkErrors.length > 0) {
      console.log('\\n❌ Network Errors:');
      networkErrors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.status} ${error.url}`);
      });
    }
    
    if (consoleMessages.filter(m => m.type === 'error').length > 0) {
      console.log('\\n🔴 Console Errors:');
      consoleMessages.filter(m => m.type === 'error').forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.text}`);
      });
    }
    
    console.log('\\n🎉 Troubleshooting completed!');
    console.log('📷 Screenshots saved: coupon-wallet-debug.png, qr-code-modal-debug.png');
    
  } catch (error) {
    console.log(`❌ Troubleshooting failed: ${error.message}`);
  } finally {
    await browser.close();
  }
}

troubleshootCouponActivation().catch(console.error);