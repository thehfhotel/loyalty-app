# CI/CD Pipeline Architecture

## Pipeline Overview

**File**: `.github/workflows/deploy.yml`  
**Type**: GitHub Actions with self-hosted runner  
**Total Duration**: 8-12 minutes  
**Strategy**: 4-phase deployment with parallel execution

## Phase 1: Parallel Validation & Security (3-4 minutes)

### Job 1A: Security Analysis
- ESLint security rules validation
- npm audit (moderate level)
- Custom security validation scripts
- Test integrity validation (no bypassing patterns)
- **Output**: Security passed/failed status

### Job 1B: Unit & Integration Tests
- PostgreSQL test database setup
- Backend unit tests (`npm run test:unit`)
- Backend integration tests (`npm run test:integration`)
- TypeScript compilation validation
- Database schema tests
- **Output**: Tests passed/failed status

### Job 1C: E2E Tests (main branch only)
- Full application E2E testing with Playwright
- OAuth flow validation
- User journey testing
- Cross-browser compatibility
- **Condition**: Only runs on main branch or PRs to main
- **Output**: E2E test results

## Phase 2: Build Validation (2-3 minutes, main branch only)

### Parallel Backend/Frontend Builds
- **Backend Build**:
  - Prisma client generation (`npm run db:generate`)
  - TypeScript compilation
  - Production build validation
  
- **Frontend Build**:
  - Vite production build
  - TypeScript compilation
  - Asset optimization

### Docker Validation
- Container build validation
- Production environment variable checks
- Multi-stage build testing

### Artifact Verification
- Build output validation
- Integrity checks
- Size optimization verification

## Phase 3: Production Deployment (3-5 minutes, main branch only)

### Pre-Deployment Backup
- Automated database backup
- Backup verification
- Timestamp and versioning

### Code Deployment
- Intelligent Git operations with caching
- Optimized dependency installation
- Environment configuration updates
- **Optimization**: Updates existing deployment instead of full rebuild

### Database Migration
- Migration status check
- Rollback safety validation
- Migration execution with Prisma
- Post-migration verification

### Service Deployment
- Docker Compose production deployment
- Container health checks
- Service startup verification
- Zero-downtime deployment strategy

## Phase 4: Post-Deployment Monitoring (<1 minute)

### Health Checks
- Backend API health endpoint validation
- Frontend accessibility check
- Database connection verification
- Redis cache validation

### OAuth Validation
- Google OAuth endpoint check
- LINE OAuth endpoint check
- Redirect URL configuration validation
- Authentication flow integrity

### Database Validation
- Migration status verification
- Rollback safety confirmation
- Schema integrity check
- Connection pool validation

### Smart Cleanup
- Conditional cleanup based on disk usage
- Old backup removal (keeps last 5)
- Docker image cleanup (if >80% disk usage)
- Build artifact cleanup

## Optimization Strategies

### Parallel Execution
- Jobs run simultaneously when possible
- 40-50% faster than sequential execution
- Intelligent dependency management

### Intelligent Caching
- Local npm cache (rsync-based)
- Docker BuildKit layer caching
- Dependency caching with checksums
- Git repository caching

### Conditional Execution
- E2E tests only on main branch/PRs
- Build validation only on main branch
- Deployment only on main branch
- Smart cleanup based on resource usage

### Resource Management
- 10-minute timeout for security analysis
- 30-minute timeout for tests
- 20-minute timeout for build
- 30-minute timeout for deployment

## Pipeline Triggers

### Automatic Triggers
- **Push to main**: Full pipeline with deployment
- **Push to develop**: Validation and testing only (no deployment)
- **Pull Request to main**: Full validation including E2E tests

### Manual Trigger
- `workflow_dispatch`: Manual deployment trigger
- Useful for hotfixes or emergency deployments

## Environment Requirements

### Self-Hosted Runner
- **OS**: Linux (configured in pipeline)
- **Docker**: Latest version with Docker Compose V2
- **Node.js**: Version 18 (configured via environment)
- **Database**: PostgreSQL 15 accessible
- **Cache**: Redis 7 accessible
- **Disk Space**: Monitored and managed automatically

