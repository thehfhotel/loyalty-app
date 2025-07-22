import { test, expect } from '@playwright/test';
import { authHelpers } from './helpers/auth';

test('Test Survey Creation Edge Cases', async ({ page }) => {
  console.log('=== TESTING SURVEY CREATION EDGE CASES ===');
  
  const responses: any[] = [];
  
  page.on('response', async response => {
    if (response.url().includes('/api/surveys') && response.request().method() === 'POST') {
      let body = 'Could not read body';
      try {
        body = await response.text();
      } catch (e) {
        body = `Error reading: ${e}`;
      }
      responses.push({
        status: response.status(),
        statusText: response.statusText(),
        body: body
      });
    }
  });

  await authHelpers.loginAsAdmin(page);

  // Test Case 1: Minimal survey without description
  console.log('\n--- Test Case 1: Minimal survey ---');
  await page.goto('/admin/surveys/create', { waitUntil: 'networkidle' });
  
  await page.fill('#title', 'Minimal Survey');
  await page.fill('#description', ''); // Empty description
  await page.selectOption('#access_type', 'public');
  await page.click('text=Single Choice');
  
  // Fill minimal question
  await page.waitForTimeout(1000);
  const questionInput = page.locator('input[placeholder*="Enter question"], textarea[placeholder*="Enter question"], input[placeholder*="question"], textarea[placeholder*="question"]').first();
  await questionInput.fill('Test question?');
  
  responses.length = 0; // Clear previous responses
  await page.click('text=Create & Publish');
  await page.waitForTimeout(3000);

  console.log('Minimal survey response:', responses[0]?.status || 'No response');
  if (responses[0]?.status >= 400) {
    console.log('Error body:', responses[0].body);
  }

  // Test Case 2: Survey with invite_only access type
  console.log('\n--- Test Case 2: Invite-only survey ---');
  await page.goto('/admin/surveys/create', { waitUntil: 'networkidle' });
  
  await page.fill('#title', 'Invite Only Survey');
  await page.fill('#description', 'Testing invite only access');
  await page.selectOption('#access_type', 'invite_only');
  await page.click('text=Single Choice');
  
  await page.waitForTimeout(1000);
  const questionInput2 = page.locator('input[placeholder*="Enter question"], textarea[placeholder*="Enter question"], input[placeholder*="question"], textarea[placeholder*="question"]').first();
  await questionInput2.fill('Invite test question?');
  
  responses.length = 0;
  await page.click('text=Create & Publish');
  await page.waitForTimeout(3000);

  console.log('Invite-only survey response:', responses[0]?.status || 'No response');
  if (responses[0]?.status >= 400) {
    console.log('Error body:', responses[0].body);
  }

  // Test Case 3: Survey with no questions (should fail)
  console.log('\n--- Test Case 3: Survey with no questions ---');
  await page.goto('/admin/surveys/create', { waitUntil: 'networkidle' });
  
  await page.fill('#title', 'No Questions Survey');
  await page.fill('#description', 'This should fail');
  await page.selectOption('#access_type', 'public');
  // Don't add any questions
  
  responses.length = 0;
  await page.click('text=Create & Publish');
  await page.waitForTimeout(3000);

  console.log('No questions survey response:', responses[0]?.status || 'No response');
  if (responses[0]?.status >= 400) {
    console.log('Error body:', responses[0].body);
  } else if (!responses[0]) {
    // Check if frontend validation prevented the request
    const errorMessages = await page.locator('.error, [role="alert"], .toast').allTextContents();
    console.log('Frontend validation messages:', errorMessages);
  }

  // Test Case 4: Check what happens with empty title (should fail)
  console.log('\n--- Test Case 4: Empty title survey ---');
  await page.goto('/admin/surveys/create', { waitUntil: 'networkidle' });
  
  await page.fill('#title', ''); // Empty title
  await page.fill('#description', 'Testing empty title');
  await page.selectOption('#access_type', 'public');
  await page.click('text=Single Choice');
  
  await page.waitForTimeout(1000);
  const questionInput4 = page.locator('input[placeholder*="Enter question"], textarea[placeholder*="Enter question"], input[placeholder*="question"], textarea[placeholder*="question"]').first();
  await questionInput4.fill('Test question?');
  
  responses.length = 0;
  await page.click('text=Create & Publish');
  await page.waitForTimeout(3000);

  console.log('Empty title survey response:', responses[0]?.status || 'No response');
  if (responses[0]?.status >= 400) {
    console.log('Error body:', responses[0].body);
  } else if (!responses[0]) {
    const errorMessages = await page.locator('.error, [role="alert"], .toast').allTextContents();
    console.log('Frontend validation messages:', errorMessages);
  }

  console.log('\n=== EDGE CASES SUMMARY ===');
  console.log('All test cases completed. If no 400 errors were found above, the survey creation is working correctly.');
});