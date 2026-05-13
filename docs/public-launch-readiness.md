# Public-Launch Readiness Checklist

Seeded from the **Pre-launch checklist** section of
[`docs/audits/operational-2026-05-13.md`](audits/operational-2026-05-13.md)
and updated as Bundle A + B + C audit fixes land. Walk this once
before the public switch flips; revisit after every audit lens (the
next one is due ~90 days after the first public traffic).

Legend:
- `[x]` — landed and verified in repo / live
- `[ ]` — open, with the audit finding ID it closes when ticked

## Operational baseline

- [x] **Graceful shutdown** on SIGTERM/SIGINT (CRIT-3) — wired in
  `backend-rust/src/main.rs` via
  `axum::serve(...).with_graceful_shutdown(...)`, with a bounded grace
  period that fits under `docker compose --timeout 30`.
- [x] **Automated Postgres backups workflow**
  (`.github/workflows/backup-production.yml`, CRIT-1) — daily schedule,
  guarded behind backup secrets (`BACKUP_AGE_RECIPIENT`,
  `BACKUP_S3_*`), restore drill documented in
  [`docs/restore-runbook.md`](restore-runbook.md). **TODO before
  public launch**: configure the backup secrets in GitHub Actions and
  *actually run the restore drill once.*
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
- [x] **booking_audit_log retention policy** (HIGH-5) — currently
  "retain indefinitely" pending legal review. Revisit before disk
  pressure (rule of thumb: when `pg_total_relation_size('booking_audit_log')`
  exceeds 20% of the data volume, partition or trim). Tracked as a
  follow-up rather than a launch blocker.

## Still open before public launch

- [ ] **Backup secrets wired in GitHub Actions** — `BACKUP_AGE_RECIPIENT`,
  `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`,
  `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` (see
  [`docs/secrets-runbook.md`](secrets-runbook.md#backup-secrets-workflow-githubworkflowsbackup-productionyml)).
  Without these the daily backup workflow is inert.
- [ ] **Restore drill performed once** (CRIT-1 closure) — follow
  [`docs/restore-runbook.md`](restore-runbook.md) against staging.
  Document the date and the restored DB size in the runbook so the
  drill is auditable.
- [ ] **Capacity test against staging** — at minimum a few hundred
  RPS of a representative read+write mix (e.g., `vegeta` /
  `k6` against `/api/loyalty/*` and `/api/auth/login`). Confirm the
  default 10-connection backend pool isn't the bottleneck; tune
  `DatabaseConfig::max_connections` if it is. Record p99 latency
  and 4xx/5xx rates as a pre-launch baseline.
- [ ] **GDPR / PDPA review** — Thai PDPA at minimum applies to
  `users.email`, `user_profiles.phone`, the `total_nights` history,
  and the OAuth-linked `provider_user_id`. Document:
  - what's stored,
  - retention window per field,
  - data-export procedure (currently manual: `gh issue` requested,
    backend dump via admin endpoint TBD),
  - account-deletion procedure (manual: admin closes account, then
    a future migration `DELETE`s the row after retention window).
  EU users add GDPR on top — decide whether to geoblock or to wire
  proper request handling.
- [ ] **Status page** — pick a host (statuspage.io, Atlassian
  Statuspage, a static page on Cloudflare Pages). At minimum show
  "API" and "Web" components. Link from the marketing site and the
  in-app footer.
- [ ] **Support-email rotation** — one address goes live with the
  public switch (e.g., `support@thehfhotel.org`). Decide whether
  it's a single inbox, a shared Gmail/Workspace label, or a help-
  desk product. Document the response SLA target.
- [ ] **On-call rotation** — at minimum a primary + secondary, with
  documented handoff. Until the team is ≥3, on-call is effectively
  one person — own that and define when "out of hours" means "the
  app can be down until morning".
- [ ] **Public Trivy / `cargo audit` policy** — both run in CI today
  but the on-failure path is a GitHub issue (CRIT-2). Decide
  pre-launch whether a fresh high-sev CVE blocks the next deploy
  or is triaged async. Document the policy in `CONTRIBUTING.md` or
  this file.
- [ ] **First public traffic capacity headroom** — the evergreen
  host's headroom (CPU/RAM/disk) against current resource limits is
  uncalibrated. Run `docker stats` for an hour during the capacity
  test; confirm the host has at least 2x the steady-state load
  available so a traffic spike doesn't OOM the data plane.

## After the first 30 days

- [ ] **Runtime metrics / dashboard** (HIGH-4) — currently no
  request rate / error rate / p99 visibility outside `tracing` logs.
  `axum-prometheus` + a small Prometheus on evergreen + a static
  Grafana dashboard is the cheapest baseline; a hosted alternative
  (Better Stack, Honeycomb) is the lower-effort path. Decide based
  on actual traffic and budget.
- [ ] **`booking_audit_log` retention partitioning** (HIGH-5) —
  if disk pressure emerges, range-partition by `occurred_at` (year)
  so old partitions can be detached cheaply.
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
