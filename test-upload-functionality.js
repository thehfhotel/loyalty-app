const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Navigating to login page...');
    await page.goto('http://localhost:3000/login');
    
    console.log('🔄 Logging in...');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    // Wait for login to complete
    await page.waitForTimeout(3000);
    
    console.log('🔄 Navigating to profile page...');
    await page.goto('http://localhost:3000/profile');
    await page.waitForSelector('h1:has-text("My Profile")', { timeout: 10000 });
    
    console.log('✅ Profile page loaded!');
    
    // Create a simple test image (1x1 pixel PNG)
    const testImageBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU8qgAAAABJRU5ErkJggg==',
      'base64'
    );
    
    // Save test image to temp file
    const tempImagePath = path.join(__dirname, 'test-avatar.png');
    fs.writeFileSync(tempImagePath, testImageBuffer);
    
    console.log('🔄 Testing file upload...');
    
    // Set up file chooser
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('button[title="Upload profile photo"]')
    ]);
    
    console.log('📁 File chooser opened');
    
    // Upload the test image
    await fileChooser.setFiles(tempImagePath);
    
    console.log('📤 File uploaded, waiting for processing...');
    
    // Wait for upload to complete (look for success notification)
    try {
      await page.waitForSelector('text=Profile photo updated successfully', { timeout: 15000 });
      console.log('✅ Upload successful! Success notification appeared.');
      
      // Check if profile image is now displayed
      const profileImage = await page.locator('img[alt="Profile"]');
      const isImageVisible = await profileImage.isVisible();
      console.log(`🖼️ Profile image visible: ${isImageVisible}`);
      
      if (isImageVisible) {
        const imageSrc = await profileImage.getAttribute('src');
        console.log(`🔗 Image source: ${imageSrc}`);
        
        if (imageSrc && imageSrc.includes('/uploads/avatars/')) {
          console.log('✅ Profile photo upload feature working correctly!');
        } else {
          console.log('⚠️ Image source doesn\'t contain expected path');
        }
      }
      
      // Test remove functionality
      console.log('🔄 Testing remove photo...');
      const removeButton = await page.locator('button:has-text("Remove Photo")');
      if (await removeButton.isVisible()) {
        await removeButton.click();
        
        await page.waitForSelector('text=Profile photo removed successfully', { timeout: 10000 });
        console.log('✅ Remove photo successful!');
        
        // Check if back to default state
        const userIcon = await page.locator('svg').first();
        const isIconVisible = await userIcon.isVisible();
        console.log(`👤 User icon visible after removal: ${isIconVisible}`);
      }
      
    } catch (uploadError) {
      console.log('⚠️ Upload may have failed or taken too long');
      
      // Check for error messages
      const errorNotification = await page.locator('text*=Failed').first();
      if (await errorNotification.isVisible()) {
        const errorText = await errorNotification.textContent();
        console.log(`❌ Error notification: ${errorText}`);
      }
    }
    
    // Take final screenshot
    await page.screenshot({ path: 'profile-upload-test.png' });
    console.log('📸 Final screenshot saved');
    
    // Clean up temp file
    fs.unlinkSync(tempImagePath);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
})();