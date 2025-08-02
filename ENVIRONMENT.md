# Environment Configuration

This document explains how environment variables and deployment configurations work in this project.

## Overview

The project uses separate environment configurations for development and production:

- **Development**: Uses `.env` file for local development
- **Production**: Uses GitHub Actions secrets (no `.env` files on server)

## File Structure

```
├── .env                           # Local development environment (git-ignored)
├── .env.example                   # Development environment template
├── .env.production.example        # Production environment template (reference only)
├── .env.development               # Development defaults
├── docker-compose.yml             # Base Docker Compose configuration
├── docker-compose.override.yml    # Development overrides (auto-loaded)
├── docker-compose.prod.yml        # Production overrides
└── ENVIRONMENT.md                 # This file
```

## Development Setup

1. **Copy environment template:**
   ```bash
   cp .env.example .env
   ```

2. **Fill in your development values:**
   - OAuth credentials for testing (optional)
   - Database settings (defaults work with Docker)
   - Admin credentials

3. **Start development environment:**
   ```bash
   docker compose up -d
   ```

   This automatically uses:
   - `docker-compose.yml` (base configuration)
   - `docker-compose.override.yml` (development overrides)
   - `.env` file for environment variables

## Production Deployment

Production uses GitHub Actions with environment secrets - no `.env` files are used on the server.

### GitHub Actions Configuration

1. **Environment Setup:**
   - Create a "production" environment in your GitHub repository
   - Add all required secrets to the production environment

2. **Required Secrets:**
   ```
   JWT_SECRET=<strong-random-32-char-string>
   JWT_REFRESH_SECRET=<different-strong-32-char-string>
   SESSION_SECRET=<another-strong-32-char-string>
   
   GOOGLE_CLIENT_ID=<production-google-client-id>
   GOOGLE_CLIENT_SECRET=<production-google-client-secret>
   GOOGLE_CALLBACK_URL=https://your-domain.com/api/oauth/google/callback
   
   FACEBOOK_APP_ID=<production-facebook-app-id>
   FACEBOOK_APP_SECRET=<production-facebook-app-secret>
   FACEBOOK_CALLBACK_URL=https://your-domain.com/api/oauth/facebook/callback
   
   LINE_CHANNEL_ID=<production-line-channel-id>
   LINE_CHANNEL_SECRET=<production-line-channel-secret>
   LINE_CALLBACK_URL=https://your-domain.com/api/oauth/line/callback
   
   LOYALTY_USERNAME=<admin-email@domain.com>
   LOYALTY_PASSWORD=<secure-admin-password>
   
   FRONTEND_URL=https://your-domain.com
   BACKEND_URL=https://your-domain.com/api
   VITE_API_URL=https://your-domain.com/api
   
   AZURE_TRANSLATION_TEXT_URI=<azure-translation-uri>
   AZURE_TRANSLATION_KEY_1=<azure-key-1>
   AZURE_TRANSLATION_KEY_2=<azure-key-2>
   AZURE_TRANSLATION_REGION=global
   ```

3. **Deployment Command:**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

### Production Features

- **Security:** No sensitive data stored in files
- **Restart Policies:** All services restart automatically
- **Port Security:** Database and Redis not exposed externally
- **Logging:** Centralized logging to named volumes
- **Health Checks:** Automated health monitoring

## Environment Files

### `.env` (Development)
- Used for local development only
- Contains development-safe defaults
- Can be customized per developer
- Git-ignored for security

### `.env.example` (Development Template)
- Template for development environment
- Safe to commit (no real secrets)
- Documents all required variables

### `.env.production.example` (Production Reference)
- Documents production requirements
- Shows what secrets need to be configured
- **Never contains real production values**

## Best Practices

1. **Never commit real secrets** to git
2. **Use strong, unique secrets** for production
3. **Update OAuth callback URLs** for your production domain
4. **Test environment variables** before deployment
5. **Backup your GitHub secrets** configuration
6. **Use different credentials** for development vs production

## Troubleshooting

### Development Issues

```bash
# Check if .env file exists and is readable
ls -la .env

# Verify Docker Compose reads environment variables
docker compose config

# Check container environment variables
docker compose exec backend env | grep JWT_SECRET
```

### Production Issues

```bash
# Check GitHub Actions logs for environment variable issues
# Verify all secrets are configured in GitHub repository settings
# Check production containers are using correct compose files
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

## Migration from Old Setup

If you're upgrading from the previous setup:

1. **Backup existing files:**
   ```bash
   cp .env .env.backup
   cp .env.production .env.production.backup
   ```

2. **Set up new development environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your development values
   ```

3. **Configure GitHub Actions secrets** using `.env.production.example` as reference

4. **Test development:**
   ```bash
   docker compose up -d
   ```

5. **Test production deployment** via GitHub Actions