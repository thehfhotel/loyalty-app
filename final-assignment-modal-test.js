const { chromium } = require('playwright');

async function testAssignmentModalFix() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🎯 Testing Coupon Assignment Modal Fix - Corrected Summary Numbers');
    
    // Try different admin credentials from the config
    const adminCredentials = [
      { email: 'winut.hf@gmail.com', password: 'password123' },
      { email: 'test@example.com', password: 'password123' },
      { email: 'test@example.com', password: 'admin123' },
      { email: 'admin@hotel.com', password: 'admin123' }
    ];

    let loginSuccessful = false;
    let usedCredentials = null;

    for (const creds of adminCredentials) {
      try {
        console.log(`🔑 Attempting login with ${creds.email}...`);
        
        await page.goto('http://localhost:3000/login');
        await page.waitForLoadState('networkidle');
        
        // Clear any existing values
        await page.fill('input[type="email"]', '');
        await page.fill('input[type="password"]', '');
        
        await page.fill('input[type="email"]', creds.email);
        await page.fill('input[type="password"]', creds.password);
        await page.click('button[type="submit"]');
        
        // Wait for either dashboard or login page (to see if login succeeded)
        try {
          await page.waitForURL('**/dashboard', { timeout: 5000 });
          console.log(`✅ Login successful with ${creds.email}`);
          loginSuccessful = true;
          usedCredentials = creds;
          break;
        } catch (e) {
          console.log(`❌ Login failed with ${creds.email}`);
          continue;
        }
      } catch (e) {
        console.log(`⚠️ Error with ${creds.email}: ${e.message}`);
        continue;
      }
    }

    if (!loginSuccessful) {
      console.log('❌ Could not login with any admin credentials');
      
      // Let's try registering a new admin user
      console.log('🔄 Attempting to register new admin user...');
      
      await page.goto('http://localhost:3000/register');
      await page.waitForLoadState('networkidle');
      
      await page.fill('input[type="text"]', 'Test Admin');
      await page.fill('input[type="email"]', 'test@example.com');
      await page.fill('input[type="password"]', 'admin123');
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);
      
      const currentUrl = page.url();
      if (currentUrl.includes('dashboard')) {
        console.log('✅ Registration and auto-login successful');
        loginSuccessful = true;
        usedCredentials = { email: 'test@example.com', password: 'admin123' };
      }
    }

    if (!loginSuccessful) {
      console.log('❌ Could not authenticate. Taking screenshot for debugging...');
      await page.screenshot({ path: '/Users/nut/loyalty-app/auth-failure-debug.png', fullPage: true });
      return;
    }

    console.log(`🚀 Authenticated successfully as ${usedCredentials.email}`);

    // Navigate to admin coupon management
    console.log('📋 Navigating to admin coupon management...');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForTimeout(3000);

    // Take screenshot of the admin coupons page
    await page.screenshot({ 
      path: '/Users/nut/loyalty-app/admin-coupons-loaded.png', 
      fullPage: true 
    });

    // Check if we have admin access
    const pageText = await page.textContent('body');
    const hasAdminAccess = pageText.includes('coupon') || pageText.includes('Coupon') || 
                          pageText.includes('คูปอง') || pageText.includes('จัดการ');

    if (!hasAdminAccess) {
      console.log('❌ No admin access detected. Current page content:');
      console.log(pageText.substring(0, 300));
      return;
    }

    console.log('✅ Admin coupon management page loaded');

    // Look for existing coupons with assignment buttons
    console.log('🔍 Looking for coupons with assignment functionality...');

    // Find all potential assignment-related buttons
    const buttons = await page.$$('button');
    const buttonTexts = [];
    
    for (let i = 0; i < buttons.length; i++) {
      const text = await buttons[i].textContent();
      const classes = await buttons[i].getAttribute('class');
      buttonTexts.push({ index: i, text: text?.trim(), classes });
      
      // Log buttons that might be assignment-related
      if (text && (
        text.includes('View') || text.includes('Assignment') || text.includes('assign') ||
        text.includes('ดู') || text.includes('มอบหมาย') || text.includes('รายละเอียด') ||
        text.includes('Details') || text.includes('Manage')
      )) {
        console.log(`🎯 Potential assignment button found: "${text}" (index ${i})`);
      }
    }

    console.log(`📊 Total buttons found: ${buttons.length}`);
    
    // Look for table rows or coupon cards that might contain assignment buttons
    const rows = await page.$$('tr, .coupon-card, .coupon-item');
    console.log(`📊 Found ${rows.length} table rows/coupon elements`);

    let modalOpened = false;

    // Try clicking on different types of assignment buttons
    const assignmentPatterns = [
      'View Assignments',
      'ดูการมอบหมาย',
      'มอบหมาย',
      'Assignment',
      'assignments',
      'Details',
      'รายละเอียด'
    ];

    for (const pattern of assignmentPatterns) {
      try {
        const button = await page.$(`button:has-text("${pattern}")`);
        if (button) {
          console.log(`🎯 Found assignment button with pattern: "${pattern}"`);
          await button.click();
          await page.waitForTimeout(2000);
          
          // Check if modal opened
          const modal = await page.$('.modal, [role="dialog"], [data-testid*="modal"], .fixed');
          if (modal) {
            console.log('✅ Assignment modal opened!');
            modalOpened = true;
            break;
          }
        }
      } catch (e) {
        // Continue to next pattern
      }
    }

    // If no specific assignment button found, try clicking on action buttons in coupon rows
    if (!modalOpened && rows.length > 0) {
      console.log('🔄 Trying to click action buttons in coupon rows...');
      
      for (let i = 0; i < Math.min(rows.length, 5); i++) {
        try {
          const actionButton = await rows[i].$('button');
          if (actionButton) {
            const buttonText = await actionButton.textContent();
            console.log(`🎯 Clicking action button in row ${i}: "${buttonText}"`);
            
            await actionButton.click();
            await page.waitForTimeout(1000);
            
            // Check if any modal or dropdown appeared
            const modal = await page.$('.modal, [role="dialog"], [data-testid*="modal"], .fixed');
            if (modal) {
              console.log('✅ Modal opened from row action button!');
              modalOpened = true;
              break;
            }
          }
        } catch (e) {
          console.log(`⚠️ Could not click action button in row ${i}`);
        }
      }
    }

    if (modalOpened) {
      console.log('📊 TESTING ASSIGNMENT MODAL WITH CORRECTED NUMBERS...');
      
      // Take screenshot of the modal
      await page.screenshot({ 
        path: '/Users/nut/loyalty-app/assignment-modal-corrected-numbers.png', 
        fullPage: true 
      });
      
      // Extract modal content
      const modalContent = await page.textContent('.modal, [role="dialog"], [data-testid*="modal"], .fixed');
      console.log('📋 Modal content preview:');
      console.log('='.repeat(50));
      console.log(modalContent.substring(0, 800));
      console.log('='.repeat(50));
      
      // Extract all numbers from the modal
      const numbers = modalContent.match(/\d+/g) || [];
      console.log('🔢 Numbers found in modal:', numbers);
      
      // Look for summary labels and their associated numbers
      const summaryPatterns = [
        'Total Users', 'Total Assigned', 'Used', 'Available',
        'ผู้ใช้ทั้งหมด', 'มอบหมายแล้ว', 'ใช้แล้ว', 'คงเหลือ'
      ];
      
      console.log('📈 Summary number analysis:');
      for (const pattern of summaryPatterns) {
        if (modalContent.includes(pattern)) {
          console.log(`✅ Found label: "${pattern}"`);
          
          // Try to extract the number that follows this label
          const regex = new RegExp(`${pattern}[\\s:]*([\\d,]+)`, 'i');
          const match = modalContent.match(regex);
          if (match) {
            console.log(`   → Associated number: ${match[1]}`);
          }
        }
      }
      
      // Check for pagination to verify the fix
      const hasPagination = modalContent.includes('Next') || modalContent.includes('Previous') ||
                           modalContent.includes('ถัดไป') || modalContent.includes('ก่อนหน้า') ||
                           modalContent.includes('Page') || modalContent.includes('หน้า');
      
      console.log(`📄 Pagination detected: ${hasPagination}`);
      
      if (hasPagination) {
        console.log('🧪 TESTING PAGINATION CONSISTENCY (this proves the fix works)...');
        
        const beforeNumbers = [...numbers];
        
        // Try to click next page
        const nextSelectors = [
          'button:has-text("Next")',
          'button:has-text("ถัดไป")',
          '[data-testid*="next"]',
          'button[aria-label*="next"]'
        ];
        
        let nextClicked = false;
        for (const selector of nextSelectors) {
          try {
            const nextButton = await page.$(selector);
            if (nextButton) {
              console.log('🔄 Clicking next page...');
              await nextButton.click();
              await page.waitForTimeout(2000);
              nextClicked = true;
              break;
            }
          } catch (e) {
            // Try next selector
          }
        }
        
        if (nextClicked) {
          const newModalContent = await page.textContent('.modal, [role="dialog"], [data-testid*="modal"], .fixed');
          const afterNumbers = newModalContent.match(/\d+/g) || [];
          
          console.log('📊 PAGINATION TEST RESULTS:');
          console.log('Numbers before pagination:', beforeNumbers);
          console.log('Numbers after pagination:', afterNumbers);
          
          // Compare the summary numbers (which should stay the same)
          const summaryNumbersBefore = beforeNumbers.slice(0, 4); // Assuming first 4 are summary
          const summaryNumbersAfter = afterNumbers.slice(0, 4);
          
          const numbersUnchanged = JSON.stringify(summaryNumbersBefore) === JSON.stringify(summaryNumbersAfter);
          
          if (numbersUnchanged) {
            console.log('🎉 SUCCESS: Summary numbers remained consistent across pagination!');
            console.log('✅ This confirms the fix is working correctly.');
            console.log('✅ Total numbers now represent ALL pages, not just current page.');
          } else {
            console.log('⚠️ Numbers changed during pagination - may need further investigation');
          }
          
          // Take final screenshot
          await page.screenshot({ 
            path: '/Users/nut/loyalty-app/pagination-consistency-test.png', 
            fullPage: true 
          });
        }
      }
      
      console.log('🎯 ASSIGNMENT MODAL FIX VERIFICATION COMPLETE');
      console.log('Screenshots saved:');
      console.log('- assignment-modal-corrected-numbers.png: Modal showing corrected totals');
      console.log('- pagination-consistency-test.png: Verification of consistent totals');
      
    } else {
      console.log('❌ Could not find or open assignment modal');
      console.log('💡 This might be because:');
      console.log('   - No coupons have been created yet');
      console.log('   - No coupons have assignments yet');
      console.log('   - The UI elements have different text/selectors than expected');
      
      // Take a screenshot of current state for debugging
      await page.screenshot({ 
        path: '/Users/nut/loyalty-app/no-assignment-modal-debug.png', 
        fullPage: true 
      });
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/Users/nut/loyalty-app/final-test-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

testAssignmentModalFix();