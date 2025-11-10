# Hotel Loyalty System - Project Overview

## Project Purpose
Modern hotel loyalty program application featuring:
- User authentication and profile management
- Loyalty points system with tier management (Bronze, Silver, Gold, Platinum)
- Coupon management and redemption
- Survey system with multilingual support
- Admin dashboard for user and loyalty management
- OAuth integration (Google, LINE, Facebook)
- Progressive Web App (PWA) with responsive design

## Project Status
**Current Version**: 4.0.1
**Phase**: Phase 1 completed, actively developing Phase 2+

## Tech Stack

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js 4.x
- **Language**: TypeScript 5.3+ (strict mode enabled)
- **Database**: PostgreSQL 15 (Prisma ORM)
- **Cache/Session**: Redis 7
- **Authentication**: JWT + Refresh Tokens, OAuth 2.0 (Google, LINE)
- **Validation**: Zod schemas
- **Logging**: Winston with daily rotation
- **Image Processing**: Sharp
- **API Translation**: Azure Translation API

### Frontend
- **Framework**: React 18.2
- **Build Tool**: Vite 5
- **Language**: TypeScript 5.2
- **Routing**: React Router DOM 6
- **State Management**: Zustand
- **Forms**: React Hook Form + Hookform Resolvers
- **Styling**: Tailwind CSS 3.3 with @tailwindcss/forms
- **i18n**: i18next with browser language detection
- **Charts**: Chart.js + react-chartjs-2
- **PWA**: vite-plugin-pwa
- **Notifications**: react-hot-toast

### Infrastructure
- **Containerization**: Docker + Docker Compose V2
- **Reverse Proxy**: Nginx Alpine
- **CI/CD**: GitHub Actions with self-hosted runner
- **Testing**: Jest (backend), Playwright (E2E)
- **Code Quality**: ESLint (security plugin), TypeScript strict mode

## Architecture Pattern
- **Monorepo**: Single repository with backend/ and frontend/ directories
- **Microservices-Ready**: Service layer architecture with clear separation
- **API-First**: Backend APIs with frontend service clients
- **Type-Safe**: Shared types between frontend/backend via Zod

## Key Features
1. **Authentication**: JWT + Refresh tokens, OAuth providers, password reset
2. **User Management**: Profile, avatar (emoji-based), settings, role-based access
3. **Loyalty System**: Points earning/redemption, tier progression, transaction history
4. **Coupon System**: Wallet, QR codes, redemption tracking, admin management
5. **Survey System**: Multilingual surveys, reward integration, analytics
6. **Admin Dashboard**: User management, loyalty configuration, coupon management
7. **Multilingual**: English, Thai, Chinese support with Azure Translation

## Project Structure
```
loyalty-app/
├── backend/          # Express API server
│   ├── src/
│   │   ├── config/       # Configuration (DB, Redis, storage, environment)
│   │   ├── controllers/  # Route controllers
│   │   ├── middleware/   # Auth, security, validation, error handling
│   │   ├── routes/       # API route definitions
│   │   ├── services/     # Business logic layer
│   │   ├── types/        # TypeScript type definitions
│   │   ├── utils/        # Utilities (logger, image processor, date formatter)
│   │   └── __tests__/    # Unit and integration tests
│   └── Dockerfile
├── frontend/         # React PWA
│   ├── src/
│   │   ├── components/   # React components (organized by domain)
│   │   ├── hooks/        # Custom React hooks
│   │   ├── i18n/         # Internationalization (locales, config)
│   │   ├── pages/        # Page components (auth, admin, loyalty, surveys)
│   │   ├── services/     # API service clients
│   │   ├── store/        # Zustand state management
│   │   ├── types/        # TypeScript types
│   │   └── utils/        # Utility functions
│   └── Dockerfile
├── database/         # Database migrations and seeds
├── nginx/           # Nginx reverse proxy configuration
├── scripts/         # Production and utility scripts
├── tests/           # E2E tests (Playwright)
├── .github/         # GitHub Actions CI/CD pipeline
└── manage.sh        # Centralized project management script
```

## Default Access
- **Frontend**: http://localhost:4001
- **Backend API**: http://localhost:4001/api (proxied via nginx)
- **Database**: localhost:5434
- **Redis**: localhost:6379
- **Default Admin**: admin@hotel.com / admin123 (CHANGE IN PRODUCTION)
