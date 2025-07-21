import { test, expect } from '@playwright/test';

test.describe('Coupon API Issue Debugging', () => {
  test('debug API endpoint mismatch issue', async ({ page }) => {
    let apiCalls: any[] = [];

    // Capture network requests and responses
    page.on('request', request => {
      console.log(`REQUEST: ${request.method()} ${request.url()}`);
      apiCalls.push({
        type: 'request',
        method: request.method(),
        url: request.url(),
        timestamp: new Date().toISOString()
      });
    });

    page.on('response', async response => {
      console.log(`RESPONSE: ${response.status()} ${response.url()}`);
      
      let responseBody = null;
      try {
        const contentType = response.headers()['content-type'];
        if (contentType && contentType.includes('application/json')) {
          responseBody = await response.json();
        } else {
          responseBody = await response.text();
        }
      } catch (e) {
        responseBody = `Error parsing: ${e.message}`;
      }

      apiCalls.push({
        type: 'response',
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        body: responseBody,
        timestamp: new Date().toISOString()
      });
    });

    // Login
    console.log('Logging in...');
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    await page.waitForURL('http://localhost:3000/dashboard');

    // Navigate to coupons
    console.log('Going to coupons page...');
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle');
    
    // Check the problematic API call
    console.log('Making direct coupon API calls...');
    
    // Try the different API endpoints to see which ones work
    const apiResults = await page.evaluate(async () => {
      const token = localStorage.getItem('token');
      const results = [];
      
      // Test different endpoints
      const endpoints = [
        '/api/coupons/user-coupons',
        '/api/coupons/my-coupons',
        'http://localhost:4000/api/coupons/user-coupons',
        'http://localhost:4000/api/coupons/my-coupons'
      ];
      
      for (const endpoint of endpoints) {
        try {
          console.log(`Testing endpoint: ${endpoint}`);
          const response = await fetch(endpoint, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          const data = await response.json();
          results.push({
            endpoint,
            status: response.status,
            success: response.ok,
            data: data
          });
        } catch (error) {
          results.push({
            endpoint,
            status: 'ERROR',
            success: false,
            error: error.message
          });
        }
      }
      
      return results;
    });

    console.log('\n=== API ENDPOINT TEST RESULTS ===');
    apiResults.forEach((result, index) => {
      console.log(`\n${index + 1}. Endpoint: ${result.endpoint}`);
      console.log(`   Status: ${result.status}`);
      console.log(`   Success: ${result.success}`);
      if (result.data) {
        console.log(`   Response: ${JSON.stringify(result.data, null, 2)}`);
      }
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });

    // Check the frontend coupon service configuration
    const couponServiceCode = await page.evaluate(() => {
      // Try to examine the coupon service configuration
      return window.location.origin;
    });

    console.log(`\nFrontend origin: ${couponServiceCode}`);

    // Also check what's in localStorage
    const storageInfo = await page.evaluate(() => {
      const token = localStorage.getItem('token');
      const user = localStorage.getItem('user');
      return {
        hasToken: !!token,
        tokenLength: token ? token.length : 0,
        user: user ? JSON.parse(user) : null
      };
    });

    console.log('\n=== STORAGE INFO ===');
    console.log(JSON.stringify(storageInfo, null, 2));

    // Take screenshot showing the current state
    await page.screenshot({ 
      path: 'test-results/debug-api-issue.png',
      fullPage: true
    });

    console.log('\n=== CAPTURED API CALLS ===');
    const couponApiCalls = apiCalls.filter(call => 
      call.url && (call.url.includes('/coupons') || call.url.includes('user-coupons') || call.url.includes('my-coupons'))
    );
    
    couponApiCalls.forEach((call, index) => {
      console.log(`\n${index + 1}. ${call.type.toUpperCase()}: ${call.method || ''} ${call.url}`);
      if (call.status) {
        console.log(`   Status: ${call.status} ${call.statusText || ''}`);
      }
      if (call.body && typeof call.body === 'object') {
        console.log(`   Body: ${JSON.stringify(call.body, null, 2)}`);
      } else if (call.body) {
        console.log(`   Body: ${call.body}`);
      }
    });
  });
});