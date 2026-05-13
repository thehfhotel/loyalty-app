# Operational readiness audit — 2026-05-13

Lens: operational readiness for a public-launch deploy of
`thehfhotel/loyalty-app`. Read-only investigation of repo, workflows, and
compose overlays. No code changes, no SSH to evergreen. Security and
correctness gaps were flagged-and-passed-along, not deep-dived.

## Summary

- **18 findings**: 3 critical, 6 high, 6 medium, 3 low.
- Overall posture: the deploy *pipeline* is now fast and well-instrumented
  (~3m43s push-to-staging-live, post-deploy `/api/health` poll, migration
  rebridge guard, distroless backend with a real Rust healthcheck binary),
  but the *operational shell* around it is essentially missing. There is
  no on-call alerting path for any failure mode that doesn't manifest as
  a GitHub Actions red X; no runtime metrics or dashboards; no automated
  Postgres backup; no graceful shutdown in the Axum process; no resource
  limits on production containers; no documented rollback or
  tunnel-failure procedure; no retention plan for `booking_audit_log`.
  Functionally, the app would launch and probably work; operationally, a
  one-person on-call after dark would be flying blind for any failure
  that doesn't trip a CI workflow.
- **Top 3 to fix before public launch**:
  1. **Automate Postgres backups** with retention + a one-time documented
     restore drill (currently `scripts/backup-production.sh` exists but is
     not scheduled anywhere — the production database has *no* automated
     backup). See CRIT-1.
  2. **Wire failure alerts** for `Verify Staging`, `Cargo Audit`, and any
     CI red on `main` to a channel a human actually reads (email, Slack,
     Discord — anything non-Actions-tab). See CRIT-2.
  3. **Add graceful shutdown to the backend** (`axum::serve(...).with_graceful_shutdown(...)`)
     so deploys don't drop in-flight requests, plus container resource
     limits and a documented rollback runbook so deploys can be
     reversed without ad-hoc shell archaeology. See CRIT-3, HIGH-2,
     HIGH-3.

## Findings

### CRITICAL — CRIT-1: No automated production database backup

- **Where**: `scripts/backup-production.sh` exists but is invoked
  nowhere — no cron, no GitHub Actions schedule, no systemd timer on
  evergreen referenced in repo. There is no backup workflow under
  `.github/workflows/`.
- **What**: The script supports full and DB-only modes, compression,
  and a 10-backup retention window — but it has to be run by hand. The
  prod Postgres data volume is the canonical store of user / loyalty /
  booking / `booking_audit_log` data, and nothing schedules a dump of
  it. No restore drill is documented or referenced anywhere in
  `docs/`. The script also has a stale credential default
  (`pg_dump -U loyalty loyalty_db`) that no longer matches the
  GHCR-deployed compose stack.
- **Impact**: Any data-loss event on the evergreen Postgres volume
  (disk full, container wipe, accidental `docker volume rm`, ransomware,
  a bad migration in a rewritten file outside the
  `REBRIDGED_MIGRATIONS` allow-list) is unrecoverable. Public launch
  amplifies this — every customer signup, points award, and tier
  transition is at risk until a real backup loop is running.
- **Fix**: Add a `.github/workflows/backup-production.yml` that runs
  daily on schedule, SSHes through the same Cloudflare tunnel the
  deploy uses, calls `pg_dump`, encrypts and ships to off-host
  storage (S3 / Backblaze / R2), with retention of at least 30 days.
  Update `scripts/backup-production.sh` to take credentials from
  env vars rather than hardcoded `-U loyalty`. Document a restore
  drill in `docs/restore-runbook.md` and *actually run it once*
  before public launch.
- **Effort**: Medium (~1 day for backup workflow + cold-storage
  destination + restore drill).

### CRITICAL — CRIT-2: Pipeline failures have no alerting path

- **Where**: `.github/workflows/cargo-audit.yml` lines 8–13 explicitly
  note "for now we just rely on the workflow appearing red on the
  Actions tab"; `.github/workflows/ci-build-e2e.yml` (`verify-staging`
  job, lines 861-883) has no notification step on failure;
  `.github/workflows/deploy.yml` likewise has no on-failure step.
