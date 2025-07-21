const { chromium } = require('playwright');

async function testCorrectPort() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Testing application on correct port...');

    // Try the correct frontend port
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // Take screenshot to see if it loads correctly
    await page.screenshot({ path: '/Users/nut/loyalty-app/port-3000-test.png', fullPage: true });
    console.log('Port 3000 screenshot saved');

    // Check for CORS errors
    page.on('console', msg => {
      if (msg.text().includes('CORS') || msg.text().includes('Failed to fetch')) {
        console.log('CORS/Network issue:', msg.text());
      }
    });

    // Now try to register/login
    console.log('Attempting registration...');
    
    // Go to register page
    await page.click('a[href="/register"]');
    await page.waitForLoadState('networkidle');

    // Register admin user
    await page.fill('input[placeholder*="name"], input[type="text"]', 'Test Admin');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // Take screenshot after registration
    await page.screenshot({ path: '/Users/nut/loyalty-app/registration-success.png', fullPage: true });
    console.log('Registration screenshot saved');

    // Now navigate to admin coupons
    console.log('Navigating to admin coupon management...');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForTimeout(3000);

    // Take screenshot of admin page
    await page.screenshot({ path: '/Users/nut/loyalty-app/admin-coupons-working.png', fullPage: true });
    console.log('Admin coupons page screenshot saved');

    // Look for View Assignments button
    const buttons = await page.$$('button');
    console.log(`Found ${buttons.length} buttons on admin page:`);
    
    for (let i = 0; i < buttons.length; i++) {
      const buttonText = await buttons[i].textContent();
      console.log(`Button ${i}: "${buttonText}"`);
      
      if (buttonText && (
        buttonText.toLowerCase().includes('view') && buttonText.toLowerCase().includes('assignment') ||
        buttonText.toLowerCase().includes('assignments') ||
        buttonText.toLowerCase().includes('มอบหมาย') // Thai for assignment
      )) {
        console.log(`Found assignments button: "${buttonText}"`);
        
        try {
          // Click the assignments button
          await buttons[i].click();
          await page.waitForTimeout(2000);
          
          // Wait for modal to appear
          await page.waitForSelector('.modal, [role="dialog"], [data-testid*="modal"]', { timeout: 5000 });
          
          // Take screenshot of the modal
          await page.screenshot({ 
            path: '/Users/nut/loyalty-app/assignments-modal-final-test.png', 
            fullPage: true 
          });
          console.log('✅ Assignments modal screenshot saved - showing corrected numbers!');
          
          // Extract and display summary numbers
          const modalText = await page.textContent('.modal, [role="dialog"]');
          console.log('Modal content preview:', modalText.substring(0, 500));
          
          // Look for specific number patterns
          const numberMatches = modalText.match(/\d+/g);
          if (numberMatches) {
            console.log('Numbers found in modal:', numberMatches);
          }
          
          break;
        } catch (e) {
          console.log('Could not interact with assignments button:', e.message);
        }
      }
    }

  } catch (error) {
    console.error('Test failed:', error.message);
    await page.screenshot({ path: '/Users/nut/loyalty-app/correct-port-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

testCorrectPort();