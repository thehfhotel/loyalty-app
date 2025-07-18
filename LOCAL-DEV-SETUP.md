# Local Development Environment Setup

This guide will help you set up the Hotel Loyalty App for local development.

## Prerequisites

- **Node.js** (v18+ recommended)
- **Docker** and **Docker Compose**
- **Git**
- **PostgreSQL** (optional, can use Docker)
- **Redis** (optional, can use Docker)

## Quick Start

### 1. Clone and Setup
```bash
git clone <repository-url>
cd loyalty-app
cp .env.example .env  # Create and configure environment variables
```

### 2. Start Infrastructure Services
```bash
# Start database, Redis, RabbitMQ, and monitoring
docker-compose up -d postgres redis rabbitmq prometheus grafana
```

### 3. Install Dependencies
```bash
# Install frontend dependencies
cd frontend
npm install
cd ..

# Install backend service dependencies
cd services/user-service && npm install && cd ../..
cd services/loyalty-service && npm install && cd ../..
cd services/campaign-service && npm install && cd ../..
cd services/survey-service && npm install && cd ../..
cd services/coupon-service && npm install && cd ../..
cd services/notification-service && npm install && cd ../..
cd services/analytics-service && npm install && cd ../..
cd services/integration-service && npm install && cd ../..
```

### 4. Initialize Database
```bash
# Run database migrations
docker-compose exec postgres psql -U loyalty_user -d loyalty_db -f /docker-entrypoint-initdb.d/01_init.sql
```

### 5. Start Development Services

#### Option A: Start All Services with Docker
```bash
docker-compose up -d
```

#### Option B: Start Services Individually (for development)
```bash
# Terminal 1: Start frontend
cd frontend
npm start

# Terminal 2: Start user service
cd services/user-service
npm run dev

# Terminal 3: Start loyalty service
cd services/loyalty-service
npm run dev

# Terminal 4: Start API Gateway
docker-compose up -d api-gateway

# Continue for other services as needed...
```

## Development Workflow

### Environment Variables

Create a `.env` file in the root directory:

```bash
# Database
DATABASE_URL=postgresql://loyalty_user:password@localhost:5433/loyalty_db
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-jwt-secret-key-for-dev
JWT_REFRESH_SECRET=your-refresh-secret-key-for-dev

# External Services (Development)
FIREBASE_PROJECT_ID=your-firebase-project-dev
SENDGRID_API_KEY=your-sendgrid-key-dev
TWILIO_ACCOUNT_SID=your-twilio-sid-dev
GOOGLE_ANALYTICS_ID=your-ga-id-dev

# PMS Integration (Mock/Development)
PMS_API_URL=http://localhost:3018
PMS_API_KEY=mock-pms-key-for-dev

# Frontend
REACT_APP_API_URL=http://localhost:3011
REACT_APP_FIREBASE_CONFIG=your-firebase-config-dev
REACT_APP_DOMAIN=localhost
```

### Service URLs (Development)

- **Frontend PWA**: http://localhost:3000
- **API Gateway**: http://localhost:8000
- **User Service**: http://localhost:3011
- **Loyalty Service**: http://localhost:3012
- **Campaign Service**: http://localhost:3013
- **Survey Service**: http://localhost:3014
- **Coupon Service**: http://localhost:3015
- **Notification Service**: http://localhost:3016
- **Analytics Service**: http://localhost:3017
- **Integration Service**: http://localhost:3018

### Database Access

```bash
# Connect to PostgreSQL
psql -h localhost -p 5433 -U loyalty_user -d loyalty_db

# Connect to Redis
redis-cli -h localhost -p 6379

# RabbitMQ Management
# http://localhost:15672 (guest/guest)
```

### Monitoring

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3019 (admin/admin)

## Development Scripts

### Package.json Scripts (per service)
```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix"
  }
}
```

### Useful Commands

