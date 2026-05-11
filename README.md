# Hotel Loyalty App

[![CI](https://github.com/thehfhotel/loyalty-app/actions/workflows/ci-test.yml/badge.svg?branch=main)](https://github.com/thehfhotel/loyalty-app/actions/workflows/ci-test.yml)
[![Deploy](https://github.com/thehfhotel/loyalty-app/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/thehfhotel/loyalty-app/actions/workflows/deploy.yml)

A production hotel loyalty platform: members, tier progression, points and coupons, surveys, bookings, admin operations, and Thai PromptPay payment intents.

**Stack:** Rust (Axum) backend · React 19 (TypeScript / Vite) frontend · PostgreSQL 15 · Redis 7 · Docker Compose

> See [CLAUDE.md](./CLAUDE.md) for project conventions (trunk-based branching, commit style, port allocation).

## Features

### Customer
- Email + OAuth (Google, LINE) sign-in with JWT access and refresh tokens
- Profile management and password reset
- Loyalty points and tier progression (Bronze / Silver / Gold / Platinum, nights-based)
- Coupon issuance and redemption
- Survey participation
- Booking flow with PromptPay QR payment intents
- Installable PWA, responsive layout

### Admin
- Role-based access control
- User, coupon, survey, and booking administration
- Tier and points adjustments via stored procedures
- Audit logging

### Platform
- Stateless Rust API behind nginx reverse proxy
- Compile-time verified SQL via `sqlx` (offline cache committed to git)
- Automatic essential-data seeding on startup (tiers, membership ID sequence)
- Migrations executed via Prisma at deploy time, schema queried by sqlx at runtime
- GitHub Actions CI for tests, Trivy vulnerability scanning, and zero-downtime deploys

## Quick Start

### Prerequisites
- Docker and Docker Compose v2 (`docker compose`, with the space)
- Rust 1.93 (pinned via `backend-rust/rust-toolchain.toml`) for native backend builds
- Node.js 20+ for the frontend
- (Optional) Anthropic Claude Code CLI: run `./claude_code_setup.sh` to install/initialize the pinned CLI.

### Clone

```bash
git clone https://github.com/thehfhotel/loyalty-app.git
cd loyalty-app
```

### Run with Docker Compose (recommended)

```bash
cp .env.example .env
# Edit .env: set LOYALTY_USERNAME, LOYALTY_PASSWORD, JWT_*, OAuth secrets
docker compose up -d
```

Services:
- Frontend: http://localhost:4001
- Backend API: http://localhost:4000
- Database: localhost:5434

### Build the Rust backend natively

```bash
cd backend-rust
cargo build --release
cargo run                  # starts the API on the port from .env
RUST_LOG=debug cargo run   # verbose logging
```

### Build the frontend natively

```bash
cd frontend
npm install
npm run dev
```

### Admin account provisioning

On first run, an admin account is provisioned from the `LOYALTY_USERNAME` / `LOYALTY_PASSWORD` environment variables (see `.env.example`). The password must be at least 12 characters and must not match any well-known default. There is **no built-in default admin** — the application will refuse to seed an admin if these variables are missing or weak.

## Project Structure

```
loyalty-app/
├── backend-rust/            # Rust/Axum API server
│   ├── src/
│   │   ├── routes/          # HTTP route handlers (auth, loyalty, coupons, surveys, bookings, payments, admin)
│   │   ├── services/        # Domain services (incl. PromptPay)
│   │   ├── models/          # Data models
│   │   ├── middleware/      # Axum middleware
│   │   └── config/          # Configuration loader
│   ├── migrations/          # SQL migration files
│   ├── tests/               # Integration tests
│   └── Dockerfile
├── frontend/                # React 19 + Vite + TypeScript PWA
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── store/
│   │   └── styles/
│   └── Dockerfile
├── nginx/                   # Reverse proxy config
├── docs/                    # Operational and design docs
└── docker-compose.*.yml     # Local, staging, and production overlays
```

## API Surface (overview)

Routes mounted under `/api/`. Examples:

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`
- `GET /api/auth/me`, `POST /api/auth/reset-password/request`, `POST /api/auth/reset-password`
- `GET /api/users/profile`, `PUT /api/users/profile`
- `GET /api/loyalty/*`, `GET /api/coupons/*`, `GET /api/surveys/*`
- `POST /api/bookings`, `GET /api/bookings/:id`
- `POST /api/payments/*` (PromptPay QR generation)
- `/api/admin/*` (admin only)

For the full list, see route handlers in `backend-rust/src/routes/`.

## Testing

```bash
# Backend
cd backend-rust && cargo test

# Frontend
cd frontend && npm run lint && npm run typecheck && npm run test
```

E2E tests (Playwright) run in CI only — see `.github/workflows/ci-build-e2e.yml`. Local E2E is not supported because of port-isolation requirements.

## CI/CD

CI runs on every pull request (Rust tests, frontend lint/type/test, Trivy scan). Merges to `main` automatically deploy to staging via the `Deploy` workflow; production deployment requires manual approval in the GitHub UI.

## Security

If you discover a vulnerability, please follow the disclosure policy in [SECURITY.md](./SECURITY.md). Do **not** open a public issue.

For day-to-day production hardening:

- Rotate `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `SESSION_SECRET` periodically
- Keep `LOYALTY_PASSWORD` strong and rotate after staff changes
- Configure HTTPS at the edge (nginx / Cloudflare)
- Restrict admin IP ranges where feasible
- Review audit logs regularly

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All contributors must follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

Released under the MIT License — see [LICENSE](./LICENSE).