- **What**: When `Verify Staging` fails after a staging deploy goes
  bad on `main`, the deploy is broken-but-reachable (staging container
  is up or down depending on the failure mode — see HIGH-1) and the
  only signal is a red status in the GitHub Environments panel that
  nobody is paged to look at. Same for the daily `Cargo Audit`
  workflow — a new CVE could land in `tokio` and the only signal is
  a red X in a tab nobody opens. Same for any CI failure on `main`
  outside of a PR cycle.
- **Impact**: An incident that doesn't immediately surface to the
  user (e.g., a runtime panic in a low-traffic endpoint, a Cargo
  CVE) goes undetected for hours or days. Public launch turns this
  from a development annoyance into an actual P1 risk.
- **Fix**: Add `if: failure()` notification steps on the three workflows
  above using a low-friction channel — `dawidd6/action-send-mail` to
  `winut.hf@gmail.com`, a Slack webhook, or even
  `gh issue create` on `cargo-audit` failure (the workflow already
  has `issues: write` permission per a TODO comment). Mirror the
  same notification on the `production` GitHub environment's required
  reviewer for the manual-approval step.
- **Effort**: Small (~1 hour to wire the first channel and three
  workflows).

### CRITICAL — CRIT-3: No graceful shutdown — deploys drop in-flight requests

- **Where**: `backend-rust/src/main.rs:150` — `axum::serve(listener, app).await?;`
  has no `.with_graceful_shutdown(...)` and no SIGTERM/SIGINT signal
  handling anywhere in the binary (`grep -rn "shutdown\|sigterm\|SIGTERM"
  backend-rust/src/` returns nothing relevant).
- **What**: When `docker compose up -d` rotates the backend container,
  Docker sends SIGTERM and Axum just exits the moment the runtime
  cancels — any request mid-flight (especially `POST /api/bookings/:id/slips`
  with multi-MB multipart uploads, or `POST /api/auth/register` doing
  password hashing) drops on the floor. Same for SSE long-lived
  connections in `routes/sse.rs`.
- **Impact**: On each deploy (multiple per day on a busy week), a
  cohort of real users gets a connection reset and has to retry. At
  low traffic this is unnoticed; with public users it produces support
  tickets and breaks idempotency assumptions on flows like slip upload
  (a half-uploaded slip can leave a partial DB row).
- **Fix**: Wire a shutdown signal future and pass it to
  `axum::serve(...).with_graceful_shutdown(shutdown_signal())`. Standard
  pattern is `tokio::signal::ctrl_c()` raced against
  `tokio::signal::unix::signal(SignalKind::terminate())`. Give it a
  bounded grace period (~25s, just under the docker compose
  `--timeout 30` default). The db pool `close()` accessor already
  exists in `backend-rust/src/db/mod.rs:91`.
- **Effort**: Small (~30 lines, well-known idiom).

### HIGH — HIGH-1: `Verify Staging` failure leaves staging in an undefined state

- **Where**: `.github/workflows/ci-build-e2e.yml:861-883`
  (`verify-staging` job) — polls `/api/health` for 90s but on failure
  just exits 1 with no rollback, no container inspect, no log capture,
  no `docker compose ps` output. The job runs *after* `deploy-staging`
  has already swapped the running container.
- **What**: When `Verify Staging` fails, the staging container has
  already been replaced by the new image — the old `_dev` containers
  are gone. The new one is either:
  (a) running but `/api/health` returns 500 (e.g., db unreachable from
  inside the container), in which case staging is broken-but-reachable
  and the public-facing `loyalty-dev.saichon.com` URL serves a broken
  app, or
  (b) crash-looping, in which case staging returns connection errors.
  Either way there is no automatic rollback, no captured backend log
  in the workflow run, and no notification (see CRIT-2). The next
  push to `main` will try to overwrite it again with the same bug.
- **Impact**: A bad staging deploy poisons staging until the next
  green push. Production gates on staging via the manual approval
  step, but only a human checking the GitHub Environments panel
  would notice — which they won't, because there's no alert.
