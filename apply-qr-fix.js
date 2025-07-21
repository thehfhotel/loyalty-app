const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'loyalty_db',
  user: 'loyalty',
  password: 'loyalty_pass'
});

async function applyQRCodeFix() {
  console.log('🔧 Applying QR Code Function Fix...\n');
  
  const client = await pool.connect();
  
  try {
    // Read the SQL fix
    const fixSQL = fs.readFileSync('./fix-qr-code-function.sql', 'utf8');
    
    console.log('📝 Executing SQL fix...');
    await client.query(fixSQL);
    console.log('✅ QR code function fix applied successfully');
    
    // Test the fixed function
    console.log('\n🧪 Testing fixed function...');
    const testResult = await client.query('SELECT generate_qr_code() as test_qr');
    console.log('✅ Generated test QR code:', testResult.rows[0].test_qr);
    
    // Now test the coupon assignment
    console.log('\n🎯 Testing coupon assignment with fixed function...');
    
    const couponResult = await client.query(`
      SELECT id FROM coupons WHERE code = 'TEST865679' AND status = 'active'
    `);
    
    const userResult = await client.query(`
      SELECT id FROM users WHERE email = 'customer@hotel.com'
    `);
    
    if (couponResult.rows.length > 0 && userResult.rows.length > 0) {
      const couponId = couponResult.rows[0].id;
      const userId = userResult.rows[0].id;
      
      try {
        await client.query('BEGIN');
        
        const assignResult = await client.query(`
          SELECT assign_coupon_to_user($1, $2, $3, $4, $5) as user_coupon_id
        `, [couponId, userId, userId, 'Test assignment after fix', null]);
        
        console.log('✅ Assignment successful! User coupon ID:', assignResult.rows[0].user_coupon_id);
        
        // Get the created user coupon details
        const userCouponResult = await client.query(`
          SELECT qr_code, status, expires_at
          FROM user_coupons 
          WHERE id = $1
        `, [assignResult.rows[0].user_coupon_id]);
        
        if (userCouponResult.rows.length > 0) {
          const userCoupon = userCouponResult.rows[0];
          console.log('📊 Created user coupon:');
          console.log('  QR Code:', userCoupon.qr_code);
          console.log('  Status:', userCoupon.status);
          console.log('  Expires:', userCoupon.expires_at);
          
          console.log('\n🎉 COUPON ACTIVATION IS NOW FIXED!');
        }
        
        await client.query('COMMIT');
        
      } catch (assignError) {
        await client.query('ROLLBACK');
        console.log('❌ Assignment still failed:', assignError.message);
      }
    } else {
      console.log('❌ Coupon or user not found for testing');
    }
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

applyQRCodeFix();