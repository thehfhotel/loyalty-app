# CLAUDE.md — Project Conventions

Rules for contributors (human and AI). Operational details (ports, deploy
paths, container names) live in `docker-compose.*.yml` and the GitHub
Actions workflows, not here.

## Hard rules

1. **`docker compose` with a space** — never `docker-compose`.
2. **Never bypass git hooks** — no `--no-verify` on commit or push.
3. **Never auto-merge PRs** — human review is mandatory. `gh pr merge`
   only after explicit approval; no `--auto`.
4. **Never bypass, skip, or fake tests** — no `test.skip`, no
   `expect(true).toBe(true)`, no `if (env.SKIP) return`. If a test is
   genuinely broken, fix or delete it; don't fake green.
5. **Never touch the database directly** — go through the backend API.
   If the endpoint doesn't exist yet, create it first.

## Architecture

```
loyalty-app/
├── backend-rust/    # Rust 1.93 / Axum API (production backend)
├── frontend/        # React / TypeScript SPA
├── scripts/         # Ops and metrics helpers
├── tests/           # Playwright E2E
└── docker-compose.* # Environment-specific overrides
```

**Trunk-based.** `main` is the only long-lived branch. Feature branches
→ PR → squash-merge to `main` → CI builds GHCR images → staging deploys
automatically → production deploys after manual approval.

**Tier system (nights-based):** Bronze 0+ · Silver 1+ · Gold 10+ ·
Platinum 20+ nights. Tiers are computed from `total_nights`, not
`current_points`.

## Database

- Migrations live in `backend-rust/migrations/` and are applied
  automatically at backend startup via `sqlx::migrate!()`. Backed by
  the embedded migrator (no Prisma).
- Compile-time `sqlx::query!()` / `sqlx::query_as!()` macros, validated
  in CI against the offline cache in `backend-rust/.sqlx/`. Regenerate
  with `backend-rust/scripts/regen-sqlx-cache.sh` (boots a throwaway
  Postgres, applies all migrations, runs `cargo sqlx prepare --workspace
  -- --tests`, tears the container down). Commit the resulting
  `.sqlx/*.json` files.
- Migrations are idempotent by convention (`ADD COLUMN IF NOT EXISTS`,
  `DO`-block constraint guards, `CREATE INDEX IF NOT EXISTS`) so a
  partial application during a failed deploy doesn't wedge the next
  attempt.
- Migration *rewrites* (e.g., canonical reconciliations) need an entry
  in `REBRIDGED_MIGRATIONS` (`backend-rust/src/db/migrations.rs`)
  because sqlx tracks a source checksum and refuses to proceed when
  the file changes. Full procedure (when it's safe, schema-diff
  pre-flight, two-piece review, staging verification) lives in
  [`docs/migration-rewrite-runbook.md`](docs/migration-rewrite-runbook.md).
- Use stored procedures (e.g., `award_points`,
  `recalculate_user_tier_by_nights`) instead of raw `UPDATE`s for
  tier-affecting operations.

## Backend (Rust)

Toolchain pinned in `backend-rust/rust-toolchain.toml`. `cd backend-rust`
picks it up via rustup.

```bash
cd backend-rust
cargo build              # debug
cargo build --release    # release
cargo test               # all tests
cargo test <name>        # single test by name filter
cargo test --test lib integration::coupon_test  # one integration module (harness: tests/lib.rs)
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --all -- --check
cargo sqlx prepare --check
```

Patterns:
- `AppState::new(pool, redis, config)` constructs application state;
  use the `.db()` / `.redis()` / `.config()` accessors, not direct
  field access.
- Routes follow `routes().with_state(state)` and mount under `/api/...`
  in `src/routes/mod.rs`.
- Auth via JWT in HttpOnly refresh cookie (Phase 3 — JSON-body refresh
  has been removed).

## Frontend

TypeScript error pattern at boundaries:

```ts
catch (error) {
  if (error instanceof Error) console.log(error.message);
  else console.log('Unknown error:', String(error));
}
```

```bash
cd frontend
npm run lint && npm run typecheck && npm run test
npx vitest run src/path/to/File.test.tsx   # single test file
```

## Root scripts & E2E

The root `package.json` orchestrates both halves:

