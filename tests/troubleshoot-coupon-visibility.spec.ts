import { test, expect } from '@playwright/test';

test.describe('Coupon Visibility Troubleshooting', () => {
  test('troubleshoot user coupon visibility issue', async ({ page }) => {
    const screenshots: string[] = [];
    let apiCalls: any[] = [];
    let consoleErrors: any[] = [];
    let networkErrors: any[] = [];

    // Capture console messages
    page.on('console', msg => {
      const logData = {
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString()
      };
      console.log(`Console ${msg.type()}: ${msg.text()}`);
      if (msg.type() === 'error') {
        consoleErrors.push(logData);
      }
    });

    // Capture network requests and responses
    page.on('request', request => {
      if (request.url().includes('/api/')) {
        console.log(`API Request: ${request.method()} ${request.url()}`);
      }
    });

    page.on('response', async response => {
      if (response.url().includes('/api/')) {
        const responseData = {
          url: response.url(),
          status: response.status(),
          statusText: response.statusText(),
          method: response.request().method(),
          timestamp: new Date().toISOString()
        };

        try {
          const contentType = response.headers()['content-type'];
          if (contentType && contentType.includes('application/json')) {
            responseData['body'] = await response.json();
          }
        } catch (e) {
          responseData['body'] = 'Could not parse JSON';
        }

        apiCalls.push(responseData);
        console.log(`API Response: ${response.status()} ${response.url()}`);
        
        if (!response.ok()) {
          networkErrors.push(responseData);
        }
      }
    });

    // Step 1: Navigate to login page
    console.log('Step 1: Navigating to login page...');
    await page.goto('http://localhost:3000/login');
    await page.screenshot({ path: 'test-results/troubleshoot-01-login-page.png' });
    screenshots.push('01-login-page.png');

    // Step 2: Login as the test user
    console.log('Step 2: Logging in as winut.hf@gmail.com...');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    
    // Wait for login API call
    const loginPromise = page.waitForResponse(response => 
      response.url().includes('/api/auth/login') && response.status() === 200
    );
    
    await page.click('button[type="submit"]');
    
    try {
      const loginResponse = await loginPromise;
      const loginData = await loginResponse.json();
      console.log('Login successful:', JSON.stringify(loginData, null, 2));
      
      // Extract user ID for comparison
      const userId = loginData.user?.id;
      console.log(`Logged in user ID: ${userId}`);
      
    } catch (error) {
      console.error('Login failed:', error);
      await page.screenshot({ path: 'test-results/troubleshoot-02-login-failed.png' });
      screenshots.push('02-login-failed.png');
    }

    // Wait for redirect and take screenshot
    await page.waitForURL('http://localhost:3000/dashboard');
    await page.screenshot({ path: 'test-results/troubleshoot-03-after-login.png' });
    screenshots.push('03-after-login.png');

    // Step 3: Navigate to coupons page
    console.log('Step 3: Navigating to /coupons page...');
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle');
    
    // Wait for potential coupon API calls
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: 'test-results/troubleshoot-04-coupons-page.png' });
    screenshots.push('04-coupons-page.png');

    // Step 4: Check what's displayed on the page
    console.log('Step 4: Analyzing what\'s displayed on coupons page...');
    const pageContent = await page.content();
    const couponCards = await page.locator('.coupon-card, [data-testid*="coupon"], .bg-white.rounded-lg.shadow').count();
    const emptyState = await page.locator('text="No coupons available", text="You don\'t have any coupons"').count();
    
    console.log(`Coupon cards found: ${couponCards}`);
    console.log(`Empty state messages: ${emptyState}`);

    // Check for loading states
    const loadingElements = await page.locator('[data-testid="loading"], .loading, .spinner').count();
    console.log(`Loading elements: ${loadingElements}`);

    // Step 5: Open dev tools and check network tab (simulate by examining our captured data)
    console.log('Step 5: Analyzing API calls made to fetch coupons...');
    
    const couponApiCalls = apiCalls.filter(call => 
      call.url.includes('/coupons') || 
      call.url.includes('/user-coupons') ||
      call.url.includes('/my-coupons')
    );
    
    console.log(`Coupon-related API calls: ${couponApiCalls.length}`);
    couponApiCalls.forEach((call, index) => {
      console.log(`Coupon API Call ${index + 1}:`);
      console.log(`  URL: ${call.url}`);
      console.log(`  Method: ${call.method}`);
      console.log(`  Status: ${call.status}`);
      console.log(`  Response: ${JSON.stringify(call.body, null, 2)}`);
    });

    // Step 6: Force a manual API call to check user coupons
    console.log('Step 6: Making direct API call to check user coupons...');
    try {
      const directApiResponse = await page.evaluate(async () => {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/coupons/user-coupons', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        return {
          status: response.status,
          data: data
        };
      });
      
      console.log('Direct API call result:');
      console.log(JSON.stringify(directApiResponse, null, 2));
      
    } catch (error) {
      console.error('Direct API call failed:', error);
    }

    // Step 7: Check admin assignment by navigating to admin page
    console.log('Step 7: Checking admin assignments...');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForLoadState('networkidle');
    
    await page.screenshot({ path: 'test-results/troubleshoot-05-admin-coupons.png' });
    screenshots.push('05-admin-coupons.png');
    
    // Try to open assignments modal
    try {
      const viewAssignmentsButton = page.locator('button:has-text("View Assignments")').first();
      if (await viewAssignmentsButton.isVisible()) {
        await viewAssignmentsButton.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'test-results/troubleshoot-06-assignments-modal.png' });
        screenshots.push('06-assignments-modal.png');
        
        // Check if the user appears in assignments
        const userInAssignments = await page.locator('text=winut.hf@gmail.com, td:has-text("winut.hf@gmail.com")').count();
        console.log(`User found in assignments table: ${userInAssignments > 0 ? 'YES' : 'NO'}`);
        
        // Get assignment table content
        const assignmentRows = await page.locator('table tbody tr').count();
        console.log(`Total assignment rows: ${assignmentRows}`);
        
        if (assignmentRows > 0) {
          for (let i = 0; i < Math.min(assignmentRows, 10); i++) {
            const row = page.locator('table tbody tr').nth(i);
            const rowText = await row.textContent();
            console.log(`Assignment row ${i + 1}: ${rowText}`);
          }
        }
      }
    } catch (error) {
      console.error('Could not access assignments:', error);
    }

    // Step 8: Generate comprehensive report
    console.log('\n=== TROUBLESHOOTING REPORT ===');
    console.log('Screenshots taken:', screenshots.length);
    console.log('API calls captured:', apiCalls.length);
    console.log('Console errors:', consoleErrors.length);
    console.log('Network errors:', networkErrors.length);
    
    console.log('\n=== CONSOLE ERRORS ===');
    consoleErrors.forEach((error, index) => {
      console.log(`${index + 1}. [${error.timestamp}] ${error.type}: ${error.text}`);
    });
    
    console.log('\n=== NETWORK ERRORS ===');
    networkErrors.forEach((error, index) => {
      console.log(`${index + 1}. ${error.method} ${error.url} - ${error.status} ${error.statusText}`);
      console.log(`   Response: ${JSON.stringify(error.body, null, 2)}`);
    });
    
    console.log('\n=== ALL API CALLS ===');
    apiCalls.forEach((call, index) => {
      console.log(`${index + 1}. ${call.method} ${call.url} - ${call.status}`);
      if (call.body && typeof call.body === 'object' && Object.keys(call.body).length > 0) {
        console.log(`   Response: ${JSON.stringify(call.body, null, 2)}`);
      }
    });

    // Final screenshot
    await page.screenshot({ path: 'test-results/troubleshoot-final-state.png' });
  });
});