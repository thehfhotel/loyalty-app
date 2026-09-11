# Public-Launch Readiness Checklist

Seeded from the **Pre-launch checklist** section of
[`docs/audits/operational-2026-05-13.md`](audits/operational-2026-05-13.md)
and updated as Bundle A + B + C audit fixes land. Walk this once
before the public switch flips; revisit after every audit lens (the
next one is due ~90 days after the first public traffic).

Legend:
- `[x]` — landed and verified in repo / live
- `[~]` — partially landed (repo half done; an out-of-repo step remains)
- `[ ]` — open, with the audit finding ID it closes when ticked

## Operational baseline

- [x] **Graceful shutdown** on SIGTERM/SIGINT (CRIT-3) — wired in
  `backend-rust/src/main.rs` via
  `axum::serve(...).with_graceful_shutdown(...)`, with a bounded grace
  period that fits under `docker compose --timeout 30`.
- [x] **Automated Postgres backups** (CRIT-1) — a systemd timer on
  evergreen (`scripts/evergreen/`), encrypting with `age` to
  `/srv/backups/loyalty`. Replaces the old GitHub Actions + S3 workflow,
  which required cloud storage and had never actually produced a backup
  (its environment-scoped secrets read empty, so it skipped nightly while
  reporting success). Restore drill in
  [`docs/restore-runbook.md`](restore-runbook.md). Installed and drilled on
  evergreen 2026-07-28 — see the row below.
- [x] **Failure-alert path** (CRIT-2) — `cargo-audit`, `Verify Staging`,
  and `deploy.yml` now file GitHub issues on red instead of relying on
  someone refreshing the Actions tab.
- [x] **Container resource limits** in `docker-compose.prod.yml`
  (HIGH-2) — conservative starting values for backend / postgres /
  redis; revisit after the first capacity test (still open below).
- [x] **`Verify Staging` on-failure log capture** (HIGH-1) — 14-day
  artifact uploads on failure so the next deploy attempt isn't a
  blind retry.
- [x] **Rollback runbook** ([`docs/rollback-runbook.md`](rollback-runbook.md),
  HIGH-3) — covers SHA lookup, redeploy command, migration-forward-only
  constraint, when to combine with DB restore, approval contingency.
- [x] **Cloudflare tunnel runbook**
  ([`docs/cloudflare-tunnel-runbook.md`](cloudflare-tunnel-runbook.md),
  HIGH-6) — tunnel ID, systemd unit, restart command, health probe,
  what to do during a Cloudflare incident.
- [x] **JSON-line logs in non-development environments** (MED-2) —
  `tracing_subscriber::fmt::layer().json()` gates on
  `state.is_production()`/non-dev; dev still gets human-readable
  output.
- [x] **Request-ID propagation** (MED-3) — `tower_http::request_id`
  with `MakeRequestUuid` + `SetRequestIdLayer` + `PropagateRequestIdLayer`;
  ID is woven into the trace span and echoed as `x-request-id` on
  responses for support tickets.
- [x] **Internal healthcheck binary hits `/api/health`** (MED-1) —
  `backend-rust/src/bin/healthcheck.rs::HEALTHCHECK_PATH = "/api/health"`,
  regression-locked by a unit test in the same file.
- [x] **Migration-rewrite runbook**
  ([`docs/migration-rewrite-runbook.md`](migration-rewrite-runbook.md),
  MED-4) — when rewriting is legitimate, schema-diff pre-flight,
  staging verification, `REBRIDGED_MIGRATIONS` step.
