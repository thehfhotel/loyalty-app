const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Test configuration
const BASE_URL = 'http://localhost:3000';
const BACKEND_URL = 'http://localhost:4000';
const TEST_TIMEOUT = 30000;

// Test user credentials
const TEST_USERS = {
  customer: {
    email: 'coupon-admin@test.com',
    password: 'test123456'
  },
  admin: {
    email: 'admin@hotel.com', 
    password: 'admin123'
  }
};

// Pages to test
const PAGES_TO_TEST = {
  public: [
    '/',
    '/login',
    '/register',
    '/reset-password'
  ],
  authenticated: [
    '/dashboard',
    '/profile', 
    '/loyalty',
    '/coupons',
    '/account-linking'
  ],
  admin: [
    '/admin/loyalty',
    '/admin/coupons',
    '/admin/feature-toggles'
  ]
};

// Error patterns to detect
const ERROR_PATTERNS = [
  /error/i,
  /failed/i,
  /cannot read property/i,
  /undefined/i,
  /null/i,
  /404/,
  /500/,
  /compilation error/i,
  /syntax error/i,
  /uncaught/i
];

class PageTester {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.results = {
      passed: [],
      failed: [],
      warnings: [],
      consoleErrors: [],
      networkErrors: []
    };
  }

  async initialize() {
    console.log('🚀 Initializing Playwright browser...');
    this.browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Playwright Test Bot'
    });
    
    this.page = await this.context.newPage();
    
    // Set up error listeners
    this.setupErrorListeners();
    
    console.log('✅ Browser initialized successfully');
  }

  setupErrorListeners() {
    // Console error listener
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        this.results.consoleErrors.push({
          page: this.page.url(),
          message: msg.text(),
          timestamp: new Date().toISOString()
        });
      }
    });

    // Network error listener
    this.page.on('response', response => {
      if (response.status() >= 400) {
        this.results.networkErrors.push({
          page: this.page.url(),
          url: response.url(),
          status: response.status(),
          statusText: response.statusText(),
          timestamp: new Date().toISOString()
        });
      }
    });

    // Page error listener
    this.page.on('pageerror', error => {
      this.results.consoleErrors.push({
        page: this.page.url(),
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    });
  }

  async testPage(url, options = {}) {
    const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
    const startTime = Date.now();
    
    try {
      console.log(`📄 Testing: ${fullUrl}`);
      
      // Navigate to page
      const response = await this.page.goto(fullUrl, { 
        waitUntil: 'networkidle',
        timeout: TEST_TIMEOUT 
      });
      
      // Check response status
      if (response && response.status() >= 400) {
        throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
      }
      
      // Wait for page to be ready
      await this.page.waitForLoadState('domcontentloaded');
      
      // Check for loading states
      try {
        await this.page.waitForSelector('[data-testid="loading"]', { 
          state: 'hidden', 
          timeout: 5000 
        });
      } catch (e) {
        // Loading selector might not exist, continue
      }
      
      // Get page title and check for obvious errors
      const title = await this.page.title();
      const pageText = await this.page.textContent('body');
      
      // Check for error patterns in page content
      const hasErrorPattern = ERROR_PATTERNS.some(pattern => 
        pattern.test(pageText) || pattern.test(title)
      );
      
      // Check for specific error indicators
      const errorElements = await this.page.$$eval(
        '[class*="error"], [class*="Error"], .error, #error',
        elements => elements.map(el => el.textContent?.trim()).filter(Boolean)
      );
      
      // Check for React error boundaries
      const reactErrors = await this.page.$$eval(
        '[data-react-error], .react-error-boundary',
        elements => elements.map(el => el.textContent?.trim()).filter(Boolean)
      );
      
      // Take screenshot for visual verification
      const screenshotPath = `./test-screenshots/${url.replace(/[/:\\?*|"<>]/g, '_')}.png`;
      await this.page.screenshot({ 
        path: screenshotPath,
        fullPage: false 
      });
      
      const duration = Date.now() - startTime;
      
      const result = {
        url: fullUrl,
        title,
        duration,
        screenshot: screenshotPath,
        status: 'passed',
        errors: [],
        warnings: []
      };
      
      // Add any detected errors
      if (hasErrorPattern) {
        result.warnings.push('Error patterns detected in page content');
      }
      
      if (errorElements.length > 0) {
        result.errors.push(`Error elements found: ${errorElements.join(', ')}`);
      }
      
      if (reactErrors.length > 0) {
        result.errors.push(`React errors found: ${reactErrors.join(', ')}`);
      }
      
      // Check if page loaded completely
      const bodyHeight = await this.page.evaluate(() => document.body.scrollHeight);
      if (bodyHeight < 100) {
        result.warnings.push('Page appears to have minimal content');
      }
      
      if (result.errors.length > 0) {
        result.status = 'failed';
        this.results.failed.push(result);
      } else if (result.warnings.length > 0) {
        result.status = 'warning';
        this.results.warnings.push(result);
      } else {
        this.results.passed.push(result);
      }
      
      console.log(`   ✅ ${result.status.toUpperCase()} (${duration}ms) - ${title}`);
      
      return result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      const result = {
        url: fullUrl,
        title: 'Failed to load',
        duration,
        status: 'failed',
        errors: [error.message],
        warnings: []
      };
      
      this.results.failed.push(result);
      console.log(`   ❌ FAILED (${duration}ms) - ${error.message}`);
      
      return result;
    }
  }

  async login(userType = 'customer') {
    console.log(`🔐 Logging in as ${userType}...`);
    
    const credentials = TEST_USERS[userType];
    if (!credentials) {
      throw new Error(`Unknown user type: ${userType}`);
    }
    
    try {
      await this.page.goto(`${BASE_URL}/login`);
      
      // Fill login form
      await this.page.fill('input[type="email"]', credentials.email);
      await this.page.fill('input[type="password"]', credentials.password);
      
      // Submit form
      await this.page.click('button[type="submit"]');
      
      // Wait for navigation to dashboard
      await this.page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 10000 });
      
      console.log(`   ✅ Successfully logged in as ${userType}`);
      return true;
      
    } catch (error) {
      console.log(`   ❌ Login failed for ${userType}: ${error.message}`);
      return false;
    }
  }

  async logout() {
    console.log('🚪 Logging out...');
    try {
      // Look for logout button/link
      const logoutSelectors = [
        'button:has-text("Logout")',
        'a:has-text("Logout")',
        '[data-testid="logout"]',
        '.logout'
      ];
      
      for (const selector of logoutSelectors) {
        try {
          await this.page.click(selector, { timeout: 2000 });
          await this.page.waitForURL(`${BASE_URL}/login`, { timeout: 5000 });
          console.log('   ✅ Successfully logged out');
          return true;
        } catch (e) {
          continue;
        }
      }
      
      // If no logout button found, clear storage
      await this.page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      
      console.log('   ⚠️ No logout button found, cleared storage');
      return true;
      
    } catch (error) {
      console.log(`   ❌ Logout failed: ${error.message}`);
      return false;
    }
  }

  async testAuthenticatedPages() {
    console.log('\n🔒 Testing authenticated pages...');
    
    // Try to login
    const loginSuccess = await this.login('customer');
    if (!loginSuccess) {
      console.log('⚠️ Skipping authenticated pages - login failed');
      return;
    }
    
    // Test each authenticated page
    for (const url of PAGES_TO_TEST.authenticated) {
      await this.testPage(url);
      await this.page.waitForTimeout(1000); // Brief pause between pages
    }
    
    await this.logout();
  }

  async testAdminPages() {
    console.log('\n👑 Testing admin pages...');
    
    // Try to login as admin
    const loginSuccess = await this.login('admin');
    if (!loginSuccess) {
      console.log('⚠️ Skipping admin pages - admin login failed');
      return;
    }
    
    // Test each admin page
    for (const url of PAGES_TO_TEST.admin) {
      await this.testPage(url);
      await this.page.waitForTimeout(1000); // Brief pause between pages
    }
    
    await this.logout();
  }

  async testPublicPages() {
    console.log('\n🌐 Testing public pages...');
    
    // Test each public page
    for (const url of PAGES_TO_TEST.public) {
      await this.testPage(url);
      await this.page.waitForTimeout(1000); // Brief pause between pages
    }
  }

  async testBackendHealth() {
    console.log('\n🔧 Testing backend endpoints...');
    
    const endpoints = [
      '/health',
      '/api/auth/login',
      '/api/coupons',
      '/api/loyalty'
    ];
    
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${BACKEND_URL}${endpoint}`);
        const status = response.status;
        
        if (status === 200 || status === 401) { // 401 is expected for protected endpoints
          console.log(`   ✅ ${endpoint} - ${status}`);
        } else {
          console.log(`   ⚠️ ${endpoint} - ${status}`);
          this.results.warnings.push({
            type: 'backend',
            endpoint,
            status,
            message: `Unexpected status code: ${status}`
          });
        }
      } catch (error) {
        console.log(`   ❌ ${endpoint} - ${error.message}`);
        this.results.failed.push({
          type: 'backend',
          endpoint,
          error: error.message
        });
      }
    }
  }

  generateReport() {
    const totalTests = this.results.passed.length + this.results.failed.length + this.results.warnings.length;
    
    const report = {
      summary: {
        total: totalTests,
        passed: this.results.passed.length,
        failed: this.results.failed.length, 
        warnings: this.results.warnings.length,
        passRate: totalTests > 0 ? Math.round((this.results.passed.length / totalTests) * 100) : 0
      },
      details: this.results,
      timestamp: new Date().toISOString()
    };
    
    // Save detailed report
    fs.writeFileSync('./test-results.json', JSON.stringify(report, null, 2));
    
    return report;
  }

  printResults() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    
    const report = this.generateReport();
    
    console.log(`Total Tests: ${report.summary.total}`);
    console.log(`✅ Passed: ${report.summary.passed}`);
    console.log(`❌ Failed: ${report.summary.failed}`);
    console.log(`⚠️  Warnings: ${report.summary.warnings}`);
    console.log(`📈 Pass Rate: ${report.summary.passRate}%`);
    
    if (this.results.failed.length > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.results.failed.forEach(test => {
        console.log(`   • ${test.url}`);
        test.errors?.forEach(error => console.log(`     - ${error}`));
      });
    }
    
    if (this.results.warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:');
      this.results.warnings.forEach(test => {
        console.log(`   • ${test.url}`);
        test.warnings?.forEach(warning => console.log(`     - ${warning}`));
      });
    }
    
    if (this.results.consoleErrors.length > 0) {
      console.log('\n🚨 CONSOLE ERRORS:');
      this.results.consoleErrors.forEach(error => {
        console.log(`   • ${error.page}: ${error.message}`);
      });
    }
    
    if (this.results.networkErrors.length > 0) {
      console.log('\n🌐 NETWORK ERRORS:');
      this.results.networkErrors.forEach(error => {
        console.log(`   • ${error.url} - ${error.status} ${error.statusText}`);
      });
    }
    
    console.log('\n📁 Detailed results saved to: test-results.json');
    console.log('📷 Screenshots saved to: ./test-screenshots/');
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      console.log('🧹 Browser closed');
    }
  }

  async runAllTests() {
    try {
      await this.initialize();
      
      // Create screenshots directory
      if (!fs.existsSync('./test-screenshots')) {
        fs.mkdirSync('./test-screenshots', { recursive: true });
      }
      
      // Run all test suites
      await this.testBackendHealth();
      await this.testPublicPages();
      await this.testAuthenticatedPages();
      await this.testAdminPages();
      
      this.printResults();
      
    } catch (error) {
      console.error('💥 Test execution failed:', error);
    } finally {
      await this.cleanup();
    }
  }
}

// Main execution
async function main() {
  console.log('🎭 Starting comprehensive page testing with Playwright...\n');
  
  const tester = new PageTester();
  await tester.runAllTests();
  
  console.log('\n🏁 Testing complete!');
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n⚠️ Test interrupted by user');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Promise Rejection:', reason);
  process.exit(1);
});

// Run the tests
main().catch(console.error);