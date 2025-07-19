# Hotel Loyalty System - Agile Implementation Plan

## Overview
This plan divides the MVP into 5 feature-based phases. Each phase delivers a production-ready, usable increment that works with real data input from the frontend. The system is designed to run flawlessly in a local development environment using Docker Compose.

## Technology Stack
- **Frontend**: React with TypeScript, Vite, TailwindCSS, PWA capabilities
- **Backend**: Node.js with Express, TypeScript
- **Database**: PostgreSQL with Redis for caching/sessions
- **Infrastructure**: Docker Compose for local development
- **Authentication**: JWT with refresh tokens
- **API**: RESTful with OpenAPI documentation

## Development Environment Setup
```bash
# Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local development)
- Git

# Quick Start
git clone <repository>
cd loyalty-app
docker-compose up -d
# Access at http://localhost:3000
```

---

## Phase 1: User Authentication & Profile Foundation (Week 1-2)
**Goal**: Establish secure user registration, login, and basic profile management for customers and admins.

### Features Delivered
1. **Customer Registration & Login**
   - Email/password authentication
   - JWT token management with refresh tokens
   - Password reset functionality
   - Session management

2. **Basic Profile Management**
   - Customer can view/edit profile (name, email, phone, preferences)
   - Profile photo upload
   - Account settings

3. **Admin Authentication**
   - Separate admin login portal
   - Role-based access control (Customer, Admin, Super Admin)
   - Admin dashboard skeleton

### Technical Implementation
```
frontend/
├── src/
│   ├── pages/
│   │   ├── auth/
│   │   │   ├── Login.tsx
│   │   │   ├── Register.tsx
│   │   │   └── ResetPassword.tsx
│   │   └── profile/
│   │       └── Profile.tsx
│   ├── components/
│   │   ├── auth/
│   │   └── profile/
│   └── services/
│       └── authService.ts

backend/
├── src/
│   ├── controllers/
│   │   └── authController.ts
│   ├── models/
│   │   └── User.ts
│   ├── middleware/
│   │   └── auth.ts
│   └── routes/
│       └── auth.ts
```

### Database Schema
```sql
-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'customer',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- User profiles
CREATE TABLE user_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    preferences JSONB DEFAULT '{}',
    avatar_url VARCHAR(500)
);
```

### Acceptance Criteria
- [ ] Customer can register with email/password
- [ ] Customer can login and receive JWT token
- [ ] Customer can view and edit profile
- [ ] Admin can login to admin portal
- [ ] All forms have proper validation
- [ ] Passwords are bcrypt hashed
- [ ] JWT tokens expire and refresh properly

---

## Phase 2: Loyalty Points & Tier System (Week 3-4)
**Goal**: Implement the core loyalty program with points earning, tiers, and transaction history.

### Features Delivered
1. **Points System**
   - View current points balance
   - Points transaction history
   - Points earning from manual admin input (simulating stays)
   - Points expiration tracking

2. **Tier Management**
   - 4 tiers: Bronze, Silver, Gold, Platinum
   - Automatic tier progression based on points
   - Tier benefits display
   - Progress indicator to next tier

3. **Admin Points Management**
   - Award points to customers
   - Adjust points with reason
   - Configure earning rules
   - View all transactions

### Technical Implementation
```
frontend/
├── src/
│   ├── pages/
│   │   ├── loyalty/
│   │   │   ├── LoyaltyDashboard.tsx
│   │   │   └── PointsHistory.tsx
│   │   └── admin/
│   │       └── PointsManagement.tsx
│   └── components/
│       ├── loyalty/
│       │   ├── PointsBalance.tsx
│       │   ├── TierStatus.tsx
│       │   └── TransactionList.tsx
│       └── admin/
│           └── AwardPointsForm.tsx

backend/
├── src/
│   ├── controllers/
│   │   └── loyaltyController.ts
│   ├── models/
│   │   ├── Points.ts
│   │   └── Tier.ts
│   └── services/
│       └── loyaltyService.ts
```

