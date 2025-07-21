const { chromium } = require('playwright');

async function testRemoveButtonSpecific() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log('🚀 Starting specific remove button test');
    
    // Login
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
    
    // Go to admin coupons
    await page.goto('http://localhost:3000/admin/coupons');
    await page.waitForTimeout(2000);
    
    // Click view assignments
    const viewButton = page.getByText('ดูการมอบคูปอง').first();
    await viewButton.click();
    await page.waitForTimeout(1000);
    
    // Take screenshot of modal
    await page.screenshot({ path: 'modal-with-actions.png', fullPage: true });
    
    // Check if Actions column header is visible
    const actionsHeader = page.locator('th:has-text("Actions")');
    const isActionsVisible = await actionsHeader.isVisible();
    console.log('Actions column header visible:', isActionsVisible);
    
    // Look for Remove button specifically
    const removeButton = page.locator('button:has-text("Remove")');
    const removeCount = await removeButton.count();
    console.log('Remove buttons found:', removeCount);
    
    // Get all table headers in modal
    const headers = await page.locator('[role="dialog"] th').allTextContents();
    console.log('All table headers:', headers);
    
    // Get all buttons in modal
    const buttons = await page.locator('[role="dialog"] button').allTextContents();
    console.log('All buttons in modal:', buttons);
    
    // Check the specific user row
    const userRow = page.locator('tr:has-text("Test User")');
    const userRowVisible = await userRow.isVisible();
    console.log('User row visible:', userRowVisible);
    
    if (userRowVisible) {
      const rowButtons = await userRow.locator('button').allTextContents();
      console.log('Buttons in user row:', rowButtons);
    }
    
    // Wait a bit to see the modal
    await page.waitForTimeout(5000);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

testRemoveButtonSpecific();