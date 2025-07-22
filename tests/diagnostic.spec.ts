import { test, expect, Page } from '@playwright/test';

test.describe('Survey System Diagnostic', () => {
  test('Check Survey System Status', async ({ page }) => {
    console.log('🔍 Diagnostic: Survey System Status Check');
    
    // Monitor network requests
    const requests: any[] = [];
    const responses: any[] = [];
    
    page.on('request', request => {
      if (request.url().includes('api/')) {
        requests.push({ url: request.url(), method: request.method() });
      }
    });
    
    page.on('response', response => {
      if (response.url().includes('api/')) {
        responses.push({ 
          url: response.url(), 
          status: response.status(),
          ok: response.ok() 
        });
      }
    });
    
    // Step 1: Check if app loads
    console.log('📍 Step 1: Load application');
    await page.goto('http://localhost:3000');
    await page.screenshot({ path: 'test-results/diagnostic-01-home.png' });
    
    // Step 2: Login
    console.log('📍 Step 2: Attempt login');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    
    // Wait and see what happens
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'test-results/diagnostic-02-after-login.png' });
    
    console.log('📍 Current URL:', page.url());
    
    // Step 3: Check if we're logged in by looking for logout button
    const logoutButton = page.locator('button:has-text("ออกจากระบบ")');
    const isLoggedIn = await logoutButton.isVisible();
    console.log('🔐 Login status:', isLoggedIn ? 'SUCCESS' : 'FAILED');
    
    if (isLoggedIn) {
      // Step 4: Test survey routes directly
      console.log('📍 Step 4: Test survey routes');
      
      const routes = [
        { path: '/surveys', name: 'Customer Surveys' },
        { path: '/admin/surveys', name: 'Admin Survey Management' },
        { path: '/admin/survey-builder', name: 'Survey Builder' }
      ];
      
      for (const route of routes) {
        console.log(`Testing ${route.name}: ${route.path}`);
        await page.goto(`http://localhost:3000${route.path}`);
        await page.waitForTimeout(3000);
        
        const currentUrl = page.url();
        const pageContent = await page.textContent('body');
        
        console.log(`  URL: ${currentUrl}`);
        console.log(`  Content includes "${route.name.toLowerCase()}": ${pageContent?.toLowerCase().includes(route.name.toLowerCase().split(' ')[0])}`);
        
        await page.screenshot({ path: `test-results/diagnostic-route-${route.path.replace(/\//g, '-')}.png` });
      }
    }
    
    // Step 5: Report API calls
    console.log('📍 Step 5: API Calls Summary');
    console.log('Requests:', requests);
    console.log('Responses:', responses);
    
    // Find failed API calls
    const failedCalls = responses.filter(r => !r.ok);
    console.log('❌ Failed API calls:', failedCalls);
    
    // Step 6: Check for survey-related elements
    console.log('📍 Step 6: Check survey implementation');
    await page.goto('http://localhost:3000/surveys');
    await page.waitForTimeout(3000);
    
    const surveyElements = {
      surveyList: await page.locator('[data-testid*="survey"], .survey, [class*="survey"]').count(),
      createButton: await page.locator('button:has-text("Create"), button:has-text("สร้าง"), [data-testid="create-survey"]').count(),
      errorMessages: await page.locator('.error, [class*="error"], .alert-error').count(),
      loadingIndicators: await page.locator('.loading, [class*="loading"], .spinner').count()
    };
    
    console.log('📊 Survey UI Elements:', surveyElements);
    
    await page.screenshot({ path: 'test-results/diagnostic-final.png' });
    
    console.log('✅ Diagnostic complete!');
  });
});