- **Fix**: On `verify-staging` failure, capture
  `docker compose ... logs --tail=200 backend` and the
  `docker compose ... ps` output via the same SSH tunnel, upload as
  workflow artifact, *and* fire the CRIT-2 alert channel. Optionally
  add an auto-rollback step that runs the same SSH path with
  `IMAGE_TAG=<previous-green-sha>` — the previous SHA is recoverable
  from `gh run list --workflow=ci-build-e2e.yml --branch=main --json
  conclusion,headSha`.
- **Effort**: Medium (~2 hours for log-capture + alert; ~half-day if
  auto-rollback included).

### HIGH — HIGH-2: No container resource limits on production

- **Where**: `docker-compose.prod.yml` (whole file). No `deploy.resources.limits`
  block on any service. `docker-compose.yml` likewise has none. No
  `mem_limit` / `cpus` keys anywhere.
- **What**: Backend, frontend (nginx), postgres, redis, and nginx
  reverse-proxy share an unbounded slice of the evergreen host's
  CPU and memory. A runaway loop in any route handler, a leaked
  connection pool, or an `INSERT` into `booking_audit_log` that
  accidentally accumulates JSONB across a slow scan can OOM the
  postgres container, which takes down auth and bookings simultaneously.
  There's also no `restart` policy info beyond `unless-stopped`.
- **Impact**: A single bad commit or sufficiently large
  unbounded-growth workload will cascade. With `booking_audit_log`
  already designed for *unbounded* growth (a row per admin action,
  with `before_data` + `after_data` JSONB) postgres memory pressure
  is a plausible failure mode within weeks of public launch.
- **Fix**: Add per-service `deploy.resources.limits` in
  `docker-compose.prod.yml` — start conservative
  (backend: 1 CPU / 512MiB, postgres: 2 CPU / 2GiB, redis: 0.5 CPU /
  256MiB) and tune from real-traffic numbers. Document the "exceeded
  this, time to scale" trigger in a runbook. Note: with non-swarm
  compose, you may also need `mem_limit` and `cpus` keys for the
  limits to actually apply.
- **Effort**: Small (~half-day including a short load test to pick
  starting numbers).

### HIGH — HIGH-3: No rollback runbook

- **Where**: `scripts/rollback-deployment.sh` exists but is
  framework-agnostic — it assumes you `git reset --hard` locally,
  then "remember to rebuild and restart containers" (line 132).
  This is the *old* Node-era flow; the new GHCR-based deploy never
  rebuilds from local source.
- **What**: With GHCR `<sha>` tags, the right rollback is "redeploy
  the previous `<sha>` image" — i.e., re-run the same SSH-to-evergreen
  flow as `deploy.yml` but with the previous commit SHA, no `git`
  involved. That procedure is not documented anywhere in `docs/`,
  `CLAUDE.md`, or the secrets runbook. The closest match,
  `scripts/deploy-from-ghcr.sh`, takes the SHA as `$3` (line 24)
  but there is no documented invocation example.
- **Impact**: When prod goes red at 22:00 on a Saturday, the on-call
  has to reverse-engineer the deploy flow under stress. Mean time to
  recover is much longer than it needs to be. Higher chance of
  collateral damage from a wrong rollback (e.g., rolling code back
  to a pre-migration SHA after the migration already ran — the
  current `sqlx::migrate!` design has no down-migrations).
- **Fix**: Add `docs/rollback-runbook.md` covering:
  (1) Identifying the last-known-good SHA via
  `gh run list --workflow=ci-build-e2e.yml --branch=main`;
  (2) Triggering a redeploy via `gh workflow run deploy.yml` with the
  prior SHA, or a documented manual SSH invocation that mirrors the
  `deploy.yml` env-injection block;
  (3) The migration-forward-only constraint, with explicit
  do-not-roll-back-code-past-the-last-migration warning;
  (4) When to combine with a database restore vs. when not to;
  (5) Who can approve the production environment if the regular
  approver is unreachable.
- **Effort**: Small (~2 hours documentation + a dry-run).

### HIGH — HIGH-4: No runtime metrics / dashboard

