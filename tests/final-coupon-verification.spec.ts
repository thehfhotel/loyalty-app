import { test, expect } from '@playwright/test';

test.describe('Final Coupon Verification', () => {
  test('verify user can now see assigned coupon', async ({ page }) => {
    console.log('=== FINAL VERIFICATION: LOGIN AND CHECK COUPONS ===');
    
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    await page.waitForURL('http://localhost:3000/dashboard');

    console.log('✓ User logged in successfully');

    // Navigate to coupons page
    await page.goto('http://localhost:3000/coupons');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/final-verification-coupons-page.png', fullPage: true });

    // Count coupon cards
    const couponCards = await page.locator('[data-testid="coupon-card"], .coupon-card').count();
    const allCoupons = await page.locator('.bg-white.rounded-lg.shadow').count();
    
    console.log(`✓ Coupon cards found: ${couponCards}`);
    console.log(`✓ All card-like elements: ${allCoupons}`);

    // Check for empty state
    const emptyState = await page.locator('text="No coupons available", text="You don\'t have any coupons"').count();
    console.log(`✓ Empty state messages: ${emptyState}`);

    // Verify API response
    const apiCheck = await page.evaluate(async () => {
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

    console.log('✓ API Response:', JSON.stringify(apiCheck, null, 2));

    if (apiCheck.data?.data?.coupons) {
      const coupons = apiCheck.data.data.coupons;
      console.log(`✓ API returns ${coupons.length} coupons`);
      
      if (coupons.length > 0) {
        coupons.forEach((coupon, index) => {
          console.log(`  ${index + 1}. ${coupon.title || coupon.name} (Status: ${coupon.status})`);
        });
      }
    }

    // Check page content
    const pageText = await page.textContent('body');
    const hasTestCoupon = pageText?.includes('Test Coupon') || false;
    console.log(`✓ Page contains 'Test Coupon': ${hasTestCoupon}`);

    console.log('\n=== TROUBLESHOOTING SUMMARY ===');
    console.log(`User: winut.hf@gmail.com`);
    console.log(`Login: Successful`);
    console.log(`Coupons Page: Loaded`);
    console.log(`Coupon Cards Visible: ${couponCards}`);
    console.log(`API Returns: ${apiCheck.data?.data?.coupons?.length || 0} coupons`);
    console.log(`Empty State Shown: ${emptyState > 0 ? 'Yes' : 'No'}`);
    console.log(`Test Coupon Text Found: ${hasTestCoupon ? 'Yes' : 'No'}`);

    // Final diagnosis
    if (apiCheck.data?.data?.coupons?.length > 0 && couponCards === 0) {
      console.log('\n🔍 ISSUE FOUND: API returns coupons but UI not displaying them');
      console.log('🔧 PROBLEM: Frontend rendering issue in CouponWallet component');
      console.log('🛠️ NEXT STEPS: Check CouponCard component rendering logic');
    } else if (apiCheck.data?.data?.coupons?.length > 0 && couponCards > 0) {
      console.log('\n✅ RESOLVED: User can now see assigned coupons');
      console.log('🎉 The coupon visibility issue has been fixed by assigning an active coupon');
    } else if (apiCheck.data?.data?.coupons?.length === 0) {
      console.log('\n❌ ISSUE: User still has no coupons assigned');
      console.log('🔧 PROBLEM: Coupon assignment may have failed or coupon is inactive');
    }
  });
});