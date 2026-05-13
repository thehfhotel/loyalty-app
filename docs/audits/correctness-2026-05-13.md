# Correctness audit — 2026-05-13

## Summary
- 14 findings: 3 critical, 4 high, 5 medium, 2 low.
- Overall posture: the schema and write paths have two recurring shapes
  that produce correctness bugs under concurrency: read-then-insert on
  identity-like columns without a uniqueness constraint, and TOCTOU
  "find a free row, then insert pointing at it" patterns. Both are
  exploitable today with two parallel requests, no special tooling.
  Stored-procedure usage is bypassed in `routes/loyalty.rs` in favour of
  hand-rolled tier recalculation that drifts from `services/loyalty.rs`.
  Error handling on startup masks underlying causes everywhere except
  `run_migrations` (which was recently fixed). Migration bridges are
  reasonable but never validated post-run, and the orphaned-DB cleanup
  in the test harness is not safe under sibling nextest processes.
- Top 3 to fix before public launch:
  - Add `UNIQUE` on `users.email` + use `INSERT … ON CONFLICT` on both
    the password registration handler and the OAuth provisioning path.
  - Add overlap-prevention (transaction + `SELECT … FOR UPDATE` on the
    room, or a btree_gist EXCLUDE constraint) to `insert_booking` so two
    concurrent bookings can't claim the same room for overlapping dates.
  - Stop calling `let _ = result;`, `.unwrap_or(0)` on DB query results
    in `routes/admin.rs::get_stats`, and stop logging startup errors with
    `{}` (use `{:#}` to surface the cause chain — same fix recently
    applied to `run_migrations`).

## Findings

### CRITICAL — `users.email` lacks UNIQUE constraint
- Where: `backend-rust/migrations/20240101000000_init.sql:632` (`CREATE INDEX "idx_users_email"`, not `UNIQUE`) + `backend-rust/src/routes/auth.rs:413-447` (read-then-insert) and `backend-rust/src/services/oauth.rs:667-759` (same pattern in the OAuth path).
- What: The init migration only creates a plain index on `users.email`. Both the password registration handler and the OAuth "find user by email, otherwise insert" branch in `services/oauth.rs::process_*_auth` do `SELECT id FROM users WHERE email = $1` outside a transaction, then `INSERT INTO users (email, …)` if no row was found. Two concurrent registrations (or one password registration + one OAuth callback) can both pass the existence check and both insert.
- Impact: Duplicate rows for the same email. Login (`SELECT … FROM users WHERE email = $1` at `auth.rs:580` and `auth.rs:864`) silently returns whichever row Postgres picks first, so the user may authenticate against the password from one row while their loyalty history sits under the other id. Audit-log rows scatter across both ids.
- Fix: New migration `ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email)` (after de-duping any existing duplicates). Then change both insert sites to `INSERT … ON CONFLICT (email) DO NOTHING RETURNING id` and treat zero returned rows as "race lost — re-fetch the existing user" or `409`. Drop the now-redundant `idx_users_email`.
- Effort: medium

### CRITICAL — `insert_booking` TOCTOU lets two requests claim the same room
- Where: `backend-rust/src/routes/bookings.rs:876-962` (`insert_booking`).
- What: The handler runs a `SELECT … FROM rooms r WHERE r.id NOT IN (SELECT room_id FROM bookings WHERE check_in_date < $3 AND check_out_date > $2)` (line 904-931) and then `INSERT INTO bookings` (line 942-961) — both on the pool, no transaction, no `FOR UPDATE`, no `EXCLUDE` constraint on `(room_id, daterange(check_in, check_out))`. Two concurrent bookings for overlapping dates both observe the room as free and both insert.
- Impact: Two confirmed bookings for the same room and overlapping dates. The downstream availability check (`check_availability`) and admin reconciliation will both show the conflict only after the fact.
- Fix: Wrap the read+insert in one `sqlx::Transaction`, take `SELECT … FOR UPDATE` on the candidate `rooms` row (or, better, add `CREATE EXTENSION btree_gist; ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (room_id WITH =, daterange(check_in_date, check_out_date, '[)') WITH &&) WHERE (status <> 'cancelled')`). The EXCLUDE constraint is the canonical fix and is enforced atomically by Postgres.
- Effort: medium (EXCLUDE constraint route) / small (transaction + FOR UPDATE route, weaker guarantee).

