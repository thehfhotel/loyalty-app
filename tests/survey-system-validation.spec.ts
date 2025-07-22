import { test, expect, Page } from '@playwright/test';

test.describe('Survey System Validation Report', () => {
  test('Survey System Current State Assessment', async ({ page }) => {
    console.log('🎯 Survey System Validation Report');
    console.log('=====================================');
    
    const results = {
      login: false,
      routes: {} as any,
      apiEndpoints: {} as any,
      uiElements: {} as any,
      issues: [] as string[]
    };
    
    // Monitor all network requests
    const apiCalls = new Map<string, { status: number, ok: boolean }>();
    
    page.on('response', response => {
      if (response.url().includes('api/')) {
        const endpoint = response.url().replace('http://localhost:4000/api/', '');
        apiCalls.set(endpoint, {
          status: response.status(),
          ok: response.ok()
        });
      }
    });
    
    // Step 1: Test Login Flow
    console.log('\n📍 Testing Login Flow');
    await page.goto('http://localhost:3000');
    await page.screenshot({ path: 'test-results/validation-01-login-page.png' });
    
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    
    await page.waitForTimeout(3000);
    const loggedIn = await page.locator('button:has-text("ออกจากระบบ")').isVisible();
    results.login = loggedIn;
    console.log(`✅ Login: ${loggedIn ? 'SUCCESS' : 'FAILED'}`);
    
    if (!loggedIn) {
      results.issues.push('Login failed - cannot proceed with survey testing');
      return;
    }
    
    await page.screenshot({ path: 'test-results/validation-02-dashboard.png' });
    
    // Step 2: Test Survey Routes
    console.log('\n📍 Testing Survey Routes');
    const routes = [
      { path: '/surveys', name: 'Customer Surveys' },
      { path: '/admin/surveys', name: 'Admin Survey Management' },
      { path: '/admin/survey-builder', name: 'Survey Builder' }
    ];
    
    for (const route of routes) {
      console.log(`Testing ${route.name}...`);
      await page.goto(`http://localhost:3000${route.path}`);
      await page.waitForTimeout(2000);
      
      const currentUrl = page.url();
      const isCorrectRoute = currentUrl.includes(route.path);
      const hasContent = (await page.textContent('body'))?.length > 100;
      
      results.routes[route.path] = {
        accessible: isCorrectRoute,
        hasContent: hasContent,
        url: currentUrl
      };
      
      console.log(`  - Accessible: ${isCorrectRoute}`);
      console.log(`  - Has Content: ${hasContent}`);
      
      if (!isCorrectRoute) {
        results.issues.push(`Route ${route.path} redirected to ${currentUrl}`);
      }
      
      await page.screenshot({ path: `test-results/validation-route-${route.path.replace(/\//g, '-')}.png` });
    }
    
    // Step 3: Test API Endpoints
    console.log('\n📍 Testing API Endpoints');
    await page.goto('http://localhost:3000/admin/surveys');
    await page.waitForTimeout(3000);
    
    apiCalls.forEach((result, endpoint) => {
      results.apiEndpoints[endpoint] = result;
      console.log(`  - ${endpoint}: ${result.status} ${result.ok ? '✅' : '❌'}`);
      
      if (!result.ok && result.status === 404) {
        results.issues.push(`API endpoint ${endpoint} returns 404 - not implemented`);
      } else if (!result.ok) {
        results.issues.push(`API endpoint ${endpoint} returns ${result.status} error`);
      }
    });
    
    // Step 4: Test UI Elements on Survey Pages
    console.log('\n📍 Testing UI Elements');
    
    // Test customer surveys page
    await page.goto('http://localhost:3000/surveys');
    await page.waitForTimeout(2000);
    
    results.uiElements.customerSurveys = {
      surveyCards: await page.locator('[data-testid*="survey"], .survey-card, [class*="survey"]').count(),
      noSurveysMessage: await page.locator('text*="no surveys", text*="ไม่มีแบบสำรวจ"').isVisible(),
      loadingState: await page.locator('.loading, [class*="loading"]').isVisible(),
      errorState: await page.locator('.error, [class*="error"]').isVisible()
    };
    
    // Test admin surveys page
    await page.goto('http://localhost:3000/admin/surveys');
    await page.waitForTimeout(2000);
    
    results.uiElements.adminSurveys = {
      createButton: await page.locator('button:has-text("Create"), button:has-text("สร้าง")').count(),
      surveyTable: await page.locator('table, [data-testid="surveys-table"]').count(),
      managementTools: await page.locator('button[data-testid*="edit"], button[data-testid*="delete"]').count()
    };
    
    await page.screenshot({ path: 'test-results/validation-final-state.png' });
    
    // Step 5: Generate Report
    console.log('\n📊 SURVEY SYSTEM VALIDATION REPORT');
    console.log('=====================================');
    console.log(`🔐 Authentication: ${results.login ? '✅ Working' : '❌ Failed'}`);
    
    console.log('\n🛣️  Route Accessibility:');
    Object.entries(results.routes).forEach(([route, info]: [string, any]) => {
      console.log(`  ${route}: ${info.accessible ? '✅' : '❌'} ${info.hasContent ? '(Has Content)' : '(Empty/Error)'}`);
    });
    
    console.log('\n🔌 API Endpoints Status:');
    Object.entries(results.apiEndpoints).forEach(([endpoint, info]: [string, any]) => {
      console.log(`  ${endpoint}: ${info.ok ? '✅' : '❌'} (${info.status})`);
    });
    
    console.log('\n🎨 UI Elements:');
    console.log('  Customer Surveys:');
    console.log(`    Survey Cards: ${results.uiElements.customerSurveys?.surveyCards || 0}`);
    console.log(`    No Surveys Message: ${results.uiElements.customerSurveys?.noSurveysMessage ? '✅' : '❌'}`);
    console.log('  Admin Surveys:');
    console.log(`    Create Button: ${results.uiElements.adminSurveys?.createButton || 0}`);
    console.log(`    Survey Management: ${results.uiElements.adminSurveys?.managementTools || 0}`);
    
    console.log('\n⚠️  Issues Found:');
    results.issues.forEach(issue => console.log(`  - ${issue}`));
    
    console.log('\n✅ Survey System Status:');
    const workingRoutes = Object.values(results.routes).filter((r: any) => r.accessible).length;
    const workingAPIs = Object.values(results.apiEndpoints).filter((r: any) => r.ok).length;
    const totalAPIs = Object.keys(results.apiEndpoints).length;
    
    console.log(`  - Routes Working: ${workingRoutes}/3`);
    console.log(`  - APIs Working: ${workingAPIs}/${totalAPIs}`);
    console.log(`  - Critical Issues: ${results.issues.length}`);
    
    // Final assessment
    if (results.login && workingRoutes >= 2) {
      console.log('\n🎉 ASSESSMENT: Survey system infrastructure is partially working');
      console.log('   Next steps: Implement missing API endpoints and survey creation UI');
    } else {
      console.log('\n🚨 ASSESSMENT: Survey system has critical issues');
      console.log('   Priority: Fix login and routing issues first');
    }
    
    console.log('\n📸 Screenshots saved to test-results/ directory');
    console.log('=====================================');
  });
});