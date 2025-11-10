# Workflow Failure Analysis - Run #19244041704

## Executive Summary

The CI/CD workflow failed due to a fundamental architectural mismatch between the workspace artifact strategy and local cache restoration logic. Three jobs failed with identical root causes.

## Failed Jobs

1. **🔒 Security & Code Quality** - TypeScript typecheck (`npm: command not found`)
2. **🧪 Unit & Integration Tests** - Cache restoration (`Backend cache not found`)
3. **🎭 E2E Tests** - Cache restoration (`Backend cache not found`)

## Root Cause Analysis

### Issue 1: Working Directory Mismatch

**Problem:**
- Prepare-workspace job runs in: `/home/nut/loyalty-app` (DEPLOY_PATH)
- Other jobs download artifact to: `/tmp/github-runner-work/loyalty-app/loyalty-app`
- Cache restoration attempts to copy FROM `/home/nut/.cache/loyalty-app`
- But working directory is `/tmp/github-runner-work/loyalty-app/loyalty-app`

**Why This Fails:**
```bash
# In Security/Test jobs, working directory is:
pwd → /tmp/github-runner-work/loyalty-app/loyalty-app

# Cache restoration tries:
cp -r /home/nut/.cache/loyalty-app/backend/node_modules backend/

# This copies TO: /tmp/github-runner-work/loyalty-app/loyalty-app/backend/
# But the cache exists at: /home/nut/.cache/loyalty-app/backend/node_modules ✅

# The copy SUCCEEDS but npm is not in PATH for the downloaded workspace
```

### Issue 2: Node.js/npm Not in PATH

**Problem:**
```
/tmp/github-runner-work/_temp/e7faf4e3-2c10-4ed2-8720-144b50406c6b.sh: line 1: npm: command not found
```

**Root Cause:**
- The `prepare-workspace` job has `actions/setup-node@v4` which sets up Node.js
- Other jobs download the artifact but DO NOT run `actions/setup-node@v4`
- Without Node.js setup, `npm` command is not available in PATH

**Evidence:**
```yaml
# prepare-workspace has:
- name: "⚡ Setup Node.js"
  uses: actions/setup-node@v4
  with:
    node-version: ${{ env.NODE_VERSION }}

# security-analysis, unit-tests, e2e-tests DO NOT have this step
```

### Issue 3: Architecture Design Flaw

**Current Design:**
1. Prepare workspace: Install dependencies, create artifact (excludes node_modules)
2. Other jobs: Download artifact, restore node_modules from local cache
3. Run commands that need npm/node

**Why It Fails:**
- Artifact download creates a fresh workspace without Node.js environment
- Local cache restoration assumes Node.js is already set up
- Commands fail because npm/node are not in PATH

## Failure Timeline

### Workflow Execution Flow

```
20:01:32 - prepare-workspace starts
20:01:45 - Node.js setup completed (npm available)
20:02:15 - Dependencies installed and cached
20:02:44 - Workspace artifact uploaded (61MB)

20:02:49 - unit-tests downloads artifact (40s)
20:02:56 - security-analysis downloads artifact (43s)
20:04:00 - e2e-tests downloads artifact (30s)

20:03:33 - unit-tests cache restoration FAILS ❌
20:03:39 - security-analysis cache restoration succeeds BUT
20:03:44 - security-analysis TypeScript check FAILS (npm: command not found) ❌
20:04:30 - e2e-tests cache restoration FAILS ❌
```

### Why Cache Restoration "Fails" Sometimes

Looking at the logs more carefully:

**Security-analysis:**
- Cache restoration step shows: "❌ Backend cache not found" BUT exits with code 0 (success)
- Wait, no - the security job logs show it PASSED cache restoration
- Then failed on npm command

**Unit-tests and E2E-tests:**
- Cache restoration exits with code 1
- These jobs fail immediately at cache restoration

This suggests a **race condition or timing issue** where:
1. Some jobs complete artifact download before cache is ready
2. Or the cache check happens too fast after artifact extraction

## Solution Architecture

### Option 1: Add Node.js Setup to Each Job (RECOMMENDED)

**Pros:**
- Simple, explicit, follows GitHub Actions best practices
- Each job is self-contained
- No dependency on filesystem state

**Cons:**
- Slightly slower (5-10s per job)
- Node.js setup happens multiple times

