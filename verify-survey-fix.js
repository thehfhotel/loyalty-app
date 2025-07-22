// Verify that survey creation is now working correctly
import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  console.log('✅ Verifying Survey Creation Fix...\n');

  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  
  const page = await context.newPage();

  try {
    console.log('1️⃣ Login and navigate to survey management...');
    await page.goto('http://localhost:3000');
    await page.fill('input[name="email"]', 'winut.hf@gmail.com');
    await page.fill('input[name="password"]', 'Kick2you@ss');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    console.log('2️⃣ Creating a test survey...');
    await page.goto('http://localhost:3000/admin/surveys/create');
    await page.waitForLoadState('networkidle');
    
    // Fill survey details
    await page.fill('input[id="title"]', 'Verification Survey');
    await page.fill('textarea[id="description"]', 'Testing that survey creation is working');
    
    // Add a text question
    await page.click('button:has-text("Text Input")');
    await page.waitForTimeout(2000);
    await page.fill('textarea[placeholder="Enter your question..."]', 'How satisfied are you?');
    
    // Add a single choice question
    await page.click('button:has-text("Single Choice")');
    await page.waitForTimeout(2000);
    const questionTextAreas = page.locator('textarea[placeholder="Enter your question..."]');
    await questionTextAreas.last().fill('Which option do you prefer?');
    
    // Submit the survey
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/surveys') && response.request().method() === 'POST'
    );
    
    await page.click('button:has-text("Create & Publish")');
    const response = await responsePromise;
    
    console.log('3️⃣ Survey creation response:', response.status());
    const responseBody = await response.text();
    console.log('Response:', responseBody);
    
    if (response.status() === 201) {
      console.log('✅ SUCCESS: Survey created successfully!');
      
      // Navigate to survey list to verify it's there
      await page.goto('http://localhost:3000/admin/surveys');
      await page.waitForLoadState('networkidle');
      
      // Check if our survey appears in the list
      const surveyExists = await page.locator('text=Verification Survey').isVisible();
      console.log('4️⃣ Survey visible in list:', surveyExists);
      
      if (surveyExists) {
        console.log('🎉 COMPLETE SUCCESS: Survey creation and listing working!');
      }
    } else {
      console.log('❌ FAILED: Survey creation returned status:', response.status());
    }

  } catch (error) {
    console.error('❌ Error during verification:', error);
  } finally {
    await browser.close();
  }
})();