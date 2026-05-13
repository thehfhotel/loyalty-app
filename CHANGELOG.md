# Changelog

All notable changes to this project are tracked here. Format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are dated
because the project ships from `main` without semver tags.

## 2026-05-13

### Test-pipeline parallelism + nextest
- `perf(ci)`: Switched the backend test runner to `cargo-nextest`. Split
  unit tests into a parallel `Test Backend Unit` job that runs on
  `ubuntu-latest` (no DB needed) alongside the renamed
  `Test Backend Integration` job (in the `rust:1.93-bookworm` container,
  postgres + redis services). Moved `cargo audit` to a daily scheduled
  workflow so it stops eating per-PR time when it gives no PR-blocking
  signal anyway (#228).
- `fix(tests)`: Replaced the in-process `tokio::sync::Mutex` that
  serialized `ensure_template_db()` with a Postgres advisory lock held
  on a dedicated connection. The in-process mutex was invisible across
  `nextest`'s per-process worker model, so every worker raced through
  the `DROP DATABASE / CREATE DATABASE` sequence and the losers panicked
  on `pg_database_datname_index`. Added a `template_db_has_users` probe
  so workers that acquire the lock after the first one short-circuit
  instead of redoing the work.
- Critical path on warm cache: heavy parallel stage dropped from 2m55s
  to 2m9s (−46s); end-to-end push → staging live now ~6m01s (was
  ~6m42s after #226, ~8m11s pre-sweep).

### Build-graph trim
- `perf(deps)`: Bumped `oauth2` v4→v5 (single-file migration in
  `services/oauth.rs` to the typestate builder API + SSRF-safe
  redirect policy) and trimmed `tokio = { features = ["full"] }` to
  the in-use subset. Collapsed an entire parallel HTTP/TLS stack
  (`reqwest 0.11`, `hyper 0.14`, `http 0.2`, `h2 0.3`, `base64 0.13`,
  `rustls 0.21`, `hyper-rustls 0.24`, `tokio-rustls 0.24` and matching
  sys crates). Duplicate transitive dep entries dropped from 71 → 53
  (−25%). Warm-cache CI:
  Build Backend Release 3m15s → 1m54s (−42%),
  Test Backend 3m16s → 2m55s (−11%),
  E2E 2m22s → 2m8s (−10%) (#226).
- `perf(ci)`: Spiked `mold` linker + clang and closed unmerged (#225) —
  the linker swap invalidated `target/` artifacts compiled with the
  default linker, blew up compile time, and timed out Test Backend at
  the 30-min job limit. Not worth pursuing for this codebase.

## 2026-05-12

### CI/CD speed sweep
- `perf(ci)`: Trivy scans pulled GHCR images instead of rebuilding from
  Dockerfile — backend scan dropped from 6m18s to ~30s (#219).
- `perf(ci)`: Consolidated Rust workflows into one, inlined deploy-staging
  into the build/e2e workflow (eliminates `workflow_run` trigger latency and
  the deploy-skip race), cached Playwright browsers and cloudflared (#220).
- `perf(ci)`: Split the consolidated Rust job back into parallel
  `test-backend` + `build-backend-release` jobs sharing one rust-cache
  prefix (#222). Net effect on critical path: ~9-10 min → ~8 min,
  end-to-end push → staging live.
- `fix(main)`: Migration error logging uses `{:#}` so the underlying sqlx
  / Postgres error reaches container logs (was previously swallowed by
  anyhow context, making every staging failure look identical).
- `fix(migrations)`: Made admin column-add migrations idempotent
  (`ADD COLUMN IF NOT EXISTS` + `DO`-block constraint guards) so a partial
  application no longer wedges the deploy (#221).
- `fix(migrations)`: Bridge for migrations rewritten in-source after being
  applied. `bridge_modified_migration_checksums` updates the recorded
  checksum for an allow-listed version set (currently just PR #215's
  canonical `booking_slips`) without re-running the SQL (#223). Unblocked
  the first successful staging deploy in months.

### Admin endpoint sweep
- `feat(admin)`: Booking management endpoints (list / detail / update /
  discount / cancel + room-types dropdown) backed by a new
  `booking_audit_log` table writing an audit row in the same transaction
  as every state change (#217).
- `feat(admin)`: Email service status + test-send endpoints, multi-slip
  verify / needs-action endpoints (#216).
- `feat(admin)`: Room and room-type CRUD writes (POST/PATCH/DELETE) +
  `room_management_columns` migration adding `bed_type`, `amenities`,
  `images`, `sort_order`, `notes` (#218).
- `docs`: `admin-backend-gaps.md` now tracks 21 of 35 endpoints
  implemented across batches 1/2/misc + room-writes; 14 remaining.

### Bookings + foundation
- `feat(bookings)`: `POST /api/bookings/:id/slips` for slip uploads (#211)
  and `DELETE /api/bookings/slips/:id` (#214).
- `chore(backend)`: Canonical `booking_slips` migration reconciling
  staging/production divergence + `backend-rust/scripts/regen-sqlx-cache.sh`
  helper that boots a throwaway Postgres, applies every migration, runs
  `cargo sqlx prepare --workspace -- --tests`, and tears the container
  down (#215).
- `fix(migration)`: Idempotent FK additions on `booking_slips` for
  pre-existing staging rows (#213).

### Auth
- `feat(auth)`: HttpOnly cookie refresh token migration completed —
  Phase 2 frontend switched to cookie-only flow (#208), Phase 3 backend
  removed the JSON-body refresh path (#212, breaking).

### Deployment infrastructure
- `feat(docker)`: Backend runtime switched to `gcr.io/distroless/cc-debian12`
  with a Rust health-check binary baked in (#209). Executable bit on
  copied binaries fixed (#210).
- `chore(ci)`: GitHub Actions deploy jobs migrated from a self-hosted
  runner to `ubuntu-latest` runners that SSH into evergreen through a
  Cloudflare tunnel. Org-level self-hosted runner retired.

### Repo hygiene
- `chore`: Public-repo readiness pass — `SECURITY.md` with real
  disclosure flow via GitHub Security Advisories (#205), README +
  CONTRIBUTING + CODE_OF_CONDUCT (#196), credential surface scrubbed
  from compose / env / workflow files (#197), Dependabot alerts
  triaged (#199).
- `chore`: Removed Node-era docs and slimmed `CLAUDE.md` (#198).
- `feat(promptpay)`: QR display + slip upload wired into the booking
  flow (#207).

## Earlier

Earlier history (Node → Rust port, initial loyalty + auth + PWA OAuth
flows, tier system migration to nights-based, original feature toggle
system) is preserved in `git log`.