```bash
npm run quality:check    # lint + typecheck + test-integrity + backend tests (what pre-push runs)
npm run dev              # backend (cargo run) + frontend (vite) concurrently
npm run test:e2e         # Playwright with the local E2E_* port env vars pre-set
```

Playwright is configured at the root (`playwright.config.ts`, tests in
`tests/`) with two projects: `api` (`*.api.spec.ts`, request-context only,
sequential) and `browser` (`*.browser.spec.ts`, Desktop Chrome). Run one
file locally:

```bash
npx playwright test tests/health.api.spec.ts --project=api
```

`BACKEND_URL` / `FRONTEND_URL` env vars override the target. The suite
assumes CI manages the Docker containers — locally, point it at an
already-running stack.

## API routes

Before wiring a new frontend call:
1. Find the handler in `backend-rust/src/routes/`.
2. Check its mount path in `backend-rust/src/routes/mod.rs`.
3. Construct `/api/{mount}/{route}`.
4. Hit it with `curl` first to confirm shape.
5. Regenerate the typed client instead of hand-writing fetch calls:
   `cd frontend && npm run generate:api` pulls `/api/openapi.json`
   (defined in `backend-rust/src/openapi.rs`) into
   `frontend/src/api/generated/`.

## CI/CD

Workflows fire on push to `main`:
- `ci-test.yml` — Lint Frontend (typecheck + ESLint at a
  `--max-warnings` ratchet + the test-integrity guard) and Frontend Unit
  Tests, running in parallel. There is deliberately no "Prepare
  Workspace" job: both jobs derive the same cache key inline and fall
  back to `npm ci` on a miss, so the serial hop it added to the deploy
  critical path bought nothing.
