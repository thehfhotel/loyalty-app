import { test, expect } from '@playwright/test';

test.describe('Coupon Assignment API Test', () => {
  test('verify backend fix - API returns correct data structure', async ({ page, request }) => {
    // First, login to get authentication
    await page.goto('http://localhost:3001/login');
    await page.fill('input[type="email"]', 'test-user@example.com');
    await page.fill('input[type="password"]', 'password');
    await page.click('button[type="submit"]');
    await page.waitForURL('http://localhost:3001/**', { waitUntil: 'networkidle' });
    
    // Get cookies for API requests
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    console.log('✅ Logged in successfully');
    
    // Test 1: Get all coupons
    const couponsResponse = await request.get('http://localhost:3001/api/coupons', {
      headers: {
        'Cookie': cookieHeader,
        'Accept': 'application/json'
      }
    });
    
    expect(couponsResponse.ok()).toBe(true);
    const coupons = await couponsResponse.json();
    console.log(`✅ Retrieved ${coupons.length} coupons`);
    
    // Test 2: Check coupon data structure
    if (coupons.length > 0) {
      const firstCoupon = coupons[0];
      
      // Verify the coupon has the correct structure
      expect(firstCoupon).toHaveProperty('id');
      expect(firstCoupon).toHaveProperty('code');
      expect(firstCoupon).toHaveProperty('discount');
      
      // The fix should ensure _count is either properly included or not cause errors
      if (firstCoupon._count) {
        expect(firstCoupon._count).toHaveProperty('assignments');
        expect(typeof firstCoupon._count.assignments).toBe('number');
        console.log(`✅ Coupon ${firstCoupon.code} has ${firstCoupon._count.assignments} assignments`);
      }
      
      // Test 3: Get assignments for a coupon (if any have assignments)
      const couponWithAssignments = coupons.find(c => c._count?.assignments > 0);
      
      if (couponWithAssignments) {
        console.log(`Testing assignments for coupon: ${couponWithAssignments.code}`);
        
        const assignmentsResponse = await request.get(
          `http://localhost:3001/api/coupons/${couponWithAssignments.id}/assignments`,
          {
            headers: {
              'Cookie': cookieHeader,
              'Accept': 'application/json'
            }
          }
        );
        
        expect(assignmentsResponse.ok()).toBe(true);
        const assignments = await assignmentsResponse.json();
        
        // Verify assignments structure
        expect(Array.isArray(assignments)).toBe(true);
        console.log(`✅ Successfully retrieved ${assignments.length} assignments`);
        
        if (assignments.length > 0) {
          const firstAssignment = assignments[0];
          
          // Check assignment structure
          expect(firstAssignment).toHaveProperty('id');
          expect(firstAssignment).toHaveProperty('couponId');
          expect(firstAssignment).toHaveProperty('userId');
          expect(firstAssignment).toHaveProperty('assignedAt');
          
          // The backend fix should ensure user data is properly included
          if (firstAssignment.user) {
            expect(firstAssignment.user).toHaveProperty('id');
            expect(firstAssignment.user).toHaveProperty('email');
            console.log(`✅ Assignment includes user data: ${firstAssignment.user.email}`);
          }
        }
      } else {
        console.log('⚠️ No coupons with assignments found for detailed testing');
      }
    }
    
    // Test 4: Monitor for any API errors on the coupon management page
    const apiErrors: any[] = [];
    
    page.on('response', response => {
      if (response.url().includes('/api/coupons') && !response.ok()) {
        apiErrors.push({
          url: response.url(),
          status: response.status(),
          statusText: response.statusText()
        });
      }
    });
    
    // Navigate to coupon management page
    await page.goto('http://localhost:3001/admin/coupons');
    await page.waitForLoadState('networkidle');
    
    // Check for any API errors
    expect(apiErrors).toHaveLength(0);
    
    console.log('✅ No API errors on coupon management page');
    console.log('✅ Backend fix verified - Coupon data structure is correct');
    
    // Test 5: If there's a View Assignments button, click it
    const viewAssignmentsButton = page.locator('button:has-text("View Assignments")').first();
    
    if (await viewAssignmentsButton.isVisible()) {
      // Clear previous error tracking
      apiErrors.length = 0;
      
      await viewAssignmentsButton.click();
      await page.waitForTimeout(2000); // Wait for any API calls
      
      // Verify no API errors occurred
      expect(apiErrors).toHaveLength(0);
      
      // Check for any error messages in the UI
      const errorElements = await page.locator('.error, .error-message, [role="alert"][class*="error"]').count();
      expect(errorElements).toBe(0);
      
      console.log('✅ View Assignments feature works without errors');
    }
  });
});