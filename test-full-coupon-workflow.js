const fetch = require('node-fetch');

async function testFullCouponWorkflow() {
  console.log('🎉 Testing Complete Coupon Workflow...\n');
  
  try {
    // Login as customer
    const customerLoginResponse = await fetch('http://localhost:4000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'customer@hotel.com',
        password: 'customer123'
      })
    });
    
    if (!customerLoginResponse.ok) {
      console.log('❌ Customer login failed');
      return;
    }
    
    const customerLoginData = await customerLoginResponse.json();
    const customerToken = customerLoginData.tokens?.accessToken;
    console.log('✅ Customer login successful');
    
    // Get customer's coupons
    const customerCouponsResponse = await fetch('http://localhost:4000/api/coupons/my-coupons', {
      headers: {
        'Authorization': `Bearer ${customerToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const customerCouponsData = await customerCouponsResponse.json();
    const customerCoupons = customerCouponsData.data?.coupons || [];
    
    if (customerCoupons.length === 0) {
      console.log('❌ Customer has no coupons');
      return;
    }
    
    console.log(`✅ Customer has ${customerCoupons.length} coupon(s)`);
    
    const testCoupon = customerCoupons[0];
    console.log(`🎫 Testing with coupon: ${testCoupon.name} (${testCoupon.code})`);
    console.log(`📱 QR Code: ${testCoupon.qrCode}`);
    
    // Test QR validation
    console.log('\n🔍 Testing QR validation...');
    const validateResponse = await fetch(`http://localhost:4000/api/coupons/validate/${testCoupon.qrCode}`);
    const validateData = await validateResponse.json();
    
    console.log('📊 Validation response:', JSON.stringify(validateData, null, 2));
    
    if (validateData.valid) {
      console.log('✅ QR validation successful!');
      
      // Test redemption
      console.log('\n💰 Testing coupon redemption...');
      const redeemResponse = await fetch('http://localhost:4000/api/coupons/redeem', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${customerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          qrCode: testCoupon.qrCode,
          originalAmount: 100.00,
          transactionReference: `WORKFLOW_TEST_${Date.now()}`,
          location: 'Hotel Reception'
        })
      });
      
      const redeemData = await redeemResponse.json();
      console.log('📊 Redemption response:', JSON.stringify(redeemData, null, 2));
      
      if (redeemData.success) {
        console.log('\n🎊 COMPLETE SUCCESS! Full coupon workflow is working!');
        console.log(`💰 Original Amount: $${redeemData.data.originalAmount}`);
        console.log(`💸 Discount Amount: $${redeemData.data.discountAmount}`);
        console.log(`💵 Final Amount: $${redeemData.data.finalAmount}`);
      } else {
        console.log('❌ Redemption failed:', redeemData.message);
      }
    } else {
      console.log('❌ QR validation failed:', validateData.message);
      
      // Let's debug the validation endpoint
      console.log('\n🔧 Debugging validation endpoint...');
      
      // Check if the QR code exists in the database using the admin API
      const adminLoginResponse = await fetch('http://localhost:4000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@hotel.com',
          password: 'admin123'
        })
      });
      
      if (adminLoginResponse.ok) {
        const adminLoginData = await adminLoginResponse.json();
        const adminToken = adminLoginData.tokens?.accessToken;
        
        // Try to validate as admin or check the database
        console.log('🔍 Checking QR code existence...');
        console.log(`QR Code being validated: "${testCoupon.qrCode}"`);
        console.log(`Length: ${testCoupon.qrCode.length}`);
        console.log(`Type: ${typeof testCoupon.qrCode}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Workflow test failed:', error.message);
  }
}

testFullCouponWorkflow();