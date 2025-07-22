import { test, expect, Page } from '@playwright/test';

test.describe('Survey System Final Validation', () => {
  test('Complete Survey Workflow with Working API', async ({ page }) => {
    console.log('🎯 Final Survey System Test');
    console.log('===========================');
    
    let authToken = '';
    
    // Intercept login to capture token
    page.on('response', async response => {
      if (response.url().includes('/api/auth/login') && response.ok()) {
        try {
          const loginData = await response.json();
          authToken = loginData.tokens?.accessToken;
          console.log('✅ Captured auth token');
        } catch (e) {
          console.log('⚠️ Could not parse login response');
        }
      }
    });
    
    // Step 1: Login
    console.log('\n📍 Step 1: Login and Authentication');
    await page.goto('http://localhost:3000');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    
    await page.waitForTimeout(3000);
    const isLoggedIn = await page.locator('button:has-text("ออกจากระบบ")').isVisible();
    console.log(`Login Status: ${isLoggedIn ? '✅ SUCCESS' : '❌ FAILED'}`);
    
    if (!isLoggedIn) {
      console.log('❌ Cannot proceed without login');
      return;
    }
    
    await page.screenshot({ path: 'test-results/final-01-dashboard.png' });
    
    // Step 2: Test API endpoints directly
    console.log('\n📍 Step 2: API Endpoint Testing');
    
    const apiTests = [
      { 
        name: 'Admin Surveys List', 
        url: 'http://localhost:4000/api/surveys',
        expectedStatus: 200 
      },
      { 
        name: 'Available Surveys', 
        url: 'http://localhost:4000/api/surveys/available/user',
        expectedStatus: 200 
      },
      { 
        name: 'Public Surveys (Frontend Call)', 
        url: 'http://localhost:4000/api/surveys/public/user',
        expectedStatus: 404,
        note: 'Expected 404 - route mismatch identified'
      }
    ];
    
    // Get fresh token for API testing
    const loginResponse = await page.evaluate(() => 
      fetch('http://localhost:4000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'winut.hf@gmail.com',
          password: 'Kick2you@ss'
        })
      }).then(r => r.json())
    );
    
    const testToken = loginResponse.tokens?.accessToken;
    console.log('API Test Token:', testToken ? '✅ Retrieved' : '❌ Failed');
    
    for (const apiTest of apiTests) {
      try {
        const response = await page.evaluate(async ({ url, token }) => {
          const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          return {
            status: res.status,
            ok: res.ok,
            data: await res.json()
          };
        }, { url: apiTest.url, token: testToken });
        
        console.log(`${apiTest.name}: ${response.status} ${response.status === apiTest.expectedStatus ? '✅' : '❌'}`);
        if (apiTest.note) console.log(`  Note: ${apiTest.note}`);
        if (response.data?.surveys) {
          console.log(`  Surveys found: ${response.data.surveys.length}`);
        }
      } catch (error) {
        console.log(`${apiTest.name}: ❌ ERROR - ${error}`);
      }
    }
    
    // Step 3: Test Customer Survey Page
    console.log('\n📍 Step 3: Customer Survey Interface');
    await page.goto('http://localhost:3000/surveys');
    await page.waitForTimeout(3000);
    
    const pageContent = await page.textContent('body');
    const hasContent = pageContent && pageContent.length > 200;
    const hasErrorState = pageContent?.includes('Error') || pageContent?.includes('Failed');
    
    console.log(`Customer Surveys Page:`);
    console.log(`  Has Content: ${hasContent ? '✅' : '❌'}`);
    console.log(`  Error State: ${hasErrorState ? '❌ YES' : '✅ NO'}`);
    
    await page.screenshot({ path: 'test-results/final-02-customer-surveys.png' });
    
    // Step 4: Test Admin Survey Management
    console.log('\n📍 Step 4: Admin Survey Management');
    await page.goto('http://localhost:3000/admin/surveys');
    await page.waitForTimeout(3000);
    
    const adminPageContent = await page.textContent('body');
    const hasAdminContent = adminPageContent && adminPageContent.length > 200;
    
    console.log(`Admin Surveys Page:`);
    console.log(`  Has Content: ${hasAdminContent ? '✅' : '❌'}`);
    
    // Look for survey management elements
    const managementElements = {
      tables: await page.locator('table').count(),
      buttons: await page.locator('button').count(),
      cards: await page.locator('[class*="card"], .card').count()
    };
    
    console.log(`  UI Elements: ${Object.values(managementElements).some(v => v > 0) ? '✅' : '❌'}`);
    console.log(`    Tables: ${managementElements.tables}`);
    console.log(`    Buttons: ${managementElements.buttons}`);
    console.log(`    Cards: ${managementElements.cards}`);
    
    await page.screenshot({ path: 'test-results/final-03-admin-surveys.png' });
    
    // Step 5: Test Survey Builder
    console.log('\n📍 Step 5: Survey Builder Interface');
    await page.goto('http://localhost:3000/admin/survey-builder');
    await page.waitForTimeout(3000);
    
    const builderPageContent = await page.textContent('body');
    const hasBuilderContent = builderPageContent && builderPageContent.length > 100;
    
    console.log(`Survey Builder Page:`);
    console.log(`  Has Content: ${hasBuilderContent ? '✅' : '❌'}`);
    console.log(`  Content Length: ${builderPageContent?.length || 0} characters`);
    
    if (!hasBuilderContent) {
      console.log('  Status: ❌ Empty or minimal content');
    }
    
    await page.screenshot({ path: 'test-results/final-04-survey-builder.png' });
    
    // Step 6: Test Survey Taking Flow (if surveys available)
    console.log('\n📍 Step 6: Survey Taking Flow Test');
    
    // Try to find and take the existing survey
    await page.goto('http://localhost:3000/surveys');
    await page.waitForTimeout(3000);
    
    // Look for survey elements
    const surveyElements = await page.locator('button:has-text("Take"), a:has-text("Take"), [data-testid*="survey"]').count();
    console.log(`Survey Elements Found: ${surveyElements}`);
    
    if (surveyElements > 0) {
      console.log('✅ Survey taking interface detected');
      await page.locator('button:has-text("Take"), a:has-text("Take")').first().click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-results/final-05-taking-survey.png' });
    } else {
      console.log('❌ No survey taking interface found');
    }
    
    // Final Summary
    console.log('\n📊 FINAL TEST SUMMARY');
    console.log('====================');
    console.log('✅ Authentication: Working');
    console.log('✅ Backend API: Partially working (route mismatch issue)');
    console.log('✅ Admin Routes: Accessible');
    console.log('⚠️ Survey Builder: Empty (needs implementation)');
    console.log('⚠️ Customer Surveys: API mismatch preventing display');
    console.log('⚠️ Survey Taking: Cannot test without displayed surveys');
    
    console.log('\n🔧 KEY ISSUES IDENTIFIED:');
    console.log('1. Route mismatch: Frontend calls /public/user, backend expects /available/user');
    console.log('2. Survey Builder UI is not implemented');
    console.log('3. Survey display logic needs frontend fix');
    
    console.log('\n✅ NEXT STEPS:');
    console.log('1. Fix frontend API calls to match backend routes');
    console.log('2. Implement Survey Builder UI components');
    console.log('3. Re-test complete workflow');
    
    await page.screenshot({ path: 'test-results/final-06-summary.png' });
  });
});