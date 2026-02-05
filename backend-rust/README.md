# Loyalty App Backend (Rust)

A high-performance Rust rewrite of the Node.js backend for the Loyalty App. This backend provides REST APIs for the loyalty program management system, featuring improved type safety, memory safety, and performance.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Development](#development)
- [Docker](#docker)
- [API Documentation](#api-documentation)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Testing](#testing)
- [Configuration](#configuration)

## Overview

### Purpose

This is a complete Rust rewrite of the Node.js/Express backend, designed to provide:

- **Performance**: Native compilation with zero-cost abstractions
- **Type Safety**: Compile-time guarantees for data types and API contracts
- **Memory Safety**: Rust's ownership model prevents common bugs
- **Concurrency**: Async/await with Tokio for efficient I/O operations

### Tech Stack

| Component | Technology |
|-----------|------------|
| **Web Framework** | [Axum](https://github.com/tokio-rs/axum) 0.7 |
| **Async Runtime** | [Tokio](https://tokio.rs/) |
| **Database** | [SQLx](https://github.com/launchbadge/sqlx) (PostgreSQL) |
| **Caching** | [Redis](https://github.com/redis-rs/redis-rs) |
| **Auth** | [jsonwebtoken](https://github.com/Keats/jsonwebtoken), [argon2](https://github.com/RustCrypto/password-hashes) |
| **HTTP Client** | [reqwest](https://github.com/seanmonstar/reqwest) |
| **Email** | [lettre](https://github.com/lettre/lettre) (SMTP/IMAP) |
| **Validation** | [validator](https://github.com/Keats/validator) |
| **Serialization** | [serde](https://serde.rs/) |
| **Tracing** | [tracing](https://github.com/tokio-rs/tracing) |
| **API Docs** | [utoipa](https://github.com/juhaku/utoipa) (OpenAPI/Swagger) |

## Prerequisites

- **Rust 1.75+** (specified in `rust-toolchain.toml`)
- **PostgreSQL 15+**
- **Redis 7+**
- **Docker** (optional, for containerized development)

### Installing Rust

```bash
# Install rustup (Rust toolchain manager)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# The project's rust-toolchain.toml will automatically install the correct version
cd backend-rust
rustup show  # Verifies toolchain installation
```

### Installing cargo-watch (for hot reload)

```bash
cargo install cargo-watch
```

## Getting Started

### 1. Clone and Setup

```bash
# Clone the repository
git clone <repository-url>
cd loyalty-app/backend-rust

# Copy environment configuration
cp .env.example .env
```

### 2. Environment Configuration

Edit `.env` file with your configuration:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/loyalty_db

# Redis
REDIS_URL=redis://localhost:6379

# JWT (minimum 32 characters for development, 64 for production)
JWT_SECRET=your-secure-jwt-secret-minimum-32-characters
JWT_REFRESH_SECRET=your-secure-refresh-secret-minimum-32-chars

# Server
PORT=4000
RUST_ENV=development
```

See [Environment Variables](#environment-variables) for the complete list.

### 3. Database Setup

Ensure PostgreSQL is running and create the database:

```bash
# Create database
createdb loyalty_db

# Run migrations
# Migrations are automatically applied from migrations/ directory
# Or manually:
psql -d loyalty_db -f migrations/20240101000000_init.sql
```

The migration file creates all necessary tables, indexes, stored procedures, and seed data including:
- User authentication tables
- Loyalty tiers (Bronze, Silver, Gold, Platinum)
- Coupon system
- Survey system
- Notification system

### 4. Running Locally

```bash
# Build and run in debug mode
cargo run

# Or with environment-specific logging
RUST_LOG=debug cargo run
```

The server will start at `http://localhost:4000` (or the port specified in `.env`).

## Development

### Running in Development Mode

```bash
# Standard run
cargo run

# With hot reload (watches for file changes)
cargo watch -x run

# With specific log levels
RUST_LOG=loyalty_backend=debug,tower_http=debug cargo run
```

### Code Quality

```bash
# Format code
cargo fmt

# Run linter
cargo clippy

# Check compilation without building
cargo check

# Build release version
cargo build --release
```

### Running Tests

```bash
# Run all tests
cargo test

# Run unit tests only
cargo test --lib

# Run integration tests only
cargo test --test integration

# Run tests with output
cargo test -- --nocapture

# Run a specific test
cargo test test_health_check

# Run tests with coverage (requires cargo-tarpaulin)
cargo tarpaulin --out Html
```

## Docker

### Building the Image

```bash
# Build development image
docker build --target development -t loyalty-backend-rust:dev .

# Build production image
docker build --target runner -t loyalty-backend-rust:latest .
```

### Running with Docker Compose

```bash
# Development (with hot reload and source mounting)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# View logs
docker compose logs -f backend-rust

# Stop services
docker compose down
```

### Docker Stages

The multi-stage Dockerfile provides:

| Stage | Purpose | Use Case |
|-------|---------|----------|
| `chef` | Dependency caching setup | Internal |
| `planner` | Generate dependency recipe | Internal |
| `builder` | Compile the application | Internal |
| `development` | Full dev environment with cargo-watch | Local development |
| `runner` | Minimal production image (~100MB) | Production deployment |

### Port Mapping (Development)

| Service | Internal Port | External Port |
|---------|---------------|---------------|
| PostgreSQL | 5432 | 5440 |
| Redis | 6379 | 6385 |
| Backend | 4001 | 4010 |

## API Documentation

### OpenAPI Specification

The API documentation is auto-generated using `utoipa` and available at:

- **Swagger UI**: `http://localhost:4000/api/docs`
- **OpenAPI JSON**: `http://localhost:4000/api/openapi.json`

### Generating TypeScript Client

Generate a type-safe TypeScript client for the frontend:

```bash
# Run the generation script (requires backend to be running)
./scripts/generate-client.sh

# Or specify a custom URL
./scripts/generate-client.sh --url http://localhost:4000/api/openapi.json

# Or use a local file
./scripts/generate-client.sh --file ./openapi.json
```

The generated client will be placed in `frontend/src/api/generated/`.

### API Routes

All routes are prefixed with `/api`:

| Route | Description |
|-------|-------------|
| `/api/health` | Health check endpoints |
| `/api/auth` | Authentication (login, register, logout) |
| `/api/users` | User profile and management |
| `/api/oauth` | OAuth authentication (Google, LINE) |
| `/api/loyalty` | Loyalty points and tiers |
| `/api/coupons` | Coupon management |
| `/api/surveys` | Survey system |
| `/api/bookings` | Booking management |
| `/api/notifications` | User notifications |
| `/api/storage` | File uploads |
| `/api/admin` | Admin panel operations |
| `/api/sse` | Server-Sent Events |

## Project Structure

```
backend-rust/
├── Cargo.toml              # Dependencies and project config
├── Dockerfile              # Multi-stage Docker build
├── docker-compose.yml      # Base Docker Compose
├── docker-compose.dev.yml  # Development overrides
├── rust-toolchain.toml     # Rust version specification
├── .env.example            # Environment template
├── config/
│   └── admins.json         # Admin users configuration
├── migrations/
│   └── 20240101000000_init.sql  # Database schema
├── scripts/
│   └── generate-client.sh  # TypeScript client generator
├── src/
│   ├── main.rs             # Application entry point
│   ├── lib.rs              # Library root (exports modules)
│   ├── state.rs            # Application state (AppState)
│   ├── error.rs            # Error types and handling
│   ├── config/
│   │   └── mod.rs          # Configuration management
│   ├── db/
│   │   ├── mod.rs          # Database connection pool
│   │   └── migrations.rs   # Migration utilities
│   ├── redis/
│   │   └── mod.rs          # Redis connection management
│   ├── routes/             # API endpoint handlers
│   │   ├── mod.rs          # Route aggregation
│   │   ├── admin.rs        # Admin endpoints
│   │   ├── auth.rs         # Authentication endpoints
│   │   ├── bookings.rs     # Booking endpoints
│   │   ├── coupons.rs      # Coupon endpoints
│   │   ├── health.rs       # Health check endpoints
│   │   ├── loyalty.rs      # Loyalty endpoints
│   │   ├── notifications.rs # Notification endpoints
│   │   ├── oauth.rs        # OAuth endpoints
│   │   ├── sse.rs          # Server-Sent Events
│   │   ├── storage.rs      # File upload endpoints
│   │   ├── surveys.rs      # Survey endpoints
│   │   └── users.rs        # User endpoints
│   ├── services/           # Business logic layer
│   │   ├── mod.rs          # Service exports
│   │   ├── auth.rs         # Authentication service
│   │   ├── booking.rs      # Booking service
│   │   ├── coupon.rs       # Coupon service
│   │   ├── email.rs        # Email service (SMTP/IMAP)
│   │   ├── loyalty.rs      # Loyalty service
│   │   ├── membership_id.rs # Membership ID generation
│   │   ├── notification.rs # Notification service
│   │   ├── oauth.rs        # OAuth service
│   │   ├── slipok.rs       # SlipOK payment service
│   │   ├── sse.rs          # SSE connection manager
│   │   ├── storage.rs      # File storage service
│   │   ├── survey.rs       # Survey service
│   │   └── user.rs         # User service
│   ├── models/             # Data structures
│   │   ├── mod.rs          # Model exports
│   │   ├── booking.rs      # Booking models
│   │   ├── coupon.rs       # Coupon models
│   │   ├── notification.rs # Notification models
│   │   ├── password_reset.rs # Password reset models
│   │   ├── points_transaction.rs # Points models
│   │   ├── survey.rs       # Survey models
│   │   ├── tier.rs         # Tier models
│   │   ├── user.rs         # User models
│   │   ├── user_loyalty.rs # User loyalty models
│   │   └── user_profile.rs # User profile models
│   ├── middleware/         # Request processing
│   │   ├── mod.rs          # Middleware exports
│   │   ├── admin.rs        # Admin authorization
│   │   ├── auth.rs         # JWT authentication
│   │   ├── cors.rs         # CORS configuration
│   │   └── rate_limit.rs   # Rate limiting
│   ├── types/
│   │   └── mod.rs          # Common type definitions
│   └── utils/
│       ├── mod.rs          # Utility exports
│       ├── logging.rs      # Logging utilities
│       └── validation.rs   # Input validation
└── tests/
    ├── common/
    │   └── mod.rs          # Shared test utilities
    └── integration/
        ├── mod.rs          # Integration test module
        └── health_test.rs  # Health endpoint tests
```

## Environment Variables

### Required Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://localhost:5432/loyalty_db` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | JWT signing secret (32+ chars) | Development default |
| `JWT_REFRESH_SECRET` | Refresh token secret (32+ chars) | Development default |

### Server Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `4000` |
| `RUST_ENV` | Environment (development/staging/production) | `development` |
| `RUST_LOG` | Log level filter | `info` |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:3000` |
| `SESSION_SECRET` | Session signing secret | Development default |

### OAuth Configuration (Optional)

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Google OAuth callback URL |
| `LINE_CLIENT_ID` | LINE OAuth client ID |
| `LINE_CLIENT_SECRET` | LINE OAuth client secret |
| `LINE_REDIRECT_URI` | LINE OAuth callback URL |

### Email Configuration (Optional)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP server port (default: 465) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | Email from address |
| `IMAP_HOST` | IMAP server hostname |
| `IMAP_PORT` | IMAP server port (default: 993) |
| `IMAP_USER` | IMAP username |
| `IMAP_PASS` | IMAP password |

### Payment Configuration (Optional)

| Variable | Description |
|----------|-------------|
| `SLIPOK_API_KEY` | SlipOK API key |
| `SLIPOK_BRANCH_ID` | SlipOK branch ID |

### Database Pool Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_MAX_CONNECTIONS` | Maximum pool connections | `10` |
| `DB_MIN_CONNECTIONS` | Minimum pool connections | `1` |
| `DB_ACQUIRE_TIMEOUT_SECS` | Connection acquire timeout | `30` |
| `DB_IDLE_TIMEOUT_SECS` | Idle connection timeout | `600` |

### Security Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `MAX_FILE_SIZE` | Maximum upload size (bytes) | `5242880` (5MB) |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | `900000` (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `10000` |

## Testing

### Test Structure

```
tests/
├── common/          # Shared test utilities
│   └── mod.rs       # Fixtures, helpers, setup/teardown
└── integration/     # Integration tests
    ├── mod.rs       # Integration test module
    └── health_test.rs
```

### Running Tests

```bash
# Unit tests (functions within src/)
cargo test --lib

# Integration tests (tests/ directory)
cargo test --test integration

# All tests
cargo test

# Run tests with specific logging
RUST_LOG=test=debug cargo test

# Run tests ignoring database-dependent tests
cargo test -- --skip "Requires running database"
```

### Test Database Configuration

Tests use isolated ports to avoid conflicts:

| Resource | Test Port |
|----------|-----------|
| PostgreSQL | 5438 |
| Redis | 6383 |

Set test environment variables:

```bash
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5438/loyalty_test_db
export TEST_REDIS_URL=redis://localhost:6383
```

### Writing Tests

```rust
use crate::common::{init_test_db, TestClient, TestUser, generate_test_token};

#[tokio::test]
async fn test_user_creation() {
    // Arrange
    let pool = init_test_db().await.unwrap();
    let user = TestUser::new("test@example.com");
    user.insert(&pool).await.unwrap();

    // Act & Assert
    // ...
}
```

## Configuration

Configuration is loaded from multiple sources (in order of precedence):

1. Environment variables
2. `.env` file
3. Config files (`config/default.toml`, `config/local.toml`)
4. Default values

### Environment Detection

The environment is determined by `RUST_ENV` or `NODE_ENV`:

- `development` - Local development (default)
- `staging` - Staging environment
- `production` - Production environment

### Production Requirements

In production mode (`RUST_ENV=production`), the following are enforced:

- JWT secrets must be at least 64 characters
- Default/weak secrets are rejected
- Localhost database URLs are rejected

## License

See the main repository LICENSE file.
