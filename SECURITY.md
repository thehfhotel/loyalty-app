# Security Configuration Guide

## ⚠️ CRITICAL: Never Commit Secrets

**All production secrets MUST be stored in GitHub Secrets, NOT in files.**

### Secrets Removed from Repository

The following secrets were **completely removed from git** (previously exposed in commit a97fa86c):

1. **JWT Secrets** - Session and refresh token signing keys
2. **OAuth Credentials** - Google, Facebook, LINE client secrets
3. **Azure Translation Keys** - API keys for translation service
4. **Admin Credentials** - Admin email configuration

### Current Secure Configuration

**GitHub Secrets** → **GitHub Actions Workflow** → **.env file** → **Docker Compose**

1. **GitHub Secrets**: All secrets stored securely in repository settings
2. **Workflow**: `.github/workflows/deploy.yml` injects secrets into `.env` file
3. **Docker Compose**: `docker-compose.prod.yml` reads from `.env` using environment variable substitution
4. **No secrets in git**: `.env` files are gitignored and never committed

## GitHub Secrets Configuration

### Required Secrets (Already Configured)

All secrets are configured in GitHub repository settings:

**Settings → Secrets and variables → Actions → Repository secrets**

| Secret Name | Description | Status |
|-------------|-------------|--------|
| `JWT_SECRET` | JWT signing key | ✅ Configured |
| `JWT_REFRESH_SECRET` | Refresh token signing key | ✅ Configured |
| `SESSION_SECRET` | Session encryption key | ✅ Configured |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | ✅ Configured |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | ✅ Configured |
| `LINE_CHANNEL_ID` | LINE OAuth channel ID | ✅ Configured |
| `LINE_CHANNEL_SECRET` | LINE OAuth secret | ✅ Configured |
| `AZURE_TRANSLATION_KEY_1` | Azure translation primary key | ✅ Configured |
| `AZURE_TRANSLATION_KEY_2` | Azure translation secondary key | ✅ Configured |
| `ADMIN_USERNAME` | Admin email | ✅ Configured |

### View Configured Secrets

```bash
# List all configured secrets (values are hidden)
gh secret list
```

### Add or Update Secrets

```bash
# Set a new secret
gh secret set SECRET_NAME --body "secret-value"

# Set from file
gh secret set SECRET_NAME < secret-file.txt

# Set interactively
gh secret set SECRET_NAME
# (paste value, then Ctrl+D)
```

### Example: Rotating JWT Secret

```bash
# Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# Update GitHub Secret
gh secret set JWT_SECRET --body "$NEW_SECRET"

# Redeploy (triggers workflow automatically)
git commit --allow-empty -m "chore: rotate JWT secret" && git push
```

## How It Works

### Deployment Flow

```
┌─────────────────┐
│ GitHub Secrets  │  ← Secrets stored here (encrypted)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ GitHub Actions  │  ← Workflow injects secrets into .env
│   (deploy.yml)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  .env file      │  ← Temporary file on runner (not committed)
│ (on runner)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Docker Compose  │  ← Reads .env via ${VAR} substitution
│ (prod.yml)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Containers    │  ← Environment variables injected
│  (backend, etc) │
└─────────────────┘
```

### Workflow Steps (Automatic)

1. **Trigger**: Push to `main` branch
2. **Checkout**: Clone latest code
3. **Environment Configuration**: Workflow reads GitHub Secrets
4. **Create .env**: Workflow creates `.env` file with all secrets
5. **Docker Compose**: `docker-compose.prod.yml` reads from `.env`
6. **Deploy**: Containers start with environment variables

### docker-compose.prod.yml Pattern

```yaml
services:
  backend:
    environment:
      # Uses ${VAR} substitution from .env file
      JWT_SECRET: ${JWT_SECRET}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      # etc...
```

**Important**: No secrets are hardcoded! All come from `.env` file created by GitHub Actions.

## Local Development vs Production

### Local Development

```bash
# Use .env or .env.development (gitignored)
cp .env.example .env
# Edit .env with development credentials
npm run dev
```

### Production Deployment

