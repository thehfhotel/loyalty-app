# Rollback Runbook

How to roll the production deploy back to a previous image when something
is wrong and the next push to `main` won't fix it fast enough.

> See also: `docs/restore-runbook.md` (DB restore),
> `docs/cloudflare-tunnel-runbook.md` (tunnel-side recovery),
> `docs/secrets-runbook.md` (env-injection details).

## Overview

`.github/workflows/deploy.yml` ships GHCR images tagged with the commit
SHA (`ghcr.io/thehfhotel/loyalty-app/backend:<sha>`). A rollback is
"redeploy a previous `<sha>` image to evergreen using the same SSH-to-
evergreen path the deploy workflow already takes."

**Critical constraint**: `sqlx::migrate!` is forward-only. There are no
down-migrations. If you roll the code back past the last applied
migration, the older code will hit columns/tables/types it doesn't
understand and will misbehave or crash. The decision tree below is the
guard.

## Decision tree

```
Did the bad commit add or alter a schema element
(new column, new table, dropped column, type change)?
│
├── YES → Code rollback alone is unsafe.
│         Roll BOTH the DB (docs/restore-runbook.md) and the code.
│
└── NO  → Code rollback is safe.
          Proceed to "Steps" below.
```

Migrations are listed under `backend-rust/migrations/`. The bad commit
either:
- changed nothing under `migrations/` → safe to roll back code only.
- added a new file under `migrations/` → roll back both (code + DB).
- modified an applied migration → see `docs/migration-rewrite-runbook.md`;
  this is a separate path and rollback requires DB restore.

## Steps — code-only rollback

### 1. Identify the last-known-good SHA

```bash
# Recent CI builds against main, with conclusion + commit SHA:
gh run list -R thehfhotel/loyalty-app \
  --workflow=ci-build-e2e.yml --branch=main \
  --json conclusion,headSha,createdAt,displayTitle --limit 20

# Pick the most recent "success" row whose displayTitle predates the
# regression. Note its headSha (full 40 chars).
```

Sanity-check that the chosen SHA also has a green `ci-test.yml` for
the same commit (frontend lint + unit tests):

```bash
gh run list -R thehfhotel/loyalty-app \
  --workflow=ci-test.yml --branch=main --commit=<sha> \
  --json conclusion
```

### 2. Confirm the GHCR images exist for that SHA

```bash
gh api repos/thehfhotel/loyalty-app/packages/container/loyalty-app%2Fbackend/versions \
  --jq '.[] | select(.metadata.container.tags | index("<sha>"))'

gh api repos/thehfhotel/loyalty-app/packages/container/loyalty-app%2Ffrontend/versions \
  --jq '.[] | select(.metadata.container.tags | index("<sha>"))'
```

Both should return a non-empty result. If the image was garbage-collected
by GHCR retention, use a more recent green SHA.

### 3. Trigger redeploy

Two options.

**Option A — re-run the previous green deploy**: the simplest path. Find
the previous green production `Deploy` run, click "Re-run jobs". GitHub
will redeploy the same SHA without rebuilding.

```bash
gh run list -R thehfhotel/loyalty-app --workflow=deploy.yml \
  --json status,conclusion,headSha,databaseId --limit 10
gh run rerun <database_id> -R thehfhotel/loyalty-app
```

**Option B — manual SSH redeploy** (when re-run isn't available): mirror
the `deploy.yml` env-injection block by hand. You need the `DATABASE_URL`,
JWT/Session/Postgres secrets in your shell. See `docs/secrets-runbook.md`
section "Manual production deployment (recovery only)" for the secret
list and the `docker compose -f ... up -d` invocation. Set
`IMAGE_TAG=<previous-sha>` (override in the `.env`) before bringing the
stack up so it pulls the prior image instead of `:latest`.

### 4. Approve the production environment

The `deploy-production` job is gated by the `production` GitHub
environment, which requires a human approver. The approver should:

- Confirm the SHA matches the last-known-good identified above.
- Confirm there were no migrations added between the bad and good SHAs.
- Click **Review deployments → Approve and deploy**.

### 5. Verify

```bash
curl -fsS https://loyalty.saichon.com/api/health
# Expect HTTP 200 with a JSON body that mentions postgres + redis healthy.
```

Spot-check the obvious user paths: `/`, login, recent booking page,
admin dashboard. The post-deploy `Verify Staging` workflow does **not**
re-run for a manual redeploy — health-check production manually here.

### 6. Open a follow-up issue for the bad commit

Document what regressed so the on-call who took the call has a written
record, and to prevent re-introduction:

```bash
gh issue create -R thehfhotel/loyalty-app \
  --title "regression: rolled back <bad-sha>" \
  --body "Symptoms / impact / rolled-back-from <bad-sha> / rolled-back-to <good-sha>"
```

## Steps — code + DB rollback

Use this when the bad commit added or altered a schema element.

1. **Stop the backend** to drain in-flight writes:
   ```bash
   ssh ... 'docker stop loyalty_backend_production'
   ```
2. **Restore the DB** to a snapshot from before the bad migration was
   applied (`docs/restore-runbook.md` § "Restoring from backup",
   steps 1–6, choose a dump whose timestamp predates the bad deploy).
3. **Redeploy the prior image** as in "code-only rollback" steps 1–4
   above.
4. **Verify** as in step 5 above.

> **Caveat**: any application data written between the bad-deploy moment
> and the rollback is lost. That tradeoff is usually correct vs. running
> on a corrupt schema, but document the cutoff timestamp in the
> follow-up issue.

## Who can approve production when the primary approver is unreachable

The `production` GitHub environment defines the required reviewer list
in repository settings (Settings → Environments → production →
Deployment branches and tags / Required reviewers). Backup approvers
must be listed there ahead of time — there is no "break-glass" override
in the GitHub UI.

If the listed approvers are all unreachable:

1. A repo admin can temporarily add themselves to the required reviewer
   list at Settings → Environments → production → Required reviewers.
2. Approve the deploy.
3. Restore the original reviewer list immediately afterward.
4. Document the override in the post-incident issue.

## Manual SSH-to-evergreen recovery (last resort)

If GitHub Actions itself is down, you can still redeploy by hand. The
flow `deploy.yml` runs over SSH is:

```bash
# On your workstation (the cloudflared binary must be installed):
ssh -o ProxyCommand="cloudflared --edge-ip-version 4 access ssh --hostname %h" \
  deploy@evergreen.thehfhotel.org

# Then on evergreen, inside the deploy directory, edit .env to set
# COMMIT_SHA / IMAGE_TAG to the previous-green SHA, then:
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml \
  -f docker-compose.prod.yml pull backend frontend
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml \
  -f docker-compose.prod.yml up -d
```

The exact deploy directory and `.env` path are not committed (they live
on the host). Look at `/srv/run-deploy-loyalty-app-prod.sh` on evergreen
for the canonical invocation.

## Dry-run

Before relying on this runbook in an incident, perform one dry-run
rollback against staging:

1. Identify the previous-green staging deploy SHA.
2. Trigger `Re-run jobs` on it.
3. Confirm `loyalty-dev.saichon.com` serves traffic correctly afterward.
4. Note the date in `docs/restore-runbook.md` § "Restore drill log".

Last dry-run: _pending — perform before public launch_.
