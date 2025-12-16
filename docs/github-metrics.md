# GitHub Reliability Metrics

This repository now ships a small helper to calculate three reliability indicators directly from GitHub Actions data:

- Flaky rate: commits that failed at least once but later passed on the same commit.
- Change failure rate: failed runs / (failed + successful runs) for the selected event.
- Time to fix: time between first failing run and next successful run on the branch.

## How it works

- Source: GitHub Actions workflow runs (completed state) pulled via the GitHub REST API.
- Scope: Single workflow name or id (defaults to `Optimized CI/CD Pipeline with Security & Testing`).
- Branch: Defaults to `main`. Adjust with `--branch`.
- Window: Sliding lookback (default 30 days) controlled by `--days`.
- Event filter: Defaults to `push` for change failure rate; flaky and time-to-fix still use all runs on the branch.

## Usage

```bash
# ensure gh is authenticated or set GITHUB_TOKEN/GH_TOKEN
GITHUB_TOKEN=$(gh auth token) node scripts/metrics/actions-metrics.js \
  --days 14 \
  --branch main \
  --event push
```

### Options

- `--repo owner/repo` (auto-detected from git remote)
- `--workflow "<name or id>"` (defaults to main CI/CD workflow)
- `--branch <branch>` (default: main)
- `--days <lookback>` (default: 30)
- `--event <push|pull_request|...>` for change failure rate only

### Example output (last 14 days, main, push)

```
Repo: jwinut/loyalty-app | Workflow: Optimized CI/CD Pipeline with Security & Testing (#178730198) | Branch: main | Window: last 14 days | Runs analyzed: 192
------------------------------------------------------------
Change failure rate: 55.7% (73 fail / 58 success, event=push)
Flaky rate: 0.0% (0 / 190 commits with runs)
Time to fix: avg 9.78h | median 20.8m (27 incidents)
```

## CI integration

- Standalone workflow: `.github/workflows/actions-metrics.yml`
  - Trigger: `workflow_run` on completion of `Optimized CI/CD Pipeline with Security & Testing`
  - Schedule: daily at 23:59 UTC to provide an end-of-day snapshot
  - Runner: `ubuntu-latest` (no self-hosted dependency)
  - Permissions: `actions:read`, `contents:read` only
  - Branch gate: only runs when the triggering workflow is on `main`
  - Uses `GITHUB_TOKEN` and passes `--repo "$GITHUB_REPOSITORY"` to avoid relying on local git remotes
  - Output: appends the metrics to the workflow summary (`$GITHUB_STEP_SUMMARY`) for easy viewing on the run page

## Interpretation notes

- Flaky rate flags commits where at least one failed attempt was followed by a success on the same SHA. It does not inspect job-level test details or artifact data.
- Change failure rate counts conclusions of `success` vs. failure-like states (`failure`, `timed_out`, `startup_failure`). Canceled/neutral runs are ignored.
- Time to fix pairs the first failing run with the next successful run on the branch; consecutive failures roll into the same incident until a success lands.
- Expand the lookback if you need more data or if the workflow rarely runs.