**Automatic** (via GitHub Actions):
```bash
git push origin main
# GitHub Actions automatically:
# - Reads secrets from GitHub Secrets
# - Creates .env file
# - Deploys with Docker Compose
```

**Manual** (for testing):
```bash
# On production server, manually create .env
cd /home/nut/loyalty-app
cat > .env << 'EOF'
JWT_SECRET=...
GOOGLE_CLIENT_SECRET=...
# ... all other secrets
EOF

# Deploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Secret Rotation

### Rotate a Secret

1. **Generate new value**:
   ```bash
   # For random secrets
   openssl rand -hex 32

   # For OAuth secrets
   # Get from provider console (Google, LINE, etc.)
   ```

2. **Update GitHub Secret**:
   ```bash
   gh secret set JWT_SECRET --body "new-secret-value"
   ```

3. **Redeploy**:
   ```bash
   # Trigger workflow with empty commit
   git commit --allow-empty -m "chore: rotate JWT secret"
   git push origin main
   ```

### Rotation Schedule (Recommended)

- **JWT Secrets**: Every 90 days
- **OAuth Secrets**: When provider requires or annually
- **API Keys**: Every 180 days
- **After security incident**: Immediately

## Security Checklist

- [x] No secrets in `docker-compose.prod.yml`
- [x] `.env*` files in `.gitignore` (except `.env.example`)
- [x] All secrets in GitHub Secrets
- [x] GitHub Actions workflow injects secrets into `.env`
- [x] Docker Compose uses `${VAR}` substitution
- [x] Secrets rotation procedure documented
- [ ] Regular secret rotation schedule (90 days recommended)
- [ ] Secrets are strong and randomly generated
- [ ] Access to GitHub repository restricted to authorized users

## Emergency Secret Leak Response

If secrets are accidentally committed or leaked:

### Immediate Actions (Within 1 Hour)

1. **Rotate ALL exposed secrets immediately**:
   ```bash
   # Generate new secrets
   NEW_JWT=$(openssl rand -hex 32)
   NEW_REFRESH=$(openssl rand -hex 32)
   NEW_SESSION=$(openssl rand -hex 32)

   # Update GitHub Secrets
   gh secret set JWT_SECRET --body "$NEW_JWT"
   gh secret set JWT_REFRESH_SECRET --body "$NEW_REFRESH"
   gh secret set SESSION_SECRET --body "$NEW_SESSION"

   # For OAuth secrets, regenerate in provider console
   # Then update GitHub Secrets with new values
   ```

2. **Trigger immediate redeployment**:
   ```bash
   git commit --allow-empty -m "security: rotate exposed secrets"
   git push origin main
   ```

3. **Revoke OAuth credentials in provider consoles**:
   - Google Cloud Console: Regenerate client secret
   - LINE Developers Console: Regenerate channel secret
   - Azure Portal: Regenerate translation keys

### Follow-up Actions (Within 24 Hours)

4. **Remove from git history** (if committed):
   ```bash
   # Install BFG Repo-Cleaner
   brew install bfg  # or download from https://rtyley.github.io/bfg-repo-cleaner/

   # Clone fresh repo
   git clone --mirror https://github.com/jwinut/loyalty-app.git

   # Remove secrets
   cd loyalty-app.git
   bfg --replace-text passwords.txt  # file with old secrets

   # Clean up
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive

   # Force push (⚠️ COORDINATE WITH TEAM)
   git push --force
   ```

5. **Audit access logs**:
   - Check GitHub access logs
   - Review application logs for suspicious activity
   - Monitor for unauthorized API usage

6. **Document incident**:
   - What was exposed
   - When it was detected
   - Actions taken
   - Lessons learned

## Additional Resources

- [GitHub Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Docker Compose Environment Variables](https://docs.docker.com/compose/environment-variables/)
- [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [GitHub CLI Secrets Commands](https://cli.github.com/manual/gh_secret)

---

**Last Updated**: November 16, 2025
**Status**: ✅ All secrets migrated to GitHub Secrets
**Migration**: Completed - using GitHub Secrets → Workflow → .env → Docker Compose pattern