### CRITICAL — `POST /api/loyalty/award` has no idempotency and double-awards on retry
- Where: `backend-rust/src/routes/loyalty.rs:689-799` (`award_points` admin endpoint, also `award_points_full` at 1151+ and `admin_award_points` at 1556+).
- What: Each call unconditionally inserts a row into `points_transactions` and adds `payload.points` / `payload.nights` to `user_loyalty`. There is no `idempotency_key`, no `If-Match` on a version column, no upsert against a client-supplied request id. A flaky network that retries the request will credit the user twice.
- Impact: Real money. Tier promotion happens at 1/10/20 nights, so even a one-night double-credit can push a customer up a tier prematurely. Reversing a duplicate award is a manual operation with no UI today.
- Fix: Add an `idempotency_key UUID` (or unique constraint on `(admin_user_id, client_request_id)`) on `points_transactions`. Make the route read a header (`Idempotency-Key`), insert the points-transaction row with `ON CONFLICT DO NOTHING RETURNING id`, and on conflict re-fetch and return the previous result. Then delete the inline tier-recalc logic in favour of calling the existing `award_points` stored procedure (see HIGH below).
- Effort: medium

### HIGH — `routes/loyalty.rs` hand-rolls tier recalculation, bypassing `award_points` SP
- Where: `backend-rust/src/routes/loyalty.rs:755-799` (UPDATE user_loyalty + inline tier lookup) and 1213-1326, 1602-1689, 1994-2294 — at least six call sites; `services/loyalty.rs:333-484` already wraps the `award_points` and `recalculate_user_tier_by_nights` stored procedures.
- What: CLAUDE.md rule #7 mandates stored procedures for tier-affecting ops. The route handlers instead manually UPDATE `user_loyalty`, then `SELECT … FROM tiers WHERE min_nights <= $1 ORDER BY min_nights DESC LIMIT 1` to pick a tier, then UPDATE `tier_id`. Two copies of the same algorithm in two places drift; one copy doesn't write `tier_updated_at` on the first UPDATE.
- Impact: When the tier policy changes (e.g. min_nights thresholds, tier-change side effects like coupon awards), the SP gets updated but the route handlers do not, so admin awards skip the SP-side hooks (coupon awards, audit log entries that the SP writes).
- Fix: Replace each `award_points`-shaped handler body with a call to `LoyaltyService::award_points(…)`. Delete the inline tier recalculation. CLAUDE.md rule #7 wording should be tightened so this drift can be caught by review.
- Effort: medium

### HIGH — `POST /api/bookings/:id/slips` has no idempotency or `(booking_id, slip_url)` uniqueness
- Where: `backend-rust/src/routes/bookings.rs:507-549` (`add_booking_slip`) → `insert_booking_slip` (1329-1351); migration `20260511000000_booking_slips.sql:55` (no UNIQUE on `slip_url`).
- What: The handler validates the request, looks up the booking, then unconditionally inserts. If the client retries (mobile, flaky network), the same slip URL gets attached twice. Each new row creates an independent SlipOK verification job, so duplicates also amplify external API spend.
- Impact: Duplicate slip rows on the same booking. Admin review queue surfaces the same slip twice. SlipOK quota burned for nothing.
- Fix: Either (a) add `UNIQUE (booking_id, slip_url)` to `booking_slips`, plus `INSERT … ON CONFLICT (booking_id, slip_url) DO NOTHING RETURNING …` returning the existing row when conflict, or (b) require an `Idempotency-Key` header.
- Effort: small

