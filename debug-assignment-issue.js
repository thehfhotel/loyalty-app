const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'loyalty_db',
  user: 'loyalty',
  password: 'loyalty_pass'
});

async function debugAssignmentIssue() {
  console.log('🔍 Debugging Assignment Issue...\n');
  
  const client = await pool.connect();
  
  try {
    // Get the customer user
    const userResult = await client.query(`
      SELECT id, email FROM users WHERE email = 'customer@hotel.com'
    `);
    
    if (userResult.rows.length === 0) {
      console.log('❌ Customer user not found');
      return;
    }
    
    const user = userResult.rows[0];
    console.log('✅ User found:', user.email, user.id);
    
    // Get an active coupon
    const couponResult = await client.query(`
      SELECT id, code, name, status FROM coupons 
      WHERE status = 'active' 
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    
    if (couponResult.rows.length === 0) {
      console.log('❌ No active coupons found');
      return;
    }
    
    const coupon = couponResult.rows[0];
    console.log('✅ Active coupon found:', coupon.code, coupon.id);
    
    // Check existing user_coupons for this combination
    const existingResult = await client.query(`
      SELECT id, status, qr_code, created_at 
      FROM user_coupons 
      WHERE user_id = $1 AND coupon_id = $2
      ORDER BY created_at DESC
    `, [user.id, coupon.id]);
    
    console.log(`\n📊 Found ${existingResult.rows.length} existing user_coupons for this combination:`);
    existingResult.rows.forEach((uc, index) => {
      console.log(`  ${index + 1}. Status: ${uc.status}, QR: ${uc.qr_code}, Created: ${uc.created_at}`);
    });
    
    // Test the stored procedure directly
    console.log('\n🎯 Testing stored procedure with detailed logging...');
    
    try {
      await client.query('BEGIN');
      
      // Try to assign
      const result = await client.query(`
        SELECT assign_coupon_to_user($1, $2, $3, $4, $5) as user_coupon_id
      `, [coupon.id, user.id, user.id, 'Debug assignment test', null]);
      
      console.log('✅ Stored procedure succeeded');
      console.log('📊 Result:', result.rows[0]);
      
      // Check if it was really created
      if (result.rows[0].user_coupon_id) {
        const checkResult = await client.query(`
          SELECT id, qr_code, status, created_at
          FROM user_coupons 
          WHERE id = $1
        `, [result.rows[0].user_coupon_id]);
        
        if (checkResult.rows.length > 0) {
          console.log('✅ User coupon created successfully:', checkResult.rows[0]);
        } else {
          console.log('❌ User coupon not found after creation');
        }
      }
      
      await client.query('ROLLBACK'); // Don't save
      
    } catch (spError) {
      await client.query('ROLLBACK');
      console.log('❌ Stored procedure failed:');
      console.log('  Error:', spError.message);
      console.log('  Code:', spError.code);
      console.log('  Detail:', spError.detail);
      console.log('  Constraint:', spError.constraint);
    }
    
    // Check the unique constraint in detail
    console.log('\n🔍 Checking constraint violations...');
    
    // Test if constraint would be violated
    if (existingResult.rows.length > 0) {
      const statusCounts = {};
      existingResult.rows.forEach(row => {
        statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
      });
      
      console.log('📊 Status distribution:', statusCounts);
      
      if (statusCounts['available'] > 0) {
        console.log('⚠️  User already has an available coupon for this coupon type');
        console.log('   This violates the unique constraint: (user_id, coupon_id, status)');
      }
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

debugAssignmentIssue();