### Database Schema
```sql
-- Loyalty tiers
CREATE TABLE tiers (
    id UUID PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    min_points INTEGER NOT NULL,
    benefits JSONB,
    color VARCHAR(7)
);

-- Points transactions
CREATE TABLE points_transactions (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    points INTEGER NOT NULL,
    type VARCHAR(50) NOT NULL,
    description TEXT,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- User loyalty status
CREATE TABLE user_loyalty (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    current_points INTEGER DEFAULT 0,
    lifetime_points INTEGER DEFAULT 0,
    tier_id UUID REFERENCES tiers(id),
    tier_updated_at TIMESTAMP
);
```

### Acceptance Criteria
- [ ] Customer sees real-time points balance
- [ ] Points history shows all transactions
- [ ] Tier automatically updates based on points
- [ ] Admin can award/deduct points
- [ ] Tier progression bar shows progress
- [ ] Points earning rules are configurable

---

## Phase 3: Digital Coupon System (Week 5-6)
**Goal**: Enable digital coupon creation, distribution, and redemption with QR codes.

### Features Delivered
1. **Customer Coupon Wallet**
   - View available coupons
   - View used/expired coupons
   - QR code display for redemption
   - Coupon details and terms

2. **Coupon Redemption**
   - QR code scanning (PWA camera access)
   - Manual code entry option
   - Real-time validation
   - Usage tracking

3. **Admin Coupon Management**
   - Create coupons with various types (%, fixed amount, BOGO)
   - Set validity periods and usage limits
   - Assign to specific customers or tiers
   - Track redemption analytics

### Technical Implementation
```
frontend/
├── src/
│   ├── pages/
│   │   ├── coupons/
│   │   │   ├── CouponWallet.tsx
│   │   │   └── CouponDetails.tsx
│   │   └── admin/
│   │       ├── CouponCreation.tsx
│   │       └── CouponAnalytics.tsx
│   └── components/
│       ├── coupons/
│       │   ├── CouponCard.tsx
│       │   ├── QRCode.tsx
│       │   └── Scanner.tsx
│       └── admin/
│           └── CouponForm.tsx

backend/
├── src/
│   ├── controllers/
│   │   └── couponController.ts
│   ├── models/
│   │   └── Coupon.ts
│   └── services/
│       ├── couponService.ts
│       └── qrService.ts
```

### Database Schema
```sql
-- Coupons
CREATE TABLE coupons (
    id UUID PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL,
    value DECIMAL(10,2),
    description TEXT,
    terms TEXT,
    valid_from TIMESTAMP,
    valid_until TIMESTAMP,
    usage_limit INTEGER,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- User coupons
CREATE TABLE user_coupons (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    coupon_id UUID REFERENCES coupons(id),
    status VARCHAR(50) DEFAULT 'active',
    used_at TIMESTAMP,
    qr_code TEXT
);
```

### Acceptance Criteria
- [ ] Customer can view all their coupons
- [ ] QR codes are generated for each coupon
- [ ] Admin can scan QR codes to redeem
- [ ] Coupons expire automatically
- [ ] Usage limits are enforced
- [ ] Redemption history is tracked

---

## Phase 4: Survey & Feedback System (Week 7-8)
**Goal**: Implement customer feedback collection through targeted surveys.

### Features Delivered
1. **Customer Survey Experience**
   - Receive survey notifications
   - Complete various question types
   - Save progress and resume
   - View survey history

2. **Survey Responses**
   - Multiple choice questions
   - Rating scales (1-5, 1-10)
   - Open text responses
   - Optional/required questions

3. **Admin Survey Management**
   - Create custom surveys
   - Target by customer segment
   - Schedule distribution
   - View response analytics
   - Export results

### Technical Implementation
```
frontend/
├── src/
│   ├── pages/
│   │   ├── surveys/
│   │   │   ├── SurveyList.tsx
│   │   │   └── TakeSurvey.tsx
│   │   └── admin/
│   │       ├── SurveyBuilder.tsx
│   │       └── SurveyResults.tsx
│   └── components/
│       ├── surveys/
│       │   ├── QuestionTypes/
│       │   └── SurveyProgress.tsx
│       └── admin/
│           └── QuestionBuilder.tsx

backend/
├── src/
│   ├── controllers/
│   │   └── surveyController.ts
│   ├── models/
│   │   ├── Survey.ts
│   │   └── Response.ts
│   └── services/
│       └── surveyService.ts
```

