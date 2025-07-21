const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔍 Testing avatar display fix...');
    
    // Login
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    
    // Go to profile
    await page.goto('http://localhost:3000/profile');
    await page.waitForSelector('h1:has-text("My Profile")', { timeout: 10000 });
    
    console.log('✅ Profile page loaded');
    
    // Check if avatar image is visible
    const profileImage = page.locator('img[alt="Profile"]');
    const isVisible = await profileImage.isVisible();
    console.log(`🖼️ Profile image visible: ${isVisible}`);
    
    if (isVisible) {
      const imageSrc = await profileImage.getAttribute('src');
      console.log(`🔗 Image URL: ${imageSrc}`);
      
      // Test if the image loads successfully
      const response = await page.goto(imageSrc);
      const status = response?.status();
      console.log(`📡 Image response status: ${status}`);
      
      if (status === 200) {
        console.log('✅ SUCCESS: Avatar image loads correctly!');
      } else {
        console.log('❌ FAILED: Avatar image still not accessible');
      }
      
      // Go back to profile
      await page.goto('http://localhost:3000/profile');
      await page.waitForSelector('h1:has-text("My Profile")');
    } else {
      console.log('📷 No avatar currently set, testing upload...');
      
      // Upload a test image to verify the fix
      const fs = require('fs');
      const path = require('path');
      
      // Create simple test image
      const testImageBuffer = Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwC/AD/2Q==',
        'base64'
      );
      
      const testPath = path.join(__dirname, 'temp-test.jpg');
      fs.writeFileSync(testPath, testImageBuffer);
      
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('button[title="Upload profile photo"]')
      ]);
      
      await fileChooser.setFiles(testPath);
      
      // Wait for success
      await page.waitForSelector('text=Profile photo updated successfully', { timeout: 15000 });
      console.log('✅ Upload successful');
      
      // Check if image now displays
      await page.waitForTimeout(2000);
      const isNowVisible = await profileImage.isVisible();
      console.log(`🖼️ Profile image now visible after upload: ${isNowVisible}`);
      
      if (isNowVisible) {
        const newImageSrc = await profileImage.getAttribute('src');
        console.log(`🔗 New image URL: ${newImageSrc}`);
        
        // Verify new image loads
        const testResponse = await fetch(newImageSrc);
        console.log(`📡 New image response status: ${testResponse.status}`);
        
        if (testResponse.ok) {
          console.log('✅ SUCCESS: Avatar display fix working!');
        }
      }
      
      // Cleanup
      fs.unlinkSync(testPath);
    }
    
    // Take final screenshot
    await page.screenshot({ path: 'avatar-display-test.png' });
    console.log('📸 Screenshot saved');
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
  } finally {
    await page.waitForTimeout(3000);
    await browser.close();
  }
})();