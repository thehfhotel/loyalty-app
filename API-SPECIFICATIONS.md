# **Hotel Loyalty App - API Specifications**

## **API Gateway Configuration**

**Base URL:** `https://api.saichon.com`

**Authentication:** JWT Bearer Token

**Rate Limiting:** 
- 100 requests/minute per user
- 1000 requests/minute per service

---

## **1. User Service API**

**Base Path:** `/api/v1/users`

### **Authentication Endpoints**

#### **POST** `/auth/register`
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "firstName": "John",
  "lastName": "Doe",
  "phoneNumber": "+1234567890",
  "preferences": {
    "roomType": "deluxe",
    "smokingPreference": "non-smoking"
  }
}
```

#### **POST** `/auth/login`
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

#### **GET** `/profile`
*Requires Authentication*
```json
{
  "id": "user-uuid",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "phoneNumber": "+1234567890",
  "loyaltyId": "LOY123456",
  "preferences": {},
  "createdAt": "2024-01-01T00:00:00Z",
  "lastLogin": "2024-01-15T12:00:00Z"
}
```

#### **PUT** `/profile`
*Requires Authentication*

---

## **2. Loyalty Service API**

**Base Path:** `/api/v1/loyalty`

### **Points & Tiers**

#### **GET** `/points/balance`
*Requires Authentication*
```json
{
  "userId": "user-uuid",
  "currentBalance": 2500,
  "totalEarned": 10000,
  "totalRedeemed": 7500,
  "tier": {
    "current": "Gold",
    "nextTier": "Platinum",
    "pointsToNext": 2500,
    "benefits": [
      "Free room upgrade",
      "Late checkout",
      "Welcome drink"
    ]
  }
}
```

#### **GET** `/points/history`
*Requires Authentication*
```json
{
  "transactions": [
    {
      "id": "txn-uuid",
      "type": "earned",
      "amount": 500,
      "description": "Stay at Downtown Hotel",
      "date": "2024-01-10T00:00:00Z",
      "reference": "booking-123"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

#### **POST** `/points/redeem`
*Requires Authentication*
```json
{
  "rewardId": "reward-uuid",
  "pointsToRedeem": 1000
}
```

#### **GET** `/tiers`
```json
{
  "tiers": [
    {
      "id": "bronze",
      "name": "Bronze",
      "minPoints": 0,
      "benefits": ["Welcome drink"],
      "color": "#CD7F32"
    },
    {
      "id": "silver",
      "name": "Silver",
      "minPoints": 5000,
      "benefits": ["Welcome drink", "Late checkout"],
      "color": "#C0C0C0"
    }
  ]
}
```

---

## **3. Campaign Service API**

**Base Path:** `/api/v1/campaigns`

### **Campaign Management**

#### **POST** `/campaigns`
*Requires Admin Authentication*
```json
{
  "title": "Summer Special Offer",
  "content": "Get 20% off on all weekend stays!",
  "targetSegments": ["gold", "platinum"],
  "startDate": "2024-06-01T00:00:00Z",
  "endDate": "2024-08-31T23:59:59Z",
  "pushNotification": true,
  "emailCampaign": true
}
```

#### **GET** `/campaigns/user`
*Requires Authentication*
```json
{
  "campaigns": [
    {
      "id": "campaign-uuid",
      "title": "Summer Special Offer",
      "content": "Get 20% off on all weekend stays!",
      "imageUrl": "https://example.com/image.jpg",
      "ctaText": "Book Now",
      "ctaUrl": "https://booking.example.com",
      "createdAt": "2024-05-15T00:00:00Z"
    }
  ]
}
```

#### **POST** `/campaigns/{campaignId}/track`
*Requires Authentication*
```json
{
  "action": "viewed|clicked|dismissed"
}
```

---

## **4. Survey Service API**

**Base Path:** `/api/v1/surveys`

### **Survey Management**

#### **POST** `/surveys`
*Requires Admin Authentication*
```json
{
  "title": "Guest Satisfaction Survey",
  "description": "Help us improve your experience",
  "questions": [
    {
      "id": "q1",
      "type": "rating",
      "question": "How was your overall experience?",
      "required": true,
      "options": {
        "min": 1,
        "max": 5,
        "labels": ["Poor", "Fair", "Good", "Very Good", "Excellent"]
      }
    },
    {
      "id": "q2",
      "type": "multiple_choice",
      "question": "What did you like most?",
      "required": false,
      "options": [
        "Room comfort",
        "Staff service",
        "Food quality",
        "Location"
      ]
    }
  ],
  "targetSegments": ["recent_guests"],
  "active": true
}
```

#### **GET** `/surveys/user`
*Requires Authentication*
```json
{
  "surveys": [
    {
      "id": "survey-uuid",
      "title": "Guest Satisfaction Survey",
      "description": "Help us improve your experience",
      "questions": [...],
      "completed": false,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### **POST** `/surveys/{surveyId}/submit`
*Requires Authentication*
```json
{
  "responses": [
    {
      "questionId": "q1",
      "answer": 4
    },
    {
      "questionId": "q2",
      "answer": ["Room comfort", "Staff service"]
    }
  ]
}
```

---

## **5. Coupon Service API**

**Base Path:** `/api/v1/coupons`

### **Coupon Management**

#### **POST** `/coupons`
*Requires Admin Authentication*
```json
{
  "code": "SUMMER20",
  "title": "Summer Discount",
  "description": "20% off on all bookings",
  "discountType": "percentage",
  "discountValue": 20,
  "minSpend": 100,
  "maxDiscount": 50,
  "validFrom": "2024-06-01T00:00:00Z",
  "validUntil": "2024-08-31T23:59:59Z",
  "usageLimit": 1,
  "targetSegments": ["gold", "platinum"],
  "active": true
}
```

#### **GET** `/coupons/user`
*Requires Authentication*
```json
{
  "coupons": [
    {
      "id": "coupon-uuid",
      "code": "SUMMER20",
      "title": "Summer Discount",
      "description": "20% off on all bookings",
      "discountType": "percentage",
      "discountValue": 20,
      "validUntil": "2024-08-31T23:59:59Z",
      "used": false,
      "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
      "barcode": "123456789012"
    }
  ]
}
```

#### **POST** `/coupons/{couponId}/redeem`
*Requires Authentication*
```json
{
  "bookingReference": "BOOK123456",
  "amount": 100
}
```

#### **POST** `/coupons/validate`
*Requires Authentication*
```json
{
  "code": "SUMMER20",
  "bookingAmount": 150
}
```

---

## **6. Notification Service API**

**Base Path:** `/api/v1/notifications`

### **Notification Management**

#### **POST** `/push/subscribe`
*Requires Authentication*
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": {
    "p256dh": "key-data",
    "auth": "auth-data"
  }
}
```

#### **GET** `/notifications/user`
*Requires Authentication*
```json
{
  "notifications": [
    {
      "id": "notification-uuid",
      "type": "campaign",
      "title": "New Offer Available!",
      "message": "Check out our summer special offer",
      "read": false,
      "createdAt": "2024-01-15T12:00:00Z"
    }
  ]
}
```

#### **PUT** `/notifications/{notificationId}/read`
*Requires Authentication*

---

## **7. Analytics Service API**

**Base Path:** `/api/v1/analytics`

### **Event Tracking**

#### **POST** `/events`
*Requires Authentication*
```json
{
  "eventType": "page_view",
  "eventData": {
    "page": "coupons",
    "timestamp": "2024-01-15T12:00:00Z",
    "userAgent": "Mozilla/5.0...",
    "sessionId": "session-uuid"
  }
}
```

#### **GET** `/dashboard/kpis`
*Requires Admin Authentication*
```json
{
  "customerEngagement": {
    "activeUsers": 1250,
    "appInstalls": 5000,
    "sessionDuration": 180
  },
  "loyaltyMetrics": {
    "pointsEarned": 50000,
    "redemptionRate": 0.15,
    "tierUpgrades": 25
  },
  "campaignPerformance": {
    "clickThroughRate": 0.08,
    "conversionRate": 0.05
  }
}
```

---

## **8. Integration Service API**

**Base Path:** `/api/v1/integrations`

### **PMS Integration**

#### **POST** `/pms/sync`
*Requires Admin Authentication*
```json
{
  "bookingData": {
    "bookingId": "BOOK123456",
    "guestEmail": "guest@example.com",
    "checkIn": "2024-01-15T15:00:00Z",
    "checkOut": "2024-01-17T11:00:00Z",
    "totalAmount": 250.00,
    "roomType": "deluxe"
  }
}
```

#### **GET** `/pms/guest/{email}`
*Requires Admin Authentication*
```json
{
  "guestData": {
    "email": "guest@example.com",
    "totalStays": 5,
    "totalSpent": 2500.00,
    "lastStay": "2024-01-17T11:00:00Z",
    "preferences": {
      "roomType": "deluxe",
      "floor": "high"
    }
  }
}
```

---

## **Error Handling**

### **Standard Error Response**
```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "The request is invalid",
    "details": [
      {
        "field": "email",
        "message": "Email is required"
      }
    ]
  },
  "timestamp": "2024-01-15T12:00:00Z",
  "requestId": "req-uuid"
}
```

### **HTTP Status Codes**
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `422` - Validation Error
- `429` - Rate Limited
- `500` - Internal Server Error

---

## **Security**

### **Authentication**
- JWT tokens with 24-hour expiry
- Refresh tokens with 30-day expiry
- Token blacklisting for logout

### **Authorization**
- Role-based access control (RBAC)
- Scope-based permissions
- Admin vs User access levels

### **Data Protection**
- All sensitive data encrypted at rest
- TLS 1.3 for data in transit
- PII anonymization in logs

---

## **Rate Limiting**

### **Per User Limits**
- Authentication: 5 requests/minute
- Profile updates: 10 requests/minute
- General API: 100 requests/minute

### **Per Service Limits**
- Internal service communication: 1000 requests/minute
- Admin operations: 500 requests/minute