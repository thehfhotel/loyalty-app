# Hotel Loyalty System - Phase 1

A modern hotel loyalty program application built with React, Node.js, and PostgreSQL. This is Phase 1 implementation featuring user authentication and profile management.

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

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd loyalty-app
```

2. Start the development environment:
```bash
docker-compose up -d
```

3. Access the application:
- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- Database: localhost:5432

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
└── docker-compose.yml      # Development environment
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
1. Visit http://localhost:3000
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

## Contributing

1. Create feature branch from main
2. Implement changes with tests
3. Ensure all linting passes
4. Submit pull request

## License

This project is proprietary software for hotel loyalty program implementation.