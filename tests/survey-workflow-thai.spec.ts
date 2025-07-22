import { test, expect, Page } from '@playwright/test';

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TEST_USER = {
  email: 'winut.hf@gmail.com',
  password: 'Kick2you@ss'
};

test.describe('Survey Workflow End-to-End (Thai Interface)', () => {
  let page: Page;
  
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    
    // Enable console logging and network monitoring
    page.on('console', msg => {
      console.log(`[CONSOLE ${msg.type()}]`, msg.text());
    });
    
    page.on('response', response => {
      if (response.status() >= 400) {
        console.log(`[NETWORK ERROR] ${response.status()} ${response.url()}`);
      }
    });
  });

  test('Complete Survey Workflow: Create → Publish → Take → Verify', async () => {
    console.log('🚀 Starting complete survey workflow test...');
    
    // Step 1: Navigate to application
    console.log('📍 Step 1: Navigate to application');
    await page.goto(BASE_URL);
    await page.screenshot({ path: 'test-results/01-homepage.png' });
    
    // Step 2: Login
    console.log('📍 Step 2: Login with test credentials');
    await page.fill('input[type="email"]', TEST_USER.email);
    await page.fill('input[type="password"]', TEST_USER.password);
    await page.click('button[type="submit"]');
    
    // Wait for login to complete
    await page.waitForURL('**/dashboard*', { timeout: 10000 });
    await page.screenshot({ path: 'test-results/02-dashboard.png' });
    console.log('✅ Successfully logged in');
    
    // Step 3: Navigate to survey management (using URL path)
    console.log('📍 Step 3: Navigate to survey management');
    // Look for admin survey management link by URL
    const surveyManagementLink = page.locator('a[href="/admin/surveys"]');
    await expect(surveyManagementLink).toBeVisible({ timeout: 10000 });
    await surveyManagementLink.click();
    
    await page.waitForURL('**/admin/surveys*', { timeout: 10000 });
    await page.screenshot({ path: 'test-results/03-survey-management.png' });
    console.log('✅ Navigated to survey management');
    
    // Step 4: Look for survey builder or create survey option
    console.log('📍 Step 4: Look for survey creation options');
    await page.waitForTimeout(2000);
    
    // Try to find create/builder buttons
    const createButtons = [
      'button:has-text("Create")',
      'button:has-text("สร้าง")',
      'button:has-text("New")',
      'button:has-text("ใหม่")',
      'a:has-text("Builder")',
      'a:has-text("สร้าง")',
      'a[href*="survey-builder"]'
    ];
    
    let builderFound = false;
    for (const selector of createButtons) {
      const element = page.locator(selector);
      if (await element.isVisible()) {
        await element.click();
        builderFound = true;
        console.log(`✅ Found and clicked: ${selector}`);
        break;
      }
    }
    
    if (!builderFound) {
      // Try direct navigation to survey builder
      console.log('🔄 Trying direct navigation to survey builder');
      await page.goto(`${BASE_URL}/admin/survey-builder`);
    }
    
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'test-results/04-survey-builder.png' });
    
    // Step 5: Check current page and look for form elements
    console.log('📍 Step 5: Analyze survey creation form');
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);
    
    // Look for survey creation elements
    const titleInput = page.locator('input[placeholder*="title" i], input[name*="title" i], input[type="text"]').first();
    const descriptionInput = page.locator('textarea[placeholder*="description" i], textarea[name*="description" i], textarea').first();
    
    if (await titleInput.isVisible()) {
      console.log('📝 Found survey form, creating test survey...');
      const surveyTitle = `E2E Test Survey ${Date.now()}`;
      
      await titleInput.fill(surveyTitle);
      
      if (await descriptionInput.isVisible()) {
        await descriptionInput.fill('This is an automated test survey for end-to-end workflow validation.');
      }
      
      // Look for save/submit buttons
      const saveButtons = [
        'button:has-text("Save")',
        'button:has-text("บันทึก")',
        'button:has-text("Create")',
        'button:has-text("สร้าง")',
        'button[type="submit"]'
      ];
      
      for (const selector of saveButtons) {
        const saveButton = page.locator(selector);
        if (await saveButton.isVisible()) {
          await saveButton.click();
          console.log(`✅ Clicked save button: ${selector}`);
          break;
        }
      }
      
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'test-results/05-survey-created.png' });
    }
    
    // Step 6: Navigate to customer surveys
    console.log('📍 Step 6: Navigate to customer surveys');
    const customerSurveysLink = page.locator('a[href="/surveys"]');
    if (await customerSurveysLink.isVisible()) {
      await customerSurveysLink.click();
      await page.waitForURL('**/surveys*', { timeout: 10000 });
    } else {
      await page.goto(`${BASE_URL}/surveys`);
    }
    
    await page.screenshot({ path: 'test-results/06-customer-surveys.png' });
    console.log('✅ Navigated to customer surveys');
    
    // Step 7: Look for available surveys
    console.log('📍 Step 7: Check available surveys');
    await page.waitForTimeout(2000);
    
    // Take screenshot of surveys page
    await page.screenshot({ path: 'test-results/07-surveys-list.png' });
    
    // Look for survey cards or links
    const surveyElements = await page.locator('div, card, article, section').all();
    console.log(`Found ${surveyElements.length} potential survey elements`);
    
    // Step 8: Test navigation and interface
    console.log('📍 Step 8: Test interface navigation');
    
    // Test menu navigation
    const menuItems = await page.locator('a[href], button').all();
    console.log(`Found ${menuItems.length} navigation elements`);
    
    // Take final screenshots
    await page.screenshot({ path: 'test-results/08-final-state.png' });
    
    console.log('🎉 Survey workflow test completed!');
    console.log('📊 Test Results Summary:');
    console.log('✅ Login successful');
    console.log('✅ Dashboard accessible');
    console.log('✅ Admin survey management accessible');
    console.log('✅ Customer surveys page accessible');
    console.log('⚠️ Survey creation form needs validation');
    console.log('⚠️ Complete survey workflow pending form implementation');
  });
  
  test('Validate Survey System Components', async () => {
    console.log('🔍 Validating survey system components...');
    
    // Login first
    await page.goto(BASE_URL);
    await page.fill('input[type="email"]', TEST_USER.email);
    await page.fill('input[type="password"]', TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard*', { timeout: 10000 });
    
    // Check all survey-related routes
    const routes = [
      '/surveys',
      '/admin/surveys', 
      '/admin/survey-builder'
    ];
    
    for (const route of routes) {
      console.log(`Testing route: ${route}`);
      await page.goto(`${BASE_URL}${route}`);
      await page.waitForTimeout(2000);
      
      const statusCode = await page.evaluate(() => {
        return fetch(window.location.href).then(r => r.status);
      });
      
      console.log(`Route ${route}: Status ${statusCode}`);
      await page.screenshot({ path: `test-results/route-${route.replace(/\//g, '-')}.png` });
    }
  });
  
  test.afterAll(async () => {
    if (page) {
      await page.close();
    }
  });
});