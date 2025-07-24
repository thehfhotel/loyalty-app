# Production Management Scripts v3.x

This directory contains comprehensive scripts for managing the Loyalty App v3.x production system with Redis sessions, consolidated database schema, and dual-environment OAuth support. These scripts provide a simple, reliable way to start, stop, restart, validate, and backup your production deployment.

## 🚀 Quick Start

### First Time Setup
1. **Validate Environment**: `./scripts/validate-environment.sh`
2. **Build Images**: `./scripts/build-production.sh`
3. **Start Production**: `./scripts/start-production.sh`

### Daily Operations
- **Build**: `./scripts/build-production.sh` (after code changes)
- **Start**: `./scripts/start-production.sh`
- **Stop**: `./scripts/stop-production.sh`
- **Restart**: `./scripts/restart-production.sh`
- **Backup**: `./scripts/backup-production.sh`

## 📋 Available Scripts

### 1. `build-production.sh` ⭐ Updated
**Purpose**: Builds Docker images for v3.x production deployment with latest features

```bash
./scripts/build-production.sh
```

**What it does**:
- 🔍 Runs environment validation before building
- 🧹 Cleans up old images to free space
- 🔨 Builds backend and frontend images with v3.x features
- 🧪 Tests image functionality
- 📋 Lists built images for verification
- ⭐ Shows v3.x feature summary

**Requirements**:
- Docker daemon running
- `.env.production` file (uses .env.example as fallback)

**Output**: Built application images ready for deployment

---

### 2. `validate-environment.sh` ⭐ Enhanced
**Purpose**: Validates v3.x production environment with Redis sessions and consolidated schema

```bash
./scripts/validate-environment.sh
```

**What it checks**:
- ✅ System requirements (Docker, Docker Compose, curl)
- ✅ Project structure and configuration files
- ✅ Environment variables and secrets (including OAuth)
- ✅ **NEW**: Redis connectivity and session store validation
- ✅ **NEW**: Consolidated database schema verification
- ✅ Port availability
- ✅ Docker resources
- ✅ Security configuration (enhanced for v3.x)
- ✅ Network connectivity

**Exit codes**:
- `0`: All validations passed
- `1`: Critical errors found (must fix before starting)

---

### 3. `start-production.sh` ⭐ Enhanced
**Purpose**: Starts v3.x production system with Redis sessions and enhanced health checks

```bash
./scripts/start-production.sh
```

**What it does**:
- 🔍 Pre-flight system checks
- 🛑 Stops any existing containers
- 📥 Pulls latest base images (postgres, redis, nginx)
- ✅ Checks for pre-built application images
- 🚀 Starts all services in production mode
- 🏥 **Enhanced**: Redis session store health checks
- 🏥 **Enhanced**: Database schema validation
- 🏥 Performs comprehensive health checks via nginx proxy
- 📊 Shows system status and resource usage
- ⭐ Displays v3.x features and OAuth endpoints

**Requirements**:
- Pre-built application images (run `build-production.sh` first)
- `.env.production` file must exist
- All ports must be available
- Docker daemon must be running

**Output**: Service status, nginx proxy access URLs, and management commands

**Note**: Now uses pre-built images for faster deployment. Run `build-production.sh` separately when code changes.

---

### 3. `stop-production.sh`
**Purpose**: Gracefully stops the production system

```bash
./scripts/stop-production.sh [OPTIONS]
```

**Options**:
- `--force`: Force stop (kill containers instead of graceful shutdown)
- `--with-volumes`: Remove volumes and ALL data (⚠️ DESTRUCTIVE)

**What it does**:
- 💾 Creates database backup (unless --with-volumes)
- 🛑 Gracefully stops services in reverse dependency order
- 🗑️ Removes containers (optionally volumes)
- 🧹 Cleans up unused Docker resources

**Examples**:
```bash
# Normal graceful stop
./scripts/stop-production.sh

# Force stop (faster but not graceful)
./scripts/stop-production.sh --force

# Stop and delete all data (DANGEROUS!)
./scripts/stop-production.sh --with-volumes
```

---

### 4. `restart-production.sh`
**Purpose**: Safely restarts the production system

```bash
./scripts/restart-production.sh [OPTIONS]
```

**Options**:
- `--force`: Force restart (not graceful)
- `--rebuild`: Rebuild images before restarting
- `--backup`: Create database backup before restart

**What it does**:
- 💾 Creates backup (if --backup)
- 🛑 Stops current system
- 🔨 Rebuilds images (if --rebuild)
- 🚀 Starts system using start script
- 📊 Shows final status

