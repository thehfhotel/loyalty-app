# GitHub Actions Deployment Setup Guide

This guide will help you set up automated deployment using GitHub Actions with a self-hosted runner on your server.

## 📋 Overview

Instead of manually SSHing to your server and pulling code, GitHub Actions will automatically deploy your app whenever you push to the main branch.

## 🚀 Quick Start

### Step 1: Configure GitHub Secrets (On Dev Machine)

```bash
# Run the configuration helper
bash scripts/deploy-config.sh
```

Or manually add secrets in GitHub:
1. Go to Settings → Secrets and variables → Actions
2. Add required secrets (see script output for list)

### Step 2: Install Runner on Server

SSH to your server and run:

```bash
# 1. Clone/pull the repository
git clone <your-repo-url> /home/nut/loyalty-app
cd /home/nut/loyalty-app

# 2. Run the setup script
bash scripts/setup-github-runner.sh
```

Follow the prompts:
- Enter your GitHub username/org
- Enter repository name  
- Get token from GitHub settings
- Script will install and start the runner

### Step 3: Verify Setup

1. Check runner status on server:
   ```bash
   sudo ${HOME}/actions-runner/svc.sh status
   ```

2. Check GitHub:
   - Go to Settings → Actions → Runners
   - Your runner should appear as "Idle"

### Step 4: Test Deployment

Push to main branch:
```bash
git add .
git commit -m "feat: Add GitHub Actions deployment"
git push origin main
```

Monitor deployment:
- Go to Actions tab in GitHub
- Watch the deployment workflow
- Check your server after completion

## 🔧 How It Works

1. **You push code** to main branch from dev machine
2. **GitHub triggers** the workflow
3. **Self-hosted runner** on your server executes the workflow
4. **Workflow steps**:
   - Pulls latest code
   - Backs up database
   - Builds Docker containers
   - Runs migrations
   - Performs health checks
   - Cleans up old images

## 📁 File Structure

```
.github/
└── workflows/
    └── deploy.yml          # Deployment workflow

scripts/
├── setup-github-runner.sh  # Runner installation (run on server)
├── deploy-config.sh        # GitHub secrets setup (run on dev)
└── ...

docs/
└── GITHUB_ACTIONS_SETUP.md # This file
```

## 🛠️ Maintenance

### Start/Stop Runner
```bash
# On server
${HOME}/start-runner.sh  # Start runner
${HOME}/stop-runner.sh   # Stop runner
${HOME}/runner-logs.sh   # View logs
```

### Update Runner
```bash
cd ${HOME}/actions-runner
sudo ./svc.sh stop
# Download new version and extract
./config.sh ...  # Reconfigure
sudo ./svc.sh install
sudo ./svc.sh start
```

### Troubleshooting

**Runner not appearing in GitHub:**
- Check runner service: `sudo ${HOME}/actions-runner/svc.sh status`
- Check logs: `${HOME}/runner-logs.sh`
- Ensure token is valid (tokens expire after 1 hour if unused)

**Deployment fails:**
- Check Actions tab in GitHub for error details
- SSH to server and check Docker logs: `docker compose logs`
- Verify all secrets are set correctly

**Permission issues:**
- Ensure runner user has Docker permissions
- Add to docker group: `sudo usermod -aG docker $USER`

## 🔒 Security Notes

- Runner uses outbound connections only (no inbound ports needed)
- Secrets are stored in GitHub, not in code
- Database is backed up before each deployment
- Failed deployments don't affect running services

## 📊 Benefits

✅ **No manual deployment** - Push and forget
✅ **Consistent deployments** - Same process every time  
✅ **Automatic backups** - Database backed up before changes
✅ **Health checks** - Ensures app is running after deployment
✅ **Rollback capability** - Can revert if issues detected
✅ **Audit trail** - All deployments logged in GitHub

## 🚦 Next Steps

After basic deployment is working, you can enhance with:

1. **Staging environment** - Deploy to staging first
2. **Automated tests** - Run tests before deployment
3. **Notifications** - Slack/Discord alerts on deployment
4. **Blue-green deployment** - Zero-downtime deployments
5. **Monitoring** - Add application monitoring

## 📞 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review GitHub Actions logs
3. Check server logs with `docker compose logs`
4. Verify all prerequisites are installed