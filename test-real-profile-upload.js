const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing profile photo upload for winut.hf@gmail.com...');
    
    // Navigate to login page
    console.log('🔄 Navigating to login page...');
    await page.goto('http://localhost:3000/login');
    
    // Login with the specified account
    console.log('🔄 Logging in with winut.hf@gmail.com...');
    await page.fill('input[type="email"]', 'winut.hf@gmail.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    // Wait for login to complete
    console.log('🔄 Waiting for login to complete...');
    await page.waitForTimeout(3000);
    
    // Navigate to profile page
    console.log('🔄 Navigating to profile page...');
    await page.goto('http://localhost:3000/profile');
    await page.waitForSelector('h1:has-text("My Profile")', { timeout: 10000 });
    
    console.log('✅ Profile page loaded successfully!');
    
    // Check if profile photo section is visible
    const profileSection = await page.locator('div:has(button[title="Upload profile photo"])');
    const isSectionVisible = await profileSection.isVisible();
    console.log(`📷 Profile photo section visible: ${isSectionVisible}`);
    
    // Check current state (avatar or default icon)
    const profileImage = page.locator('img[alt="Profile"]');
    const userIcon = page.locator('svg').first();
    
    const hasCurrentAvatar = await profileImage.isVisible();
    console.log(`🖼️ Current avatar image visible: ${hasCurrentAvatar}`);
    
    // Prepare to upload the specified image
    const imagePath = path.join('/Users/nut/loyalty-app', 'pic/profile-pic.jpg');
    console.log(`📁 Looking for image at: ${imagePath}`);
    
    // Check if the file exists
    const fs = require('fs');
    if (!fs.existsSync(imagePath)) {
      console.log('❌ Image file not found at pic/profile-pic.jpg');
      console.log('🔄 Creating a test image instead...');
      
      // Create a simple colored square as test image
      const { createCanvas } = require('canvas');
      const canvas = createCanvas(200, 200);
      const ctx = canvas.getContext('2d');
      
      // Draw a gradient background
      const gradient = ctx.createLinearGradient(0, 0, 200, 200);
      gradient.addColorStop(0, '#3b82f6');
      gradient.addColorStop(1, '#1e40af');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 200, 200);
      
      // Add some text
      ctx.fillStyle = 'white';
      ctx.font = 'bold 24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('TEST', 100, 90);
      ctx.fillText('AVATAR', 100, 120);
      
      // Save as test image
      const buffer = canvas.toBuffer('image/jpeg');
      const testImagePath = path.join('/Users/nut/loyalty-app', 'test-profile.jpg');
      fs.writeFileSync(testImagePath, buffer);
      
      console.log('✅ Created test image at test-profile.jpg');
      imagePath = testImagePath;
    }
    
    console.log('🔄 Starting file upload...');
    
    // Set up file chooser and click upload button
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('button[title="Upload profile photo"]')
    ]);
    
    console.log('📁 File chooser opened, selecting image...');
    
    // Upload the image
    await fileChooser.setFiles(imagePath);
    
    console.log('📤 Image uploaded, waiting for processing...');
    
    // Wait for upload to complete (look for loading spinner and then success)
    try {
      // Wait for loading spinner to appear
      await page.waitForSelector('div.animate-spin', { timeout: 5000 });
      console.log('⏳ Upload processing started...');
      
      // Wait for loading spinner to disappear (upload complete)
      await page.waitForSelector('div.animate-spin', { state: 'hidden', timeout: 15000 });
      console.log('✅ Upload processing completed!');
      
      // Check for success notification
      try {
        await page.waitForSelector('text=Profile photo updated successfully', { timeout: 5000 });
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
        
        // Test the "Change Photo" and "Remove Photo" buttons
        const changePhotoBtn = page.locator('button:has-text("Change Photo")');
        const removePhotoBtn = page.locator('button:has-text("Remove Photo")');
        
        const changeVisible = await changePhotoBtn.isVisible();
        const removeVisible = await removePhotoBtn.isVisible();
        
        console.log(`🔄 "Change Photo" button visible: ${changeVisible}`);
        console.log(`🗑️ "Remove Photo" button visible: ${removeVisible}`);
        
        // Take a screenshot of the successful upload
        await page.screenshot({ path: 'profile-upload-success.png' });
        console.log('📸 Screenshot saved as profile-upload-success.png');
        
        console.log('\n🎉 PROFILE PHOTO UPLOAD TEST COMPLETED SUCCESSFULLY!');
        console.log('✅ Feature is working correctly for winut.hf@gmail.com');
        
      } catch (successError) {
        console.log('⚠️ Success notification not found, checking for errors...');
        
        // Check for error notifications
        try {
          const errorElements = await page.locator('div:has-text("Failed")').all();
          if (errorElements.length > 0) {
            for (const element of errorElements) {
              const errorText = await element.textContent();
              console.log(`❌ Error found: ${errorText}`);
            }
          } else {
            console.log('🤔 No obvious error messages found');
          }
        } catch (e) {
          console.log('🤔 Could not check for error messages');
        }
      }
      
    } catch (uploadError) {
      console.log('❌ Upload processing failed or timed out');
      console.log(`Error: ${uploadError.message}`);
      
      // Take a screenshot for debugging
      await page.screenshot({ path: 'profile-upload-error.png' });
      console.log('📸 Error screenshot saved as profile-upload-error.png');
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'profile-test-failure.png' });
    console.log('📸 Failure screenshot saved');
  } finally {
    // Keep browser open for 5 seconds to see the result
    console.log('🔄 Keeping browser open for 5 seconds to review...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();