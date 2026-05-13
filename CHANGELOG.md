# Changelog

All notable changes to this project are tracked here. Format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are dated
because the project ships from `main` without semver tags.

## 2026-05-13

### `fix(audit)`: correctness mediums + lows
Closes Bundle B + C of `docs/audits/correctness-2026-05-13.md` in a single
PR. No new schema; only existing call sites + a handful of validation
guards.

- **MED-1 OAuth state replay window**: switch the Google and LINE
  callback paths to consume the Redis state value with `GETDEL` instead
  of `GET`-then-`DEL`-after-exchange. Removed the now-dead
  `delete_oauth_state` helper. New integration tests assert the state
  key is gone after a single callback for both providers.
- **MED-2 `payment_type` / `payment_amount` read-only**: wire both
  columns into `UpdateBookingRequest`, the `UPDATE bookings` SET clause,
  and the `BeforeRow` snapshot/audit diff. Handler-side validation
  rejects `payment_type` values outside `{full, deposit}` with 400
  instead of leaking a 500 from the CHECK constraint. New integration
  tests round-trip both fields via PUT → GET and assert a 4xx on an
  invalid `paymentType`.
- **MED-3 `get_stats` swallowed errors**: replaced the two
  `.unwrap_or(0)` sites on `total_points_issued` and `total_bookings`
  with `?` so query failures surface instead of being coerced to a
  misleading zero. The decoding-time `.unwrap_or(0)` defaults on
  optional columns elsewhere in `routes/admin.rs` are intentional and
  remain untouched.
- **MED-4 `validate_migrations` never called**: invoke it from
  `run_migrations` after `MIGRATOR.run` and refuse to boot on any
  checksum mismatch or missing version outside the `REBRIDGED_MIGRATIONS`
  allowlist. Bridge bugs now fail the deploy explicitly with a logged
  per-mismatch error and an `anyhow!` summary, same risk-profile fix as
  the recent startup-log `{:#}` change.
- **MED-5 OAuth provisioning not transactional**: wrap the new-user
  inserts (`users`, `user_profiles`, `notification_preferences`,
  `user_audit_log`, `user_loyalty`) in a single `sqlx::Transaction` and
  commit at the end. Race-loss branch rolls back the empty transaction
  before linking the existing row. The `notification_preferences`
  insert no longer uses `let _ = …` (LOW-2 covered en passant). New
  integration test confirms no half-provisioned user remains when the
  loyalty insert fails mid-flow.
- **LOW-1 password reset cooldown**: 1-minute per-user cooldown on the
  `password_reset_tokens` insert via `WHERE NOT EXISTS (...)`. The HTTP
  rate limiter is already wired through `redis_rate_limit_middleware`
  with the strict 5/min preset on `/api/auth/forgot-password`
  (`routes/mod.rs`); the new guard caps per-victim token churn even
  inside that budget.
- **LOW-2 `let _ = sqlx::query!(…)`**: the survey
  `award_survey_completion_coupons` call now logs failures at
  `warn!` while keeping the non-fatal semantics (the survey response
  must not roll back). The OAuth notification_preferences variant was
  cleaned up as part of MED-5 above.

Bundles A + B (the criticals + highs) shipped in #235/#236/#237; this PR
closes the remaining audit items from `correctness-2026-05-13.md`.

### Pre-launch audit + fixes
Three read-only audit lenses landed (#232 operational, #233 security,
#234 correctness) surfacing 46 findings total (6 critical, 14 high, 17
medium, 9 low). Followed by three implementation bundles, each scoped
to a domain:

- **`fix(audit)`: schema + data-integrity** (#237) — `users.email`
  UNIQUE constraint with `ON CONFLICT` registration + OAuth
  provisioning paths; closed booking-creation TOCTOU on overlapping
  room dates via `EXCLUDE USING gist` constraint + transaction;
  `Idempotency-Key` support for `POST /api/loyalty/award` and
  `POST /api/bookings/:id/slips` via a new `idempotency_keys` table;
  delegate admin loyalty awards to `award_points` stored procedure
  (CLAUDE.md rule #7); write `booking_audit_log` rows from admin
  slip mutations; scope test orphan-DB cleanup so sibling nextest
  processes don't drop each other's databases.
- **`fix(audit)`: auth/authz hardening** (#236) — block admin →
  super_admin role escalation (and demotion of existing super_admins)
  in `update_user` and `update_user_role`; switch rate-limiter to
  bucket by the actual TCP peer via `ConnectInfo` and harden
  `nginx.conf` to replace (not append) `X-Forwarded-For`; lock down
  `POST /api/admin/email/test` to the caller's own address with a
  daily Redis-backed quota; restrict `slipUrl` to `/storage/slips/`
  prefix and verify image magic bytes; per-route 10 MiB body limit
  on slip upload; authn-gate slip-serving with per-slip ownership
  check; allowlist `RUSTSEC-2023-0071` in `.cargo/audit.toml` with
  rationale (HS256-only build, RSA path unreachable).
- **`fix(audit)`: ops infra** (#235) — graceful shutdown on
  SIGTERM/SIGINT in the Axum server; `error!("...: {:#}", e)` on
  startup paths so anyhow cause chains surface; daily encrypted
  Postgres backups workflow (guarded behind secrets until wired);
  GitHub issue filed on `cargo-audit` / `Verify Staging` /
  `Deploy` failure (silent-CI tab gap closed); staging backend
  log capture on `Verify Staging` failure with 14-day artifact;
  conservative resource limits in `docker-compose.prod.yml`;
  three new operational runbooks (rollback, cloudflared tunnel,
  migration rewrite); JSON-line logging in non-development
  environments; `x-request-id` propagation through Axum's
  TraceLayer.

Bundles A + B together close all 6 critical and most high-severity
findings. Bundle C closes the operational criticals plus most highs.
Remaining audit follow-ups (Bundle B/C mediums + lows) are tracked
in the three audit docs under `docs/audits/`.

### E2E off the deploy critical path
- `perf(ci)`: Moved E2E to run in parallel with `deploy-staging` instead
  of gating it. Every PR still runs full E2E before merge (the meaningful
  gate); production still requires manual approval (the user-facing
  gate); E2E remains a workflow-level status signal on `main` runs so a
  red E2E surfaces before prod approval, but it no longer blocks the
  staging deploy itself.
- `feat(ci)`: New `Verify Staging` job polls `/api/health` for up to 90s
  after `deploy-staging` completes. Catches deploy-itself-broken cases
  (image won't start, runtime migration crash, missing env var) that
  pre-merge tests can't see.
- `perf(ci)`: Cached `cargo-nextest` binary keyed on the toolchain
  version so warm-cache runs skip the install step.
- Critical path on warm cache: `Lint → max(Test, Build) → Push → Deploy
  → Verify ≈ 3m43s`. E2E (~2m) runs in parallel with `Deploy + Verify`
  and finishes ~30s after. End-to-end push → staging-live drops from
  ~6m01s to ~3m43s — about **2m20s** off the critical path, on top of
  earlier sweep wins (#230).
- `docs`: CLAUDE.md updated to document the new gating model so future
  contributors understand why E2E isn't a deploy gate.

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