**Examples**:
```bash
# Normal restart
./scripts/restart-production.sh

# Restart with new code changes
./scripts/restart-production.sh --rebuild

# Safe restart with backup
./scripts/restart-production.sh --backup
```

---

### 5. `backup-production.sh`
**Purpose**: Creates comprehensive backups of production data

```bash
./scripts/backup-production.sh [OPTIONS]
```

**Options**:
- `--full`: Full backup including database, config, logs (default)
- `--database-only`: Database backup only
- `--compress`: Compress backup files
- `--backup-dir DIR`: Custom backup directory

**What it backs up**:
- 🗃️ **Database**: Complete PostgreSQL dump
- 🔐 **Configuration**: Docker configs, nginx, env (sanitized)
- 💾 **Redis**: Redis data dump
- 📄 **Files**: Upload files and application data
- 📋 **Logs**: Container logs and system info

**Examples**:
```bash
# Full backup (default)
./scripts/backup-production.sh

# Database only
./scripts/backup-production.sh --database-only

# Compressed full backup
./scripts/backup-production.sh --full --compress

# Custom backup location
./scripts/backup-production.sh --backup-dir /path/to/backups
```

**Backup location**: `./backups/loyalty_backup_YYYYMMDD_HHMMSS/`

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 Loyalty App v3.x Architecture                   │
├─────────────────────────────────────────────────────────────────┤
│                       Nginx Reverse Proxy                       │
│                     Port: 4001 (external)                       │
│                       Port: 80 (internal)                       │
├─────────────────────────┬───────────────────┬───────────────────┤
│    Frontend (React)     │ Backend (Node.js) │  Database (Pg)    │
│    Port: 3000 (int)     │ Port: 4000 (int)  │ Port: 5432 (int)  │
│    Vite dev server      │ Express + OAuth   │ Port: 5434 (ext)  │
├─────────────────────────┴───────────────────┴───────────────────┤
│                  Redis Session Store v3.x                       │
│                   Port: 6379 (internal)                         │
│           Session persistence • No memory leaks                 │
└─────────────────────────────────────────────────────────────────┘

🌐 External Access:
• Application: http://localhost:4001 (nginx → frontend)
• API Endpoints: http://localhost:4001/api/* (nginx → backend)
• OAuth Endpoints: http://localhost:4001/api/oauth/* (Google, LINE, Facebook)
• Database: localhost:5434 (development access only)

