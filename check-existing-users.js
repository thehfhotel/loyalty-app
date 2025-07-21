const { chromium } = require('playwright');

async function checkUsers() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // First, let's see what happens when we try to access the application directly
    console.log('Checking application status...');
    
    await page.goto('http://localhost');
    await page.waitForTimeout(3000);
    
    // Take a screenshot to see current state
    await page.screenshot({ path: '/Users/nut/loyalty-app/app-status-check.png', fullPage: true });
    console.log('App status screenshot saved');

    // Check for any network errors in the console
    page.on('console', msg => {
      console.log('Browser console:', msg.text());
    });

    page.on('response', response => {
      if (!response.ok()) {
        console.log('Failed request:', response.url(), response.status());
      }
    });

    // Try the direct admin dashboard URL to see what happens
    console.log('Trying direct admin dashboard access...');
    await page.goto('http://localhost/admin');
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: '/Users/nut/loyalty-app/admin-direct-access.png', fullPage: true });
    console.log('Admin direct access screenshot saved');

    // Try dashboard
    console.log('Trying dashboard access...');
    await page.goto('http://localhost/dashboard');
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: '/Users/nut/loyalty-app/dashboard-access.png', fullPage: true });
    console.log('Dashboard access screenshot saved');

    // Let's see what the app structure looks like
    const body = await page.textContent('body');
    console.log('Current page text preview:', body.substring(0, 300));

  } catch (error) {
    console.error('Check failed:', error.message);
  } finally {
    await browser.close();
  }
}

checkUsers();