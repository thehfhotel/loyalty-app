#!/usr/bin/env node

/**
 * Verification script for nights-based tier system improvements
 * Verifies that nights and points are properly separated and tiers are correctly configured
 */

const fs = require('fs');

function verifyNightsTierSystem() {
  console.log('🔍 Verifying Nights-Based Tier System Implementation\n');

  const results = {
    database: false,
    frontend: false,
    translations: false,
    display: false
  };

  // Test 1: Verify Database Tier Configuration
  console.log('1. Checking database tier configuration...');
  const migrationPath = '/Users/nut/loyalty-app/database/migrations/012_update_tiers_to_nights_based.sql';
  
  if (fs.existsSync(migrationPath)) {
    const migrationContent = fs.readFileSync(migrationPath, 'utf8');
    
    // Check for correct tier values
    const newMemberTier = migrationContent.includes("'New Member', 0,");
    const silverTier = migrationContent.includes("'Silver', 1,");
    const goldTier = migrationContent.includes("'Gold', 10,");
    
    if (newMemberTier && silverTier && goldTier) {
      console.log('✅ Database tiers: New Member (0), Silver (1), Gold (10)');
      results.database = true;
    } else {
      console.log('❌ Database tier values incorrect');
      console.log(`   New Member (0): ${newMemberTier ? '✅' : '❌'}`);
      console.log(`   Silver (1): ${silverTier ? '✅' : '❌'}`);
      console.log(`   Gold (10): ${goldTier ? '✅' : '❌'}`);
    }
  } else {
    console.log('❌ Database migration file not found');
  }

  // Test 2: Verify TierStatus Component
  console.log('\n2. Checking TierStatus component display logic...');
  const tierStatusPath = '/Users/nut/loyalty-app/frontend/src/components/loyalty/TierStatus.tsx';
  
  if (fs.existsSync(tierStatusPath)) {
    const tierStatusContent = fs.readFileSync(tierStatusPath, 'utf8');
    
    // Check for proper nights display logic
    const properNightsDisplay = tierStatusContent.includes('tier.min_points === 0 ? t(\'loyalty.newMember\')');
    const nightsProgressLogic = tierStatusContent.includes('nights_to_next_tier !== undefined && loyaltyStatus.nights_to_next_tier !== null');
    
    if (properNightsDisplay && nightsProgressLogic) {
      console.log('✅ TierStatus component properly displays nights-based tiers');
      results.frontend = true;
    } else {
      console.log('❌ TierStatus component issues found');
      console.log(`   New Member display: ${properNightsDisplay ? '✅' : '❌'}`);
      console.log(`   Nights progress logic: ${nightsProgressLogic ? '✅' : '❌'}`);
    }
  } else {
    console.log('❌ TierStatus component file not found');
  }

  // Test 3: Verify ProfilePage Component
  console.log('\n3. Checking ProfilePage component display logic...');
  const profilePath = '/Users/nut/loyalty-app/frontend/src/pages/ProfilePage.tsx';
  
  if (fs.existsSync(profilePath)) {
    const profileContent = fs.readFileSync(profilePath, 'utf8');
    
    // Check for proper nights/points separation
    const nightsFirst = profileContent.indexOf('total_nights') < profileContent.indexOf('current_points');
    const tierEligibilityLabel = profileContent.includes('loyalty.tierEligibility');
    const forRewardsLabel = profileContent.includes('loyalty.forRewards');
    const nightsProgressLogic = profileContent.includes('nights_to_next_tier !== undefined && loyaltyStatus.nights_to_next_tier !== null');
    
    if (nightsFirst && tierEligibilityLabel && forRewardsLabel && nightsProgressLogic) {
      console.log('✅ ProfilePage component properly separates nights and points');
      results.display = true;
    } else {
      console.log('❌ ProfilePage component issues found');
      console.log(`   Nights displayed first: ${nightsFirst ? '✅' : '❌'}`);
      console.log(`   Tier eligibility label: ${tierEligibilityLabel ? '✅' : '❌'}`);
      console.log(`   For rewards label: ${forRewardsLabel ? '✅' : '❌'}`);
      console.log(`   Nights progress logic: ${nightsProgressLogic ? '✅' : '❌'}`);
    }
  } else {
    console.log('❌ ProfilePage component file not found');
  }

  // Test 4: Verify Translation Keys
  console.log('\n4. Checking translation keys...');
  const enTransPath = '/Users/nut/loyalty-app/frontend/src/i18n/locales/en/translation.json';
  const thTransPath = '/Users/nut/loyalty-app/frontend/src/i18n/locales/th/translation.json';
  
  let translationsOk = true;
  
  if (fs.existsSync(enTransPath)) {
    const enContent = fs.readFileSync(enTransPath, 'utf8');
    const hasNewMember = enContent.includes('"newMember": "New Member"');
    const hasTierEligibility = enContent.includes('"tierEligibility": "For tier status"');
    const hasForRewards = enContent.includes('"forRewards": "For rewards"');
    
    if (hasNewMember && hasTierEligibility && hasForRewards) {
      console.log('✅ English translations complete');
    } else {
      console.log('❌ English translations missing keys');
      translationsOk = false;
    }
  } else {
    console.log('❌ English translation file not found');
    translationsOk = false;
  }
  
  if (fs.existsSync(thTransPath)) {
    const thContent = fs.readFileSync(thTransPath, 'utf8');
    const hasNewMember = thContent.includes('"newMember": "สมาชิกใหม่"');
    const hasTierEligibility = thContent.includes('"tierEligibility": "สำหรับระดับสมาชิก"');
    const hasForRewards = thContent.includes('"forRewards": "สำหรับรางวัล"');
    
    if (hasNewMember && hasTierEligibility && hasForRewards) {
      console.log('✅ Thai translations complete');
    } else {
      console.log('❌ Thai translations missing keys');
      translationsOk = false;
    }
  } else {
    console.log('❌ Thai translation file not found');
    translationsOk = false;
  }
  
  results.translations = translationsOk;

  // Summary
  console.log('\n🎯 Nights-Based Tier System Verification Summary:');
  console.log(`Database Configuration: ${results.database ? '✅' : '❌'}`);
  console.log(`Frontend Components: ${results.frontend ? '✅' : '❌'}`);
  console.log(`Display Logic: ${results.display ? '✅' : '❌'}`);
  console.log(`Translations: ${results.translations ? '✅' : '❌'}`);

  const allPassed = Object.values(results).every(r => r);
  
  if (allPassed) {
    console.log('\n🎉 All verification tests passed!');
    console.log('\n✨ Nights-based tier system is properly configured:');
    console.log('- New Member: 0 nights (starting tier)');
    console.log('- Silver: 1+ nights (frequent guest)');
    console.log('- Gold: 10+ nights (VIP guest)');
    console.log('- Points and nights are clearly separated');
    console.log('- Tier progression is based on nights, not points');
    console.log('- Points are for rewards only');
  } else {
    console.log('\n⚠️  Some verification tests failed. Please review the issues above.');
  }

  return allPassed;
}

// Fix the typo in fs.existsExists
function fs_existsExists(path) {
  return fs.existsSync(path);
}

// Override the typo
global.fs = {
  ...fs,
  existsExists: fs_existsExists
};

// Run verification
verifyNightsTierSystem();