🔗 Internal Communication:
• All services communicate via Docker container names
• Nginx routes /api/* to backend:4000
• Frontend proxies to nginx for unified access
• Redis stores sessions with loyalty-app:sess: prefix

🚀 v3.x Enhancements:
• Redis session store replaces MemoryStore (production-ready)
• Consolidated database schema (23 migrations → 1 schema file)
• Dual environment OAuth support (localhost + Cloudflare tunnel)
• Enhanced security and validation
```

---

## ⭐ Version 3.x Features

### 🚀 Major Improvements

**Redis Session Store**
- ✅ **Production Ready**: Eliminates MemoryStore warning and memory leaks
- ✅ **Horizontal Scaling**: Sessions persist across multiple server instances
- ✅ **Session Persistence**: Sessions survive server restarts
- ✅ **Enhanced Security**: Secure cookies, HttpOnly, SameSite protection

**Consolidated Database Schema**
- ✅ **Simplified Deployment**: Single schema file replaces 23 migration files
- ✅ **Faster Setup**: One-command database initialization
- ✅ **Version Control**: Clean schema tracking in `database/schema.sql`
- ✅ **Deployment Guide**: Comprehensive guide in `DATABASE_DEPLOYMENT_GUIDE.md`

**OAuth Dual Environment Support**
- ✅ **Development**: Works with localhost:4001 for local development
- ✅ **Production**: Compatible with Cloudflare tunnel domains
- ✅ **Multi-Provider**: Google, LINE, and Facebook OAuth support
- ✅ **Security**: Enhanced callback URL validation

**Enhanced Scripts & Validation**
- ✅ **Environment Validation**: Comprehensive pre-flight checks
- ✅ **Health Monitoring**: Redis, database, and service health checks
- ✅ **Resource Management**: Docker resource monitoring and optimization
- ✅ **Security Checks**: Environment file permissions and security validation

### 📋 Migration from v2.x

If upgrading from a previous version:

1. **Update Dependencies**:
   ```bash
   cd backend
   npm install connect-redis@7.1.1 @types/connect-redis@0.0.23
   ```

2. **Deploy New Database Schema**:
   ```bash
   ./database/deploy-database.sh
   ```

3. **Update Environment Files**:
   - Add Redis configuration to `.env.production`
   - Verify OAuth callback URLs use port 4001

4. **Rebuild and Restart**:
   ```bash
   ./scripts/build-production.sh
   ./scripts/restart-production.sh
   ```

---

## 🔧 Configuration Files

### Environment Files
- **`.env.production.example`**: Template for production configuration
- **`.env.production`**: Your actual production secrets (create this!)

### Docker Configuration
- **`docker-compose.yml`**: Base service definitions
- **`docker-compose.prod.yml`**: Production overrides

### Script Configuration
All scripts automatically detect and use the correct configuration files.

---

## 🚨 Common Workflows

### Initial Production Deployment
```bash
# 1. Validate environment
./scripts/validate-environment.sh

# 2. Create production environment file
cp .env.production.example .env.production
# Edit .env.production with your values

# 3. Start production system
./scripts/start-production.sh
```

### Regular Maintenance
```bash
# Daily backup
./scripts/backup-production.sh --compress

# Restart with latest changes
./scripts/restart-production.sh --rebuild --backup

# Health check
./scripts/validate-environment.sh
```

### Troubleshooting
```bash
# Check system status
docker compose ps

# View logs
docker compose logs -f [service]

# Restart specific service
docker compose restart [service]

# Full system restart
./scripts/restart-production.sh --force
```

### Emergency Recovery
```bash
# Stop everything
./scripts/stop-production.sh --force

# Restore from backup
tar xzf backups/loyalty_backup_YYYYMMDD_HHMMSS.tar.gz
docker compose exec -T postgres psql -U loyalty -d loyalty_db < backup/database_*.sql

# Start system
./scripts/start-production.sh
```

---

## 🔒 Security Best Practices

### Environment Security
- ✅ Set `.env.production` permissions: `chmod 600 .env.production`
- ✅ Use strong, unique secrets for all JWT and session keys
- ✅ Change default admin credentials
- ✅ Configure OAuth providers with production URLs

### Backup Security
- ✅ Backups exclude sensitive environment variables
- ✅ Store backups in secure, encrypted location
- ✅ Regularly test backup restoration
- ✅ Implement backup retention policy

### Network Security
- ✅ Production removes database port exposure
- ✅ Use Cloudflare Zero Trust for external access
- ✅ Configure proper firewall rules
- ✅ Enable proper CORS settings

---

## 🐛 Troubleshooting

### Common Issues

**Error: "Port already in use"**
```bash
# Find what's using the port
sudo netstat -tlnp | grep :4001

# Stop conflicting service or use different port
```

**Error: "Docker daemon not running"**
```bash
# Start Docker
sudo systemctl start docker    # Linux
open -a Docker                 # macOS
```

**Error: "Permission denied"**
```bash
# Make scripts executable
chmod +x scripts/*.sh

# Check Docker permissions
sudo usermod -aG docker $USER
```

**Error: "Environment validation failed"**
```bash
# Run validation to see specific issues
./scripts/validate-environment.sh

# Fix issues and re-run
```

### Log Locations
- **Container Logs**: `docker compose logs [service]`
- **System Logs**: `./backups/*/logs/`
- **Error Logs**: Check individual service logs

### Recovery Procedures
1. **Database Issues**: Restore from backup
2. **Container Issues**: `./scripts/restart-production.sh --rebuild`
3. **Network Issues**: Check port conflicts and Docker networking
4. **Permission Issues**: Check file permissions and Docker group membership

---

## 📞 Support

### Quick Commands Reference
```bash
# System Status
docker compose ps
docker stats --no-stream

# View Logs
docker compose logs -f backend
docker compose logs -f frontend

# Database Access
docker compose exec postgres psql -U loyalty -d loyalty_db

# Manual Container Management
docker compose up -d [service]
docker compose restart [service]
docker compose stop [service]
```

### Health Check URLs
- **Backend Health**: `curl http://localhost:4000/api/health`
- **Frontend**: `curl http://localhost:4001`
- **Database**: `docker compose exec postgres pg_isready -U loyalty`

---

## 🔄 Updates and Maintenance

### Updating the Application
```bash
# Pull latest code
git pull origin main

# Restart with rebuild
./scripts/restart-production.sh --rebuild --backup
```

### Regular Maintenance Tasks
- **Daily**: Monitor logs and resource usage
- **Weekly**: Create full backup
- **Monthly**: Clean up old backups and Docker images
- **Quarterly**: Update dependencies and security patches

---

## 📝 Script Development

All scripts follow these conventions:
- ✅ Comprehensive error handling with `set -e`
- ✅ Colored output for better readability
- ✅ Detailed logging with timestamps
- ✅ Command-line argument parsing
- ✅ Help documentation (`--help`)
- ✅ Exit codes for automation
- ✅ Safety checks and confirmations