- **Where**: `Cargo.toml` has no `metrics`/`prometheus` crate;
  `backend-rust/src/routes/mod.rs` has no `/metrics` route; no
  Grafana/Prometheus reference anywhere in the repo. The only
  metrics surface is `scripts/metrics/actions-metrics.js` which
  reports on CI runs, not on runtime.
- **What**: There is no visibility into request rate, error rate,
  p99 latency, DB connection pool saturation
  (`db.max_connections` default is `10` — a real number worth
  watching), Redis hit/miss, or queue depth on any background task.
  The only operational signal is `tracing::info!` lines in a
  container log that no one is tailing.
- **Impact**: When a regression slows `/api/loyalty/award-points` from
  100ms to 2s, nobody notices until customers complain. When the
  10-connection pool saturates under traffic, every request 503s
  and the only debug artifact is "container looks fine, why is the
  app slow?"
- **Fix**: Pick the lightest-weight viable option for the team size:
  `axum-prometheus` + a small Prometheus running on evergreen + a
  static Grafana dashboard for request rate / p99 / pool saturation /
  4xx-5xx counts. Or, cheaper: emit structured JSON logs (currently
  human-formatted via `tracing_subscriber::fmt::layer().with_target(true)`
  at `backend-rust/src/main.rs:164`) and aggregate with
  Cloudflare's free analytics / a tiny vector→loki stack. Either
  is a multi-day project; flagging now so it doesn't ambush you
  three weeks after public launch.
- **Effort**: Large (~3-5 days for a real Prometheus+Grafana setup).

### HIGH — HIGH-5: `booking_audit_log` has no retention policy

- **Where**: `backend-rust/migrations/20260512020000_booking_admin_fields.sql:83-127`
  defines `booking_audit_log` with `before_data JSONB` + `after_data JSONB`
  per row, indexed on `(booking_id)` and `(occurred_at DESC)`, written
  inside the same transaction as every admin booking state change
  (`backend-rust/src/routes/admin_bookings.rs:1184`). No retention or
  partitioning.
- **What**: Each booking edit / discount / cancel writes one row
  containing two JSONB snapshots of the booking. With public-user
  bookings + admin-side adjustments at hotel scale, this table grows
  monotonically and the `before_data`/`after_data` payload can be
  many KB. Within a year there's no immediate query-perf issue (the
  index on `occurred_at DESC` is fine), but disk usage grows
  unboundedly and `pg_dump` time scales with it.
- **Impact**: On a long-running prod instance, audit log eventually
  dominates DB size — `pg_dump` slows, backup-restore cycle stretches,
  postgres memory pressure increases. Not P1, but inevitable.
