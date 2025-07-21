const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 500 // Slow down actions for better visibility
  });
  
  try {
    console.log('🔄 Testing coupon assignment flow via Docker Compose...\n');
    
    // Test data
    const testUser = {
      email: 'winut.hf@gmail.com',
      password: 'password123'
    };
    
    const testCoupon = {
      code: 'DOCKER-TEST-' + Date.now(),
      name: 'Docker Test Coupon',
      description: 'Testing assignment flow via Docker'
    };
    
    console.log('📊 Test Parameters:');
    console.log(`   Admin User: ${testUser.email}`);
    console.log(`   Coupon Code: ${testCoupon.code}`);
    console.log(`   Frontend URL: http://localhost:3000`);
    
    const page = await browser.newPage();
    
    // Phase 1: Login as admin
    console.log('\n🔄 Phase 1: Admin Login...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');
    
    // Check if login page loaded
    const loginPageLoaded = await page.locator('h1').textContent();
    console.log(`📊 Page title: "${loginPageLoaded}"`);
    
    await page.fill('input[type="email"]', testUser.email);
    await page.fill('input[type="password"]', testUser.password);
    
    // Take screenshot before login
    await page.screenshot({ path: 'login-page.png' });
    
    await page.click('button[type="submit"]');
    
    try {
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      console.log('✅ Admin logged in successfully');
    } catch (error) {
      console.log('❌ Login failed, checking for error messages...');
      const errorElement = await page.locator('.text-red-600').textContent().catch(() => null);
      if (errorElement) {
        console.log(`📊 Error message: ${errorElement}`);
      }
      throw new Error('Login failed');
    }
    
    // Phase 2: Navigate to admin coupons
    console.log('\n🔄 Phase 2: Navigate to Admin Coupons...');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForLoadState('networkidle');
    
    // Wait for page to load and check language
    await page.waitForTimeout(2000);
    
    // Switch to Thai if needed
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
    
    const pageTitle = await page.locator('h1').textContent();
    console.log(`📊 Admin page title: "${pageTitle}"`);
    
    // Phase 3: Create new coupon
    console.log('\n🔄 Phase 3: Create New Coupon...');
    
    // Look for create button (in Thai or English)
    const createButton = page.locator('button').filter({ 
      hasText: /สร้างคูปอง|Create Coupon|Create/i 
    });
    
    if (await createButton.isVisible()) {
      await createButton.click();
      console.log('✅ Clicked create coupon button');
    } else {
      console.log('❌ Create coupon button not found');
      await page.screenshot({ path: 'no-create-button.png' });
      throw new Error('Create button not found');
    }
    
    await page.waitForTimeout(1000);
    
    // Fill coupon details
    console.log('📝 Filling coupon details...');
    
    // Code field - try multiple selectors
    const codeInputs = [
      'input[name="code"]',
      'input[placeholder*="รหัส"]',
      'input[placeholder*="Code"]',
      'input[id*="code"]'
    ];
    
    let codeInput = null;
    for (const selector of codeInputs) {
      if (await page.locator(selector).isVisible()) {
        codeInput = page.locator(selector);
        break;
      }
    }
    
    if (codeInput) {
      await codeInput.fill(testCoupon.code);
      console.log('✅ Filled coupon code');
    } else {
      console.log('❌ Could not find code input field');
      await page.screenshot({ path: 'no-code-input.png' });
    }
    
    // Name field
    const nameInputs = [
      'input[name="name"]',
      'input[placeholder*="ชื่อ"]',
      'input[placeholder*="Name"]',
      'input[id*="name"]'
    ];
    
    let nameInput = null;
    for (const selector of nameInputs) {
      if (await page.locator(selector).isVisible()) {
        nameInput = page.locator(selector);
        break;
      }
    }
    
    if (nameInput) {
      await nameInput.fill(testCoupon.name);
      console.log('✅ Filled coupon name');
    }
    
    // Description field
    const descInputs = [
      'textarea[name="description"]',
      'textarea[placeholder*="คำอธิบาย"]',
      'textarea[placeholder*="Description"]',
      'input[name="description"]'
    ];
    
    let descInput = null;
    for (const selector of descInputs) {
      if (await page.locator(selector).isVisible()) {
        descInput = page.locator(selector);
        break;
      }
    }
    
    if (descInput) {
      await descInput.fill(testCoupon.description);
      console.log('✅ Filled coupon description');
    }
    
    // Set coupon type to percentage
    const typeSelect = page.locator('select[name="type"]').or(page.locator('select').first());
    if (await typeSelect.isVisible()) {
      await typeSelect.selectOption('percentage');
      console.log('✅ Selected percentage type');
    }
    
    // Set value to 10%
    const valueInputs = [
      'input[name="value"]',
      'input[type="number"]',
      'input[placeholder*="มูลค่า"]'
    ];
    
    let valueInput = null;
    for (const selector of valueInputs) {
      const input = page.locator(selector);
      if (await input.isVisible()) {
        valueInput = input;
        break;
      }
    }
    
    if (valueInput) {
      await valueInput.fill('10');
      console.log('✅ Set coupon value to 10%');
    }
    
    // Take screenshot before submission
    await page.screenshot({ path: 'coupon-form.png' });
    
    // Submit the form
    const submitButton = page.locator('button[type="submit"]').or(
      page.locator('button').filter({ hasText: /สร้างคูปอง|Create|Submit/i })
    );
    
    if (await submitButton.isVisible()) {
      await submitButton.click();
      console.log('✅ Submitted coupon creation form');
      await page.waitForTimeout(3000);
    }
    
    // Phase 4: Find and assign the coupon
    console.log('\n🔄 Phase 4: Assign Coupon to User...');
    
    // Refresh the page to see the new coupon
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // Look for the created coupon in the table
    const couponRow = page.locator(`tr:has-text("${testCoupon.code}")`);
    
    if (await couponRow.isVisible()) {
      console.log('✅ Found created coupon in table');
      
      // Look for assign button
      const assignButtons = [
        couponRow.locator('button:has-text("มอบหมาย")'),
        couponRow.locator('button:has-text("Assign")'),
        couponRow.locator('button').filter({ hasText: /assign|มอบหมาย/i })
      ];
      
      let assignButton = null;
      for (const button of assignButtons) {
        if (await button.isVisible()) {
          assignButton = button;
          break;
        }
      }
      
      if (assignButton) {
        await assignButton.click();
        console.log('✅ Clicked assign button');
        await page.waitForTimeout(1000);
        
        // In the assignment modal, select the user
        const userCheckboxes = [
          `input[type="checkbox"][value*="${testUser.email}"]`,
          `tr:has-text("${testUser.email}") input[type="checkbox"]`,
          'input[type="checkbox"]'
        ];
        
        let userCheckbox = null;
        for (const selector of userCheckboxes) {
          const checkbox = page.locator(selector).first();
          if (await checkbox.isVisible()) {
            userCheckbox = checkbox;
            break;
          }
        }
        
        if (userCheckbox) {
          await userCheckbox.check();
          console.log('✅ Selected user for assignment');
          
          // Confirm assignment
          const confirmButtons = [
            'button:has-text("มอบหมายให้ผู้ใช้")',
            'button:has-text("Assign to Users")',
            'button:has-text("Assign")'
          ];
          
          let confirmButton = null;
          for (const selector of confirmButtons) {
            const button = page.locator(selector);
            if (await button.isVisible()) {
              confirmButton = button;
              break;
            }
          }
          
          if (confirmButton) {
            await confirmButton.click();
            console.log('✅ Confirmed coupon assignment');
            await page.waitForTimeout(2000);
          }
        } else {
          console.log('❌ Could not find user checkbox');
          await page.screenshot({ path: 'no-user-checkbox.png' });
        }
      } else {
        console.log('❌ Could not find assign button');
        await page.screenshot({ path: 'no-assign-button.png' });
      }
    } else {
      console.log('❌ Could not find created coupon in table');
      await page.screenshot({ path: 'coupon-not-found.png' });
    }
    
    // Phase 5: Verify in user wallet
    console.log('\n🔄 Phase 5: Verify in User Wallet...');
    
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    // Count coupons and look for our test coupon
    const couponCards = await page.locator('.bg-white.shadow').count();
    console.log(`📊 Total coupon cards in wallet: ${couponCards}`);
    
    const testCouponInWallet = await page.locator(`text=${testCoupon.code}`).isVisible();
    console.log(`📊 Test coupon visible in wallet: ${testCouponInWallet}`);
    
    // Get all visible text to see what's there
    const pageText = await page.textContent('body');
    const hasTestCoupon = pageText.includes(testCoupon.code);
    console.log(`📊 Test coupon found in page text: ${hasTestCoupon}`);
    
    // Take final screenshots
    await page.screenshot({ path: 'user-wallet-final.png', fullPage: true });
    
    // Results
    console.log('\n📊 COUPON ASSIGNMENT TEST RESULTS:');
    
    if (testCouponInWallet || hasTestCoupon) {
      console.log('🎉 SUCCESS: Coupon assignment flow is working!');
      console.log('   ✅ Admin can create coupons');
      console.log('   ✅ Admin can assign coupons to users');
      console.log('   ✅ Assigned coupons appear in user wallet');
    } else if (couponCards > 0) {
      console.log('⚠️ PARTIAL SUCCESS: Assignment process has issues');
      console.log('   ✅ User has coupons in wallet');
      console.log('   ❌ Test coupon not visible (assignment may have failed)');
    } else {
      console.log('❌ FAILURE: Assignment process is not working');
      console.log('   ❌ No coupons visible in user wallet');
      console.log('   ❌ Assignment process failed completely');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: 'test-error.png', fullPage: true });
    }
  } finally {
    console.log('\n🔄 Test completed. Keeping browser open for 10 seconds for review...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();
  }
})();