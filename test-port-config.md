# Port Configuration Test Plan

## Expected Behavior After Port Change

### Docker Configuration
- **Host Port**: 4001 (external access)
- **Container Port**: 3000 (internal frontend container)
- **Port Mapping**: `4001:3000` in docker compose.yml

### Access Points
- **Frontend**: http://localhost:4001 (from host machine)
- **Backend API**: http://localhost:4000 (unchanged)
- **Internal Container Communication**: frontend:3000 (nginx config)

### Test Steps

1. **Build and Start Services**
   ```bash
   docker compose down
   docker compose build frontend
   docker compose up -d
   ```

2. **Verify Port Mapping**
   ```bash
   docker compose ps
   # Should show: loyalty_frontend ... 0.0.0.0:4001->3000/tcp
   ```

3. **Test Frontend Access**
   ```bash
   curl -I http://localhost:4001
   # Should return 200 OK with HTML content
   ```

4. **Test API Access Through Frontend**
   ```bash
   curl -I http://localhost:4001/api/health
   # Should return backend health check response
   ```

5. **Verify OAuth Redirects**
   - Check that OAuth providers redirect to correct URLs
   - Test login/logout flows work with new port

## Files Changed

### Configuration Files
- ✅ `docker compose.yml` - Updated port mapping and FRONTEND_URL default
- ✅ `docker compose.prod.yml` - Updated nginx port mapping
- ✅ `frontend/vite.config.ts` - Kept internal port as 3000
- ✅ `frontend/Dockerfile` - Kept internal port as 3000
- ✅ `.env.production.example` - Updated FRONTEND_PORT and Cloudflare tunnel config

### Code Files
- ✅ `backend/src/routes/oauth.ts` - Updated all localhost:3000 fallbacks
- ✅ `backend/src/index.ts` - Updated CORS origin fallback

### Documentation Files
- ✅ `README.md` - Updated frontend URL references
- ✅ `DEPLOYMENT.md` - Updated all port references
- ✅ `docs/FACEBOOK_OAUTH_SETUP.md` - Updated test URLs
- ✅ `docs/GOOGLE_OAUTH_SETUP.md` - Updated test URLs
- ✅ `docs/LINE_OAUTH_SETUP.md` - Updated test URLs
- ✅ `docs/planning/IMPLEMENTATION_PLAN.md` - Updated references

### Configuration Verification
- ✅ Nginx config (`nginx/nginx.conf`) - Correctly points to `frontend:3000` (internal)
- ✅ Docker port mapping - Correctly maps `4001:3000` (host:container)
- ✅ Environment variables - Updated fallback URLs to use port 4001

## Success Criteria
- [ ] Frontend accessible at http://localhost:4001
- [ ] Backend API accessible at http://localhost:4001/api/*
- [ ] OAuth flows work correctly with new port
- [ ] All internal container communication works
- [ ] Production deployment configuration is updated