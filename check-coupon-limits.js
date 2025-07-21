const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'loyalty_db',
  user: 'loyalty',
  password: 'loyalty_pass'
});

async function checkCouponLimits() {
  console.log('🔍 Checking Coupon Usage Limits...\n');
  
  const client = await pool.connect();
  
  try {
    // Get the coupon details
    const couponResult = await client.query(`
      SELECT 
        id, code, name, usage_limit, usage_limit_per_user, used_count
      FROM coupons 
      WHERE code = 'TEST865679'
    `);
    
    const coupon = couponResult.rows[0];
    console.log('📊 Coupon Details:');
    console.log('  Code:', coupon.code);
    console.log('  Name:', coupon.name);
    console.log('  Total Usage Limit:', coupon.usage_limit);
    console.log('  Usage Limit Per User:', coupon.usage_limit_per_user);
    console.log('  Current Used Count:', coupon.used_count);
    
    // Get user coupon history for this coupon
    const userCouponResult = await client.query(`
      SELECT 
        user_id, status, used_at, created_at,
        (SELECT email FROM users WHERE id = user_coupons.user_id) as user_email
      FROM user_coupons 
      WHERE coupon_id = $1
      ORDER BY created_at DESC
    `, [coupon.id]);
    
    console.log(`\n📊 User Coupon History (${userCouponResult.rows.length} records):`);
    userCouponResult.rows.forEach((uc, index) => {
      console.log(`  ${index + 1}. User: ${uc.user_email}, Status: ${uc.status}, Created: ${uc.created_at}, Used: ${uc.used_at || 'N/A'}`);
    });
    
    // Count by user and status
    const customerCoupons = userCouponResult.rows.filter(uc => uc.user_email === 'customer@hotel.com');
    console.log(`\n📊 Customer's coupon count for this coupon: ${customerCoupons.length}`);
    
    const statusCounts = {};
    customerCoupons.forEach(uc => {
      statusCounts[uc.status] = (statusCounts[uc.status] || 0) + 1;
    });
    console.log('📊 Status breakdown:', statusCounts);
    
    const nonRevokedCount = customerCoupons.filter(uc => uc.status !== 'revoked').length;
    console.log(`📊 Non-revoked count: ${nonRevokedCount}`);
    console.log(`📊 Limit per user: ${coupon.usage_limit_per_user}`);
    
    if (nonRevokedCount >= coupon.usage_limit_per_user) {
      console.log('❌ User has reached their usage limit for this coupon');
      console.log(`   Current count (${nonRevokedCount}) >= Limit (${coupon.usage_limit_per_user})`);
      
      if (statusCounts['used'] > 0) {
        console.log('\n💡 Suggestion: Change the stored procedure logic to only count');
        console.log('   "available" status coupons for the usage limit check,');
        console.log('   not all non-revoked statuses.');
      }
    } else {
      console.log('✅ User should be able to get another coupon');
    }
    
  } catch (error) {
    console.error('❌ Check failed:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkCouponLimits();