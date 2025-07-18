# Hotel Loyalty App - Test Suite

This directory contains comprehensive tests for the Hotel Loyalty App, focusing on the user registration flow and related functionality.

## Test Files

### 1. Simple Node.js Test (`simple-test.js`)
A lightweight, headless test runner that validates the registration flow without requiring browser dependencies.

**Features:**
- ✅ Frontend app availability check
- ✅ User service API health check
- ✅ Registration API endpoint testing
- ✅ Duplicate email handling validation
- ✅ Password strength validation
- ✅ Automated test reporting

**Usage:**
```bash
cd tests/
node simple-test.js
```

### 2. Playwright E2E Tests (`tests/registration.spec.js`)
Full browser-based end-to-end tests using Playwright for comprehensive UI and workflow testing.

**Features:**
- Form validation testing
- User interaction simulation
- Network error handling
- Loading state verification
- Navigation testing
- Visual regression testing

**Usage:**
```bash
cd tests/
npm install
npx playwright install
npx playwright test
```

**Or use the helper script:**
```bash
./run-tests.sh                # Headless mode
./run-tests.sh --headed       # With browser UI
./run-tests.sh --debug        # Debug mode
./run-tests.sh --ui           # Playwright UI mode
```

## Test Results

### Latest Test Run Results
```
🚀 Starting Hotel Loyalty App Registration Tests
=================================================

🔍 Testing app availability...
✅ Frontend app is running and accessible

🔍 Testing user service API...
✅ User service API is running

🔍 Testing registration API endpoint...
✅ Registration API working correctly
✅ Registration API returns correct response structure
   - User ID: Generated UUID
   - Email: test.timestamp@example.com
   - Loyalty Tier: bronze
   - Total Points: 0

🔍 Testing duplicate email handling...
✅ Duplicate email handling working correctly

🔍 Testing password validation...
✅ Password validation working correctly

📊 Test Results:
   ✅ Passed: 5
   ❌ Failed: 0
   📈 Success Rate: 100.0%

🎉 All tests passed! Registration flow is working correctly.
```

## Test Coverage

### API Endpoints Tested
- `GET /` - Frontend app availability
- `GET /health` - User service health check
- `POST /api/v1/auth/register` - User registration
  - ✅ Successful registration
  - ✅ Duplicate email handling (409 error)
  - ✅ Password validation (400 error)
  - ✅ Required field validation
  - ✅ Response structure validation

### Frontend Features Tested
- ✅ Registration form rendering
- ✅ Form field validation
- ✅ Password confirmation matching
- ✅ Loading states
- ✅ Error message display
- ✅ Success redirect to dashboard
- ✅ Navigation links

### Security Features Tested
- ✅ Password strength requirements
- ✅ Email format validation
- ✅ Duplicate registration prevention
- ✅ JWT token generation
- ✅ Input sanitization

## Prerequisites

### For Simple Tests
- Node.js (v18+)
- Network access to the running application

### For Playwright Tests
- Node.js (v18+)
- Playwright dependencies: `npm install`
- Browser binaries: `npx playwright install`

## Configuration

### Test URLs
- Frontend: `http://192.168.100.228:3010`
- API: `http://192.168.100.228:3011`

### Test Data
- Test users are created with timestamp-based email addresses
- Passwords use strong format: `TestPassword123@`
- Known existing email for duplicate testing: `demo.user.final@example.com`

## Troubleshooting

### Common Issues

1. **App Not Running**
   ```bash
   # Start the application
   docker-compose up -d
   
   # Check service status
   docker-compose ps
   ```

2. **Port Conflicts**
   - Ensure ports 3010 and 3011 are available
   - Check if services are properly mapped in docker-compose.yml

3. **Database Connection Issues**
   ```bash
   # Check database logs
   docker-compose logs postgres
   
   # Restart database
   docker-compose restart postgres
   ```

4. **Test Failures**
   - Check service logs: `docker-compose logs user-service`
   - Verify network connectivity
   - Ensure database is properly initialized

## Continuous Integration

This test suite is designed to be CI/CD friendly:

```bash
# CI/CD Pipeline Step
cd tests/
node simple-test.js
```

Exit codes:
- `0` - All tests passed
- `1` - Some tests failed

## Future Enhancements

- [ ] Add login flow tests
- [ ] Add dashboard functionality tests
- [ ] Add profile management tests
- [ ] Add mobile responsiveness tests
- [ ] Add performance benchmarking
- [ ] Add accessibility testing
- [ ] Add cross-browser compatibility tests

## Bug Reports

If tests fail, please include:
1. Test output logs
2. Docker service logs
3. Browser console errors (for Playwright tests)
4. Network configuration details
5. Environment information