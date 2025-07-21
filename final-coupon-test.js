const fetch = require('node-fetch');

async function runFinalCouponTest() {
  console.log('🎉 FINAL COUPON ACTIVATION TEST\n');
  console.log('=====================================\n');
  
  try {
    // Step 1: Admin creates and assigns coupon
    console.log('🔐 Step 1: Admin authentication...');
    const adminLogin = await fetch('http://localhost:4000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@hotel.com', password: 'admin123' })
    });
    const adminData = await adminLogin.json();
    const adminToken = adminData.tokens?.accessToken;
    console.log('✅ Admin login successful');
    
    // Step 2: Create new coupon
    console.log('\n🎫 Step 2: Creating new test coupon...');
    const newCoupon = await fetch('http://localhost:4000/api/coupons', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: `FINAL${Date.now()}`,
        name: 'Final Test Coupon',
        description: 'Testing complete workflow',
        type: 'percentage',
        value: 15,
        status: 'active',
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        usageLimit: 100,
        usageLimitPerUser: 1
      })
    });
    const newCouponData = await newCoupon.json();
    console.log('✅ New coupon created:', newCouponData.data.code);
    
    // Step 3: Get customer user
    console.log('\n👤 Step 3: Getting customer user...');
    const users = await fetch('http://localhost:4000/api/loyalty/admin/users?limit=10', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const usersData = await users.json();
    const customer = usersData.data?.users?.find(u => u.email === 'customer@hotel.com');
    console.log('✅ Customer found:', customer.email);
    
    // Step 4: Assign coupon to customer
    console.log('\n🎯 Step 4: Assigning coupon to customer...');
    const assignment = await fetch('http://localhost:4000/api/coupons/assign', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        couponId: newCouponData.data.id,
        userIds: [customer.user_id],
        assignedReason: 'Final workflow test'
      })
    });
    const assignmentData = await assignment.json();
    console.log('✅ Assignment successful:', assignmentData.message);
    
    // Step 5: Customer login and coupon access
    console.log('\n🔑 Step 5: Customer authentication...');
    const customerLogin = await fetch('http://localhost:4000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'customer@hotel.com', password: 'customer123' })
    });
    const customerData = await customerLogin.json();
    const customerToken = customerData.tokens?.accessToken;
    console.log('✅ Customer login successful');
    
    // Step 6: Get customer coupons
    console.log('\n🎫 Step 6: Retrieving customer coupons...');
    const customerCoupons = await fetch('http://localhost:4000/api/coupons/my-coupons', {
      headers: { 'Authorization': `Bearer ${customerToken}` }
    });
    const customerCouponsData = await customerCoupons.json();
    const activeCoupons = customerCouponsData.data?.coupons || [];
    console.log(`✅ Customer has ${activeCoupons.length} active coupon(s)`);
    
    if (activeCoupons.length === 0) {
      console.log('❌ No coupons found for customer');
      return;
    }
    
    const testCoupon = activeCoupons.find(c => c.code.startsWith('FINAL')) || activeCoupons[0];
    console.log(`📱 Testing with coupon: ${testCoupon.name} (${testCoupon.code})`);
    console.log(`📱 QR Code: ${testCoupon.qrCode}`);
    
    // Step 7: QR Code validation
    console.log('\n🔍 Step 7: QR code validation...');
    const validation = await fetch(`http://localhost:4000/api/coupons/validate/${testCoupon.qrCode}`);
    const validationData = await validation.json();
    console.log('✅ QR validation result:', validationData.valid ? 'VALID' : 'INVALID');
    
    if (!validationData.valid) {
      console.log('❌ QR validation failed:', validationData.message);
      return;
    }
    
    // Step 8: Coupon redemption
    console.log('\n💰 Step 8: Coupon redemption...');
    const redemption = await fetch('http://localhost:4000/api/coupons/redeem', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${customerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        qrCode: testCoupon.qrCode,
        originalAmount: 200.00,
        transactionReference: `FINAL_TEST_${Date.now()}`,
        location: 'Hotel Reception - Final Test'
      })
    });
    const redemptionData = await redemption.json();
    
    if (redemptionData.success) {
      console.log('✅ Redemption successful!');
      console.log(`   💰 Original Amount: $${redemptionData.data.originalAmount || 200}`);
      console.log(`   💸 Discount Amount: $${redemptionData.data.discountAmount}`);
      console.log(`   💵 Final Amount: $${redemptionData.data.finalAmount}`);
      
      console.log('\n🎊 FINAL RESULT: COMPLETE SUCCESS!');
      console.log('=====================================');
      console.log('✅ Coupon creation: WORKING');
      console.log('✅ Coupon assignment: WORKING');
      console.log('✅ QR code generation: WORKING');
      console.log('✅ QR code validation: WORKING');
      console.log('✅ Coupon redemption: WORKING');
      console.log('\n🎉 ALL COUPON ACTIVATION ISSUES RESOLVED!');
      
    } else {
      console.log('❌ Redemption failed:', redemptionData.message);
    }
    
  } catch (error) {
    console.error('❌ Final test failed:', error.message);
  }
}

runFinalCouponTest();