# Security Configuration Guide

## ⚠️ CRITICAL: Never Commit Secrets

**All production secrets MUST be stored in GitHub Secrets, NOT in files.**

### Secrets Removed from Repository

The following secrets were **completely removed from git** (previously exposed in commit a97fa86c):

1. **JWT Secrets** - Session and refresh token signing keys
2. **OAuth Credentials** - Google, Facebook, LINE client secrets
3. **Azure Translation Keys** *(feature currently disabled)* - API keys for translation service
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
| `ADMIN_USERNAME` | Admin email | ✅ Configured |

> ℹ️ Translation services are currently disabled. No Azure translator secrets are required unless the feature is re-enabled.

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
   - Azure Portal: Regenerate translation keys (only if translation is enabled)

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

## CodeQL Code Scanning

### Overview

This project uses GitHub CodeQL for Static Application Security Testing (SAST). CodeQL runs automatically on:
- Push to `main` branch
- Pull requests to `main`
- Weekly scheduled scans (Monday 12:00 UTC)

Configuration: `.github/workflows/codeql.yml`

### Log Injection Prevention

We implement OWASP-compliant log sanitization to prevent log injection attacks (CWE-117).

**Sanitizer Functions** (`backend/src/utils/logSanitizer.ts`):

| Function | Purpose | Usage |
|----------|---------|-------|
| `sanitizeLogValue(value)` | General sanitization | Any user input in logs |
| `sanitizeUserId(id)` | UUID/ID sanitization | User IDs, transaction IDs |
| `sanitizeEmail(email)` | Email masking | Email addresses (masks middle) |
| `sanitizeUrl(url)` | URL sanitization | URLs in log entries |
| `sanitizeIp(ip)` | IP validation | IP addresses |

**Security Controls:**
- Removes CR (`\r`), LF (`\n`), CRLF sequences
- Removes ASCII control characters (`\x00-\x1F`, `\x7F`)
- Removes Unicode control characters (C0, C1 sets)
- Removes ANSI escape sequences (terminal color codes)
- Removes null bytes (prevents string truncation attacks)
- Truncates to 500 chars (prevents log flooding)
- Strict mode: allowlist-only approach (alphanumerics + safe punctuation)

**Example Usage:**
```typescript
import { sanitizeUserId, sanitizeEmail, sanitizeLogValue } from '../utils/logSanitizer';

// Always sanitize user-controlled values before logging
logger.info(`User ${sanitizeUserId(userId)} logged in`);
logger.info(`Email: ${sanitizeEmail(userEmail)}`);
logger.warn(`Invalid input: ${sanitizeLogValue(userInput)}`);
```

### CodeQL Limitations (IMPORTANT)

#### JavaScript Model Extensions Don't Support Sanitizers

CodeQL data extensions for JavaScript only support:
- `sourceModel` - Define taint sources
- `sinkModel` - Define taint sinks
- `summaryModel` - Define flow through functions
- `typeModel` - Define type relationships

**There is NO `sanitizerModel` or `barrierModel` for JavaScript.** This means CodeQL cannot be taught to recognize custom sanitizer functions via model packs.

Reference: [Customizing Library Models for JavaScript](https://codeql.github.com/docs/codeql-language-guides/customizing-library-models-for-javascript/)

#### Inline Suppression Comments Don't Work in Code Scanning

GitHub Code Scanning does **NOT** support inline suppression comments:

```typescript
// These comments are IGNORED by GitHub Code Scanning:
// codeql[js/log-injection]
// lgtm[js/log-injection]
logger.info(`User: ${sanitizeUserId(userId)}`);  // Still flagged!
```

The `// codeql[]` and `// lgtm[]` comments only work with:
- CodeQL CLI (local analysis)
- LGTM.com (deprecated)

**They do NOT work with GitHub Code Scanning.**

Reference: [GitHub CodeQL Issue #9383](https://github.com/github/codeql/issues/9383)

### Handling False Positives

Since our sanitizer functions properly remove control characters but CodeQL can't recognize them, log injection alerts are **false positives**.

#### Dismissing Alerts via API

```bash
# Dismiss a single alert
gh api -X PATCH repos/OWNER/REPO/code-scanning/alerts/ALERT_NUMBER \
  -f state=dismissed \
  -f dismissed_reason="false positive" \
  -f dismissed_comment="User input is sanitized via sanitizeUserId/sanitizeEmail/sanitizeLogValue functions which remove newlines, carriage returns, and control characters per OWASP recommendations."

# List open log injection alerts
gh api repos/OWNER/REPO/code-scanning/alerts \
  --jq '.[] | select(.rule.id == "js/log-injection" and .state == "open") | {number, file: .most_recent_instance.location.path, line: .most_recent_instance.location.start_line}'
```

#### Dismissal Reasons

Valid values for `dismissed_reason`:
- `"false positive"` - Code is not actually vulnerable
- `"won't fix"` - Accepted risk, won't be addressed
- `"used in tests"` - Test code, not production

### Best Practices

1. **Always use sanitizer functions** for user-controlled data in logs
2. **Keep inline comments** (`// codeql[js/log-injection]`) for documentation even though they don't affect Code Scanning
3. **Dismiss false positives via API** with clear comments explaining why
4. **Review new alerts** before dismissing - ensure sanitizers are actually used
5. **Update sanitizers** if new attack vectors are discovered

### CodeQL Configuration Files

```
.github/
├── codeql/
│   ├── codeql-config.yml          # Main config (queries to run)
│   └── extensions/                 # Auto-detected model packs
│       └── loyalty-app-models/
│           ├── codeql-pack.yml    # Pack definition
│           └── models/
│               └── log-sanitizers.yml  # Model definitions (for reference only)
└── workflows/
    └── codeql.yml                 # Workflow definition
```

**Note:** The model pack in `extensions/` is kept for documentation purposes but does not affect JavaScript log injection detection due to the limitation described above.

## Additional Resources

- [GitHub Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Docker Compose Environment Variables](https://docs.docker.com/compose/environment-variables/)
- [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [OWASP Log Injection](https://owasp.org/www-community/attacks/Log_Injection)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [GitHub CLI Secrets Commands](https://cli.github.com/manual/gh_secret)
- [CodeQL JavaScript Models](https://codeql.github.com/docs/codeql-language-guides/customizing-library-models-for-javascript/)
- [CodeQL Query Help: Log Injection](https://codeql.github.com/codeql-query-help/javascript/js-log-injection/)

---

**Last Updated**: December 15, 2025
**Status**: ✅ All secrets migrated to GitHub Secrets
**CodeQL**: ✅ Log injection alerts dismissed as false positives (sanitizers in use)
**Migration**: Completed - using GitHub Secrets → Workflow → .env → Docker Compose pattern
