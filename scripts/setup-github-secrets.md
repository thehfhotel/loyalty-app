# GitHub Secrets Setup Guide

## Critical Action Required

The following variables need to be moved from GitHub **Variables** to **Secrets** for security and proper CI/CD functionality:

### 1. Move Variables to Secrets

Go to: **GitHub Repository** → **Settings** → **Environments** → **production** → **Environment secrets**

#### Variables to Move to Secrets:

```bash
# Core URLs (CRITICAL - Required for OAuth redirects)
FRONTEND_URL=https://loyalty.saichon.com
BACKEND_URL=https://loyalty.saichon.com/api  
VITE_API_URL=https://loyalty.saichon.com/api

# OAuth Callback URLs
GOOGLE_CALLBACK_URL=https://loyalty.saichon.com/api/oauth/google/callback
LINE_CALLBACK_URL=https://loyalty.saichon.com/api/oauth/line/callback
FACEBOOK_CALLBACK_URL=https://loyalty.saichon.com/api/oauth/facebook/callback
```

### 2. Steps to Move Variables:

1. **Copy the values** from GitHub Variables
2. **Create new secrets** with the same names in GitHub Secrets
3. **Delete the variables** after confirming secrets are working

### 3. Why This is Critical:

- **OAuth redirects** currently point to `localhost:4001` because `FRONTEND_URL` is missing from secrets
- **API calls** fail because `VITE_API_URL` is not available to the frontend
- **Security**: URLs should be in secrets, not public variables

### 4. Verification:

After moving to secrets, the deployment will:
- ✅ Use production URLs for OAuth redirects
- ✅ Fix the "localhost:4001" redirect issue
- ✅ Ensure frontend can communicate with backend API
- ✅ Maintain security best practices

### 5. Quick Setup Commands:

You can use GitHub CLI to set these secrets:

```bash
# Set the critical URL secrets
gh secret set FRONTEND_URL --body "https://loyalty.saichon.com" --env production
gh secret set BACKEND_URL --body "https://loyalty.saichon.com/api" --env production  
gh secret set VITE_API_URL --body "https://loyalty.saichon.com/api" --env production

# Set OAuth callback URLs
gh secret set GOOGLE_CALLBACK_URL --body "https://loyalty.saichon.com/api/oauth/google/callback" --env production
gh secret set LINE_CALLBACK_URL --body "https://loyalty.saichon.com/api/oauth/line/callback" --env production
gh secret set FACEBOOK_CALLBACK_URL --body "https://loyalty.saichon.com/api/oauth/facebook/callback" --env production
```

### 6. After Setup:

Run a new deployment to test the fixes:
```bash
# Trigger deployment
git commit --allow-empty -m "test: Trigger deployment with fixed secrets"
git push origin main
```

This will resolve the localhost redirect issue and ensure proper production configuration.