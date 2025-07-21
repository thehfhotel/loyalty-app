const { chromium } = require('playwright');

async function debugCouponPage() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Debugging coupon management page...');

    // Navigate to login page
    await page.goto('http://localhost');
    await page.waitForLoadState('networkidle');
    
    // Take screenshot of login page
    await page.screenshot({ path: '/Users/nut/loyalty-app/debug-login-page.png', fullPage: true });
    console.log('Login page screenshot saved');

    // Login as admin
    console.log('Logging in as admin...');
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // Take screenshot after login
    await page.screenshot({ path: '/Users/nut/loyalty-app/debug-after-login.png', fullPage: true });
    console.log('After login screenshot saved');

    // Check current URL
    const currentUrl = page.url();
    console.log('Current URL after login:', currentUrl);

    // Navigate to admin coupon management
    console.log('Navigating to coupon management...');
    await page.goto('http://localhost/admin/coupons');
    await page.waitForTimeout(3000);

    // Take screenshot of coupon management page
    await page.screenshot({ path: '/Users/nut/loyalty-app/debug-coupon-management.png', fullPage: true });
    console.log('Coupon management screenshot saved');

    // Check current URL
    console.log('Current URL on coupon page:', page.url());

    // Get page title and all text content
    const pageTitle = await page.title();
    console.log('Page title:', pageTitle);

    // Check for any error messages or loading states
    const body = await page.textContent('body');
    console.log('Page contains "error":', body.toLowerCase().includes('error'));
    console.log('Page contains "loading":', body.toLowerCase().includes('loading'));
    console.log('Page contains "admin":', body.toLowerCase().includes('admin'));
    console.log('Page contains "coupon":', body.toLowerCase().includes('coupon'));

    // List all buttons on the page
    const buttons = await page.$$('button');
    console.log(`Found ${buttons.length} buttons:`);
    for (let i = 0; i < Math.min(buttons.length, 10); i++) {
      const buttonText = await buttons[i].textContent();
      console.log(`Button ${i}: "${buttonText}"`);
    }

    // List all links
    const links = await page.$$('a');
    console.log(`Found ${links.length} links:`);
    for (let i = 0; i < Math.min(links.length, 10); i++) {
      const linkText = await links[i].textContent();
      const href = await links[i].getAttribute('href');
      console.log(`Link ${i}: "${linkText}" -> "${href}"`);
    }

    // Check network responses
    console.log('Waiting for any network activity...');
    await page.waitForTimeout(2000);

  } catch (error) {
    console.error('Debug failed:', error.message);
    await page.screenshot({ path: '/Users/nut/loyalty-app/debug-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

debugCouponPage();