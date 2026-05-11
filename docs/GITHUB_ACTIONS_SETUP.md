# GitHub Actions Deployment Setup Guide

This guide describes how to wire up automated deployment for this repo using
GitHub Actions and a self-hosted runner on your deploy host.

## Overview

Pushes to `main` trigger the workflow in `.github/workflows/deploy.yml`. The
workflow runs tests, builds Docker images, pushes them to GHCR, deploys to
staging automatically, and deploys to production after a manual approval.

## Quick Start

### Step 1: Configure GitHub secrets

Set the secrets the workflow needs (database URLs, JWT secrets, OAuth
credentials, deploy URLs, etc.) under **Settings → Secrets and variables →
Actions** for the repository. The exact list is enumerated in
`.github/workflows/deploy.yml` — search the workflow for `secrets.`.

### Step 2: Install a self-hosted runner

Follow GitHub's official instructions:

1. Open **Settings → Actions → Runners → New self-hosted runner** in your
   repo on github.com.
2. Pick the OS that matches your deploy host (typically Linux x64).
3. Run the displayed `mkdir`, `curl`, `tar`, `./config.sh`, and `./run.sh`
   commands on the host.

Recommended labels: `self-hosted,Linux,X64,production`. The deploy workflow
targets self-hosted runners.

To install the runner as a service so it starts on boot:

```bash
cd "$RUNNER_DIR"          # the directory you ran ./config.sh in
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status
```

### Step 3: Verify the runner is registered

In GitHub: **Settings → Actions → Runners** — your runner should appear
with status "Idle".

### Step 4: Trigger a deployment

Push to `main` and watch the **Actions** tab. Staging deploys automatically;
production requires you to approve the deployment in the GitHub UI.

## How it works

1. You push to `main`.
2. GitHub triggers the workflow.
3. The self-hosted runner on your deploy host runs the workflow.
4. The workflow:
   - Runs tests
   - Builds Docker images
   - Pushes images to GHCR
   - Backs up the database
   - Deploys via `docker compose pull` + `up -d`
   - Runs health checks
   - Cleans up dangling images

## File structure

```
.github/
└── workflows/
    └── deploy.yml          # Deployment workflow

scripts/
├── deploy-from-ghcr.sh     # Pull GHCR images and bring up the stack
├── deploy-config.sh        # GitHub secrets setup helper (run on dev)
└── ...
```

## Maintenance

### Start, stop, and inspect the runner

```bash
cd "$RUNNER_DIR"
sudo ./svc.sh start
sudo ./svc.sh stop
sudo ./svc.sh status
tail -f _diag/Runner_*.log
```

### Update the runner

GitHub will prompt when a new runner version is required. The standard
upgrade path is:

```bash
cd "$RUNNER_DIR"
sudo ./svc.sh stop
# Download and extract the new tarball per GitHub's instructions
sudo ./svc.sh install
sudo ./svc.sh start
```

### Troubleshooting

**Runner not appearing in GitHub:**
- Check the service status: `sudo "$RUNNER_DIR"/svc.sh status`
- Tail the logs in `"$RUNNER_DIR"/_diag/`
- Registration tokens expire after one hour if unused — request a fresh one.

**Deployment fails:**
- Inspect the failed job in the **Actions** tab.
- SSH to the host and check container logs: `docker compose logs`
- Verify every required secret is set.

**Permission issues:**
- The runner user must be in the `docker` group:
  `sudo usermod -aG docker "$USER"` (then re-login).

## Security notes

- The runner uses outbound connections only — no inbound ports are required.
- Secrets live in GitHub, not in the repo.
- The database is backed up before each deployment.
- A failed deployment does not affect the currently running services.

## Next steps

Possible enhancements:

1. Run a richer test suite before deployment.
2. Slack/Discord notifications on deployment events.
3. Blue/green deployment for zero downtime.
4. Application monitoring and alerting.
