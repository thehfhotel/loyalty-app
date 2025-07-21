const { chromium } = require('playwright');

async function debugDashboardButton() {
  console.log('🔍 Debugging Dashboard Button Implementation...\n');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Login as admin
    console.log('🔐 Logging in as admin...');
    await page.goto('http://localhost:3001/login');
    
    await page.fill('input[type="email"]', 'admin@hotel.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('http://localhost:3001/dashboard', { timeout: 10000 });
    console.log('✅ Admin login successful\n');
    
    // Navigate to profile page and debug
    console.log('📄 Navigating to Profile page...');
    await page.goto('http://localhost:3001/profile');
    await page.waitForLoadState('networkidle');
    
    // Check for various button selectors
    console.log('🔍 Looking for dashboard button with different selectors...');
    
    const selectors = [
      'button:has-text("Dashboard")',
      'button:has-text("แดชบอร์ด")', // Thai
      'button[aria-label*="Dashboard"]',
      'button[aria-label*="Back to Dashboard"]',
      'button svg', // Any button with an icon
      'a[href="/dashboard"]',
      '.dashboard-button' // Class name
    ];
    
    for (const selector of selectors) {
      try {
        const element = page.locator(selector);
        const count = await element.count();
        if (count > 0) {
          console.log(`  ✅ Found ${count} element(s) with selector: ${selector}`);
          
          // Get the first element's text content
          const text = await element.first().textContent();
          console.log(`     Text content: "${text}"`);
          
          // Get outer HTML for the first match
          const html = await element.first().innerHTML();
          console.log(`     Inner HTML: ${html}`);
        } else {
          console.log(`  ❌ No elements found with selector: ${selector}`);
        }
      } catch (error) {
        console.log(`  ❌ Error with selector ${selector}: ${error.message}`);
      }
    }
    
    // Check all buttons on the page
    console.log('\n🔍 All buttons on the page:');
    const allButtons = await page.locator('button').all();
    for (let i = 0; i < allButtons.length; i++) {
      try {
        const text = await allButtons[i].textContent();
        const isVisible = await allButtons[i].isVisible();
        console.log(`  Button ${i + 1}: "${text}" (visible: ${isVisible})`);
      } catch (error) {
        console.log(`  Button ${i + 1}: Error getting text - ${error.message}`);
      }
    }
    
    // Take a screenshot for visual debugging
    await page.screenshot({ 
      path: './debug-dashboard-button.png',
      fullPage: true 
    });
    console.log('\n📷 Screenshot saved: debug-dashboard-button.png');
    
  } catch (error) {
    console.log(`❌ Debug failed: ${error.message}`);
  } finally {
    await browser.close();
  }
}

debugDashboardButton().catch(console.error);