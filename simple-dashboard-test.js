const { chromium } = require('playwright');

async function simpleDashboardTest() {
  console.log('🧪 Simple Dashboard Button Test...\n');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Try both ports
    const ports = [3000, 3001];
    let workingPort = null;
    
    for (const port of ports) {
      try {
        console.log(`🔗 Trying http://localhost:${port}...`);
        await page.goto(`http://localhost:${port}/`, { timeout: 5000 });
        workingPort = port;
        console.log(`✅ Connected to port ${port}`);
        break;
      } catch (error) {
        console.log(`❌ Port ${port} not available`);
      }
    }
    
    if (!workingPort) {
      console.log('❌ No working port found');
      return;
    }
    
    // Navigate to login
    await page.goto(`http://localhost:${workingPort}/login`);
    console.log('📄 Navigated to login page');
    
    // Take a screenshot to see what's happening
    await page.screenshot({ 
      path: './login-page.png',
      fullPage: true 
    });
    console.log('📷 Login page screenshot saved: login-page.png');
    
    // Check if we can access the app
    await page.goto(`http://localhost:${workingPort}/`);
    
    await page.screenshot({ 
      path: './app-home.png',
      fullPage: true 
    });
    console.log('📷 App home screenshot saved: app-home.png');
    
    console.log('🎉 Basic connectivity test completed');
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
  } finally {
    await browser.close();
  }
}

simpleDashboardTest().catch(console.error);