# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Hotel Loyalty App - Project Configuration

## Project Overview

This is a **Hotel Loyalty Progressive Web App (PWA)** built with a microservices architecture. The application enables hotels to manage customer loyalty programs, campaigns, surveys, and coupons through a modern web interface.

**Current Status:** Planning/Documentation Phase - Services not yet implemented

## Architecture

### Microservices Structure
```
loyalty-app/
├── services/
│   ├── user-service/          # Authentication & user management
│   ├── loyalty-service/       # Points, tiers, rewards
│   ├── campaign-service/      # Marketing campaigns
│   ├── survey-service/        # Feedback surveys
│   ├── coupon-service/        # Coupon management
│   ├── notification-service/  # Push notifications
│   ├── analytics-service/     # Event tracking & KPIs
│   └── integration-service/   # PMS & external APIs
├── frontend/                  # React PWA
├── database/                  # PostgreSQL schemas
├── monitoring/                # Prometheus/Grafana config
└── docker-compose.yml         # Container orchestration
```

### Key Technologies
- **Backend:** Node.js + Express.js microservices
- **Frontend:** React.js PWA with TypeScript
- **Database:** PostgreSQL with Redis caching
- **Message Queue:** RabbitMQ
- **API Gateway:** Kong
- **Containerization:** Docker Compose
- **Monitoring:** Prometheus + Grafana

## Development Commands

### Environment Setup
```bash
# Start all services
docker-compose up -d

# Start specific service
docker-compose up user-service

# View logs
docker-compose logs -f [service-name]

# Stop all services
docker-compose down

# Rebuild services
docker-compose build
```

### Testing
**Note:** Testing commands are planned for when services are implemented
```bash
# Run all tests
npm run test

# Run service-specific tests
npm run test:user-service

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e
```

### Development Workflow
**Note:** These commands are planned for when services are implemented
```bash
# Install dependencies (per service)
cd services/[service-name] && npm install

# Start development server
npm run dev

# Build for production
npm run build

# Run linting
npm run lint

# Run type checking
npm run type-check
```

## API Endpoints

### Gateway URL
- **Development:** `http://localhost:8000`
- **Production:** `https://api.saichon.com`

### Service Ports
- API Gateway: 8000
- User Service: 3011
- Loyalty Service: 3012
- Campaign Service: 3013
- Survey Service: 3014
- Coupon Service: 3015
- Notification Service: 3016
- Analytics Service: 3017
- Integration Service: 3018
- PWA Frontend: 3010

## Database Schema

### Core Tables
- `users` - User authentication and profiles
- `loyalty_tiers` - Loyalty tier definitions
- `loyalty_points` - Points transactions
- `campaigns` - Marketing campaigns
- `surveys` - Survey definitions and responses
- `coupons` - Coupon management
- `notifications` - Notification history
- `analytics_events` - Event tracking

## Key Features

### Customer Features
- User registration and authentication
- Loyalty points tracking and tier status
- Coupon wallet with QR codes
- Survey participation
- Marketing campaign viewing
- Push notifications

### Admin Features
- Customer profile management
- Loyalty tier and points configuration
- Campaign creation and segmentation
- Survey builder and analytics
- Coupon creation and distribution
- Analytics dashboards

## Security

### Authentication
- JWT tokens with refresh strategy
- Role-based access control (RBAC)
- API key authentication for services

### Data Protection
- Database encryption at rest
- TLS 1.3 for all communications
- PII anonymization in logs
- GDPR compliance features

## Monitoring & Logging

### Metrics
- Prometheus for metrics collection
- Grafana dashboards for visualization
- Service health checks
- Performance monitoring

### Logging
- Centralized logging with structured format
- Log correlation across services
- Error tracking and alerting

## External Integrations

### Required Services
- **Firebase:** Push notifications
- **SendGrid/AWS SES:** Email notifications
- **Twilio/AWS SNS:** SMS notifications
- **Google Analytics:** Web analytics
- **PMS System:** Hotel management integration

### Environment Variables
```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/loyalty_db
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret

# External Services
FIREBASE_PROJECT_ID=your-firebase-project
SENDGRID_API_KEY=your-sendgrid-key
TWILIO_ACCOUNT_SID=your-twilio-sid
GOOGLE_ANALYTICS_ID=your-ga-id

# PMS Integration
PMS_API_URL=https://your-pms-api.com
PMS_API_KEY=your-pms-key
```

