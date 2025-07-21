import { test, expect } from '@playwright/test';

test.describe('Create Test Coupon and Assign to User', () => {
  test('create coupon and assign to test user to verify functionality', async ({ page }) => {
    console.log('=== STEP 1: LOGIN AS ADMIN ===');
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    await page.waitForURL('http://localhost:3000/dashboard');

    console.log('=== STEP 2: NAVIGATE TO ADMIN COUPONS ===');
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/create-01-admin-coupons-initial.png' });

    // Check if there are any existing coupons
    const existingCoupons = await page.locator('.coupon-item, .bg-white.rounded-lg.shadow, [data-testid="coupon-item"]').count();
    console.log(`Found ${existingCoupons} existing coupons`);

    console.log('=== STEP 3: CREATE NEW TEST COUPON ===');
    // Look for "Create Coupon" or similar button
    const createButtons = [
      'button:has-text("Create Coupon")',
      'button:has-text("Add Coupon")',
      'button:has-text("New Coupon")',
      '[data-testid="create-coupon"]'
    ];

    let createButton = null;
    for (const selector of createButtons) {
      const button = page.locator(selector);
      if (await button.isVisible()) {
        createButton = button;
        console.log(`Found create button: ${selector}`);
        break;
      }
    }

    if (createButton) {
      await createButton.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'test-results/create-02-create-modal-opened.png' });

      // Fill in coupon details
      console.log('Filling coupon creation form...');
      
      // Try different field selectors
      const titleField = page.locator('input[name="title"], input[placeholder*="title"], #title, #coupon-title');
      if (await titleField.isVisible()) {
        await titleField.fill('Test Coupon for Diagnosis');
      }

      const descField = page.locator('textarea[name="description"], textarea[placeholder*="description"], #description');
      if (await descField.isVisible()) {
        await descField.fill('Test coupon created for troubleshooting user visibility issue');
      }

      // Select coupon type
      const typeDropdown = page.locator('select[name="type"], #type, [data-testid="coupon-type"]');
      if (await typeDropdown.isVisible()) {
        await typeDropdown.selectOption('percentage');
      }

      // Set value
      const valueField = page.locator('input[name="value"], #value, [data-testid="coupon-value"]');
      if (await valueField.isVisible()) {
        await valueField.fill('10');
      }

      // Set expiry date (30 days from now)
      const expiryField = page.locator('input[name="expiresAt"], input[type="date"], #expires-at');
      if (await expiryField.isVisible()) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 30);
        const dateString = futureDate.toISOString().split('T')[0];
        await expiryField.fill(dateString);
      }

      await page.screenshot({ path: 'test-results/create-03-form-filled.png' });

      // Submit the form
      const submitButtons = [
        'button[type="submit"]',
        'button:has-text("Create")',
        'button:has-text("Save")',
        '[data-testid="submit-coupon"]'
      ];

      let submitButton = null;
      for (const selector of submitButtons) {
        const button = page.locator(selector);
        if (await button.isVisible()) {
          submitButton = button;
          console.log(`Found submit button: ${selector}`);
          break;
        }
      }

      if (submitButton) {
        await submitButton.click();
        await page.waitForTimeout(2000);
        console.log('Coupon creation form submitted');
      }
    } else {
      console.log('No create coupon button found - might need to create coupon via API');
      
      // Create coupon directly via API
      const apiResult = await page.evaluate(async () => {
        const authStorage = localStorage.getItem('auth-storage');
        let token = null;
        
        if (authStorage) {
          try {
            const parsedAuth = JSON.parse(authStorage);
            token = parsedAuth.state?.accessToken;
          } catch (e) {
            return { error: 'Could not parse auth storage' };
          }
        }

        if (!token) {
          return { error: 'No auth token found' };
        }

        try {
          const response = await fetch('http://localhost:4000/api/coupons', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              title: 'Test Coupon for Diagnosis',
              description: 'Test coupon created for troubleshooting user visibility issue',
              type: 'percentage',
              value: 10,
              status: 'active',
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              usageLimit: 100
            })
          });
          
          const data = await response.json();
          return {
            status: response.status,
            success: response.ok,
            data: data
          };
        } catch (error) {
          return {
            error: error.message
          };
        }
      });

      console.log('API coupon creation result:', JSON.stringify(apiResult, null, 2));
    }

    await page.screenshot({ path: 'test-results/create-04-after-creation.png' });

    console.log('=== STEP 4: REFRESH AND FIND CREATED COUPON ===');
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    const newCouponCount = await page.locator('.coupon-item, .bg-white.rounded-lg.shadow, [data-testid="coupon-item"]').count();
    console.log(`After creation: Found ${newCouponCount} coupons (was ${existingCoupons})`);

    console.log('=== STEP 5: ASSIGN COUPON TO TEST USER ===');
    // Look for "View Assignments" button or similar
    const assignButtons = [
      'button:has-text("View Assignments")',
      'button:has-text("Assign")',
      'button:has-text("Manage")',
      '[data-testid="assign-coupon"]'
    ];

    let assignButton = null;
    for (const selector of assignButtons) {
      const button = page.locator(selector).first();
      if (await button.isVisible()) {
        assignButton = button;
        console.log(`Found assign button: ${selector}`);
        break;
      }
    }

    if (assignButton) {
      await assignButton.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'test-results/create-05-assignment-modal.png' });

      // Look for user selection or assignment functionality
      // This will vary based on the UI implementation
      const userSearchField = page.locator('input[placeholder*="search"], input[name="userSearch"], #user-search');
      if (await userSearchField.isVisible()) {
        await userSearchField.fill('winut.hf@gmail.com');
        await page.waitForTimeout(500);
      }

      // Look for checkboxes or select buttons for the user
      const userCheckbox = page.locator('input[type="checkbox"]').first();
      if (await userCheckbox.isVisible()) {
        await userCheckbox.check();
      }

      // Submit assignment
      const assignSubmitButtons = [
        'button:has-text("Assign")',
        'button:has-text("Save")',
        'button[type="submit"]'
      ];

      for (const selector of assignSubmitButtons) {
        const button = page.locator(selector);
        if (await button.isVisible()) {
          await button.click();
          console.log(`Clicked assignment submit: ${selector}`);
          await page.waitForTimeout(2000);
          break;
        }
      }
    } else {
      console.log('No assignment button found - trying direct API assignment');
      
      // Assign coupon directly via API
      const assignResult = await page.evaluate(async () => {
        const authStorage = localStorage.getItem('auth-storage');
        let token = null;
        
        if (authStorage) {
          try {
            const parsedAuth = JSON.parse(authStorage);
            token = parsedAuth.state?.accessToken;
          } catch (e) {
            return { error: 'Could not parse auth storage' };
          }
        }

        if (!token) {
          return { error: 'No auth token found' };
        }

        try {
          // First, get available coupons
          const couponsResponse = await fetch('http://localhost:4000/api/coupons?status=active&limit=10', {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          
          const couponsData = await couponsResponse.json();
          const coupons = couponsData.data?.coupons || [];
          
          if (coupons.length === 0) {
            return { error: 'No active coupons found to assign' };
          }

          // Assign the first coupon to the test user
          const couponId = coupons[0].id;
          const response = await fetch('http://localhost:4000/api/coupons/assign', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              couponId: couponId,
              userIds: ['59d2f833-a118-4a43-a1d1-73a7f5119ddf'], // Test user ID
              assignedReason: 'Testing coupon visibility'
            })
          });
          
          const data = await response.json();
          return {
            couponId: couponId,
            status: response.status,
            success: response.ok,
            data: data
          };
        } catch (error) {
          return {
            error: error.message
          };
        }
      });

      console.log('API coupon assignment result:', JSON.stringify(assignResult, null, 2));
    }

    await page.screenshot({ path: 'test-results/create-06-after-assignment.png' });

    console.log('=== STEP 6: VERIFY USER CAN SEE COUPON ===');
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/create-07-user-coupons-after-assignment.png' });

    const finalCouponCards = await page.locator('[data-testid="coupon-card"], .coupon-card').count();
    console.log(`User coupons page now shows ${finalCouponCards} coupon cards`);

    // Check API response
    const finalApiCheck = await page.evaluate(async () => {
      const authStorage = localStorage.getItem('auth-storage');
      let token = null;
      
      if (authStorage) {
        try {
          const parsedAuth = JSON.parse(authStorage);
          token = parsedAuth.state?.accessToken;
        } catch (e) {
          return { error: 'Could not parse auth storage' };
        }
      }

      if (!token) {
        return { error: 'No auth token found' };
      }

      try {
        const response = await fetch('http://localhost:4000/api/coupons/my-coupons?page=1&limit=20', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        const data = await response.json();
        return {
          status: response.status,
          success: response.ok,
          data: data
        };
      } catch (error) {
        return {
          error: error.message
        };
      }
    });

    console.log('Final API check for user coupons:', JSON.stringify(finalApiCheck, null, 2));

    console.log('=== SUMMARY ===');
    console.log(`Created and assigned coupon to test user`);
    console.log(`User coupons page shows ${finalCouponCards} coupon cards`);
    
    if (finalApiCheck.data?.data?.coupons) {
      console.log(`API returns ${finalApiCheck.data.data.coupons.length} coupons for user`);
    }
  });
});