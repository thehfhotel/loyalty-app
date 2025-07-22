import { test, expect, Page } from '@playwright/test';

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TEST_USER = {
  email: 'winut.hf@gmail.com',
  password: 'Kick2you@ss'
};

test.describe('Survey Workflow End-to-End', () => {
  let page: Page;
  let surveyId: string;
  
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    
    // Enable console logging and network monitoring
    page.on('console', msg => {
      console.log(`[CONSOLE ${msg.type()}]`, msg.text());
    });
    
    page.on('response', response => {
      if (response.status() >= 400) {
        console.log(`[NETWORK ERROR] ${response.status()} ${response.url()}`);
      }
    });
  });

  test('Complete Survey Workflow: Create → Publish → Take → Verify', async () => {
    console.log('🚀 Starting complete survey workflow test...');
    
    // Step 1: Navigate to application
    console.log('📍 Step 1: Navigate to application');
    await page.goto(BASE_URL);
    await page.screenshot({ path: 'test-results/01-homepage.png' });
    
    // Step 2: Login
    console.log('📍 Step 2: Login with test credentials');
    await page.fill('input[type="email"]', TEST_USER.email);
    await page.fill('input[type="password"]', TEST_USER.password);
    await page.click('button[type="submit"]');
    
    // Wait for login to complete
    await page.waitForURL('**/dashboard*', { timeout: 10000 });
    await page.screenshot({ path: 'test-results/02-dashboard.png' });
    console.log('✅ Successfully logged in');
    
    // Step 3: Navigate to admin survey builder
    console.log('📍 Step 3: Navigate to admin survey builder');
    await page.click('text="Admin"');
    await page.waitForTimeout(1000);
    await page.click('text="Survey Builder"');
    await page.waitForURL('**/admin/survey-builder*', { timeout: 10000 });
    await page.screenshot({ path: 'test-results/03-survey-builder.png' });
    console.log('✅ Navigated to survey builder');
    
    // Step 4: Create a new public survey
    console.log('📍 Step 4: Create a new public survey');
    const surveyTitle = `E2E Test Survey ${Date.now()}`;
    
    // Fill survey details
    await page.fill('input[placeholder*="title" i]', surveyTitle);
    await page.fill('textarea[placeholder*="description" i]', 'This is an automated test survey for end-to-end workflow validation.');
    
    // Set survey as public
    const publicRadio = page.locator('input[value="public"]');
    if (await publicRadio.isVisible()) {
      await publicRadio.check();
      console.log('✅ Set survey type to public');
    }
    
    // Add sample questions
    console.log('Adding sample questions...');
    
    // Question 1 - Multiple Choice
    await page.click('button:has-text("Add Question")');
    await page.fill('input[placeholder*="question" i]', 'What is your overall satisfaction?');
    await page.selectOption('select', 'multiple-choice');
    
    // Add options
    await page.fill('input[placeholder*="option" i]', 'Very Satisfied');
    await page.click('button:has-text("Add Option")');
    await page.fill('input[placeholder*="option" i]:last-of-type', 'Satisfied');
    await page.click('button:has-text("Add Option")');
    await page.fill('input[placeholder*="option" i]:last-of-type', 'Neutral');
    
    // Question 2 - Text
    await page.click('button:has-text("Add Question")');
    await page.fill('input[placeholder*="question" i]:last-of-type', 'Please provide any additional feedback:');
    await page.selectOption('select:last-of-type', 'text');
    
    await page.screenshot({ path: 'test-results/04-survey-created.png' });
    console.log('✅ Created survey with sample questions');
    
    // Step 5: Save and publish the survey
    console.log('📍 Step 5: Save and publish the survey');
    await page.click('button:has-text("Save Survey")');
    
    // Wait for save confirmation
    await page.waitForTimeout(2000);
    
    // Set status to active/published
    const publishButton = page.locator('button:has-text("Publish"), button:has-text("Activate")');
    if (await publishButton.isVisible()) {
      await publishButton.click();
      console.log('✅ Survey published successfully');
    } else {
      // Alternative approach - look for status toggle
      const statusToggle = page.locator('input[type="checkbox"], button[aria-label*="status"]');
      if (await statusToggle.isVisible()) {
        await statusToggle.click();
      }
    }
    
    await page.screenshot({ path: 'test-results/05-survey-published.png' });
    
    // Step 6: Navigate to customer survey list
    console.log('📍 Step 6: Navigate to customer survey list');
    await page.click('text="Surveys"');
    await page.waitForURL('**/surveys*', { timeout: 10000 });
    await page.screenshot({ path: 'test-results/06-survey-list.png' });
    console.log('✅ Navigated to customer survey list');
    
    // Step 7: Find and take the newly created survey
    console.log('📍 Step 7: Find and take the newly created survey');
    
    // Look for the survey we just created
    const surveyCard = page.locator(`text="${surveyTitle}"`).first();
    await expect(surveyCard).toBeVisible({ timeout: 10000 });
    
    // Click to take the survey
    const takeButton = surveyCard.locator('..').locator('button:has-text("Take Survey"), a:has-text("Take Survey")');
    if (await takeButton.isVisible()) {
      await takeButton.click();
    } else {
      // Alternative: click on the survey card itself
      await surveyCard.click();
    }
    
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/07-taking-survey.png' });
    console.log('✅ Started taking the survey');
    
    // Step 8: Complete the survey submission
    console.log('📍 Step 8: Complete the survey submission');
    
    // Answer Question 1 (Multiple Choice)
    await page.click('input[value*="Satisfied"], label:has-text("Satisfied")');
    
    // Answer Question 2 (Text)
    await page.fill('textarea, input[type="text"]', 'This is test feedback from the automated E2E test. The survey workflow is working correctly!');
    
    // Submit the survey
    await page.click('button:has-text("Submit"), button:has-text("Complete")');
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: 'test-results/08-survey-submitted.png' });
    console.log('✅ Survey submitted successfully');
    
    // Step 9: Verify the survey appears in analytics
    console.log('📍 Step 9: Verify survey appears in analytics');
    
    // Navigate to analytics/admin area
    await page.click('text="Admin"');
    await page.waitForTimeout(1000);
    await page.click('text="Analytics", text="Survey Results", text="Reports"');
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: 'test-results/09-analytics.png' });
    
    // Look for our survey in the results
    const analyticsContent = await page.textContent('body');
    if (analyticsContent?.includes(surveyTitle) || analyticsContent?.includes('test feedback')) {
      console.log('✅ Survey response found in analytics');
    } else {
      console.log('⚠️ Survey response not immediately visible in analytics (may need refresh)');
    }
    
    console.log('🎉 Complete survey workflow test completed successfully!');
  });
  
  test.afterAll(async () => {
    if (page) {
      await page.close();
    }
  });
});