- **Fix**: Document the retention policy explicitly (e.g., "keep
  forever for legal" or "trim rows older than 2 years") and either
  (a) range-partition `booking_audit_log` by `occurred_at` so dropping
  old partitions is cheap, or
  (b) add a scheduled job (Postgres `pg_cron` or a GH Actions cron
  workflow) that periodically `DELETE`s rows older than the policy
  cutoff. Either way, decide before launch — partitioning is far
  cheaper to introduce on an empty table than after a year of growth.
- **Effort**: Small if you pick "retain forever, partition by year"
  now (~2 hours migration + sqlx cache regen).

### HIGH — HIGH-6: Cloudflare tunnel is single SPOF, undocumented

- **Where**: `.github/workflows/deploy.yml:121-231` (production) and
  `.github/workflows/ci-build-e2e.yml:759-851` (staging) both deploy
  by SSHing through `cloudflared access ssh` to
  `evergreen.thehfhotel.org`. The tunnel itself is configured
  outside the repo (presumably on the evergreen host). No docs in
  `docs/` cover tunnel name, daemon configuration, failover, or
  restart procedure.
- **What**: The tunnel is the only ingress path for *both* deploys
  *and* production user traffic (loyalty.saichon.com and
  loyalty-dev.saichon.com both route through Cloudflare). When the
  tunnel daemon dies, both staging deploys and the public app go
  dark at the same moment. There is no monitor on the tunnel
  process itself, no documented restart command, and no contingency
  for an extended Cloudflare outage.
- **Impact**: A `cloudflared` daemon crash on evergreen is
  recoverable in minutes once you know what to do; it can be hours
  if you don't. A regional Cloudflare incident has no fallback.
- **Fix**: Add `docs/cloudflare-tunnel-runbook.md` covering tunnel
  ID, the systemd unit name on evergreen, how to restart it
  (`systemctl restart cloudflared`), how to verify health
  (`cloudflared tunnel info <id>`), and what to do during a
  Cloudflare incident (probably just "wait"). Optionally enable
  Cloudflare's tunnel-health-check email notification on the team
  Cloudflare account. Longer-term, consider a second tunnel
  endpoint for redundancy.
- **Effort**: Small (~1 hour for the doc).

### MEDIUM — MED-1: `/api/health` is the only health surface; the path used by the docker healthcheck and `Verify Staging` is the basic one

- **Where**: `backend-rust/src/routes/health.rs:198-205` mounts
  `/` (full check, checks DB+Redis) and `/basic` (just-the-process).
  The compose healthcheck (`docker-compose.prod.yml:80`) invokes
  `/app/healthcheck` — a tiny Rust binary that hits the configured
  local URL. Without auditing `src/bin/healthcheck.rs` it's unclear
  whether it hits `/api/health` (full check, good) or
  `/api/health/basic` (process-up-only — would lie when DB or Redis
  are dead).
- **What**: If the embedded healthcheck binary hits the basic
  endpoint, a sick backend with a healthy process but a dead db
  connection passes both the docker healthcheck *and* the
  `Verify Staging` poll. The deploy then looks green while user
  requests 503.
- **Impact**: False-green deploys mask real outages until users
  complain.
- **Fix**: Verify (or change) `src/bin/healthcheck.rs` to hit
  `/api/health` (which is mapped to `health_check_full` per
  `health.rs:200`, *good*) rather than `/api/health/basic`. The
  `verify-staging` job already hits `/api/health` so that side is
  fine. Add a unit test or comment in `bin/healthcheck.rs`
  fixing the contract.
- **Effort**: Small (~30 min to verify and add a test).

### MEDIUM — MED-2: No structured logging — log aggregation will be painful

- **Where**: `backend-rust/src/main.rs:156-172` initializes
  `tracing_subscriber::fmt::layer()` with default formatter (human
  text output). No `.json()` formatter, no JSON output.
- **What**: Container logs are human-formatted strings like
  `2026-05-13T13:42:10Z INFO loyalty_backend::routes::auth: Login
  succeeded for user X`. To aggregate them into Loki, ELK, or
  Cloudflare Logs, you parse-by-regex per line type and lose all
  the structured fields that `tracing` already has internally.
- **Impact**: Whenever you do decide to ship logs off-host, you have
  to redo every log call to be parseable, or accept that log
  search is `grep`. Not P0, but every day this lives, more code
  references the unstructured format.
- **Fix**: Switch the fmt layer to `.json()` in production and
  staging (`if config.environment != Development { fmt_layer.json() }`).
  Confirm `tracing::info!(user_id = %id, "...")` style is consistent
  across the codebase (the spot-check looks fine — see
  `main.rs:57-62`).
- **Effort**: Small (~1 hour + a careful look at the dashboard you
  use locally; JSON output is harder to read in a terminal).

### MEDIUM — MED-3: No request ID / correlation ID in logs

- **Where**: `backend-rust/src/main.rs:243-248` configures
  `TraceLayer::new_for_http()` with default `make_span_with`,
  which doesn't inject a request ID. There's no
  `tower_http::request_id` layer, no `RequestId` extension.
  `grep -rn "request_id\|trace.*id\|correlation" backend-rust/src/`
  returns nothing relevant.
- **What**: A panic or error in `routes/auth.rs` produces a log line
  that can't be tied to the request that caused it, the user agent,
  or any downstream queries the same request kicked off (db, redis,
  external OAuth call). When a user reports "this failed at 14:32"
  the only correlation is timestamp + endpoint, which is fragile
  at any non-trivial traffic.
- **Impact**: Debugging a user-reported error from production logs
  takes 10x longer than it would with a request ID.
- **Fix**: Add `tower_http::request_id::SetRequestIdLayer::x_request_id(MakeRequestUuid)`
  and propagate the ID into the trace span via
  `TraceLayer::new_for_http().make_span_with(|req| ...)`. Echo it
  back in a response header for support tickets. Combined with
  MED-2's JSON logs, this becomes the foundation for real
  observability.
- **Effort**: Small (~1 hour, one of the more standard Axum recipes).

### MEDIUM — MED-4: Migration-rewrite procedure not documented

- **Where**: `backend-rust/src/db/migrations.rs:174-252` implements
  `bridge_modified_migration_checksums` with a hardcoded
  `REBRIDGED_MIGRATIONS` allow-list. The mechanism is explained in
  code comments and CHANGELOG (#223), but there is no checklist /
  procedure in `CLAUDE.md` or `docs/` for the *next* operator who
  needs to do this.
- **What**: When a future developer needs to rewrite an applied
  migration (canonical reconciliation, fixing a typo, idempotence
  refactor), they have to (a) know this mechanism exists, (b) know
  to add the version to `REBRIDGED_MIGRATIONS`, (c) verify the
  rewrite is genuinely schema-equivalent. None of these are
  documented anywhere a human reading the repo would naturally
  find. The risk is someone rewrites a migration *without*
  rebridging, the deploy fails on staging, and they push a "fix"
  that ships a real schema change as a "rebridge".
- **Impact**: Production data corruption when the schema-equivalent
  assumption is violated.
- **Fix**: Add a `docs/migration-rewrite-runbook.md` (or expand
  `backend-rust/migrations/README.md`) with: when rewriting is
  legitimate (canonical reconciliation, no behavior change),
  required pre-flight diff (schema dump before/after on a copy of
  prod), how to add the version to `REBRIDGED_MIGRATIONS`, how
  staging will react, how to verify on staging before merging. Link
  from `CLAUDE.md` § Database.
- **Effort**: Small (~1 hour).

### MEDIUM — MED-5: No body-level secret rotation guidance for JWT family

- **Where**: `docs/secrets-runbook.md:119-148` covers rotation
  cadence but doesn't explain *what happens to active sessions* on
  JWT rotation. With Phase 3 (cookie-only refresh, per
  `feat(auth)`#212 in CHANGELOG), the impact of rotating
  `JWT_REFRESH_SECRET` is: every active session is invalidated and
  every user has to log in again. Rotating `JWT_SECRET` invalidates
  every access token immediately (typical TTL is short, so impact
  is small).
- **What**: The runbook prescribes 90-day rotation but doesn't
  prepare the operator for the UX impact, doesn't propose a phased
  rotation (e.g., dual-validate old+new for a grace window), and
  doesn't note that rotating `SESSION_SECRET` may have similar
  effect depending on what it's used for (the runbook is silent on
  that — `grep`ing the code suggests it's the OAuth state cookie
  encryption, but unconfirmed in this audit).
- **Impact**: An operator following the runbook on a normal Tuesday
  rotates `JWT_REFRESH_SECRET`, every user gets logged out at once,
  and support is buried in "I can't log in" tickets they can't
  distinguish from a real bug.
- **Fix**: Add an "Impact on active sessions" subsection per secret
  in the runbook, plus a recommendation for low-traffic-hour
  rotation. If a dual-key validator is feasible without a code
  change, document the procedure; if not, note that future work.
- **Effort**: Small (~1 hour audit + doc).

### MEDIUM — MED-6: Production approval has no documented pre-approval checklist

- **Where**: `.github/workflows/deploy.yml:78-87` defines the
  production environment but the GitHub Environment "production" is
  configured outside the repo. No `docs/` file lists what the
  approver should check before clicking approve.
- **What**: An approver looking at the GitHub Environment screen
  sees a SHA and a "review deployments" button. There's nothing
  prompting them to verify staging health, verify the relevant PR
  passed E2E (which can be red after staging deploy under the
  new model — see CHANGELOG 2026-05-13), or check the changelog
  for the deploy.
- **Impact**: Approvals become rubber-stamps and the manual gate
  loses its safety function — which is exactly what the gate exists
  to prevent.
- **Fix**: Add `docs/production-approval-checklist.md` covering:
  (1) staging `/api/health` returns 200 (the auto-poll only runs
  once); (2) commit SHA on the deploy matches the latest green
  staging deploy; (3) E2E for the SHA on `main` is green
  (`gh run list --workflow=ci-build-e2e.yml --branch=main
  --commit=<sha>` — currently E2E can be red on main without
  blocking deploy.yml); (4) check `CHANGELOG.md` and the PR list
  for surprises; (5) abort criteria. Link from the
  GitHub Environment description.
- **Effort**: Small (~1 hour for the doc + a screenshot of where to
  paste the link).

### LOW — LOW-1: `nginx.conf` `server_name localhost;` couples reverse proxy to Cloudflare-only access

- **Where**: `nginx/nginx.conf:34` — `server_name localhost;` with a
  block comment explaining the Cloudflare-tunnel rationale.
- **What**: The choice is intentional and documented (lines 21-30),
  but it means any direct HTTP probe on evergreen's port 4001 or
  5001 from the host or via SSH tunnel works correctly only by
  accident — no `Host` header check, no separation of staging vs
  prod by virtual host. If you ever want to add a second public
  hostname (e.g., admin-only), you'd have to revisit. Operationally
  low-risk today.
- **Impact**: Future-you complexity.
- **Fix**: Leave as-is until a real second hostname is needed; doc
  is already in the file. Optional: add a header check that requires
  the request originated from Cloudflare's IPs in production.
- **Effort**: None now.

### LOW — LOW-2: Rate limiter is a placeholder ("can be extended with Redis-backed distributed rate limiting")

- **Where**: `backend-rust/src/middleware/rate_limit.rs:1-80` —
  explicit comment line 4: "This is a placeholder implementation"
  and line 75: "Note: This is suitable for single-instance
  deployments." The current production posture *is* single-instance,
  so it works — but the `RateLimiter::strict()` / `relaxed()`
  presets exist without an audit of whether they're actually
  applied to the right routes.
- **What**: Hard to evaluate the runtime effectiveness from a
  read-only pass. With public users, login brute-force protection
  is the main concern — verify it's wired to `/api/auth/login` (and
  not just `/api/auth/register`) before launch.
- **Impact**: Brute-force login attempts if not applied to the right
  route.
- **Fix**: Verify the route bindings; add a test that hammers
  `/api/auth/login` and confirms it 429s after `strict()` count.
- **Effort**: Small.

### LOW — LOW-3: Public-launch readiness checklist is implicit, not written

- **Where**: Nowhere. There is no `docs/public-launch-readiness.md`.
- **What**: A pre-launch dry-run typically includes capacity test,
  abuse monitoring, GDPR data flow if EU users (the
  `total_nights` + email + LINE / Google OAuth surface is PII),
  status page, support-email rotation, on-call rotation. None of
  these are tracked in the repo.
- **Impact**: Launch day is a scramble.
- **Fix**: Use the "Pre-launch checklist" section below as the seed
  of `docs/public-launch-readiness.md`. Walk it once before flipping
  the public switch.
- **Effort**: Small (~half-day for the walk-through itself).

## Not-findings (verified clean)

- **Migration idempotence is real.** Every migration in
  `backend-rust/migrations/` after the init uses
  `ADD COLUMN IF NOT EXISTS`, `DO`-block constraint guards, and
  `CREATE INDEX IF NOT EXISTS`. A partial application doesn't wedge
  the next deploy. The `bridge_modified_migration_checksums` allow-list
  mechanism is well-designed (see MED-4 for the missing doc).
- **Health endpoint correctness on the wire.** `GET /api/health`
  (the path `Verify Staging` polls) maps to `health_check_full` which
  hits both Postgres and Redis (`backend-rust/src/routes/health.rs:128-194`)
  and returns 503 if either is down. Not theater — it actually
  exercises the dependencies. (The remaining ambiguity is the
  internal docker healthcheck binary — see MED-1.)
- **Database body limit + nginx body limit are aligned.**
  `main.rs:21` sets a 16 MiB axum body limit with a comment matching
  nginx's `client_max_body_size 15M`. Multipart uploads of slip
  images won't surprise-fail.
- **Secret hygiene is solid.** `docs/secrets-runbook.md` is real,
  GitHub Actions Secrets are the source of truth, compose files use
  `${VAR:?required}` failure-on-missing pattern, no secrets baked
  into images, well-known dev credentials refuse-to-boot in production
  via `enforce_safe_database_url` (`main.rs:289-340` with a thorough
  test suite).
- **Production approval gate exists.** `deploy.yml` correctly
  declares `environment: name: production` which triggers GitHub's
  required-approval flow. The gate is real even though it lacks a
  checklist (MED-6).
- **CI failure visibility within the pipeline is good.** Migration
  errors are logged with `{:#}` for the anyhow cause chain
  (`main.rs:97`), backend logs are captured on E2E failure
  (`ci-build-e2e.yml:602-606`), test database schema is validated
  before tests run (`ci-build-e2e.yml:234-256`). The signal is
  there — it just doesn't reach a human (CRIT-2).

## Pre-launch checklist

In priority order — items closer to the top will hurt more if
skipped.

- [ ] **Automated Postgres backup running daily, restore drill
      documented and performed once** (CRIT-1)
- [ ] **Alert channel wired** for `Verify Staging` failure,
      `Cargo Audit` red, and any `main` CI failure (CRIT-2)
- [ ] **Graceful shutdown** implemented in
      `backend-rust/src/main.rs` (CRIT-3)
- [ ] **Container resource limits** set on backend / postgres /
      redis in `docker-compose.prod.yml` (HIGH-2)
- [ ] **Rollback runbook written** + dry-run performed (HIGH-3)
- [ ] **`Verify Staging` on-failure log capture + alert** (HIGH-1)
- [ ] **`booking_audit_log` retention policy decided** (HIGH-5)
- [ ] **Cloudflare tunnel runbook written** (HIGH-6)
- [ ] **Internal healthcheck binary confirmed to hit `/api/health`
      not `/api/health/basic`** (MED-1)
- [ ] **Request ID middleware + JSON logs** (MED-2, MED-3)
- [ ] **Migration-rewrite runbook** (MED-4)
- [ ] **JWT rotation impact documented + dry-run** (MED-5)
- [ ] **Production-approval checklist** linked from the GitHub
      Environment (MED-6)
- [ ] **Login rate-limit verified** (LOW-2)
- [ ] **Status page + support email + on-call rotation** decided
      and posted somewhere customers can find them (LOW-3)
- [ ] **Capacity test against staging** — at minimum, a few
      hundred RPS of a representative read+write mix; confirm the
      10-connection default pool isn't the bottleneck
- [ ] **GDPR / PDPA review** of the user data flow if any
      jurisdiction applies; document data-export and account-deletion
      procedures even if only manually supported at launch

## Suggested follow-up

Group findings into bundles a small team can ship in order:

- **Bundle A (critical + high) — *do before public launch*:**
  Automated backups + restore drill (CRIT-1); CI / verify-staging
  alert wiring (CRIT-2); graceful shutdown (CRIT-3); resource limits
  (HIGH-2); rollback runbook (HIGH-3); verify-staging log capture
  (HIGH-1); `booking_audit_log` retention (HIGH-5); Cloudflare
  tunnel runbook (HIGH-6).
- **Bundle B (medium) — *first week after launch*:** Confirm
  healthcheck binary hits the full endpoint (MED-1); JSON logs
  (MED-2); request ID middleware (MED-3); migration-rewrite
  runbook (MED-4); JWT rotation impact section (MED-5);
  production-approval checklist (MED-6).
- **Bundle C (low / observability investment) — *first month
  after launch, or sooner if traffic warrants*:** Runtime
  Prometheus / Grafana or equivalent (HIGH-4 — labeled HIGH
  because the gap is real, but the investment is large enough to
  warrant a deliberate after-launch project); rate-limit audit
  (LOW-2); public-launch readiness doc consolidation (LOW-3);
  nginx `server_name` review (LOW-1).