### HIGH — Startup error logs drop the cause chain (only `run_migrations` was fixed)
- Where: `backend-rust/src/main.rs:52, 67, 85, 104, 112, 125` — `error!("Failed to … : {}", e)`. Only line 97 (`run_migrations`) uses `{:#}`.
- What: PR #223's lesson — sqlx errors stack their cause inside an `anyhow::Context` wrapper, and `{}` only renders the top frame — applies equally to the config-load, DB-connect, seed, and Redis-connect failure paths. A "Database connection error: connection refused" log today obscures whether it's TLS, DNS, auth, or pool-acquire timeout.
- Impact: When staging/production fails to boot, the only ground truth is a generic top-level message; operators have to add `{:#}` and redeploy to learn anything.
- Fix: Mechanical — replace `: {}", e` with `: {:#}", e` on each of the six startup error sites. Same pattern in `routes/slips.rs:120,129,164,175` and `routes/storage.rs:105,115,163,173,226,235,300,319,370` for endpoint-level error logs.
- Effort: trivial

### HIGH — Test harness orphan-DB cleanup races with sibling nextest processes
- Where: `backend-rust/tests/common/mod.rs:348-366` (loop inside `ensure_template_db`, executed under the advisory lock).
- What: After (re)building the template DB, the function `SELECT datname FROM pg_database WHERE datname LIKE 'test_%'` and DROPs every match. The advisory lock that wraps this is on `TEMPLATE_DB_NAME` only — sibling nextest processes that have already passed `ensure_template_db()` and are creating/using their own `test_<uuid>` databases hold no such lock. They'll have their connections terminated by the `pg_terminate_backend` loop (line 357-362) and their database dropped out from under them.
- Impact: Flaky test failures with "database does not exist" or "connection terminated" only when (a) two nextest workers race the template build and (b) the loser triggers the rebuild path. Hard to reproduce locally, more likely in CI under load.
- Fix: Either skip the orphan cleanup entirely (let it happen at a CI-only end-of-job step), or only DROP databases older than e.g. `application_name='loyalty-test'` AND `backend_start < now() - '1 hour'`. The current "drop everything that matches `test_*`" is too aggressive once nextest is enabled.
- Effort: small

### MEDIUM — OAuth state can be replayed within the exchange window
- Where: `backend-rust/src/routes/oauth.rs:530-587` (state fetched at 530, code exchanged at 548, state deleted at 587).
- What: The OAuth state value is read out of Redis but not deleted until *after* `exchange_google_code` (and the LINE equivalent) completes. The window between fetch and delete is one network round-trip to Google + a DB write; an attacker who steals the state value (e.g. via a leaky logging proxy, Referer leak) could race a parallel callback before the delete fires. PKCE is not implemented.
- Impact: Theoretical CSRF/replay narrow window. Mitigated in practice by the 10-minute state TTL and the requirement to also possess a valid Google authorization code, but the standard pattern is "consume on first lookup".
- Fix: Use a `GETDEL` (Redis 6.2+) or pipeline `GET` + `DEL` so the state is atomically consumed at fetch time. Optionally add PKCE (`code_challenge_method=S256`) and store the verifier alongside the state value.
- Effort: small

### MEDIUM — Feature drift: `payment_type` / `payment_amount` columns are read-only
- Where: `backend-rust/migrations/20260512020000_booking_admin_fields.sql` adds the columns; `backend-rust/src/routes/admin_bookings.rs:533-535, 675-677` returns them; `UpdateBookingRequest` (line 278-287) does NOT accept them; `update_booking` UPDATE (line 869-892) does NOT write them.
- What: The migration's docstring says "explicit payment_type / payment_amount split, currently inferred at read time. Persisting it lets the modal show what the admin set last", but no PUT field was wired. The admin modal will surface whatever was set the first time (which is never, so they stay NULL) and re-save will not persist user edits.
- Impact: Admin UI exhibits "I set this and it disappeared" or "this never persists" — exactly the failure mode the audit spec flagged.
- Fix: Either (a) add `payment_type: Option<String>` and `payment_amount: Option<Decimal>` to `UpdateBookingRequest` and the UPDATE SET clause, or (b) drop the columns until the persistence story is decided. Validate `payment_type` against the existing CHECK constraint values (`'full' | 'deposit'`).
- Effort: small

