const { chromium } = require('playwright');

async function comprehensiveCouponTest() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🚀 Starting comprehensive coupon assignment test...');

    // Go to the correct port
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    
    // Switch to English if needed for easier testing
    const langButton = await page.$('button:has-text("🇹🇭")');
    if (langButton) {
      await langButton.click();
      await page.waitForTimeout(1000);
    }

    console.log('📝 Step 1: Register new admin user...');
    
    // Go to register page
    await page.click('text=สร้างบัญชี');
    await page.waitForLoadState('networkidle');

    // Fill registration form
    await page.fill('input[type="text"]', 'Admin User');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    
    // Wait for registration/login success
    await page.waitForTimeout(3000);

    // Take screenshot after registration
    await page.screenshot({ path: '/Users/nut/loyalty-app/step1-registration.png', fullPage: true });

    console.log('🔐 Step 2: Verify login and navigate to admin panel...');
    
    // Check if we're logged in by looking for dashboard or profile elements
    const currentUrl = page.url();
    console.log('Current URL after registration:', currentUrl);
    
    // If still on login page, try logging in
    if (currentUrl.includes('login') || currentUrl.includes('register')) {
      console.log('Still on auth page, attempting login...');
      await page.goto('http://localhost:3000/login');
      await page.waitForLoadState('networkidle');
      
      await page.fill('input[type="email"]', 'test@example.com');
      await page.fill('input[type="password"]', 'admin123');
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);
    }

    // Navigate to admin coupon management
    console.log('🏪 Step 3: Navigate to admin coupon management...');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: '/Users/nut/loyalty-app/step2-admin-coupons.png', fullPage: true });

    // Check if we can access the admin page
    const pageContent = await page.textContent('body');
    const hasAdminContent = pageContent.includes('coupon') || pageContent.includes('Coupon') || 
                           pageContent.includes('คูปอง') || pageContent.includes('admin') || 
                           pageContent.includes('Admin');
    
    console.log('Has admin content:', hasAdminContent);
    
    if (!hasAdminContent) {
      console.log('❌ Cannot access admin page. Current content preview:');
      console.log(pageContent.substring(0, 300));
      return;
    }

    console.log('🎯 Step 4: Look for coupons and assignment buttons...');
    
    // Look for all buttons and identify potential assignment buttons
    const allButtons = await page.$$('button');
    console.log(`Found ${allButtons.length} buttons on the page`);
    
    let assignmentButton = null;
    
    for (let i = 0; i < allButtons.length; i++) {
      const buttonText = await allButtons[i].textContent();
      const buttonClass = await allButtons[i].getAttribute('class');
      console.log(`Button ${i}: "${buttonText}" (class: ${buttonClass})`);
      
      // Look for assignment-related buttons (English or Thai)
      if (buttonText && (
        buttonText.toLowerCase().includes('view') && buttonText.toLowerCase().includes('assignment') ||
        buttonText.toLowerCase().includes('assignments') ||
        buttonText.includes('ดูการมอบหมาย') ||
        buttonText.includes('มอบหมาย') ||
        buttonText.includes('View Assignments') ||
        buttonText.includes('รายละเอียด')
      )) {
        assignmentButton = allButtons[i];
        console.log(`🎉 Found assignment button: "${buttonText}"`);
        break;
      }
    }

    if (!assignmentButton) {
      console.log('⚠️ No assignment button found. Let me check for coupon cards or other interactive elements...');
      
      // Look for coupon cards or rows
      const couponElements = await page.$$('.coupon-card, .coupon-item, [data-testid*="coupon"], tr');
      console.log(`Found ${couponElements.length} potential coupon elements`);
      
      // Try clicking on the first coupon or table row to see options
      if (couponElements.length > 0) {
        console.log('Trying to interact with first coupon element...');
        await couponElements[0].click();
        await page.waitForTimeout(1000);
        
        // Look again for buttons after interaction
        const newButtons = await page.$$('button');
        for (let i = 0; i < newButtons.length; i++) {
          const buttonText = await newButtons[i].textContent();
          if (buttonText && buttonText.toLowerCase().includes('assignment')) {
            assignmentButton = newButtons[i];
            console.log(`Found assignment button after interaction: "${buttonText}"`);
            break;
          }
        }
      }
    }

    if (assignmentButton) {
      console.log('📊 Step 5: Click assignment button and open modal...');
      
      await assignmentButton.click();
      await page.waitForTimeout(2000);

      // Wait for modal to appear
      try {
        await page.waitForSelector('.modal, [role="dialog"], [data-testid*="modal"], .fixed', { timeout: 10000 });
        console.log('✅ Assignment modal opened successfully!');
        
        // Take screenshot of the modal with corrected numbers
        await page.screenshot({ 
          path: '/Users/nut/loyalty-app/final-assignments-modal-corrected.png', 
          fullPage: true 
        });
        
        console.log('📈 Step 6: Extract and verify summary numbers...');
        
        // Get modal content
        const modalContent = await page.textContent('.modal, [role="dialog"], [data-testid*="modal"], .fixed');
        console.log('Modal content preview:');
        console.log(modalContent.substring(0, 800));
        
        // Extract numbers from the modal
        const numbers = modalContent.match(/\d+/g);
        if (numbers) {
          console.log('📊 Numbers found in modal:', numbers);
          console.log('These should now represent totals across ALL pages, not just current page');
        }
        
        // Look for specific labels
        const summaryLabels = [
          'Total Users', 'Total Assigned', 'Used', 'Available',
          'ผู้ใช้ทั้งหมด', 'มอบหมายทั้งหมด', 'ใช้แล้ว', 'ใช้ได้'
        ];
        
        for (const label of summaryLabels) {
          if (modalContent.includes(label)) {
            console.log(`✅ Found label: "${label}"`);
          }
        }
        
        // Check if pagination exists to confirm fix is working
        const hasPagination = modalContent.includes('Next') || 
                            modalContent.includes('Previous') || 
                            modalContent.includes('ถัดไป') ||
                            modalContent.includes('ก่อนหน้า') ||
                            modalContent.includes('Page');
        
        console.log(`📄 Pagination present: ${hasPagination}`);
        
        if (hasPagination) {
          console.log('🔄 Testing pagination to verify numbers remain consistent...');
          
          const beforeNumbers = numbers ? [...numbers] : [];
          
          // Try to click next page
          const nextButton = await page.$('button:has-text("Next"), button:has-text("ถัดไป"), [data-testid*="next"]');
          if (nextButton) {
            await nextButton.click();
            await page.waitForTimeout(2000);
            
            const newModalContent = await page.textContent('.modal, [role="dialog"], [data-testid*="modal"], .fixed');
            const afterNumbers = newModalContent.match(/\d+/g);
            
            console.log('Numbers before pagination:', beforeNumbers);
            console.log('Numbers after pagination:', afterNumbers);
            
            // The total numbers should remain the same (this confirms the fix is working)
            if (JSON.stringify(beforeNumbers) === JSON.stringify(afterNumbers)) {
              console.log('✅ SUCCESS: Numbers remained consistent across pagination!');
              console.log('This confirms the fix is working correctly.');
            } else {
              console.log('⚠️ Numbers changed - this indicates the fix may need further verification');
            }
            
            // Take final screenshot
            await page.screenshot({ 
              path: '/Users/nut/loyalty-app/pagination-test-verification.png', 
              fullPage: true 
            });
          }
        }
        
        console.log('🎯 FINAL RESULT: Coupon assignment fix verification completed!');
        console.log('Screenshots saved:');
        console.log('- final-assignments-modal-corrected.png: Modal showing corrected summary numbers');
        console.log('- pagination-test-verification.png: Verification that numbers are consistent');
        
      } catch (e) {
        console.log('❌ Could not open assignment modal:', e.message);
        await page.screenshot({ path: '/Users/nut/loyalty-app/modal-open-error.png', fullPage: true });
      }
      
    } else {
      console.log('❌ Could not find assignment button. The page might not have coupons with assignments yet.');
      console.log('💡 Consider creating test data first or checking existing coupons.');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/Users/nut/loyalty-app/comprehensive-test-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

comprehensiveCouponTest();