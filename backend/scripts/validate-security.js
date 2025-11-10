#!/usr/bin/env node

/**
 * Security Validation Script
 * Tests security middleware and configuration
 */

const fs = require('fs');
const path = require('path');

const VALIDATION_RESULTS = {
  passed: [],
  failed: [],
  warnings: []
};

function log(level, message, details = null) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  
  if (level === 'error') {
    VALIDATION_RESULTS.failed.push({ message, details });
    console.error(`❌ ${logMsg}`);
  } else if (level === 'warn') {
    VALIDATION_RESULTS.warnings.push({ message, details });
    console.warn(`⚠️ ${logMsg}`);
  } else {
    VALIDATION_RESULTS.passed.push(message);
    console.log(`✅ ${logMsg}`);
  }
  
  if (details) {
    console.log(`   Details: ${JSON.stringify(details, null, 2)}`);
  }
}

function validateFile(filePath, description) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      log('info', `${description} exists and is readable`);
      return content;
    } else {
      log('error', `${description} not found`, { path: filePath });
      return null;
    }
  } catch (error) {
    log('error', `Failed to read ${description}`, { path: filePath, error: error.message });
    return null;
  }
}

function validateSecurityMiddleware() {
  console.log('\n🔍 Validating Security Middleware...\n');
  
  // Check security middleware file
  const securityPath = path.join(__dirname, '../src/middleware/security.ts');
  const securityContent = validateFile(securityPath, 'Security middleware file');
  
  if (securityContent) {
    // Check for required functions
    const requiredFunctions = [
      'createRateLimiter',
      'createApiRateLimiter', 
      'createAuthRateLimiter',
      'securityHeaders',
      'customSecurityHeaders',
      'inputSanitization',
      'securityMonitoring',
      'productionSecurity'
    ];
    
    requiredFunctions.forEach(func => {
      if (securityContent.includes(`export const ${func}`)) {
        log('info', `Security function '${func}' is exported`);
      } else {
        log('error', `Security function '${func}' is missing or not exported`);
      }
    });
    
    // Check for security patterns
    const securityPatterns = [
      { pattern: /helmet\(/g, name: 'Helmet security headers' },
      { pattern: /rateLimit\(/g, name: 'Rate limiting configuration' },
      { pattern: /sanitizeValue/g, name: 'Input sanitization' },
      { pattern: /suspicious.*patterns/i, name: 'Security monitoring patterns' },
      { pattern: /hsts.*maxAge/g, name: 'HSTS configuration' },
      { pattern: /contentSecurityPolicy/g, name: 'CSP configuration' }
    ];
    
    securityPatterns.forEach(({ pattern, name }) => {
      if (pattern.test(securityContent)) {
        log('info', `${name} implemented`);
      } else {
        log('warn', `${name} may be missing`);
      }
    });
  }
}

function validateEnvironmentConfig() {
  console.log('\n🔍 Validating Environment Configuration...\n');
  
  // Check environment validation file
  const envPath = path.join(__dirname, '../src/config/environment.ts');
  const envContent = validateFile(envPath, 'Environment configuration file');
  
  if (envContent) {
    // Check for Zod validation
    if (envContent.includes('z.object')) {
      log('info', 'Zod schema validation implemented');
    } else {
      log('error', 'Zod schema validation not found');
    }
    
    // Check for security validations
    const securityChecks = [
      { pattern: /JWT_SECRET.*min\(32/g, name: 'JWT secret minimum length validation' },
      { pattern: /performSecurityChecks/g, name: 'Security checks function' },
      { pattern: /defaultSecrets/g, name: 'Default secret detection' },
      { pattern: /production.*64/g, name: 'Production security requirements' }
    ];
    
    securityChecks.forEach(({ pattern, name }) => {
      if (pattern.test(envContent)) {
        log('info', `${name} implemented`);
      } else {
        log('warn', `${name} may be missing`);
      }
    });
  }
}

function validateESLintSecurity() {
  console.log('\n🔍 Validating ESLint Security Configuration...\n');

  // Check for ESLint configuration (flat config or legacy)
  let eslintPath = path.join(__dirname, '../eslint.config.mjs');
  let eslintContent = validateFile(eslintPath, 'ESLint flat config file (eslint.config.mjs)');

  // Fallback to legacy config if flat config doesn't exist
  if (!eslintContent) {
    eslintPath = path.join(__dirname, '../.eslintrc.js');
    eslintContent = validateFile(eslintPath, 'ESLint configuration file (.eslintrc.js)');
  }

  if (eslintContent) {
    // Check for security plugin (multiple configuration approaches)
    if (eslintContent.includes('plugin:security/recommended') ||
        (eslintContent.includes("'security'") && eslintContent.includes('plugins:')) ||
        (eslintContent.includes('eslint-plugin-security') && eslintContent.includes('security'))) {
      log('info', 'ESLint security plugin configured');
    } else {
      log('error', 'ESLint security plugin not configured');
    }

    // Check for specific security rules
    const securityRules = [
      'security/detect-eval-with-expression',
      'security/detect-unsafe-regex',
      'security/detect-buffer-noassert',
      'security/detect-child-process'
    ];

    securityRules.forEach(rule => {
      if (eslintContent.includes(rule)) {
        log('info', `ESLint security rule '${rule}' configured`);
      } else {
        log('warn', `ESLint security rule '${rule}' may be missing`);
      }
    });
  }
}

function validatePackageScripts() {
  console.log('\n🔍 Validating Package.json Security Scripts...\n');
  
  // Check package.json
  const packagePath = path.join(__dirname, '../package.json');
  const packageContent = validateFile(packagePath, 'Package.json file');
  
  if (packageContent) {
    try {
      const packageJson = JSON.parse(packageContent);
      const scripts = packageJson.scripts || {};
      
      const securityScripts = [
        'lint:security',
        'security:audit', 
        'security:scan'
      ];
      
      securityScripts.forEach(script => {
        if (scripts[script]) {
          log('info', `Security script '${script}' configured: ${scripts[script]}`);
        } else {
          log('warn', `Security script '${script}' is missing`);
        }
      });
      
      // Check for security dependencies
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      const securityDeps = [
        'helmet',
        'express-rate-limit',
        'zod',
        'eslint-plugin-security'
      ];
      
      securityDeps.forEach(dep => {
        if (deps[dep]) {
          log('info', `Security dependency '${dep}' installed: ${deps[dep]}`);
        } else {
          log('error', `Security dependency '${dep}' is missing`);
        }
      });
      
    } catch (error) {
      log('error', 'Failed to parse package.json', { error: error.message });
    }
  }
}

function validateMainApplication() {
  console.log('\n🔍 Validating Main Application Integration...\n');
  
  // Check main application file
  const indexPath = path.join(__dirname, '../src/index.ts');
  const indexContent = validateFile(indexPath, 'Main application file');
  
  if (indexContent) {
    // Check for security middleware imports
    const securityImports = [
      'securityHeaders',
      'createRateLimiter',
      'inputSanitization',
      'securityMonitoring'
    ];
    
    securityImports.forEach(imp => {
      if (indexContent.includes(imp)) {
        log('info', `Security middleware '${imp}' imported`);
      } else {
        log('warn', `Security middleware '${imp}' may not be imported`);
      }
    });
    
    // Check for middleware usage
    const middlewareUsage = [
      { pattern: /app\.use.*securityMonitoring/g, name: 'Security monitoring middleware' },
      { pattern: /app\.use.*inputSanitization/g, name: 'Input sanitization middleware' },
      { pattern: /createRateLimiter/g, name: 'Rate limiting middleware' },
      { pattern: /isProduction.*productionSecurity/g, name: 'Production security middleware' }
    ];
    
    middlewareUsage.forEach(({ pattern, name }) => {
      if (pattern.test(indexContent)) {
        log('info', `${name} applied`);
      } else {
        log('warn', `${name} may not be applied`);
      }
    });
  }
}

function generateReport() {
  console.log('\n📊 Security Validation Report\n');
  console.log('='.repeat(50));
  
  console.log(`\n✅ Passed: ${VALIDATION_RESULTS.passed.length}`);
  console.log(`⚠️  Warnings: ${VALIDATION_RESULTS.warnings.length}`);
  console.log(`❌ Failed: ${VALIDATION_RESULTS.failed.length}`);
  
  if (VALIDATION_RESULTS.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    VALIDATION_RESULTS.warnings.forEach((warning, index) => {
      console.log(`  ${index + 1}. ${warning.message}`);
    });
  }
  
  if (VALIDATION_RESULTS.failed.length > 0) {
    console.log('\n❌ Critical Issues:');
    VALIDATION_RESULTS.failed.forEach((failure, index) => {
      console.log(`  ${index + 1}. ${failure.message}`);
    });
  }
  
  const totalChecks = VALIDATION_RESULTS.passed.length + VALIDATION_RESULTS.warnings.length + VALIDATION_RESULTS.failed.length;
  const successRate = Math.round((VALIDATION_RESULTS.passed.length / totalChecks) * 100);
  
  console.log(`\n📈 Overall Security Score: ${successRate}%`);
  
  if (VALIDATION_RESULTS.failed.length === 0) {
    console.log('\n🎉 Security validation completed successfully!');
    return 0;
  } else {
    console.log('\n🚨 Security validation failed. Please address critical issues.');
    return 1;
  }
}

// Run validation
console.log('🔒 Phase 3 Security Implementation Validation');
console.log('='.repeat(50));

validateSecurityMiddleware();
validateEnvironmentConfig(); 
validateESLintSecurity();
validatePackageScripts();
validateMainApplication();

const exitCode = generateReport();
process.exit(exitCode);