### MEDIUM — `routes/admin.rs::get_stats` swallows DB query errors as zeros
- Where: `backend-rust/src/routes/admin.rs:646` (`total_points_issued`) and `:659` (`total_bookings`) — both end with `.unwrap_or(0)` on the `sqlx::query_scalar!` result.
- What: A query failure (transient connection drop, statement timeout, schema regression) is silently coerced to `0`. The dashboard then shows zero points issued / zero bookings without distinguishing "really zero" from "the query failed".
- Impact: Admin dashboard misleads operators. Some queries fail loudly (lines 619, 633, 668, 678, 686 use `?`), so the two-zeroes pattern is doubly confusing.
- Fix: Either propagate the error with `?` (consistent with the other tile queries) or wrap with `match` + tracing::warn and a sentinel value the frontend treats as "n/a". Mixing is the worst option.
- Effort: trivial

### MEDIUM — Migration validation function exists but is never called
- Where: `backend-rust/src/db/migrations.rs:345` (`validate_migrations`) — defined, returns a `ValidationResult` with mismatches/pending lists. No call site in `main.rs` or anywhere else.
- What: After PR #221/#223 added bridges that mutate `_sqlx_migrations` checksums on every boot, the only thing keeping those bridges honest is human review. `validate_migrations` is the obvious post-bridge sanity check (after `MIGRATOR.run` completes, assert every embedded migration is applied with matching checksum) and it's never called.
- Impact: A bridge with a wrong `(version, reason)` tuple or a corrupted embedded migration would proceed without complaint. Not user-facing on its own, but the bridges are exactly the surface where a bug "bricks every deploy" — same risk profile as the recently-fixed log issue.
- Fix: Call `validate_migrations(pool).await?` from `run_migrations` after `MIGRATOR.run` returns, and fail boot on any mismatch outside the `REBRIDGED_MIGRATIONS` allowlist.
- Effort: small

### MEDIUM — `ensure_loyalty_enrollment` / OAuth flow not wrapped in a transaction
- Where: `backend-rust/src/services/oauth.rs:744-799` — `generate_membership_id()` → `INSERT INTO users` → `INSERT INTO user_profiles` (line 769ish) → `let _ = INSERT INTO notification_preferences …` → `log_oauth_login` → `ensure_loyalty_enrollment` are all separate statements on `self.state.db()` (the pool), not a single transaction.
- What: If `INSERT INTO user_profiles` or `ensure_loyalty_enrollment` fails after the user row is committed, you're left with a half-provisioned user (no profile, no loyalty record). On the next OAuth callback the find-by-provider lookup succeeds, but downstream reads that JOIN `user_profiles`/`user_loyalty` 500.
- Impact: Stuck users with no profile after a transient DB error during OAuth signup. Manual cleanup required.
- Fix: Open one `Transaction`, do all five inserts inside it (same shape as `routes/auth.rs::register` already does), commit at the end. Use `?` (not `let _ =`) for the notification_preferences insert — `ON CONFLICT DO NOTHING` already makes it idempotent.
- Effort: small

### LOW — `password_reset_tokens` insert has no idempotency or rate limit at the model layer
- Where: `backend-rust/src/routes/auth.rs:876-886` — every `POST /forgot-password` call inserts a new password_reset_tokens row, indefinitely.
- What: An attacker hammering the forgot-password endpoint with a known email creates unbounded rows (and sends unbounded emails). No application-side cooldown, no `WHERE NOT EXISTS (… recent unexpired token)` guard. Rate limiting at the HTTP layer exists (`rate_limit.rs`) — verify the route is wired through it.
- Impact: Email bombing / token table bloat. Smaller blast radius than the auth races above.
- Fix: Add `AND NOT EXISTS (SELECT 1 FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW() - INTERVAL '1 minute')` guard, or insert with `ON CONFLICT (user_id) WHERE used_at IS NULL DO NOTHING` after adding a partial unique index. Also confirm the route is rate-limited.
- Effort: small