### Database Schema
```sql
-- Surveys
CREATE TABLE surveys (
    id UUID PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    questions JSONB NOT NULL,
    target_segment JSONB,
    status VARCHAR(50) DEFAULT 'draft',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Survey responses
CREATE TABLE survey_responses (
    id UUID PRIMARY KEY,
    survey_id UUID REFERENCES surveys(id),
    user_id UUID REFERENCES users(id),
    answers JSONB NOT NULL,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Acceptance Criteria
- [ ] Customer receives survey notifications
- [ ] All question types work correctly
- [ ] Progress is saved automatically
- [ ] Admin can create complex surveys
- [ ] Results show real-time analytics
- [ ] Data can be exported to CSV

---

## Phase 5: Marketing Campaign Management (Week 9-10)
**Goal**: Enable targeted marketing communications with push notifications and analytics.

### Features Delivered
1. **Customer Notifications**
   - Receive push notifications (PWA)
   - In-app notification center
   - Notification preferences
   - Rich media support

2. **Campaign Delivery**
   - Targeted customer segments
   - Scheduled campaigns
   - A/B testing support
   - Multi-channel (push, in-app, email)

3. **Admin Campaign Tools**
   - Visual campaign builder
   - Customer segmentation
   - Campaign scheduling
   - Performance analytics
   - Template library

### Technical Implementation
```
frontend/
├── src/
│   ├── pages/
│   │   ├── notifications/
│   │   │   └── NotificationCenter.tsx
│   │   └── admin/
│   │       ├── CampaignBuilder.tsx
│   │       └── CampaignAnalytics.tsx
│   ├── components/
│   │   └── campaigns/
│   └── service-worker.js

backend/
├── src/
│   ├── controllers/
│   │   └── campaignController.ts
│   ├── models/
│   │   └── Campaign.ts
│   └── services/
│       ├── campaignService.ts
│       └── pushService.ts
```

### Database Schema
```sql
-- Campaigns
CREATE TABLE campaigns (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    content JSONB NOT NULL,
    segment_criteria JSONB,
    scheduled_at TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Campaign recipients
CREATE TABLE campaign_recipients (
    id UUID PRIMARY KEY,
    campaign_id UUID REFERENCES campaigns(id),
    user_id UUID REFERENCES users(id),
    status VARCHAR(50),
    opened_at TIMESTAMP,
    clicked_at TIMESTAMP,
    sent_at TIMESTAMP
);

-- Push subscriptions
CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    endpoint TEXT NOT NULL,
    keys JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Acceptance Criteria
- [ ] Push notifications work on mobile/desktop
- [ ] Customers can manage preferences
- [ ] Campaigns reach targeted segments
- [ ] Analytics show open/click rates
- [ ] Scheduled campaigns send on time
- [ ] A/B testing produces clear results

---

## Post-MVP Considerations

### Performance Optimizations
- Implement caching strategies
- Add CDN for static assets
- Optimize database queries
- Implement lazy loading

### Security Enhancements
- Add 2FA authentication
- Implement rate limiting
- Add security headers
- Regular security audits

### Additional Features (Future)
- Social login integration
- Multi-language support
- Dark mode
- Mobile app versions
- PMS integration
- Online booking integration

## Success Metrics

### Technical Metrics
- Page load time < 3s
- API response time < 200ms
- 99.9% uptime
- Zero critical security vulnerabilities

### Business Metrics
- User registration rate
- Points redemption rate
- Coupon usage rate
- Survey completion rate
- Campaign engagement rate

## Risk Mitigation

### Technical Risks
- **PWA Limitations**: Provide fallbacks for unsupported features
- **Browser Compatibility**: Test across major browsers
- **Data Privacy**: Implement GDPR compliance from start

### Business Risks
- **User Adoption**: Focus on UX and onboarding
- **Admin Training**: Provide comprehensive documentation
- **Scalability**: Design for growth from the beginning