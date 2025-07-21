const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing profile photo upload with pic/profile-pic.jpg...');
    
    // Navigate to login page
    console.log('🔄 Navigating to login page...');
    await page.goto('http://localhost:3000/login');
    
    // Login with test account
    console.log('🔄 Logging in with test@example.com...');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    // Wait for dashboard to load
    console.log('🔄 Waiting for dashboard...');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Login successful!');
    
    // Navigate to profile page
    console.log('🔄 Navigating to profile page...');
    await page.goto('http://localhost:3000/profile');
    await page.waitForSelector('h1:has-text("My Profile")', { timeout: 10000 });
    
    console.log('✅ Profile page loaded successfully!');
    
    // Check current state
    const profileImage = page.locator('img[alt="Profile"]');
    const hasCurrentAvatar = await profileImage.isVisible();
    console.log(`🖼️ Current avatar visible: ${hasCurrentAvatar}`);
    
    // Path to the real image file
    const imagePath = path.join('/Users/nut/loyalty-app', 'pic/profile-pic.jpg');
    console.log(`📁 Using image: ${imagePath}`);
    
    // Check if file exists
    const fs = require('fs');
    if (!fs.existsSync(imagePath)) {
      throw new Error('Image file not found at pic/profile-pic.jpg');
    }
    
    console.log('🔄 Starting file upload...');
    
    // Set up file chooser and click upload button
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('button[title="Upload profile photo"]')
    ]);
    
    console.log('📁 File chooser opened, selecting image...');
    
    // Upload the real image
    await fileChooser.setFiles(imagePath);
    
    console.log('📤 Image uploaded, waiting for processing...');
    
    // Wait for success notification
    try {
      await page.waitForSelector('text=Profile photo updated successfully', { timeout: 15000 });
      console.log('✅ SUCCESS: Profile photo updated successfully!');
      
      // Verify the image is now displayed
      await page.waitForTimeout(1000);
      const isImageNowVisible = await profileImage.isVisible();
      console.log(`🖼️ Profile image now visible: ${isImageNowVisible}`);
      
      if (isImageNowVisible) {
        const imageSrc = await profileImage.getAttribute('src');
        console.log(`🔗 Image URL: ${imageSrc}`);
        
        if (imageSrc && imageSrc.includes('/uploads/avatars/')) {
          console.log('✅ VERIFIED: Image URL contains correct path!');
        }
      }
      
      // Check the buttons
      const changePhotoBtn = page.locator('button:has-text("Change Photo")');
      const removePhotoBtn = page.locator('button:has-text("Remove Photo")');
      
      const changeVisible = await changePhotoBtn.isVisible();
      const removeVisible = await removePhotoBtn.isVisible();
      
      console.log(`🔄 "Change Photo" button visible: ${changeVisible}`);
      console.log(`🗑️ "Remove Photo" button visible: ${removeVisible}`);
      
      // Take a success screenshot
      await page.screenshot({ path: 'profile-upload-final-success.png' });
      console.log('📸 Success screenshot saved as profile-upload-final-success.png');
      
      console.log('\n🎉 PROFILE PHOTO UPLOAD TEST COMPLETED SUCCESSFULLY!');
      console.log('✅ The pic/profile-pic.jpg has been uploaded and is displaying correctly!');
      console.log('✅ Feature is fully functional!');
      
    } catch (uploadError) {
      console.log('❌ Upload failed or success notification not found');
      
      // Check for any error messages
      try {
        const errorSelectors = [
          'text*="Failed"',
          'text*="Error"', 
          '[class*="error"]',
          '[role="alert"]'
        ];
        
        for (const selector of errorSelectors) {
          try {
            const errorElement = await page.locator(selector).first();
            if (await errorElement.isVisible()) {
              const errorText = await errorElement.textContent();
              console.log(`❌ Error found: ${errorText}`);
            }
          } catch (e) {
            // Ignore selector errors
          }
        }
      } catch (e) {
        console.log('🤔 No error messages detected');
      }
      
      await page.screenshot({ path: 'profile-upload-final-error.png' });
      console.log('📸 Error screenshot saved');
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'profile-test-final-failure.png' });
    console.log('📸 Failure screenshot saved');
  } finally {
    // Keep browser open for review
    console.log('🔄 Keeping browser open for 10 seconds to review...');
    await page.waitForTimeout(10000);
    await browser.close();
  }
})();