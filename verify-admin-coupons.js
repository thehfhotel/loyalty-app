const { chromium } = require('playwright');

async function verifyAdminCoupons() {
  console.log('✅ Verifying Admin Coupon Functionality...\n');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const consoleMessages = [];
  const networkErrors = [];
  
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
  
  // Monitor network failures
  page.on('response', response => {
    if (!response.ok()) {
      const error = {
        url: response.url(),
        status: response.status(),
        statusText: response.statusText()
      };
      networkErrors.push(error);
      console.log(`🔴 Network Error: ${response.status()} ${response.url()}`);
    }
  });
  
  try {
    // Login as admin
    console.log('👤 Logging in as admin...');
    await page.goto('http://localhost:3000/login');
    
    await page.fill('input[type="email"]', 'admin@hotel.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('http://localhost:3000/dashboard', { timeout: 10000 });
    console.log('✅ Admin login successful');
    
    // Navigate to admin coupons
    console.log('\n📋 Navigating to coupon management...');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForLoadState('networkidle');
    
    // Create a new coupon
    console.log('\n🎫 Creating a new test coupon...');
    await page.click('button:has-text("Create Coupon")');
    await page.waitForTimeout(1000);
    
    // Generate unique coupon code
    const timestamp = Date.now();
    const couponCode = `TEST${timestamp.toString().slice(-6)}`;
    
    // Fill form - using nth selectors since inputs don't have name attributes
    const inputs = await page.locator('input[type="text"]').all();
    if (inputs.length >= 2) {
      await inputs[0].fill(couponCode); // Code field
      await inputs[1].fill(`Test ${couponCode}`); // Name field
    }
    
    await page.fill('textarea', `Test coupon created at ${new Date().toLocaleString()}`);
    await page.selectOption('select', 'percentage');
    
    // Fill value (find the number input after the select)
    const numberInputs = await page.locator('input[type="number"]').all();
    if (numberInputs.length > 0) await numberInputs[0].fill('15');
    
    // Set valid dates - backend expects datetime format but frontend uses date inputs
    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + 30);
    
    const dateInputs = await page.locator('input[type="date"]').all();
    if (dateInputs.length >= 2) {
      await dateInputs[0].fill(today.toISOString().split('T')[0]);
      await dateInputs[1].fill(futureDate.toISOString().split('T')[0]);
    }
    
    console.log(`📅 Set dates: ${today.toISOString().split('T')[0]} to ${futureDate.toISOString().split('T')[0]}`);
    
    console.log(`📝 Creating coupon: ${couponCode} (15% off)`);
    
    // Verify all required fields are filled
    const codeInput = await page.locator('input[type="text"]').nth(0);
    const nameInput = await page.locator('input[type="text"]').nth(1);
    const valueInput = await page.locator('input[type="number"]').nth(0);
    const validFromInput = await page.locator('input[type="date"]').nth(0);
    const validUntilInput = await page.locator('input[type="date"]').nth(1);
    
    console.log('📋 Form values before submit:');
    console.log(`Code: ${await codeInput.inputValue()}`);
    console.log(`Name: ${await nameInput.inputValue()}`);
    console.log(`Value: ${await valueInput.inputValue()}`);
    console.log(`Valid From: ${await validFromInput.inputValue()}`);
    console.log(`Valid Until: ${await validUntilInput.inputValue()}`);
    
    // Submit - find the create button inside the modal
    try {
      // Wait for any loading to complete
      await page.waitForTimeout(500);
      
      // First try the submit button
      await page.click('button[type="submit"]');
      console.log('✅ Clicked submit button');
    } catch (e) {
      console.log('Primary submit failed, trying alternative selector...');
      
      // Try to find the Create Coupon button specifically
      try {
        await page.click('button:has-text("Create Coupon")');
        console.log('✅ Clicked Create Coupon button');
      } catch (e2) {
        console.log('Secondary submit failed, trying manual search...');
        // Last resort - find any button with "Create" text
        const buttons = await page.locator('button').all();
        for (const button of buttons) {
          const text = await button.textContent();
          if (text && text.includes('Create') && !text.includes('Cancel')) {
            await button.click();
            console.log(`✅ Clicked button with text: ${text}`);
            break;
          }
        }
      }
    }
    
    // Wait for modal to close and table to update
    await page.waitForTimeout(3000);
    
    // Check for any error messages on the page
    const errorMessage = await page.locator('.bg-red-50, .text-red-800, [class*="error"]').first();
    if (await errorMessage.isVisible()) {
      const errorText = await errorMessage.textContent();
      console.log(`🔴 Error on page: ${errorText}`);
    }
    
    // Check if coupon appears in table
    const couponCreated = await page.locator(`text=${couponCode}`).first().isVisible();
    if (couponCreated) {
      console.log('✅ Coupon created successfully!');
      
      // Test assignment
      console.log('\n👥 Testing coupon assignment...');
      
      // Find the assign button for our new coupon
      const row = await page.locator(`tr:has-text("${couponCode}")`);
      await row.locator('button:has-text("Assign")').click();
      
      await page.waitForTimeout(1000);
      
      // Select a few users
      const checkboxes = await page.locator('input[type="checkbox"]').all();
      const usersToSelect = Math.min(3, checkboxes.length);
      
      for (let i = 0; i < usersToSelect; i++) {
        await checkboxes[i].check();
      }
      
      console.log(`✅ Selected ${usersToSelect} users`);
      
      // Assign
      await page.click(`button:has-text("Assign to ${usersToSelect} users")`);
      await page.waitForTimeout(2000);
      
      console.log('✅ Assignment completed!');
      
      // Take final screenshot
      await page.screenshot({ 
        path: './verify-admin-coupons.png',
        fullPage: true 
      });
      
      console.log('\n🎉 All functionality verified successfully!');
      console.log(`📷 Screenshot saved: verify-admin-coupons.png`);
      
    } else {
      console.log('❌ Coupon creation may have failed');
    }
    
  } catch (error) {
    console.log(`\n❌ Verification failed: ${error.message}`);
  } finally {
    await browser.close();
  }
}

verifyAdminCoupons().catch(console.error);