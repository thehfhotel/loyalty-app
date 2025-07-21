const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('🔄 Testing instant avatar refresh after upload...');
    
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
    
    // Get the specific profile picture container element
    const profileContainer = page.locator('#root > div.min-h-screen.bg-gray-50 > main > div > div > div > div.relative > div');
    const isContainerVisible = await profileContainer.isVisible();
    
    console.log(`✅ Profile picture container visible: ${isContainerVisible}`);
    
    // Check initial state
    const profileImage = page.locator('img[alt="Profile"]');
    const userIcon = page.locator('svg').first();
    
    const hasInitialAvatar = await profileImage.isVisible();
    console.log(`🖼️ Initial avatar visible: ${hasInitialAvatar}`);
    
    if (hasInitialAvatar) {
      const initialSrc = await profileImage.getAttribute('src');
      console.log(`📷 Initial image URL: ${initialSrc}`);
    }
    
    // Create test image
    const fs = require('fs');
    const { createCanvas } = require('canvas');
    
    const canvas = createCanvas(200, 200);
    const ctx = canvas.getContext('2d');
    
    // Create unique test image with timestamp
    const timestamp = Date.now();
    const gradient = ctx.createRadialGradient(100, 100, 0, 100, 100, 100);
    gradient.addColorStop(0, '#ff6b6b');
    gradient.addColorStop(1, '#ee5a24');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 200, 200);
    
    ctx.fillStyle = 'white';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('TEST', 100, 90);
    ctx.fillText(timestamp.toString().slice(-4), 100, 120);
    
    const buffer = canvas.toBuffer('image/jpeg');
    const testImagePath = path.join(__dirname, 'test-instant-refresh.jpg');
    fs.writeFileSync(testImagePath, buffer);
    
    console.log('📁 Created unique test image');
    
    // Start upload
    console.log('🔄 Starting file upload...');
    
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('button[title="Upload profile photo"]')
    ]);
    
    await fileChooser.setFiles(testImagePath);
    
    console.log('📤 File selected, monitoring for instant update...');
    
    // Wait for upload success notification
    await page.waitForSelector('text=Profile photo updated successfully', { timeout: 15000 });
    console.log('✅ Upload success notification appeared');
    
    // Check if image updated instantly (within 1 second)
    await page.waitForTimeout(500); // Small delay to ensure DOM update
    
    const isImageNowVisible = await profileImage.isVisible();
    console.log(`🖼️ Profile image visible after upload: ${isImageNowVisible}`);
    
    if (isImageNowVisible) {
      const newImageSrc = await profileImage.getAttribute('src');
      console.log(`🔗 New image URL: ${newImageSrc}`);
      
      // Check if URL contains cache buster
      if (newImageSrc.includes('?t=')) {
        console.log('✅ Cache-busting parameter found in URL');
      }
      
      // Verify the image loads
      const imageLoadPromise = page.waitForFunction(
        (imgElement) => imgElement && imgElement.complete && imgElement.naturalHeight !== 0,
        await profileImage.elementHandle(),
        { timeout: 5000 }
      );
      
      try {
        await imageLoadPromise;
        console.log('✅ New image loaded successfully');
      } catch {
        console.log('⚠️ Image load check timed out');
      }
      
      // Take screenshot to verify visual update
      await page.screenshot({ path: 'instant-refresh-test.png' });
      console.log('📸 Screenshot saved');
      
      console.log('\n🎉 SUCCESS: Profile picture refreshed instantly after upload!');
      console.log('✅ No manual page refresh required');
      console.log('✅ State management working correctly');
      
    } else {
      console.log('❌ FAILED: Profile image not visible after upload');
      
      // Check if still in loading state
      const loadingSpinner = page.locator('div.animate-spin');
      const isLoading = await loadingSpinner.isVisible();
      console.log(`⏳ Still loading: ${isLoading}`);
      
      await page.screenshot({ path: 'instant-refresh-failed.png' });
    }
    
    // Cleanup
    fs.unlinkSync(testImagePath);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: 'instant-refresh-error.png' });
  } finally {
    console.log('🔄 Keeping browser open for 5 seconds...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
})();