# Security Configuration Guide

## ⚠️ CRITICAL: Never Commit Secrets

**All production secrets MUST be stored in `.env.production` (gitignored) or GitHub Secrets.**

### Secrets That Were Previously Exposed (Now Removed)

The following secrets were **removed from `docker-compose.prod.yml`** in commit XXX:

1. **JWT Secrets** - Session and refresh token signing keys
2. **OAuth Credentials** - Google, Facebook, LINE client secrets
3. **Azure Translation Keys** - API keys for translation service
4. **Admin Credentials** - Admin email configuration

### Current Secure Configuration

**File**: `docker-compose.prod.yml`
- ✅ Uses `env_file: .env.production` to load all secrets
- ✅ Only public/non-sensitive config hardcoded (URLs, endpoints)
- ✅ `.env.production` is gitignored and never committed

**File**: `.env.production` (gitignored)
```bash
# This file contains ALL production secrets
# It is loaded automatically by docker-compose.prod.yml
# NEVER commit this file to git

# Core Secrets
JWT_SECRET=<your-jwt-secret>
JWT_REFRESH_SECRET=<your-refresh-secret>
SESSION_SECRET=<your-session-secret>

# OAuth Secrets
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
LINE_CHANNEL_ID=<your-line-channel-id>
LINE_CHANNEL_SECRET=<your-line-channel-secret>
FACEBOOK_APP_ID=<your-facebook-app-id>
FACEBOOK_APP_SECRET=<your-facebook-app-secret>

# Azure Translation Service
AZURE_TRANSLATION_KEY_1=<your-azure-key-1>
AZURE_TRANSLATION_KEY_2=<your-azure-key-2>

# Admin Configuration
ADMIN_USERNAME=<admin-email>
```

## GitHub Actions Deployment

### Required GitHub Secrets

For GitHub Actions deployments, configure these secrets in your repository:

**Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `SSH_PRIVATE_KEY` | SSH key for deployment server access | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `SSH_HOST` | Deployment server hostname/IP | `loyalty.saichon.com` |
| `SSH_USER` | Deployment server username | `nut` |
| `ENV_PRODUCTION` | Complete `.env.production` file contents | See `.env.production.example` |

### Deployment Workflow

The GitHub Actions workflow (`.github/workflows/deploy.yml`) will:

1. Connect to your server via SSH (using `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`)
2. Pull the latest code
3. Create `.env.production` from `ENV_PRODUCTION` secret
4. Run `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`

**All secrets are loaded from `.env.production` via `env_file` directive.**

## Local Development

For local development, use `.env` or `.env.development`:

```bash
# Development uses different secrets (not production!)
cp .env.example .env
# Edit .env with development credentials
npm run dev
```

## Production Deployment

### Manual Deployment

```bash
# On production server
git pull
# Ensure .env.production exists with all secrets
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Automated Deployment (GitHub Actions)

Push to `main` branch triggers automatic deployment:

```bash
git push origin main
# GitHub Actions will:
# 1. SSH to production server
# 2. Pull latest code
# 3. Deploy with secrets from GitHub Secrets
```

## Secret Rotation

To rotate secrets:

1. **Update `.env.production`** on production server with new values
2. **Update GitHub Secret** `ENV_PRODUCTION` with new complete file
3. **Restart services**: `docker compose restart backend`

## Security Checklist

- [x] `.env.production` is in `.gitignore`
- [x] No secrets hardcoded in `docker-compose.prod.yml`
- [x] GitHub Secrets configured for CI/CD
- [x] All secrets loaded via `env_file` directive
- [ ] Regular secret rotation schedule (recommended: every 90 days)
- [ ] Secrets are strong and randomly generated
- [ ] Access to production server is restricted

## Emergency Secret Leak Response

If secrets are accidentally committed:

1. **Immediately rotate ALL exposed secrets** (new keys, passwords, tokens)
2. **Update `.env.production`** on production server
3. **Update GitHub Secrets** with new values
4. **Restart services** to use new secrets
5. **Remove from git history** (use `git filter-repo` or BFG Repo-Cleaner)
6. **Force push** to overwrite history (⚠️ coordinate with team)

### Example: Remove secrets from git history

```bash
# Install BFG Repo-Cleaner
brew install bfg  # or download from https://rtyley.github.io/bfg-repo-cleaner/

# Remove file with secrets
bfg --delete-files docker-compose.prod.yml.old

# Clean up
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force push (⚠️ DANGEROUS - coordinate with team)
git push --force
```

## Additional Resources

- [GitHub Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Docker Compose env_file](https://docs.docker.com/compose/environment-variables/set-environment-variables/#use-the-env_file-attribute)
- [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)

---

**Last Updated**: November 16, 2025
**Status**: Secrets removed from docker-compose.prod.yml, using env_file pattern
