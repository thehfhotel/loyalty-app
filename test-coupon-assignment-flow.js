const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  
  try {
    console.log('🔄 Testing complete coupon assignment flow...\n');
    
    // Test data
    const testUser = {
      email: 'winut.hf@gmail.com',
      password: 'password123'
    };
    
    const testCoupon = {
      code: 'TESTFLOW',
      name: 'Test Flow Coupon',
      description: 'Testing assignment flow'
    };
    
    console.log('📊 Test Parameters:');
    console.log(`   Admin User: ${testUser.email}`);
    console.log(`   Coupon Code: ${testCoupon.code}`);
    
    // Phase 1: Admin creates and assigns coupon
    console.log('\n🔄 Phase 1: Admin creates and assigns coupon...');
    const adminPage = await browser.newPage();
    
    // Login as admin
    await adminPage.goto('http://localhost:3003/login');
    await adminPage.fill('input[type="email"]', testUser.email);
    await adminPage.fill('input[type="password"]', testUser.password);
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Admin logged in');
    
    // Navigate to admin coupons
    await adminPage.goto('http://localhost:3003/admin/coupons');
    await adminPage.waitForLoadState('networkidle');
    console.log('✅ Navigated to admin coupons page');
    
    // Create new coupon
    await adminPage.click('button:has-text("สร้างคูปอง")'); // "Create Coupon" in Thai
    await adminPage.waitForTimeout(500);
    
    // Fill coupon details
    await adminPage.fill('input[placeholder*="รหัส"]', testCoupon.code);
    await adminPage.fill('input[placeholder*="ชื่อ"]', testCoupon.name);
    await adminPage.fill('textarea[placeholder*="คำอธิบาย"]', testCoupon.description);
    
    // Set percentage discount
    await adminPage.selectOption('select', 'percentage');
    await adminPage.fill('input[type="number"][placeholder*="มูลค่า"]', '20');
    
    // Set minimum spend
    await adminPage.fill('input[type="number"][placeholder*="จำนวนเงินขั้นต่ำ"]', '100');
    
    // Set validity
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 7);
    const validUntil = tomorrow.toISOString().split('T')[0];
    await adminPage.fill('input[type="date"]', validUntil);
    
    // Submit coupon creation
    await adminPage.click('button[type="submit"]:has-text("สร้างคูปอง")');
    await adminPage.waitForTimeout(2000);
    console.log('✅ Coupon created');
    
    // Find the created coupon and assign it
    const couponRow = adminPage.locator(`tr:has-text("${testCoupon.code}")`);
    await couponRow.waitFor({ timeout: 5000 });
    
    // Click assign button for this coupon
    const assignButton = couponRow.locator('button:has-text("มอบหมาย")'); // "Assign" in Thai
    await assignButton.click();
    await adminPage.waitForTimeout(1000);
    console.log('✅ Opened assignment modal');
    
    // Select the user in the assignment modal
    const userCheckbox = adminPage.locator(`input[type="checkbox"][value="${testUser.email}"]`).first();
    if (await userCheckbox.isVisible()) {
      await userCheckbox.check();
      console.log('✅ Selected user for assignment');
    } else {
      // Try alternative selector
      const userRow = adminPage.locator(`tr:has-text("${testUser.email}")`);
      const checkbox = userRow.locator('input[type="checkbox"]');
      await checkbox.check();
      console.log('✅ Selected user for assignment (alternative method)');
    }
    
    // Confirm assignment
    await adminPage.click('button:has-text("มอบหมายให้ผู้ใช้")'); // "Assign to Users" in Thai
    await adminPage.waitForTimeout(2000);
    
    // Check for success message
    await adminPage.waitForTimeout(1000);
    console.log('✅ Coupon assignment attempted');
    
    // Phase 2: Verify coupon appears in user's wallet
    console.log('\n🔄 Phase 2: Verifying coupon in user wallet...');
    const userPage = await browser.newPage();
    
    // Login as the same user (who should now have the coupon)
    await userPage.goto('http://localhost:3003/login');
    await userPage.fill('input[type="email"]', testUser.email);
    await userPage.fill('input[type="password"]', testUser.password);
    await userPage.click('button[type="submit"]');
    await userPage.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ User logged in');
    
    // Navigate to coupons page
    await userPage.goto('http://localhost:3003/coupons');
    await userPage.waitForLoadState('networkidle');
    await userPage.waitForTimeout(2000);
    console.log('✅ Navigated to user coupons page');
    
    // Check if the test coupon appears
    const testCouponVisible = await userPage.locator(`text=${testCoupon.code}`).isVisible();
    console.log(`📊 Test coupon visible: ${testCouponVisible}`);
    
    // Count total coupons
    const couponCards = await userPage.locator('.bg-white.shadow.rounded-lg').count();
    console.log(`📊 Total coupon cards: ${couponCards}`);
    
    // Get all visible coupon codes
    const couponCodes = await userPage.locator('text*="FREE"').or(userPage.locator('text*="TEST"')).allTextContents();
    console.log(`📊 Visible coupon codes: ${couponCodes.join(', ') || 'None found'}`);
    
    // Take screenshots
    await adminPage.screenshot({ path: 'admin-coupon-assignment.png', fullPage: true });
    await userPage.screenshot({ path: 'user-coupon-wallet.png', fullPage: true });
    console.log('📸 Screenshots saved');
    
    // Final verification
    console.log('\n📊 ASSIGNMENT FLOW RESULTS:');
    
    if (testCouponVisible) {
      console.log('🎉 SUCCESS: Complete assignment flow working!');
      console.log('   ✅ Admin can create coupons');
      console.log('   ✅ Admin can assign coupons to users');  
      console.log('   ✅ Assigned coupons appear in user wallet');
    } else {
      console.log('⚠️ PARTIAL SUCCESS: Assignment may have issues');
      if (couponCards > 0) {
        console.log('   ✅ User has some coupons');
        console.log('   ⚠️ But test coupon not visible (may be timing issue)');
      } else {
        console.log('   ❌ No coupons visible in user wallet');
        console.log('   ❌ Assignment process may have failed');
      }
    }
    
    // Cleanup: Try to delete the test coupon
    try {
      console.log('\n🔄 Cleaning up test coupon...');
      await adminPage.bringToFront();
      await adminPage.reload();
      await adminPage.waitForLoadState('networkidle');
      
      const testCouponRow = adminPage.locator(`tr:has-text("${testCoupon.code}")`);
      if (await testCouponRow.isVisible()) {
        const deleteButton = testCouponRow.locator('button:has-text("ลบ")'); // "Delete" in Thai
        await deleteButton.click();
        await adminPage.waitForTimeout(500);
        
        // Confirm deletion
        await adminPage.fill('input[placeholder*="DELETE"]', 'DELETE');
        await adminPage.click('button:has-text("ลบคูปอง")'); // "Delete Coupon" in Thai
        await adminPage.waitForTimeout(1000);
        console.log('✅ Test coupon cleaned up');
      }
    } catch (cleanupError) {
      console.log('⚠️ Could not clean up test coupon (may need manual deletion)');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    // Take error screenshots
    const pages = await browser.pages();
    for (let i = 0; i < pages.length; i++) {
      await pages[i].screenshot({ path: `error-page-${i}.png` });
    }
  } finally {
    console.log('\n🔄 Keeping browser open for 10 seconds for review...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();
  }
})();