### GitHub Secrets (Production)
- `JWT_SECRET`: JWT signing secret
- `JWT_REFRESH_SECRET`: Refresh token secret
- `SESSION_SECRET`: Session encryption secret
- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret
- `LINE_CHANNEL_ID`: LINE OAuth channel ID
- `LINE_CHANNEL_SECRET`: LINE OAuth channel secret
- `AZURE_TRANSLATION_KEY_1`: Azure Translation API key
- `AZURE_TRANSLATION_KEY_2`: Backup translation key
- `AZURE_TRANSLATION_REGION`: Azure region

### Environment Variables
```yaml
DEPLOY_PATH: /home/nut/loyalty-app
NODE_VERSION: 18
CACHE_VERSION: v1
NODE_ENV: production
FRONTEND_URL: https://your-domain.com
BACKEND_URL: https://your-domain.com/api
```

## Quality Gates

### Pre-Deployment Gates
1. All security checks passed
2. All tests passed (unit + integration + E2E on main)
3. TypeScript compilation successful
4. ESLint validation passed
5. Test integrity validation passed
6. Build artifacts generated successfully

### Deployment Gates
1. Database backup created successfully
2. Pre-deployment validation passed
3. Migration rollback safety confirmed
4. Previous deployment healthy

### Post-Deployment Gates
1. Health checks passed
2. OAuth validation passed
3. Database migration status confirmed
4. Services responding correctly

## Failure Handling

### Security Analysis Failure
- Pipeline stops immediately
- Detailed security report generated
- Deployment blocked until fixed

### Test Failure
- Pipeline stops immediately
- Test results summary provided
- Specific failing tests identified
- Deployment blocked until fixed

### Build Failure
- Pipeline stops immediately
- Build logs captured
- Compilation errors reported
- Deployment blocked until fixed

### Deployment Failure
- Automatic rollback consideration
- Failure logs captured
- Notification sent
- Manual intervention required

## Monitoring & Observability

### Deployment Summaries
- Comprehensive reporting of all pipeline stages
- Detailed timing information
- Resource usage statistics
- Success/failure indicators

### Enhanced Logging
- Detailed diagnostics for troubleshooting
- Step-by-step execution logs
- Error messages with context
- Performance metrics

### Health Dashboards
- Post-deployment service monitoring
- Real-time health status
- OAuth endpoint validation
- Database connection status

### Performance Metrics
- Build times by phase
- Test coverage statistics
- Deployment success rates
- Resource utilization

## Pipeline Files Structure

```
.github/
└── workflows/
    └── deploy.yml       # Single consolidated pipeline
                         # (Replaced old multi-file setup)

scripts/
├── validate-test-integrity.sh      # Test bypassing detection
├── validate-oauth-health.sh        # OAuth endpoint validation
├── validate-db-migration.sh        # Database migration checks
├── migration-rollback-safety.sh    # Rollback safety validation
└── reset-rate-limits.sh           # OAuth rate limit management
```

## Recent Optimizations

### Pipeline Consolidation (January 2025)
- **Before**: 5 separate workflow files
- **After**: Single optimized deploy.yml
- **Benefit**: Reduced complexity, improved maintainability, better parallel execution

### Docker Compose Validation
- Added syntax validation before builds
- Container property validation
- Volume configuration checks
- Port conflict detection

### Prisma Generation Validation
- Mandatory Prisma client generation before builds
- Generation status verification
- Import path validation
- Type generation checks

### E2E Test Improvements
- Non-conflicting port allocation
- Proper container health checks
- State cleanup between runs
- Configuration consistency validation

### Smart Resource Management
- Disk usage monitoring
- Conditional cleanup triggers
- Old backup rotation
- Docker image pruning

## Best Practices

### For Developers
1. Always test locally before pushing
2. Run `npm run quality:check` before committing
3. Never use `--no-verify` flags
4. Monitor pipeline status after pushing
5. Review pipeline logs for any warnings

### For Maintenance
1. Regularly review pipeline performance
2. Update dependencies in workflow
3. Monitor disk space on runner
4. Review and rotate secrets periodically
5. Keep backup retention policy updated

### For Debugging
1. Check pipeline logs first
2. Review specific job failures
3. Test locally with same conditions
4. Verify environment variables
5. Check runner resource availability