**Implementation:**
```yaml
security-analysis:
  steps:
    - name: "📥 Download shared workspace"
      uses: actions/download-artifact@v4

    - name: "⚡ Setup Node.js"  # ADD THIS
      uses: actions/setup-node@v4
      with:
        node-version: ${{ env.NODE_VERSION }}

    - name: "♻️ Restore dependencies from local cache"
      # ... rest of steps
```

### Option 2: Use Artifact to Distribute node_modules (NOT RECOMMENDED)

**Pros:**
- Single source of truth for dependencies

**Cons:**
- Artifacts become huge (300MB+)
- Upload/download times become bottleneck
- Defeats the purpose of local caching strategy

### Option 3: Hybrid Approach - Setup Node Then Cache

**Pros:**
- Fast for cache hits
- Falls back to npm ci for cache misses

**Cons:**
- More complex logic
- Still needs Node.js setup in each job

**Implementation:**
```yaml
- name: "⚡ Setup Node.js"
  uses: actions/setup-node@v4
  with:
    node-version: ${{ env.NODE_VERSION }}

- name: "♻️ Restore dependencies from local cache"
  run: |
    LOCAL_CACHE_BASE="/home/nut/.cache/loyalty-app"

    if [ -d "$LOCAL_CACHE_BASE/backend/node_modules" ]; then
      cp -r "$LOCAL_CACHE_BASE/backend/node_modules" backend/
      echo "✅ Cache restored"
    else
      echo "⚠️ Cache miss, installing..."
      cd backend && npm ci
    fi
```

## Recommended Fix

### Phase 1: Add Node.js Setup (IMMEDIATE)

Add `actions/setup-node@v4` to all jobs that need npm:
- security-analysis
- unit-tests
- e2e-tests
- build-validation (if it runs npm commands)

### Phase 2: Improve Cache Strategy (OPTIONAL)

Make cache restoration more resilient:
```yaml
- name: "♻️ Restore dependencies with fallback"
  run: |
    LOCAL_CACHE_BASE="/home/nut/.cache/loyalty-app"

    # Try cache first
    CACHE_SUCCESS=false
    if [ -d "$LOCAL_CACHE_BASE/backend/node_modules" ]; then
      echo "♻️ Restoring from cache..."
      cp -r "$LOCAL_CACHE_BASE/backend/node_modules" backend/ && CACHE_SUCCESS=true
    fi

    # Fallback to npm ci if cache failed
    if [ "$CACHE_SUCCESS" = false ]; then
      echo "⚠️ Cache unavailable, installing dependencies..."
      cd backend && npm ci --prefer-offline
    fi
```

## Impact Assessment

### Current State
- ❌ All parallel validation jobs fail
- ❌ No tests run
- ❌ No security checks complete
- ❌ Pipeline blocks deployment

### After Fix
- ✅ Node.js available in all jobs
- ✅ Cache restoration works reliably
- ✅ Fallback to npm ci for cache misses
- ✅ Pipeline completes successfully

## Implementation Priority

1. **CRITICAL (Now):** Add Node.js setup to failing jobs
2. **HIGH (Today):** Add cache fallback logic
3. **MEDIUM (This week):** Optimize cache key invalidation
4. **LOW (Future):** Consider distributed caching solutions

## Testing Plan

1. Apply Node.js setup fix
2. Trigger workflow with: `git commit --allow-empty -m "test: CI fix" && git push`
3. Monitor all three parallel jobs for success
4. Verify cache restoration logic works
5. Check npm command availability

## Related Documentation

- Local Cache Strategy: `.github/workflows/deploy.yml:41-57`
- Artifact Upload: `.github/workflows/deploy.yml:142-153`
- Cache Restoration: `.github/workflows/deploy.yml:175-195`
- Prisma Setup: `claudedocs/PRISMA_SETUP.md`

## Lessons Learned

1. **Artifact-based parallelization requires environment setup in each job**
2. **Local filesystem caching needs consistent working directories**
3. **Self-hosted runners need explicit tool setup even with caching**
4. **Always add fallback logic for cache strategies**
5. **Test workflow changes with cache cold and warm states**

---

**Analysis Date:** 2025-11-10
**Workflow Run:** https://github.com/jwinut/loyalty-app/actions/runs/19244041704
**Analyzed By:** Claude Code Troubleshooting Agent
