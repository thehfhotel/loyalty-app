#!/usr/bin/env node

/**
 * Translation Key Checker
 *
 * Scans all TSX files for translation keys used with t('...') or t("...")
 * and compares against EN and TH translation files.
 *
 * Usage: node scripts/check-translations.js
 * Exit codes: 0 = all keys found, 1 = missing keys found
 */

const fs = require('fs');
const path = require('path');

// Configuration
const SRC_DIR = path.join(__dirname, '../src');
const EN_TRANSLATION = path.join(__dirname, '../src/i18n/locales/en/translation.json');
const TH_TRANSLATION = path.join(__dirname, '../src/i18n/locales/th/translation.json');

// Patterns to match translation keys
// Matches: t('key'), t("key"), t('key', {...}), t("key", {...})
const TRANSLATION_PATTERNS = [
  /\bt\(\s*['"]([^'"]+)['"]/g,           // t('key') or t("key")
  /\bt\(\s*`([^`$]+)`/g,                 // t(`key`) - simple template literals
];

// Keys to ignore (dynamic keys, etc.)
const IGNORE_PATTERNS = [
  /^\$\{/,                               // Template literal variables
  /\./g,                                 // We'll handle nested keys
];

/**
 * Recursively get all .tsx files in a directory
 */
function getTsxFiles(dir, files = []) {
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip node_modules and test directories for cleaner output
      if (item !== 'node_modules' && item !== '__tests__') {
        getTsxFiles(fullPath, files);
      }
    } else if (item.endsWith('.tsx') || item.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract translation keys from a file
 */
function extractKeys(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const keys = new Set();

  for (const pattern of TRANSLATION_PATTERNS) {
    // Reset regex lastIndex
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const key = match[1];
      // Skip dynamic keys
      if (!key.includes('${') && !key.includes('`')) {
        keys.add(key);
      }
    }
  }

  return { filePath, keys: Array.from(keys) };
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj, key) {
  const parts = key.split('.');
  let current = obj;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Load and flatten translation keys
 */
function loadTranslations(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error loading ${filePath}:`, error.message);
    process.exit(1);
  }
}

/**
 * Main function
 */
function main() {
  console.log('Translation Key Checker');
  console.log('=======================\n');

  // Load translations
  const enTranslations = loadTranslations(EN_TRANSLATION);
  const thTranslations = loadTranslations(TH_TRANSLATION);

  // Get all TSX files
  const files = getTsxFiles(SRC_DIR);
  console.log(`Scanning ${files.length} TypeScript files...\n`);

  // Extract keys from all files
  const allKeys = new Map(); // key -> [files that use it]

  for (const file of files) {
    const { keys } = extractKeys(file);
    const relativePath = path.relative(SRC_DIR, file);

    for (const key of keys) {
      if (!allKeys.has(key)) {
        allKeys.set(key, []);
      }
      allKeys.get(key).push(relativePath);
    }
  }

  console.log(`Found ${allKeys.size} unique translation keys.\n`);

  // Check for missing keys
  const missingInEn = [];
  const missingInTh = [];

  for (const [key, usedIn] of allKeys) {
    const enValue = getNestedValue(enTranslations, key);
    const thValue = getNestedValue(thTranslations, key);

    if (enValue === undefined) {
      missingInEn.push({ key, usedIn });
    }
    if (thValue === undefined) {
      missingInTh.push({ key, usedIn });
    }
  }

  // Report results
  let hasErrors = false;

  if (missingInEn.length > 0) {
    hasErrors = true;
    console.log('MISSING IN ENGLISH (en/translation.json):');
    console.log('-'.repeat(50));
    for (const { key, usedIn } of missingInEn) {
      console.log(`  "${key}"`);
      console.log(`    Used in: ${usedIn.slice(0, 3).join(', ')}${usedIn.length > 3 ? ` (+${usedIn.length - 3} more)` : ''}`);
    }
    console.log(`\nTotal: ${missingInEn.length} missing keys\n`);
  }

  if (missingInTh.length > 0) {
    hasErrors = true;
    console.log('MISSING IN THAI (th/translation.json):');
    console.log('-'.repeat(50));
    for (const { key, usedIn } of missingInTh) {
      console.log(`  "${key}"`);
      console.log(`    Used in: ${usedIn.slice(0, 3).join(', ')}${usedIn.length > 3 ? ` (+${usedIn.length - 3} more)` : ''}`);
    }
    console.log(`\nTotal: ${missingInTh.length} missing keys\n`);
  }

  if (hasErrors) {
    // Print summary of all missing keys for easy reference
    const allMissingKeys = new Set([
      ...missingInEn.map(m => m.key),
      ...missingInTh.map(m => m.key)
    ]);

    console.log('='.repeat(60));
    console.log('SUMMARY: All missing translation keys');
    console.log('='.repeat(60));
    console.log('\nKeys to add:\n');
    for (const key of Array.from(allMissingKeys).sort()) {
      const inEn = missingInEn.some(m => m.key === key);
      const inTh = missingInTh.some(m => m.key === key);
      const missing = [];
      if (inEn) missing.push('EN');
      if (inTh) missing.push('TH');
      console.log(`  "${key}" (missing in: ${missing.join(', ')})`);
    }
    console.log(`\nTotal unique missing keys: ${allMissingKeys.size}`);
    console.log('\n' + '='.repeat(60));
    console.log('FAILED: Missing translation keys found!');
    console.log('Please add the missing keys to both translation files.');
    console.log('='.repeat(60));
    process.exit(1);
  } else {
    console.log('SUCCESS: All translation keys are present in both EN and TH files.');
    process.exit(0);
  }
}

main();