- `ci-image.yml` (**CI Runner Image**) — builds
  `ghcr.io/thehfhotel/loyalty-app/ci-rust`, the container the Rust jobs
  run inside (`.github/ci-image/Dockerfile`: rust:1.93-bookworm + the
  apt deps + sccache + cargo-nextest + sqlx-cli). Runs on changes to
  that Dockerfile and weekly. **The tag is the Dockerfile's content
  hash**, so editing it selects a new tag automatically — nothing to
  bump by hand. It MUST stay a bookworm base: the release binary is
  COPYed into distroless cc-debian12 (glibc 2.36) and a newer glibc
  produces a binary that cannot load (issue #360).
- `ci-build-e2e.yml` (named **CI Build & Deploy**) — `Ensure CI Runner
  Image` resolves that tag (and builds it if GHCR lacks it, so a first
  run or a retention sweep self-heals) → the Rust container jobs. Lint
  Backend, Test Backend Unit, Build & Push Frontend and Wait for
  Frontend Checks start at T+0 with no dependency at all; Test Backend
  Integration, Verify SQLx Query Cache and Build Backend Release start
  behind the image job; Build Backend Release → Build & Push Backend to
  GHCR; both image jobs + both test jobs → **Regression & Smoke (API)**
  → Deploy to Staging (inline, on push to `main` only) → Verify Staging
  health check.

  **`cargo sqlx prepare --check` is its own job (`sqlx-check`), not a
  step inside the integration job**, so its compile runs in parallel
  instead of adding ~18s to the critical path. It needs a migrated
  Postgres, hence its own service. It shares the integration job's
  rust-cache entry via `shared-key` and never saves, so it costs no
  extra cache quota. It is a `needs:` of `deploy-staging` and
  `promote-latest` — a stale `.sqlx/` cache still blocks the deploy.

  **Lint Backend gates the deploy directly, not through the test jobs.**
  `deploy-staging` and `promote-latest` list `lint-backend` in their
  `needs:` explicitly, so a red clippy/rustfmt still blocks staging,
  still blocks the `latest` retag and still blocks production — but the
  test jobs no longer idle behind it, which took ~1 min off the critical
  path. Don't "tidy" that edge back into the test jobs.

  The deploy gate is the **API regression/smoke suite**
  (`regression-api`, the Playwright `api` project — `*.api.spec.ts`),
  which uses Playwright's request context with **no browser**, so it has
  no `cdn.playwright.dev` dependency and is reliable enough to block
  deploys. Build & Push also runs `/app/healthcheck` inside the image it
  just pushed and requires the binary's own connection-refused message
  and exit 1 — the compose `HEALTHCHECK` had no gate before, so a
  binary that could not even load was invisible.
- `e2e.yml` (**Browser E2E**) — the full browser suite (Playwright
  `browser` project — `*.browser.spec.ts`), run inside the
  `mcr.microsoft.com/playwright` container so browsers are pre-baked (no
  CDN download). It triggers via `workflow_run` after CI Build & Deploy
  (and nightly / on demand) and **does NOT gate deployment** — a flaky
  browser/CDN issue must never block shipping. Treat a red Browser E2E
  as a signal to investigate, not a deploy blocker.
- `trivy.yml` — filesystem dependency scan (blocking on PRs, so a
  fixable CRITICAL/HIGH shows red before merge); backend/frontend image
  scans triggered by `workflow_run` from `ci-build-e2e.yml` (`CI Build &
  Deploy`; pulls images from GHCR instead of rebuilding) and are
  informational, since the image has already shipped by then.
- `scorecard.yml` / `semgrep.yml` / `codeql.yml` / `cargo-audit.yml` —
  non-gating security scanners. `cargo-audit` also runs on
  `backend-rust/Cargo.{lock,toml}` changes so a vulnerable crate cannot
  merge and auto-deploy inside the daily cron window.
- `email-canary.yml` (**Email Canary**) — **non-gating.** Every 6h it
  sends a real message through the production relay (`environment:
  production`, so the env-scoped `SMTP_*` secrets resolve) to prove
  outbound mail is *deliverable*, which `/api/health` can never do — it
  only sees configuration. Alerts are GitHub issues, never email: the
  only mailbox available would be the one that is down. It touches no
  health endpoint and no deploy workflow depends on it. Runbook:
  [`docs/email-canary-runbook.md`](docs/email-canary-runbook.md).
Postgres backups deliberately do **not** run in CI. A systemd timer on
evergreen (`scripts/evergreen/`) dumps, gzips and `age`-encrypts to
`/srv/backups/loyalty`, so production data never transits a runner. The
previous GitHub Actions + S3 workflow was removed: it needed cloud storage
and, because its secrets were environment-scoped while the job declared no
`environment:`, it reported success nightly while backing up nothing. Backup
alerts are **GitHub issues** (`scripts/evergreen/loyalty-backup-notify-github.sh`),
not email: the only mailbox available is the one the alert would be reporting
on, so it would suppress its own alarm — and the issue is commented on per
failure and **closed automatically on recovery**, which is also what clears
`LAST-FAILURE`. Setup, token rotation and the alert drill:
[`docs/restore-runbook.md`](docs/restore-runbook.md).

**Release PRs are authored by a GitHub App, so CI runs on them like any
other PR.** `release-please.yml` mints an installation token for the
**`hf-release-bot`** App (`vars.RELEASE_BOT_APP_ID` +
`secrets.RELEASE_BOT_PRIVATE_KEY`, via `actions/create-github-app-token`)
and passes it to the release-please action instead of `GITHUB_TOKEN`. The
release PR is therefore authored by `hf-release-bot[bot]`, its
`pull_request` runs are created *and start on their own*, and its head
commit carries real checks before anyone merges it.

Why that was needed: GitHub treats `GITHUB_TOKEN`-driven events specially
in two different ways, neither with an opt-out setting —

- **`push`** — no workflow run is created *at all* (the long-standing
  anti-recursion rule). Adding `release-please--**` to a workflow's `push:
  branches:` list therefore does nothing; that was tried in #377 and reverted
  in #379 once release PR #378 confirmed zero `push` runs on the release
  branch.
- **`pull_request`** — since 2026-06-11 a run *is* created, but parked in an
  approval-required state (`action_required`). It never starts unless a
  maintainer approves it in the Actions UI.

So a release PR's head commit used to carry **no completed checks** unless
someone manually approved its parked runs — and merging that PR is exactly
what fires the unattended production deploy, making the one PR class that
ships to production the one class nothing verified. That shortfall is what
OpenSSF Scorecard alerts **#92** (SAST) and **#925** (CI-Tests) measure.
Both score a rolling 30-PR window, so **they do not close on merge**: they
recover as App-authored release PRs with real checks age into that window.

**No silent fallback.** The job asserts `vars.RELEASE_BOT_APP_ID` and
`secrets.RELEASE_BOT_PRIVATE_KEY` are non-empty before minting, and that a
non-empty token came back. If the App is uninstalled, the key rotated, or
the secret deleted, the run **fails loudly** with a message naming both
settings and no release PR appears — it never falls back to `GITHUB_TOKEN`,
because a green run that re-parks the checks is the exact failure this
removes. Recovery: re-add the credential per
[`docs/secrets-runbook.md`](docs/secrets-runbook.md) → *Release-bot App*.
The App is installed on this repository only, with exactly
`contents=write`, `pull_requests=write`, `metadata=read` — notably **no
`actions`**, so the release bot can cause workflow runs but never approve,
cancel or re-run one.

Production deploys live in `deploy.yml` and are **unattended** — the
`production` environment no longer has a required reviewer, so a green
build ships to production with no human in the loop. What stands in for
that reviewer:

- **One trigger.** `workflow_run` on **CI Build & Deploy only** (which
  already fails closed on CI Tests via `wait-for-frontend-checks`).
  Listing both workflows fired this 2–3× per commit, and whichever fired
  first skipped the deploy while still reporting green.
- **Fails, never skips.** An unmet prerequisite exits non-zero. A run
  that deploys nothing must never look like a successful deploy.
- **Staleness guard.** Refuses to deploy a commit that is no longer the
  tip of `main`, so a slow build can't roll production backwards onto
  older code with newer migrations already applied.
- **Push-only.** A `workflow_dispatch`/re-run of CI Build & Deploy won't
  reach production, because it skips the staging deploy.
- **Post-deploy health check.** Polls production `/api/health` for 90s;
  a crash-looping release fails the job instead of reporting green.
- **Revision assertion.** Images bake their commit SHA in at build time
  (`ARG GIT_SHA`) and `/api/health` reports it as `revision`, so both
  `Verify Staging` and the production verify step prove the deploy
  actually shipped *this* commit rather than merely that something
  answers 200. Phased: a matching SHA passes, an absent/`unknown` one
  warns (pre-bake images and rollbacks), a *different* SHA fails.
  Check it by hand with
  `curl -sS <url>/api/health | jq -r .revision` (no `-f` — a 503 still
  carries the body you need).
- Failure *or cancellation* files a `Production deploy failed` issue.

Verify a deploy with
[`docs/production-approval-checklist.md`](docs/production-approval-checklist.md)
(now a post-deploy checklist) and roll back per
[`docs/rollback-runbook.md`](docs/rollback-runbook.md). To restore a
manual gate, re-add a required reviewer in Settings → Environments →
`production`. Full audit of every workflow:
[`docs/workflow-review-2026-07.md`](docs/workflow-review-2026-07.md).

Public-launch readiness — the state of every audit follow-up tied to
flipping the public switch — is tracked in
[`docs/public-launch-readiness.md`](docs/public-launch-readiness.md).

Conventional commit prefixes: `feat:`, `fix:`, `improve:`, `refactor:`,
`test:`, `docs:`, `chore:`.

## Security

- Never log sensitive data (passwords, tokens, API keys).
- Validate input on every boundary; sanitize user-controlled content
  (XSS); parameterized queries / sqlx macros (SQL injection); sanitize
  user-controlled values before embedding in log output (log injection).
- Production secrets in GitHub Actions secrets. Templates live in
  `.env.example` / `.env.production.example`. Real `.env*` files are
  never committed.

## Quick reference

```bash
# Local dev
docker compose up -d

# Git workflow
git checkout -b feat/my-feature
git commit -m "feat: description"   # hooks run automatically
git push -u origin feat/my-feature
gh pr create --base main
# ...human reviews...
gh pr merge <PR> --squash --delete-branch   # only after explicit approval
```

## Agent skills

### Issue tracker

Issues live in GitHub Issues (thehfhotel/loyalty-app) via the `gh` CLI; external PRs are NOT a triage/request surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), created on first use. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` (lazy-created by /grill-with-docs) + `docs/adr/`. See `docs/agents/domain.md`.

## Estate task board

Cross-repo tasks live in ~/HF/hf-tasks (thehfhotel/hf-tasks). Read `tasks/INDEX.md` before cross-repo work; update task status as you work.
