# CLAUDE.md - Project Conventions

This file documents conventions and rules for contributors (human and AI).
Operational specifics (port maps, deploy paths, container names) live in the
relevant `docker-compose.*.yml` files and the GitHub Actions workflow, not here.

## Mandatory Rules

### 1. Docker Compose Syntax
Use `docker compose` (with a space). Never `docker-compose` (with a hyphen).

```bash
# Correct
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Wrong
docker-compose up -d
```

### 2. Git Hooks Are Mandatory
```bash
# Forbidden
git commit --no-verify
git push --no-verify

# Correct — let the hooks run
git commit -m "feat: description"
git push
```

### 3. Never Merge PRs Automatically
Human review is required for every pull request.

```bash
# Forbidden
gh pr merge --auto
gh pr merge <PR_NUMBER>   # without human review

# Correct — open the PR and stop
gh pr create --title "feat: description" --body "..."
```

Code review catches bugs, security issues, and design problems that
"obvious" changes can still introduce. Auto-merge bypasses that safety net.

### 4. Testing Integrity Is Absolute
```typescript
// Forbidden
test.skip('test')
expect(true).toBe(true)             // meaningless
if (process.env.SKIP_TESTS) return  // bypass

// Correct
expect(actualResult).toBe(expectedResult)
```

### 5. Path Handling
- Prefer absolute paths in CI/CD.
- Validate relative paths (especially `../` traversal).
- Test paths in both local and CI environments.

### 6. Database Access
Never touch the database directly. Always go through the backend API.

```bash
# Forbidden
psql -c "UPDATE user_loyalty..."

# Correct
curl -X POST http://<host>/api/loyalty/award-points
```

If the API doesn't exist yet, create it first.

## Project Architecture

### Repository Structure
```
loyalty-app/
├── backend-rust/    # Rust/Axum API (production backend)
├── frontend/        # React/TypeScript SPA
├── scripts/         # Deployment and ops scripts
├── tests/           # End-to-end tests
└── docker-compose.* # Environment-specific compose overrides
```

### Branching Model
Trunk-based development. `main` is the only long-lived branch.
Feature branches merge to `main` via PR. Pushes to `main` trigger
the CI/CD pipeline (tests, image build, staging deploy, then
production with manual approval).

### Database Operations

- **Migrations** live under `backend-rust/migrations/` and are applied
  automatically when the backend starts.
- The Rust backend uses `sqlx` with **compile-time** query macros validated
  against the offline cache in `.sqlx/`. Regenerate with
  `DATABASE_URL=... cargo sqlx prepare` against a live database; CI
  verifies the cache with `cargo sqlx prepare --check`. The helper
  `backend-rust/scripts/regen-sqlx-cache.sh` automates the workflow: it
  boots a throwaway Postgres container, applies every migration, runs
  `cargo sqlx prepare --workspace -- --tests`, and tears the container
  down. After adding or modifying any `sqlx::query!` / `sqlx::query_as!`
  call, run that script and commit the resulting `.sqlx/*.json` files.
- Use stored procedures (e.g., `award_points`, `recalculate_user_tier_by_nights`)
  rather than raw `UPDATE` statements for tier-affecting operations.

**Tier system (nights-based):**
```
Bronze: 0+   Silver: 1+   Gold: 10+   Platinum: 20+ nights
```

### Rust Backend
The Rust toolchain version is pinned in `backend-rust/rust-toolchain.toml`.
Rustup will pick it up automatically when you `cd backend-rust`.

```bash
cd backend-rust
cargo build              # debug build
cargo build --release    # release build
cargo run                # run locally
cargo test               # run all tests
RUST_LOG=debug cargo run # run with debug logging
```

Key patterns:
- `AppState::new(pool, redis, config)` constructs the application state.
- Use the `.db()` accessor on `AppState`, not direct field access.
- Routes follow the `routes().with_state(state)` pattern.

### Frontend
TypeScript error handling pattern:
```typescript
catch (error) {
  if (error instanceof Error) {
    console.log(error.message);
  } else {
    console.log('Unknown error:', String(error));
  }
}
```

Tailwind plugins must be in the correct `package.json` section and validated
before build.

### API Routes
Before wiring a new frontend call:
1. Find the handler in `backend-rust/src/routes/`.
2. Check the mount path in `backend-rust/src/routes/mod.rs`.
3. Construct the full path: `/api/{mount}/{route}`.
4. Hit it with `curl` first to confirm.

## Development Standards

### Security
- Never log sensitive data (passwords, tokens, API keys).
- Validate input on every boundary.
- Sanitize user-controlled content (XSS).
- Use parameterized queries (SQL injection).
- Use stored procedures for complex DB operations.
- Sanitize user-controlled values before embedding them in log output
  (log injection).

### Git Commits
Conventional commit prefixes:
```
feat:     a new feature
fix:      a bug fix
improve:  enhancement to existing functionality
refactor: code restructuring without behavior change
test:     add or update tests
docs:     documentation changes
chore:    maintenance, tooling, deps
```

### Testing Requirements
- Frontend: TypeScript compiles, ESLint passes (warnings OK, errors not).
- Backend: `cargo build` and `cargo test` pass.
- All tests pass — no skips, no fakes, no bypasses.
- Maintain coverage; meaningful assertions only.

### Environment Variables
- Templates: `.env.example`, `.env.production.example`.
- Real values: `.env`, `.env.production` (never committed).
- Production secrets live in GitHub Actions secrets.

## Quick Reference

```bash
# Local development
docker compose up -d

# Backend development
cd backend-rust
cargo build
cargo test
cargo run
RUST_LOG=debug cargo run
cargo sqlx prepare           # regenerate .sqlx/ cache (needs DATABASE_URL)
cargo sqlx prepare --check   # verify cache is up-to-date

# Frontend quality checks
cd frontend && npm run lint && npm run typecheck && npm run test

# Git workflow (trunk-based)
git checkout -b feature/my-feature
# ... make changes ...
git commit -m "feat: description"   # hooks run automatically
git push -u origin feature/my-feature
gh pr create --base main
```

## Non-Negotiables

1. Use `docker compose` (never `docker-compose`).
2. Never bypass git hooks.
3. Never bypass, skip, or fake tests.
4. Prefer absolute paths; validate relative paths.
5. No direct database access — always go through APIs.
6. Use environment-specific compose overrides.
7. Use stored procedures for complex DB operations.
8. Maintain code quality standards.
9. Follow security best practices.
10. Write meaningful tests.

**Critical facts:**
- Tiers are computed from `total_nights`, not `current_points`.
- Trunk-based development: only `main` exists; no `develop`.
- Staging and production both run from GHCR images via the same Docker stage.
- Production deployment requires manual approval in GitHub.
