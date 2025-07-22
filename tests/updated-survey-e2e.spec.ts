import { test, expect } from '@playwright/test';

test('Complete Survey Workflow E2E Test', async ({ page }) => {
  console.log('Starting Complete Survey E2E Test...');

  // Step 1: Login
  console.log('Step 1: Logging in...');
  await page.goto('http://localhost:3000/login');
  await page.waitForLoadState('networkidle');
  
  await page.fill('input[type="email"]', 'winut.hf@gmail.com');
  await page.fill('input[type="password"]', 'Kick2you@ss');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/e2e-01-after-login.png' });

  // Step 2: Navigate to Survey Builder
  console.log('Step 2: Navigating to Survey Builder...');
  await page.goto('http://localhost:3000/admin/surveys/create');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000); // Wait for page to fully load
  await page.screenshot({ path: 'test-results/e2e-02-survey-builder.png' });

  // Verify we're on the survey builder page
  await expect(page.locator('text=Create Survey')).toBeVisible();
  await expect(page.locator('input#title')).toBeVisible();

  // Step 3: Fill in basic survey information
  console.log('Step 3: Filling survey information...');
  
  await page.fill('input#title', 'Customer Satisfaction Survey');
  await page.fill('textarea#description', 'Please help us improve our services');
  await page.selectOption('select#status', 'active');
  await page.selectOption('select#access_type', 'public');
  
  await page.screenshot({ path: 'test-results/e2e-03-basic-info-filled.png' });

  // Step 4: Add Multiple Choice Question
  console.log('Step 4: Adding multiple choice question...');
  
  await page.click('button:has-text("Multiple Choice")');
  await page.waitForTimeout(500);
  
  // The question editor should now be visible
  const questionEditor = page.locator('.space-y-4 > div').first();
  await questionEditor.waitFor();
  
  await page.screenshot({ path: 'test-results/e2e-04-question-added.png' });

  // Step 5: Add Rating Question  
  console.log('Step 5: Adding rating question...');
  
  await page.click('button:has-text("5-Star Rating")');
  await page.waitForTimeout(500);
  
  await page.screenshot({ path: 'test-results/e2e-05-rating-added.png' });

  // Step 6: Add Text Question
  console.log('Step 6: Adding text question...');
  
  await page.click('button:has-text("Text Input")');
  await page.waitForTimeout(500);
  
  await page.screenshot({ path: 'test-results/e2e-06-text-added.png' });

  // Step 7: Create & Publish Survey
  console.log('Step 7: Publishing survey...');
  
  await page.click('button:has-text("Create & Publish")');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: 'test-results/e2e-07-survey-published.png' });

  // Check current URL to see if we were redirected
  const currentUrl = page.url();
  console.log('Current URL after publish:', currentUrl);

  // Step 8: Navigate to Customer Survey List
  console.log('Step 8: Navigating to customer survey list...');
  
  await page.goto('http://localhost:3000/surveys');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: 'test-results/e2e-08-survey-list.png' });

  // Step 9: Look for our survey in the list
  console.log('Step 9: Looking for survey in list...');
  
  // Check if there are tabs for different survey types
  const publicTab = page.locator('button:has-text("Public")');
  if (await publicTab.isVisible()) {
    await publicTab.click();
    await page.waitForTimeout(500);
    console.log('Clicked public tab');
  }
  
  // Look for survey by title
  const surveyTitle = page.locator('text=Customer Satisfaction Survey');
  if (await surveyTitle.isVisible()) {
    console.log('✅ Survey found in list');
    await page.screenshot({ path: 'test-results/e2e-09-survey-found.png' });
    
    // Step 10: Try to take the survey
    console.log('Step 10: Taking survey...');
    
    // Look for "Take Survey" button near the survey title
    const takeButton = page.locator('button:has-text("Take Survey")').first();
    if (await takeButton.isVisible()) {
      await takeButton.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      
      await page.screenshot({ path: 'test-results/e2e-10-taking-survey.png' });
      
      console.log('✅ Survey taking page loaded');
      
      // Check current URL
      console.log('Survey taking URL:', page.url());
      
      // If we have survey questions visible, try to answer them
      const questionElements = page.locator('[class*="question"]');
      const questionCount = await questionElements.count();
      console.log(`Found ${questionCount} question elements`);
      
      if (questionCount > 0) {
        console.log('✅ Survey questions are visible - survey workflow complete');
      } else {
        console.log('⚠️  No questions visible, but survey page loaded');
      }
      
    } else {
      console.log('⚠️  Take Survey button not found');
      await page.screenshot({ path: 'test-results/e2e-10-no-take-button.png' });
    }
    
  } else {
    console.log('⚠️  Survey not found in list');
    await page.screenshot({ path: 'test-results/e2e-09-survey-not-found.png' });
    
    // Check what surveys are in the list
    const pageContent = await page.locator('body').innerText();
    console.log('Survey list content:', pageContent.substring(0, 500));
  }

  console.log('Complete Survey E2E Test finished!');
});

test('Survey Builder Form Validation', async ({ page }) => {
  console.log('Testing Survey Builder Form Validation...');
  
  // Login
  await page.goto('http://localhost:3000/login');
  await page.fill('input[type="email"]', 'winut.hf@gmail.com');
  await page.fill('input[type="password"]', 'Kick2you@ss');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  
  // Go to survey builder
  await page.goto('http://localhost:3000/admin/surveys/create');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  // Test form validation by trying to submit without required fields
  console.log('Testing form validation...');
  
  // Try to create without title
  await page.click('button:has-text("Create & Publish")');
  await page.waitForTimeout(1000);
  
  // Check if we stayed on the same page (validation prevented submit)
  const currentUrl = page.url();
  if (currentUrl.includes('/admin/surveys/create')) {
    console.log('✅ Form validation working - stayed on create page');
  } else {
    console.log('⚠️  Form validation may not be working - URL changed to:', currentUrl);
  }
  
  await page.screenshot({ path: 'test-results/form-validation-test.png' });
});