- [x] **JWT-rotation impact documented**
  ([`docs/secrets-runbook.md` — "Impact on active sessions"](secrets-runbook.md#impact-on-active-sessions),
  MED-5) — per-secret session impact table, low-traffic-hour
  recommendation, dual-key-rotation noted as future work.
- [x] **Production-approval checklist**
  ([`docs/production-approval-checklist.md`](production-approval-checklist.md),
  MED-6) — link this from the GitHub Environment description for
  `production`.
- [x] **Login rate-limit verified** (LOW-2) — `RedisRateLimiter::strict()`
  is applied to the entire `auth::routes()` subtree
  (`backend-rust/src/routes/mod.rs::create_router`), which covers
  `/api/auth/login`, `/register`, `/forgot-password`, `/reset-password`
  and `/reset-password/request`. Limiter is in-process only when
  Redis is single-instance; Redis-distributed via `RedisRateLimiter`.
  Integration test
  (`backend-rust/tests/integration/auth_test.rs::test_login_rate_limit_returns_429`)
  pins the contract.
- [x] **booking_audit_log retention policy** (HIGH-5) — **implemented
  (F10).** A batched, time-based prune
  (`backend-rust/src/services/audit_retention.rs`) covers
  `booking_audit_log` and the far busier `slip_access_log`, on the same
  hourly-timer pattern as the F2 slip sweep. **Off until the owner names a
  window** (`AUDIT_LOG_RETENTION_DAYS`,
  `SLIP_ACCESS_LOG_RETENTION_DAYS` — repository variables, blank = off),
  and the windows are floored at **365 days** and **90 days**
  respectively: a value below the floor is refused and logged at startup,
  never clamped. Nothing belonging to a booking that is still open is
  ever pruned. The legal-review question is now only *which* number, not
  whether a mechanism exists.

## Still open before public launch

- [x] **Backup installed on evergreen** — **done 2026-07-28.** `install.sh` has
  been run on evergreen: the timer is active (next run 01:00 ICT), 5 encrypted
  dumps are present and `last-success` is fresh;
  `loyalty-backup-notify-github.sh` is installed and set as `ALERT_COMMAND`; a
  full alert drill filed issue #375 on a genuine failure, de-duplicated a repeat
  run to a comment, proved a broken notifier cannot fail an otherwise-good
  backup (`Result=success`, marker retained), then commented, **closed #375**
  and cleared the markers on a clean run; and a restore drill decrypted
  `loyalty_pg_20260727T204006Z.sql.gz.age` with the age key, loaded it into a
  throwaway `loyalty_db_restore` under `ON_ERROR_STOP=1`, verified 44 tables /
  10 users / 4 tiers, and dropped the scratch DB. Log:
  [`docs/restore-runbook.md` § Restore drill log](restore-runbook.md#restore-drill-log).

Nothing else is outstanding in this section. See **Accepted risks** below for
the one thing deliberately *not* being fixed before launch.

## Accepted risks

Decisions taken with eyes open, not oversights. Each is a conscious trade-off
the owner has signed off on; revisit them at the ~90-day re-audit.

- **Backups are single-site (accepted 2026-07-28).** The encrypted dumps in
  `/srv/backups/loyalty` live on evergreen, the same host that runs the
  production database. There are no offsite or second-machine copies. This
  covers the failure modes that actually happen — a bad migration, an
  accidental `DELETE`, a corrupted table, a restore drill — but **losing
  evergreen loses the database and every backup of it together**. The owner has
  weighed that against the cost and key-management surface of offsite storage
  and chosen to launch this way. Watch criteria for revisiting: the host moving
  off its current hardware, the first real data-loss incident, or any regulatory
  or customer commitment on recovery. The mitigation, if and when it is taken,
  is a pull-based copy of `/srv/backups/loyalty` to a second machine — the dumps
  are already `age`-encrypted at rest, so the second site never needs the key.

## After the first 30 days

- [~] **Runtime metrics / dashboard** (HIGH-4) — backend half **done**:
  `axum-prometheus` exposes request-rate / latency-histogram / in-flight
  metrics at `GET /metrics` (top-level, internal-only — nginx proxies
  only `/api` + `/storage`, so the endpoint is reachable on the Docker
  network for a scrape but never publicly). **Still open**: run a
  Prometheus on evergreen (scrape `backend:4001/metrics`) + a static
  Grafana dashboard, or point a hosted agent (Better Stack, Honeycomb)
  at it. There's no request-rate/error-rate/p99 *dashboard* until that
  scraper is wired.
- [x] **`booking_audit_log` retention partitioning** (HIGH-5) —
  **considered and deliberately not done (F10).** Retention ships as a
  batched prune instead. Range partitioning by `occurred_at` only pays
  off when the table is *read* by time, and neither of these tables is:
  `admin_bookings::fetch_audit_history` reads `WHERE booking_id = $1` and
  `admin_slips::get_slip_access_log` reads `WHERE slip_id = $1`. With no
  time predicate the planner can prune no partition, so every one of
  those reads would fan out across every partition that exists. Adopting
  it on the live tables would also mean a rewrite under `ACCESS
  EXCLUSIVE` (the partition key has to join the primary key), which
  blocks writes — the thing the prune was required not to do. Reasoning
  in full: `backend-rust/src/services/audit_retention.rs` module docs and
  `backend-rust/migrations/20260913000000_audit_log_retention.sql`.
- [ ] **Re-audit lens** — run the three audit lenses again ~90 days
  after public launch. Real traffic + real users almost always
  surface findings the read-only audit missed.

## Pre-launch "go / no-go" decision

A green checkbox in **every "Still open before public launch"** row
above is the bar. Don't flip the switch with a yellow row in there.
Decisions to skip a row need a writeup in this file (and a follow-up
issue) explaining the trade-off and the watch criteria.

## Where this is linked from

- [`CLAUDE.md` §  CI/CD](../CLAUDE.md#cicd)
- [`docs/audits/operational-2026-05-13.md`](audits/operational-2026-05-13.md)
  — original pre-launch checklist source