## Development Guidelines

### Code Standards
- Use TypeScript for type safety
- Follow ESLint configuration
- Write unit tests for all services
- Document API endpoints
- Use conventional commits

### Service Development
- Each service should be independent
- Use dependency injection
- Implement proper error handling
- Add health check endpoints
- Use structured logging

### Frontend Development
- Follow React best practices
- Use responsive design principles
- Implement PWA features (offline, push notifications)
- Optimize for mobile-first experience
- Add proper error boundaries

## Deployment

### Development
```bash
docker-compose up -d
```

### Production
- Use container orchestration (Kubernetes/Docker Swarm)
- Implement load balancing
- Setup SSL certificates
- Configure monitoring and alerting
- Implement backup strategies

## Troubleshooting

### Common Issues
- **Service won't start:** Check Docker logs and environment variables
- **Database connection:** Verify PostgreSQL is running and credentials are correct
- **API Gateway errors:** Check Kong configuration and service discovery
- **Push notifications:** Verify Firebase configuration and credentials

### Health Checks
- All services expose `/health` endpoint
- Database connectivity checks
- External service availability
- Redis connectivity validation

## Infrastructure Integration

### Existing Cloudflare Tunnel
This project integrates with an existing Cloudflare tunnel setup:
- **Domain:** saichon.com
- **Tunnel ID:** cfaa5422-f0b3-491f-991c-3ca3ebd2c901
- **Server IP:** 192.168.100.228

### Port Allocation (Modified to avoid conflicts)
The ports have been adjusted to avoid conflicts with existing services:
```yaml
Original → Modified (to avoid conflicts)
PWA Frontend:     3000 → 3010  # Conflicts with appsmith/metabase
User Service:     3001 → 3011
Loyalty Service:  3002 → 3012  # Conflicts with order service
Campaign Service: 3003 → 3013
Survey Service:   3004 → 3014
Coupon Service:   3005 → 3015
Notification:     3006 → 3016
Analytics:        3007 → 3017
Integration:      3008 → 3018
Grafana:          3009 → 3019
API Gateway:      8000 → 8000   # No conflict
```

### Required Cloudflare Routes
Add these routes manually via Cloudflare dashboard:
- `loyalty.saichon.com` → `192.168.100.228:3010`
- `api.saichon.com` → `192.168.100.228:8000`
- `monitoring.saichon.com` → `192.168.100.228:3019`

## Documentation

### Key Documents
- `PRD.md` - Product Requirements Document
- `DEV-PLAN.md` - Development Plan with Architecture
- `API-SPECIFICATIONS.md` - Detailed API documentation
- `docker-compose.yml` - Container configuration
- `deployment-integration-guide.md` - Cloudflare tunnel integration guide
- `security-config.yml` - Security configuration template

### API Documentation
- Swagger/OpenAPI specs for each service (planned)
- Postman collection for testing (planned)
- Authentication flow diagrams (planned)
- Error handling documentation (planned)

## Project Implementation Status

### Current State
- ✅ Architecture design complete
- ✅ Documentation comprehensive  
- ✅ Docker compose configuration ready
- ✅ Port conflicts resolved for existing infrastructure
- ✅ Domain integration planned (saichon.com)
- ❌ Service implementation not started
- ❌ Frontend not implemented
- ❌ Database schemas not created

### Next Development Steps
1. **Initialize service directories** - Create microservice folder structure
2. **Implement User Service** - Authentication and user management
3. **Setup API Gateway** - Kong configuration and routing
4. **Create database schemas** - PostgreSQL table structures
5. **Implement PWA frontend** - React application with offline capabilities
6. **Add Cloudflare routes** - Manual dashboard configuration required

### Critical Notes for Future Development
- All ports have been modified to avoid conflicts with existing saichon.com services
- Cloudflare tunnel integration requires manual dashboard configuration
- No package.json files exist yet - services need to be scaffolded
- Docker compose is configured but services need implementation first

---

*This configuration is optimized for integration with existing saichon.com infrastructure. Services need implementation before deployment.*