### LOW — `let _ = sqlx::query!(…)` silently drops insert errors
- Where: `backend-rust/src/services/oauth.rs:780-789` (notification_preferences insert) and `backend-rust/src/services/survey.rs:586-593` (`award_survey_completion_coupons` stored proc call).
- What: Both bury the result of an awaited sqlx query. The survey site has a comment "Ignore coupon errors - don't fail the survey submission" — fair, but the error never reaches a log either. The OAuth notification_preferences insert just isn't checked at all.
- Impact: Silent partial failures. A coupon-award SP that started failing post-deploy (because of an enum mismatch, say) would never surface.
- Fix: Replace `let _ = …` with `if let Err(e) = … { tracing::warn!(error = ?e, "failed to …; non-fatal"); }`. Keep the non-fatal semantics, lose the silence.
- Effort: trivial

## Not-findings (verified clean)

- `routes/admin_bookings.rs::update_booking` / `apply_discount` / `cancel_booking` all use a single `sqlx::Transaction` with `FOR UPDATE` on the booking row and an `insert_audit_row` call inside the same transaction (lines 793-919, 947-1012, 1033-1088). Audit-log row ordering under contention is correct.
- The `register` handler at `routes/auth.rs:430-523` does wrap the `INSERT INTO users`, `INSERT INTO user_profiles`, `INSERT INTO refresh_tokens`, `INSERT INTO user_loyalty`, and `INSERT INTO user_audit_log` in a single transaction. The race is only on the existence check at line 413 (outside the tx), which is exactly what the missing UNIQUE constraint would fix.
- All four migration files use `IF NOT EXISTS` or `pg_constraint` lookups, so they are idempotent under partial application (per the docstring on `20260512020000_booking_admin_fields.sql`). The Prisma + checksum bridges in `migrations.rs:93-252` are guarded by `IF EXISTS` checks and only mutate on detected divergence.
- OAuth `state` is generated with `rand::thread_rng().gen::<[u8; 32]>()` (256 bits, `routes/oauth.rs:252-256`) and stored in Redis keyed by `oauth_state:{provider}:{state}` for 10 minutes (`OAUTH_STATE_EXPIRY_SECS`). State is checked against the provider parameter on callback. Cryptographic generation: fine. Storage scope: fine. (The replay window finding above is about the delete timing, not the generation.)
- Most non-test `.expect(…)` calls in the crate are on `reqwest::Client::builder().build()` (which only fails on TLS unavailability) or on compile-time-known regex patterns. No 500-panic surface from production paths.
- The advisory lock around template-DB creation (`tests/common/mod.rs:239-242`) correctly serialises sibling nextest workers on the rebuild path. The orphan-cleanup loop inside the lock is the only test-infra finding.

## Suggested follow-up

- Bundle A (critical + high — block public launch):
  - Migration: `ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email)` + de-dupe + ON CONFLICT in `register` and OAuth provisioning.
  - Migration + handler: `EXCLUDE USING gist` on `bookings(room_id, daterange)` (or transaction + FOR UPDATE) in `insert_booking`.
  - Idempotency keys on `POST /api/loyalty/award` and `POST /api/bookings/:id/slips` (`Idempotency-Key` header + unique constraints on the underlying tables).
  - Route → `LoyaltyService::award_points` instead of hand-rolled UPDATEs (closes the SP-bypass drift).
  - Replace `{}` with `{:#}` in startup error logs.
  - Constrain the orphan-DB cleanup in `tests/common/mod.rs` to non-overlapping siblings (or move it to CI teardown).
- Bundle B (medium):
  - OAuth state `GETDEL` instead of GET-then-DEL.
  - Wire `payment_type`/`payment_amount` into `UpdateBookingRequest` (or drop the columns).
  - Fail `get_stats` loudly instead of `.unwrap_or(0)`.
  - Call `validate_migrations` post-`MIGRATOR.run` and fail boot on unexpected mismatches.
  - Wrap OAuth user provisioning in a single Transaction.
- Bundle C (low / doc):
  - Password reset endpoint cooldown.
  - Replace `let _ = sqlx::query!(…)` with logged warn-on-error.
  - Tighten CLAUDE.md rule #7 wording so reviewers catch hand-rolled tier writes.
