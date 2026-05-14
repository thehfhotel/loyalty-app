# Production-Approval Pre-Flight Checklist

What an approver should verify before clicking **Approve** on the
`production` GitHub environment.

> The manual gate on `deploy.yml` (`environment: name: production`) is
> the last safety check between green CI on `main` and live user
> traffic. Treating it as a rubber stamp defeats the purpose. This
> checklist is the minimum due-diligence pass; expand it for risky
> commits (migrations, infra changes, secret touches).
>
> Paste a link to this file in the **GitHub Environment description**
> for `production` so it appears beside the Approve button.

## TL;DR — five checks, ~2 minutes

1. Staging `/api/health` returns **200**.
2. The deploy's commit SHA **matches the latest green** staging deploy.
3. E2E for that SHA on `main` is **green**.
4. Skim `CHANGELOG.md` and the squash-merge PRs for **surprises**
   (migrations, infra changes, secret-touch).
5. Confirm you can reach the **rollback runbook** before you click.

If all five pass: approve. If any fail: abort (instructions at the
bottom) and post in the on-call channel.

---

## 1. Staging is healthy *right now*

```bash
curl -fsS https://loyalty-dev.saichon.com/api/health | jq .
```

- **Required**: HTTP `200` and `status: "healthy"`.
- All `services.*` should be `"healthy"` or `"configured"`. A
  `"degraded"` status with `database: "unhealthy"` or
  `redis: "unhealthy"` means staging itself is broken; production
  approval should be on hold until staging is fixed.

**Why this matters**: the auto-poll in `.github/workflows/ci-build-e2e.yml`
(`verify-staging` job) only runs **once at deploy time**. By the time a
human is approving production, that poll may be hours old. A staging
container that died after the poll passed won't show up unless someone
asks now.

## 2. Commit SHA matches the latest green staging deploy

The production deploy ships **the same SHA** that ran on staging — verify
nothing accidentally points at a stale or unrelated build.

```bash
# What SHA is the GitHub Environment about to deploy?
# (Visible in the GitHub UI on the "Review pending deployments" screen,
# under the workflow_run details — copy the head SHA.)

PROPOSED_SHA=<paste-from-github-ui>

# What SHA is the latest *successful* ci-build-e2e.yml on main?
gh run list -R thehfhotel/loyalty-app \
  --workflow=ci-build-e2e.yml --branch=main --limit=5 \
  --json conclusion,headSha,createdAt \
  --jq '.[] | select(.conclusion == "success") | .headSha' \
  | head -1
```

- These two SHAs **must match**.
- If `PROPOSED_SHA` is older than the latest green: a newer commit has
  already been built. You're about to redeploy a stale image. Usually
  fine, but ask why the newer build isn't being shipped instead.
- If `PROPOSED_SHA` is newer than the latest green: there is no green
  staging deploy for it yet. Abort and wait.

## 3. E2E for this SHA on `main` is green

Per the gating model adopted in #230, E2E **runs in parallel** with the
staging deploy on `main`, not as a gate. So:

- `ci-build-e2e.yml` can be green even if **E2E itself is red**, as
  long as the deploy + verify path succeeded.
- The manual production approver is the last point at which a red E2E
  on `main` would block a release. Don't skip this check.

```bash
gh run list -R thehfhotel/loyalty-app \
  --workflow=ci-build-e2e.yml --branch=main --commit=$PROPOSED_SHA \
  --json conclusion,jobs --jq '.[0]'
```

Then in the GitHub UI, drill into that run and confirm the **E2E
Tests** job is green (not just the workflow-level conclusion). If E2E
is red:

- **Abort production deploy** unless you've read the failure and are
  confident it's an infra flake (e.g., a known Playwright network
  blip). Document the abort decision either way.
- File an issue, then re-trigger the failed job. If it passes on
  retry, proceed with deploy.

## 4. Skim `CHANGELOG.md` and the merged PR list for surprises

Run:

```bash
# Compare current main to whatever's live in prod
gh api repos/thehfhotel/loyalty-app/compare/$LIVE_SHA...$PROPOSED_SHA \
  --jq '.commits[] | "- " + .commit.message'
```

Look for any of these — they all warrant extra scrutiny before
clicking approve:

- **Migrations**: any new file under `backend-rust/migrations/`. A
  forward-only `sqlx::migrate!` change means rollback requires a DB
  restore (see [`docs/rollback-runbook.md`](rollback-runbook.md)).
- **Migration rewrites**: edits to existing `migrations/*.sql` or to
  `REBRIDGED_MIGRATIONS` in `db/migrations.rs`. Re-read
  [`docs/migration-rewrite-runbook.md`](migration-rewrite-runbook.md)
  before approving.
- **Secret-touch**: edits to `.env.example`, `.env.production.example`,
  any reference to `JWT_SECRET` / `JWT_REFRESH_SECRET` /
  `SESSION_SECRET` / OAuth secrets. Cross-check
  [`docs/secrets-runbook.md`](secrets-runbook.md). Have the matching
  GitHub Actions secrets been updated yet?
- **Infra / deploy changes**: edits to anything under
  `docker-compose*.yml`, `nginx/`, `.github/workflows/`. These can
  break the deploy itself, not just the app.
- **Resource-limit changes**: edits to
  `docker-compose.prod.yml::deploy.resources`. A tightened limit can
  OOM-kill the backend; a loosened one can starve postgres.

For routine "fix typo" / "bump version" commits, this step is a
30-second skim. For anything in the list above, slow down.

## 5. Know how to roll back

Before clicking approve, confirm you can reach
[`docs/rollback-runbook.md`](rollback-runbook.md). The single most
common failure mode after a bad deploy is the on-call not knowing
which SHA to roll *to* — the runbook documents that lookup. If the
deploy goes bad five minutes after approval, you'll want the runbook
already open in another tab.

For DB-touching deploys, also have
[`docs/restore-runbook.md`](restore-runbook.md) at hand.

---

## Abort criteria — when NOT to approve

Abort and post in the on-call channel if any of the following are
true:

- Staging `/api/health` is **not 200** right now (step 1).
- The proposed SHA does **not match** the latest green staging SHA
  (step 2), and you can't justify the divergence.
- E2E for the SHA is **red** on `main` and you haven't read the
  failure (step 3).
- A migration or rewrite is in the deploy and you haven't read the
  migration runbook in the last week (step 4).
- A secret rotation landed in this batch but the matching GitHub
  Actions secret update has **not** been applied (step 4).
- You don't have time to handle a rollback in the next 30 minutes if
  this deploy turns out bad. Approval is not "deploy and walk away".

**To abort**: in the GitHub UI's "Review pending deployments" dialog,
choose **Reject**. The workflow ends, no production state changes,
and a future push to `main` (or re-run of `deploy.yml`) will queue a
fresh approval request. Document the reason in the rejection comment
so the next approver doesn't repeat the same approve-then-roll-back
cycle.

---

## Rollback link

If you approve and the deploy is bad, follow
[`docs/rollback-runbook.md`](rollback-runbook.md). For schema-touching
deploys also follow [`docs/restore-runbook.md`](restore-runbook.md).
The cloudflared tunnel-side recovery path is in
[`docs/cloudflare-tunnel-runbook.md`](cloudflare-tunnel-runbook.md).
