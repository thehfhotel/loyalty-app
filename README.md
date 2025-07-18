# Hotel Loyalty App

A comprehensive Progressive Web Application (PWA) for hotel loyalty program management, built with modern technologies and following industry best practices.

## 🏗️ Architecture

### Technology Stack
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL with Redis caching
- **Deployment**: Docker + Docker Compose + Nginx
- **Authentication**: JWT with refresh tokens + OAuth2
- **PWA**: Service Workers + Web Push Notifications

### Project Structure
```
├── shared/                 # Shared types and utilities
├── frontend/              # React PWA application
├── backend/               # Node.js API server
├── database/              # Database schemas and migrations
├── nginx/                 # Nginx configuration
├── .github/workflows/     # CI/CD pipelines
└── docker-compose.yml     # Development environment
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- npm 9+

### Development Setup

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd loyalty-app
   npm install
   ```

2. **Environment Configuration**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start Development Environment**
   ```bash
   # Start database services
   npm run docker:up
   
   # Build shared package
   npm run build:shared
   
   # Start development servers
   npm run dev
   ```

4. **Initialize Database**
   ```bash
   # Run migrations and seed data
   cd backend
   npm run db:migrate
   npm run db:seed
   ```

### Access Points
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **Database**: localhost:5432
- **Redis**: localhost:6379

## 📱 Features

### Customer Features
- **Account Management**: Registration, login, profile management
- **Loyalty Program**: Points earning, tier progression, redemption
- **Coupons**: Digital coupon wallet with QR codes
- **Surveys**: Interactive feedback surveys with rewards
- **Notifications**: Push notifications for offers and updates
- **PWA**: Installable app with offline capabilities

### Admin Features
- **Customer Management**: View and manage customer profiles
- **Campaign Management**: Create and send targeted campaigns
- **Survey Management**: Design and analyze customer surveys
- **Coupon Management**: Create and track digital coupons
- **Analytics**: Comprehensive reporting and insights
- **Loyalty Configuration**: Manage tiers and points rules

## 🔧 Development

### Available Scripts
```bash
# Development
npm run dev                 # Start all services
npm run dev:frontend        # Frontend only
npm run dev:backend         # Backend only

# Building
npm run build              # Build all packages
npm run build:frontend     # Build frontend
npm run build:backend      # Build backend
npm run build:shared       # Build shared package

# Testing
npm run test               # Run all tests
npm run test:frontend      # Frontend tests
npm run test:backend       # Backend tests

# Code Quality
npm run lint               # Lint all packages
npm run typecheck          # Type checking
npm run lint:fix           # Fix linting issues

# Docker
npm run docker:up          # Start Docker services
npm run docker:down        # Stop Docker services
npm run docker:build       # Build Docker images
```

### Database Operations
```bash
cd backend
npm run db:migrate         # Run migrations
npm run db:seed           # Seed test data
npm run db:reset          # Reset database
```

## 🏭 Production Deployment

### Docker Deployment
```bash
# Build production images
docker-compose -f docker-compose.prod.yml build

# Deploy
docker-compose -f docker-compose.prod.yml up -d
```

### Environment Variables
Key production environment variables:
- `NODE_ENV=production`
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - JWT signing secret
- `FIREBASE_CONFIG` - Firebase configuration for push notifications

## 🔐 Security

### Authentication
- JWT tokens with refresh token rotation
- OAuth2 integration (Google, Facebook)
- Password strength requirements
- Rate limiting on auth endpoints

### Data Protection
- HTTPS enforcement
- CORS configuration
- Input validation and sanitization
- SQL injection protection
- XSS protection headers

### API Security
- Rate limiting per endpoint
- Request size limits
- Authentication middleware
- Role-based access control

## 📊 Monitoring

### Application Monitoring
- Health check endpoints
- Request logging with Morgan
- Error tracking with Winston
- Performance metrics

### Database Monitoring
- Connection pool monitoring
- Query performance tracking
- Automatic failover support

## 🧪 Testing

### Test Strategy
- **Unit Tests**: Individual component/function testing
- **Integration Tests**: API endpoint testing
- **E2E Tests**: Full user journey testing
- **Database Tests**: Migration and schema testing

### Coverage Requirements
- Minimum 80% code coverage
- Critical path coverage: 100%
- All API endpoints tested

## 📈 Performance

### Frontend Optimization
- Code splitting and lazy loading
- Image optimization
- Service Worker caching
- Bundle size optimization

### Backend Optimization
- Database query optimization
- Redis caching strategy
- Connection pooling
- Response compression

### PWA Features
- Offline functionality
- Background sync
- Push notifications
- App shell caching

## 🔄 CI/CD Pipeline

### GitHub Actions Workflow
1. **Code Quality**: Linting, type checking, testing
2. **Security**: Vulnerability scanning
3. **Build**: Docker image building
4. **Test**: E2E testing
5. **Deploy**: Automatic deployment to staging/production

### Deployment Environments
- **Development**: Local development
- **Staging**: Pre-production testing
- **Production**: Live application

## 📚 API Documentation

### Authentication Endpoints
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Token refresh
- `POST /api/auth/logout` - User logout

### Customer Endpoints
- `GET /api/customers/profile` - Get customer profile
- `PUT /api/customers/profile` - Update customer profile
- `GET /api/customers/points` - Get points balance
- `GET /api/customers/transactions` - Get points history

### Loyalty Endpoints
- `GET /api/loyalty/tiers` - Get loyalty tiers
- `GET /api/loyalty/redemptions` - Get redemption options
- `POST /api/loyalty/redeem` - Redeem points

### Campaign Endpoints
- `GET /api/campaigns` - Get campaigns
- `POST /api/campaigns` - Create campaign
- `PUT /api/campaigns/:id` - Update campaign
- `DELETE /api/campaigns/:id` - Delete campaign

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

### Code Style
- Use TypeScript for type safety
- Follow ESLint configuration
- Write comprehensive tests
- Document new features
- Follow commit message conventions

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and questions:
- Create an issue in the GitHub repository
- Contact the development team
- Check the documentation wiki

## 📋 Roadmap

### Phase 1 (Current)
- ✅ Project setup and infrastructure
- ✅ Authentication system
- ✅ Basic loyalty features
- ✅ Database schema

### Phase 2 (Next)
- 🔄 Frontend PWA implementation
- 🔄 Campaign management
- 🔄 Survey system
- 🔄 Admin dashboard

### Phase 3 (Future)
- 📋 Advanced analytics
- 📋 Mobile app integration
- 📋 Third-party integrations
- 📋 AI-powered recommendations

---

**Built with ❤️ by the Hotel Development Team**