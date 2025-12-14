# Hotel Loyalty System - Phase 1

[![Test Reports](https://img.shields.io/badge/Test_Reports-Allure-green?logo=github)](https://jwinut.github.io/loyalty-app/test-reports/)
[![CI/CD Pipeline](https://github.com/jwinut/loyalty-app/actions/workflows/deploy.yml/badge.svg)](https://github.com/jwinut/loyalty-app/actions/workflows/deploy.yml)

A modern hotel loyalty program application built with React, Node.js, and PostgreSQL. This is Phase 1 implementation featuring user authentication and profile management.

> **📋 Important**: Please read [CLAUDE.md](./CLAUDE.md) for critical project rules and conventions that must be followed.

## Features (Phase 1)

### Customer Features
- ✅ User Registration & Login
- ✅ JWT Authentication with Refresh Tokens
- ✅ Password Reset via Email
- ✅ Profile Management
- ✅ Responsive PWA Design

### Admin Features
- ✅ Role-based Authentication
- ✅ User Management Access

### Technical Features
- ✅ PostgreSQL Database with Migrations
- ✅ Redis for Session Management
- ✅ Docker Compose Development Environment
- ✅ TypeScript Frontend & Backend
- ✅ Input Validation with Zod
- ✅ Comprehensive Error Handling
- ✅ Audit Logging

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local development)
- (Optional) Anthropic Claude Code CLI: run `./claude_code_setup.sh` to install/initialize the pinned CLI and store your Anthropic API key in `~/.claude/settings.json`.

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd loyalty-app
```

2. Start the development environment:
```bash
docker compose up -d
```

3. Access the application:
- Frontend: http://localhost:4001
- Backend API: http://localhost:4000
- Database: localhost:5434

### Default Admin Account
- Email: `admin@hotel.com`
- Password: `admin123`

**⚠️ Change this password immediately in production!**

## Project Structure

```
loyalty-app/
├── backend/                 # Node.js API server
│   ├── src/
│   │   ├── controllers/     # Route handlers
│   │   ├── middleware/      # Express middleware
│   │   ├── routes/          # API routes
│   │   ├── services/        # Business logic
│   │   ├── types/           # TypeScript types
│   │   └── utils/           # Utility functions
│   └── Dockerfile
├── frontend/                # React PWA
│   ├── src/
│   │   ├── components/      # Reusable components
│   │   ├── pages/           # Page components
│   │   ├── services/        # API services
│   │   ├── store/           # State management
│   │   └── styles/          # CSS styles
│   └── Dockerfile
├── database/
│   └── migrations/          # SQL migration files
├── nginx/                   # Reverse proxy config
└── docker compose.yml      # Development environment
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - User logout
- `POST /api/auth/reset-password/request` - Request password reset
- `POST /api/auth/reset-password` - Reset password
- `GET /api/auth/me` - Get current user

### User Management
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile
- `POST /api/users/avatar` - Upload avatar (TODO)
- `DELETE /api/users/avatar` - Delete avatar

## Development

### Backend Development
```bash
cd backend
npm install
npm run dev
```

### Frontend Development
```bash
cd frontend
npm install
npm run dev
```

### Database Migrations
Database migrations run automatically on container startup via Docker.

## Testing

### Test User Registration
1. Visit http://localhost:4001
2. Click "Create a new account"
3. Fill in the registration form
4. Verify login works with new account

### Test Profile Management
1. Login with any account
2. Navigate to Profile page
3. Update profile information
4. Verify changes are saved

## Phase 2 Planning

The next phase will include:
- Loyalty Points System
- Tier Management (Bronze, Silver, Gold, Platinum)
- Points Earning & Redemption
- Transaction History
- Admin Points Management

## Security Notes

### Production Deployment
Before deploying to production:

1. Change default admin password
2. Update JWT secrets in environment variables
3. Enable HTTPS/SSL
4. Configure proper firewall rules
5. Set up backup procedures
6. Enable audit logging review

### Environment Variables
Key environment variables to configure:
- `JWT_SECRET` - JWT signing secret
- `JWT_REFRESH_SECRET` - Refresh token secret
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string

## CI/CD Pipeline

### Overview
The project uses an optimized GitHub Actions pipeline with comprehensive validation and automated deployment to production.

### Pipeline Architecture
**4-Phase Deployment Process** (8-12 minutes total):

#### Phase 1: Parallel Validation & Security (3-4 minutes)
- **Security Analysis**: ESLint security rules, npm audit, custom security validation, test integrity validation
- **Unit & Integration Tests**: Backend tests with PostgreSQL test database, TypeScript validation, database schema tests
- **E2E Tests**: Full application testing with Playwright (main branch only)

#### Phase 2: Build Validation (2-3 minutes, main branch only)
- **Production Build**: Parallel backend/frontend builds with TypeScript compilation
- **Docker Validation**: Container build validation with production environment variables
- **Artifact Verification**: Build output validation and integrity checks

#### Phase 3: Production Deployment (3-5 minutes, main branch only)
- **Smart Database Backup**: Automated pre-deployment database backups
- **Zero-Downtime Deployment**: Optimized code deployment with intelligent caching
- **Environment Configuration**: Secure environment variable management
- **Database Migration**: Automated migrations with rollback safety checks
- **Service Deployment**: Docker Compose production deployment

#### Phase 4: Post-Deployment Monitoring (< 1 minute)
- **Health Checks**: Comprehensive application and service validation
- **OAuth Validation**: Production OAuth endpoint health verification
- **Database Validation**: Migration status and rollback safety verification
- **Smart Cleanup**: Conditional resource cleanup based on disk usage

### Key Features

#### 🔒 Security & Quality Validation
- **Test Integrity Validation**: Prevents test bypassing patterns that could hide failures
- **OAuth Health Validation**: Validates OAuth endpoints before and after deployment
- **Database Migration Validation**: Comprehensive migration testing and rollback safety
- **Security Auditing**: npm audit, ESLint security rules, custom security scripts
- **TypeScript Validation**: Full type checking across backend and frontend

#### ⚡ Performance Optimizations
- **Parallel Execution**: Jobs run simultaneously when possible (40-50% faster)
- **Intelligent Caching**: Local npm cache, Docker BuildKit, dependency caching
- **Conditional Jobs**: E2E tests only run on main branch or PRs to main
- **Smart Deployment**: Updates existing deployments instead of full rebuilds

#### 🛡️ Deployment Safety
- **Pre-deployment Validation**: All tests must pass before deployment
- **Automated Backups**: Database backups before each deployment
- **Health Monitoring**: Post-deployment validation ensures services are operational
- **Rollback Safety**: Migration rollback procedures validated before deployment

### OAuth & Database Validation

#### OAuth Health Validation
The pipeline validates OAuth functionality at multiple stages:
- **Pre-deployment**: Validates OAuth endpoints during testing phase
- **E2E Testing**: OAuth-specific end-to-end tests using Playwright
- **Post-deployment**: Production OAuth configuration validation

OAuth validation checks:
- OAuth provider endpoints (Google, LINE, Facebook)
- Redirect URL configuration
- Authentication flow integrity
- Rate limiting functionality

#### Database Migration Validation
Comprehensive database validation includes:
- **Migration Status**: Verifies all migrations are properly applied
- **Rollback Safety**: Validates rollback procedures and backup availability
- **Schema Integrity**: Tests database schema after migrations
- **Connection Validation**: Ensures database connectivity in production

### Rate Limit Management
The pipeline includes OAuth rate limit reset functionality:
- **Reset Script**: `./scripts/reset-rate-limits.sh` with multiple reset strategies
- **Integration**: Available via `./manage.sh` (Deployment Menu → Reset OAuth Rate Limits)
- **CI Integration**: Rate limits automatically managed during testing

### Pipeline Triggers
- **Push to main**: Full pipeline with deployment
- **Push to develop**: Validation and testing only
- **Pull Request to main**: Full validation including E2E tests
- **Manual Trigger**: `workflow_dispatch` for manual deployments

### Environment Requirements
- **Self-hosted Runner**: Optimized for dedicated build environment
- **Docker & Docker Compose**: Container orchestration
- **PostgreSQL & Redis**: Database and caching services
- **GitHub Secrets**: Production environment variables and OAuth credentials

### Monitoring & Observability
- **Deployment Summaries**: Comprehensive reporting of all pipeline stages
- **Enhanced Logging**: Detailed diagnostics for troubleshooting
- **Health Dashboards**: Post-deployment service monitoring
- **Performance Metrics**: Build times, test coverage, deployment success rates

## Contributing

1. Create feature branch from main
2. Implement changes with tests
3. Ensure all linting passes
4. Run `npm run oauth:health` and `npm run db:validate` for validation features
5. Submit pull request

## License

This project is proprietary software for hotel loyalty program implementation.
