import { test, expect } from '@playwright/test';

test.describe('Comprehensive Coupon Diagnosis', () => {
  test('complete analysis of coupon visibility issue', async ({ page }) => {
    let apiCalls: any[] = [];
    
    // Capture all API responses
    page.on('response', async response => {
      if (response.url().includes('/api/')) {
        try {
          const data = await response.json();
          apiCalls.push({
            url: response.url(),
            status: response.status(),
            method: response.request().method(),
            body: data
          });
        } catch (e) {
          apiCalls.push({
            url: response.url(),
            status: response.status(),
            method: response.request().method(),
            body: 'Could not parse JSON'
          });
        }
      }
    });

    console.log('=== STEP 1: LOGIN AS TEST USER ===');
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    await page.waitForURL('http://localhost:3000/dashboard');
    await page.screenshot({ path: 'test-results/diagnosis-01-after-login.png' });

    // Get the logged in user ID
    const loginCall = apiCalls.find(call => call.url.includes('/api/auth/login'));
    const userId = loginCall?.body?.user?.id;
    console.log(`✓ User logged in: ${loginCall?.body?.user?.email} (ID: ${userId})`);

    console.log('\n=== STEP 2: CHECK USER COUPONS PAGE ===');
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/diagnosis-02-coupons-page.png' });

    const couponCards = await page.locator('[data-testid="coupon-card"], .coupon-card, .bg-white.rounded-lg.shadow').count();
    const emptyCouponsText = await page.locator('text="No coupons available", text="You don\'t have any coupons", text="no coupons", text="empty"').count();
    
    console.log(`✓ Coupon cards displayed: ${couponCards}`);
    console.log(`✓ Empty state messages: ${emptyCouponsText}`);

    // Check the API response for user coupons
    const userCouponsCall = apiCalls.find(call => call.url.includes('/my-coupons'));
    if (userCouponsCall) {
      console.log(`✓ User coupons API response:`, JSON.stringify(userCouponsCall.body, null, 2));
    }

    console.log('\n=== STEP 3: CHECK ADMIN COUPON ASSIGNMENTS ===');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/diagnosis-03-admin-coupons.png' });

    // Try to find and click on a "View Assignments" button for any coupon
    const viewAssignmentButtons = page.locator('button:has-text("View Assignments")');
    const buttonCount = await viewAssignmentButtons.count();
    console.log(`✓ Found ${buttonCount} "View Assignments" buttons`);

    if (buttonCount > 0) {
      // Click the first one
      await viewAssignmentButtons.first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'test-results/diagnosis-04-assignments-modal.png' });

      // Look for the user in the assignments table
      const assignmentTable = page.locator('table');
      if (await assignmentTable.isVisible()) {
        const tableRows = await page.locator('table tbody tr').count();
        console.log(`✓ Assignment table has ${tableRows} rows`);

        let userFoundInAssignments = false;
        for (let i = 0; i < tableRows; i++) {
          const row = page.locator('table tbody tr').nth(i);
          const rowText = await row.textContent();
          if (rowText?.includes('winut.hf@gmail.com') || rowText?.includes(userId)) {
            userFoundInAssignments = true;
            console.log(`✓ User found in row ${i + 1}: ${rowText}`);
            break;
          }
        }

        if (!userFoundInAssignments) {
          console.log(`❌ User winut.hf@gmail.com (${userId}) NOT found in assignments table`);
          
          // Log all rows for debugging
          console.log('\nAll assignment rows:');
          for (let i = 0; i < Math.min(tableRows, 10); i++) {
            const row = page.locator('table tbody tr').nth(i);
            const rowText = await row.textContent();
            console.log(`Row ${i + 1}: ${rowText}`);
          }
        }
      }
    }

    console.log('\n=== STEP 4: DIRECT DATABASE CHECK VIA API ===');
    
    // Make direct API calls to check database state
    const apiResults = await page.evaluate(async (testUserId) => {
      const authStorage = localStorage.getItem('auth-storage');
      let token = null;
      
      if (authStorage) {
        try {
          const parsedAuth = JSON.parse(authStorage);
          token = parsedAuth.state?.accessToken;
        } catch (e) {
          console.error('Could not parse auth storage:', e);
        }
      }

      if (!token) {
        return { error: 'No auth token found' };
      }

      const results = [];

      // Test 1: Check user coupons directly
      try {
        const response = await fetch('http://localhost:4000/api/coupons/my-coupons?page=1&limit=100', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        results.push({
          test: 'my-coupons',
          status: response.status,
          success: response.ok,
          data: data
        });
      } catch (error) {
        results.push({
          test: 'my-coupons',
          error: error.message
        });
      }

      // Test 2: Check all active coupons (to see if any exist)
      try {
        const response = await fetch('http://localhost:4000/api/coupons?status=active&limit=100', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        results.push({
          test: 'all-active-coupons',
          status: response.status,
          success: response.ok,
          data: data
        });
      } catch (error) {
        results.push({
          test: 'all-active-coupons',
          error: error.message
        });
      }

      // Test 3: Get user profile to confirm ID
      try {
        const response = await fetch('http://localhost:4000/api/auth/me', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        results.push({
          test: 'user-profile',
          status: response.status,
          success: response.ok,
          data: data
        });
      } catch (error) {
        results.push({
          test: 'user-profile',
          error: error.message
        });
      }

      return { token: token ? 'Present' : 'Missing', results };
    }, userId);

    console.log('\n=== API TEST RESULTS ===');
    console.log(`Token status: ${apiResults.token}`);
    
    if (apiResults.results) {
      apiResults.results.forEach((result: any) => {
        console.log(`\n${result.test.toUpperCase()}:`);
        console.log(`  Status: ${result.status || 'ERROR'}`);
        console.log(`  Success: ${result.success || false}`);
        if (result.data) {
          if (result.test === 'my-coupons') {
            const coupons = result.data.data?.coupons || [];
            console.log(`  User has ${coupons.length} coupons`);
            if (coupons.length > 0) {
              coupons.forEach((coupon: any, idx: number) => {
                console.log(`    ${idx + 1}. ${coupon.title} (Status: ${coupon.status})`);
              });
            }
          } else if (result.test === 'all-active-coupons') {
            const coupons = result.data.data?.coupons || [];
            console.log(`  Total active coupons in system: ${coupons.length}`);
            if (coupons.length > 0) {
              coupons.slice(0, 3).forEach((coupon: any, idx: number) => {
                console.log(`    ${idx + 1}. ${coupon.title} (ID: ${coupon.id})`);
              });
            }
          } else if (result.test === 'user-profile') {
            console.log(`  User ID: ${result.data.user?.userId}`);
            console.log(`  Email: ${result.data.user?.email}`);
          }
        }
        if (result.error) {
          console.log(`  Error: ${result.error}`);
        }
      });
    }

    console.log('\n=== STEP 5: SUMMARY ===');
    console.log(`User: winut.hf@gmail.com (ID: ${userId})`);
    console.log(`Coupons visible on page: ${couponCards}`);
    console.log(`Empty state shown: ${emptyCouponsText > 0 ? 'YES' : 'NO'}`);
    
    const myCouponsResponse = apiResults.results?.find((r: any) => r.test === 'my-coupons');
    if (myCouponsResponse?.data?.data) {
      console.log(`API returns ${myCouponsResponse.data.data.coupons?.length || 0} coupons for user`);
    }
    
    const allCouponsResponse = apiResults.results?.find((r: any) => r.test === 'all-active-coupons');
    if (allCouponsResponse?.data?.data) {
      console.log(`System has ${allCouponsResponse.data.data.coupons?.length || 0} active coupons total`);
    }

    console.log('\n=== DIAGNOSIS ===');
    if (couponCards === 0 && myCouponsResponse?.data?.data?.coupons?.length === 0) {
      console.log('🔍 ISSUE: User genuinely has no coupons assigned');
      console.log('🔧 SOLUTION: Check if coupons need to be assigned to this user in admin panel');
    } else if (couponCards === 0 && myCouponsResponse?.data?.data?.coupons?.length > 0) {
      console.log('🔍 ISSUE: API returns coupons but UI not showing them');
      console.log('🔧 SOLUTION: Frontend rendering issue - check CouponWallet component');
    } else if (couponCards > 0) {
      console.log('✅ RESULT: Coupons are being displayed correctly');
    }

    // Take final screenshots
    await page.screenshot({ path: 'test-results/diagnosis-final-state.png', fullPage: true });
  });
});