```bash
# Health check all services
curl http://localhost:3011/health  # User Service
curl http://localhost:3012/health  # Loyalty Service
curl http://localhost:3013/health  # Campaign Service
curl http://localhost:3014/health  # Survey Service
curl http://localhost:3015/health  # Coupon Service

# View logs
docker-compose logs -f user-service
docker-compose logs -f loyalty-service

# Restart specific service
docker-compose restart user-service

# Reset database
docker-compose down postgres
docker volume rm loyalty-app_postgres_data
docker-compose up -d postgres
```

## Development Best Practices

### 1. Service Development

```bash
# Create new service
mkdir services/new-service
cd services/new-service
npm init -y
npm install express helmet cors dotenv
mkdir -p src/{controllers,routes,models,middleware,utils,config}
```

### 2. Database Development

```bash
# Create migration
echo "ALTER TABLE users ADD COLUMN new_field VARCHAR(255);" > database/migrations/001_add_new_field.sql

# Run migration
docker-compose exec postgres psql -U loyalty_user -d loyalty_db -f /docker-entrypoint-initdb.d/migrations/001_add_new_field.sql
```

### 3. Testing

```bash
# Run tests for specific service
cd services/user-service
npm test

# Run integration tests
npm run test:integration

# Run all tests
npm run test:all
```

### 4. Code Quality

```bash
# Lint all services
find services/ -name "package.json" -execdir npm run lint \;

# Format code
find services/ -name "package.json" -execdir npm run format \;
```

## Troubleshooting

### Common Issues

1. **Port conflicts**: Check if ports 3000-3019, 5433, 6379, 15672, 8000, 9090 are free
2. **Database connection**: Ensure PostgreSQL is running and credentials are correct
3. **Redis connection**: Verify Redis is accessible
4. **Service startup**: Check service logs for detailed error messages

### Debug Commands

```bash
# Check running containers
docker-compose ps

# Check service logs
docker-compose logs service-name

# Check database connectivity
docker-compose exec postgres pg_isready -h localhost -p 5432

# Check Redis connectivity
docker-compose exec redis redis-cli ping

# Test service endpoints
curl -I http://localhost:3011/health
```

### Performance Tips

1. **Use nodemon** for automatic restarts during development
2. **Enable hot reloading** for React frontend
3. **Use Redis** for caching to improve response times
4. **Monitor memory usage** with `docker stats`

## IDE Configuration

### VS Code Extensions
- ESLint
- Prettier
- Docker
- Thunder Client (for API testing)
- GitLens
- PostgreSQL Explorer

### VS Code Settings
```json
{
  "editor.formatOnSave": true,
  "eslint.autoFixOnSave": true,
  "files.exclude": {
    "**/node_modules": true,
    "**/build": true,
    "**/.git": true
  }
}
```

## API Testing

### Postman Collection
Import the provided Postman collection for testing all endpoints:
- Authentication endpoints
- User management
- Loyalty points and rewards
- Campaign management
- Survey functionality
- Coupon system

### cURL Examples
```bash
# Register user
curl -X POST http://localhost:3011/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"firstName":"John","lastName":"Doe","email":"john@example.com","password":"Test123@"}'

# Login user
curl -X POST http://localhost:3011/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"Test123@"}'

# Get user profile
curl -X GET http://localhost:3011/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## Production Deployment

When ready for production:

1. **Environment Variables**: Update `.env` with production values
2. **SSL Certificates**: Configure HTTPS
3. **Domain Configuration**: Update API URLs
4. **Database**: Use production PostgreSQL instance
5. **Monitoring**: Configure production monitoring
6. **Backup**: Set up automated backups

## Next Steps

1. **Set up CI/CD pipeline**
2. **Configure automated testing**
3. **Set up error tracking (Sentry)**
4. **Configure log aggregation**
5. **Set up performance monitoring**

---

*This setup provides a complete development environment for the Hotel Loyalty App. All services can be developed, tested, and debugged locally.*