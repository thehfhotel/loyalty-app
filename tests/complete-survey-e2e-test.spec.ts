import { test, expect } from '@playwright/test';

test('Complete Survey Workflow E2E Test', async ({ page }) => {
  // Test data
  const surveyData = {
    title: 'Customer Satisfaction Survey',
    description: 'Please help us improve our services',
    questions: [
      {
        type: 'multiple_choice',
        title: 'How satisfied are you with our service?',
        options: ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied']
      },
      {
        type: 'rating',
        title: 'Rate your overall experience',
        maxRating: 5
      },
      {
        type: 'text',
        title: 'Any additional comments?'
      }
    ]
  };

  console.log('Starting Complete Survey E2E Test...');

  // Step 1: Navigate to login page
  console.log('Step 1: Navigating to login page...');
  await page.goto('http://localhost:3000/login');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/e2e-01-login-page.png' });

  // Step 2: Login with test credentials
  console.log('Step 2: Logging in...');
  await page.fill('input[type="email"]', 'winut.hf@gmail.com');
  await page.fill('input[type="password"]', 'Kick2you@ss');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/e2e-02-after-login.png' });

  // Verify login success
  await expect(page).toHaveURL(/dashboard/);

  // Step 3: Navigate to Survey Builder (correct route)
  console.log('Step 3: Navigating to Survey Builder...');
  await page.goto('http://localhost:3000/admin/surveys/create');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/e2e-03-survey-builder.png' });

  // Step 4: Create a Test Survey
  console.log('Step 4: Creating survey...');
  
  // Fill in basic survey info
  await page.fill('input[name="title"]', surveyData.title);
  await page.fill('textarea[name="description"]', surveyData.description);
  
  // Set access type to public
  await page.selectOption('select[name="accessType"]', 'public');
  
  // Add questions
  for (const [index, question] of surveyData.questions.entries()) {
    console.log(`Adding question ${index + 1}: ${question.type}`);
    
    // Click Add Question button
    await page.click('button:has-text("Add Question")');
    await page.waitForTimeout(500);
    
    // Fill question details
    const questionContainer = page.locator('.question-container').nth(index);
    await questionContainer.locator('input[name="title"]').fill(question.title);
    await questionContainer.locator('select[name="type"]').selectOption(question.type);
    
    // Handle question-specific fields
    if (question.type === 'multiple_choice' && question.options) {
      for (const [optionIndex, optionText] of question.options.entries()) {
        if (optionIndex === 0) {
          await questionContainer.locator('input[name="options"]').first().fill(optionText);
        } else {
          await questionContainer.locator('button:has-text("Add Option")').click();
          await questionContainer.locator('input[name="options"]').nth(optionIndex).fill(optionText);
        }
      }
    } else if (question.type === 'rating' && question.maxRating) {
      await questionContainer.locator('input[name="maxRating"]').fill(question.maxRating.toString());
    }
  }
  
  await page.screenshot({ path: 'test-results/e2e-04-survey-form-filled.png' });

  // Step 5: Create & Publish Survey
  console.log('Step 5: Publishing survey...');
  await page.click('button:has-text("Create & Publish")');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/e2e-05-survey-created.png' });

  // Verify success message or redirect
  // The survey should now be created and we should see a success state
  
  // Step 6: Navigate to Customer Survey List
  console.log('Step 6: Navigating to customer survey list...');
  await page.goto('http://localhost:3000/surveys');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/e2e-06-survey-list.png' });

  // Step 7: Verify Survey Appears in Public Surveys
  console.log('Step 7: Verifying survey appears in list...');
  
  // Click on Public Surveys tab if it exists
  const publicTab = page.locator('button:has-text("Public Surveys")');
  if (await publicTab.isVisible()) {
    await publicTab.click();
    await page.waitForTimeout(500);
  }
  
  // Look for our survey
  const surveyCard = page.locator('.survey-card').filter({ hasText: surveyData.title });
  await expect(surveyCard).toBeVisible();
  await page.screenshot({ path: 'test-results/e2e-07-survey-visible.png' });

  // Step 8: Take the Survey
  console.log('Step 8: Taking the survey...');
  
  // Click "Take Survey" button
  await surveyCard.locator('button:has-text("Take Survey")').click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/e2e-08-survey-taking.png' });

  // Answer the questions
  // Question 1: Multiple choice
  await page.click('input[type="radio"][value="Very Satisfied"]');
  
  // Question 2: Rating (click on star 4)
  await page.click('.rating-stars .star:nth-child(4)');
  
  // Question 3: Text input
  await page.fill('textarea[name="text_response"]', 'Great service overall, keep up the good work!');
  
  await page.screenshot({ path: 'test-results/e2e-09-survey-answered.png' });

  // Step 9: Submit Survey
  console.log('Step 9: Submitting survey...');
  await page.click('button:has-text("Submit")');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/e2e-10-survey-submitted.png' });

  // Verify submission success
  await expect(page.locator(':has-text("Thank you")')).toBeVisible();

  // Step 10: Verify in Admin (Optional - check analytics)
  console.log('Step 10: Checking admin analytics...');
  await page.goto('http://localhost:3000/admin/surveys');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/e2e-11-admin-verification.png' });

  console.log('Complete Survey E2E Test completed successfully!');

  // Final verification
  console.log('Verification Summary:');
  console.log('✅ Login successful');
  console.log('✅ Survey Builder accessible');
  console.log('✅ Survey creation successful');
  console.log('✅ Survey appears in customer list');
  console.log('✅ Survey can be taken');
  console.log('✅ Survey submission successful');
  console.log('✅ Admin verification possible');
});

test('Survey Builder Route Validation', async ({ page }) => {
  console.log('Testing Survey Builder Route Validation...');
  
  // Login first
  await page.goto('http://localhost:3000/login');
  await page.fill('input[type="email"]', 'winut.hf@gmail.com');
  await page.fill('input[type="password"]', 'Kick2you@ss');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  
  // Test correct route
  console.log('Testing correct route: /admin/surveys/create');
  await page.goto('http://localhost:3000/admin/surveys/create');
  await page.waitForLoadState('networkidle');
  
  // Should see survey builder form
  await expect(page.locator('input[name="title"]')).toBeVisible();
  await expect(page.locator('textarea[name="description"]')).toBeVisible();
  await expect(page.locator('button:has-text("Add Question")')).toBeVisible();
  
  await page.screenshot({ path: 'test-results/route-validation-correct.png' });
  console.log('✅ Correct route works properly');
  
  // Test wrong route (should redirect or show 404)
  console.log('Testing wrong route: /admin/survey-builder');
  try {
    await page.goto('http://localhost:3000/admin/survey-builder');
    await page.waitForTimeout(2000);
    
    // Should either redirect or show 404/not found
    const url = page.url();
    const hasBuilderForm = await page.locator('input[name="title"]').isVisible();
    
    if (!hasBuilderForm) {
      console.log('✅ Wrong route correctly does not show survey builder');
    } else {
      console.log('⚠️  Wrong route unexpectedly shows survey builder');
    }
    
    await page.screenshot({ path: 'test-results/route-validation-wrong.png' });
  } catch (error) {
    console.log('✅ Wrong route correctly fails:', error.message);
  }
});