const { chromium } = require('playwright');

async function createAndTestAdmin() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Creating admin user and testing coupon management...');

    // Navigate to register page
    await page.goto('http://localhost');
    await page.waitForLoadState('networkidle');
    
    // Go to register page
    await page.click('a[href="/register"]');
    await page.waitForLoadState('networkidle');

    // Register admin user
    console.log('Registering admin user...');
    await page.fill('input[type="text"]', 'Test Admin'); // name field
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // Take screenshot after registration
    await page.screenshot({ path: '/Users/nut/loyalty-app/after-registration.png', fullPage: true });
    console.log('Registration completed');

    // Navigate to admin coupon management
    console.log('Navigating to coupon management...');
    await page.goto('http://localhost/admin/coupons');
    await page.waitForTimeout(3000);

    // Take screenshot of the admin page
    await page.screenshot({ path: '/Users/nut/loyalty-app/admin-coupons-access.png', fullPage: true });
    console.log('Admin coupons page screenshot saved');

    // Check if we can see admin content
    const pageContent = await page.textContent('body');
    console.log('Page contains "coupon":', pageContent.toLowerCase().includes('coupon'));
    console.log('Page contains "admin":', pageContent.toLowerCase().includes('admin'));
    console.log('Page contains "assignment":', pageContent.toLowerCase().includes('assignment'));

    // Look for any View Assignments buttons or assignment modals
    const viewButtons = await page.$$('button');
    console.log(`Found ${viewButtons.length} buttons on admin page:`);
    
    for (let i = 0; i < viewButtons.length; i++) {
      const buttonText = await viewButtons[i].textContent();
      console.log(`Button ${i}: "${buttonText}"`);
      
      if (buttonText && (buttonText.includes('View') || buttonText.includes('Assignment') || buttonText.includes('assignment'))) {
        console.log(`Found potential assignments button: "${buttonText}"`);
        
        try {
          await viewButtons[i].click();
          await page.waitForTimeout(2000);
          
          // Take screenshot of modal if it opens
          await page.screenshot({ path: '/Users/nut/loyalty-app/assignments-modal-test.png', fullPage: true });
          console.log('Assignments modal screenshot saved');
          
          // Look for summary numbers
          const modalContent = await page.textContent('body');
          console.log('Modal content preview:', modalContent.substring(0, 500));
          
          break;
        } catch (e) {
          console.log('Could not click button:', e.message);
        }
      }
    }

  } catch (error) {
    console.error('Test failed:', error.message);
    await page.screenshot({ path: '/Users/nut/loyalty-app/create-admin-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

createAndTestAdmin();