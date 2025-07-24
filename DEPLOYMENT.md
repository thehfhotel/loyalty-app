# Production Deployment Guide - Cloudflare Zero Trust

This guide covers deploying the loyalty app to a production server using Docker Compose and Cloudflare Zero Trust for secure public access.

## Prerequisites

1. **Server Requirements**
   - Linux server with Docker and Docker Compose installed
   - Minimum 2GB RAM, 20GB storage
   - Port 3000 available for Cloudflare tunnel

2. **Cloudflare Requirements**
   - Domain registered with Cloudflare
   - Cloudflare Zero Trust account
   - `cloudflared` daemon installed and configured

3. **OAuth Provider Setup**
   - Google OAuth (Google Cloud Console)
   - Facebook OAuth (Facebook Developer Console)  
   - LINE OAuth (LINE Developer Console)

## Step 1: Server Setup

### 1.1 Clone Repository
```bash
git clone <your-repo-url>
cd loyalty-app
```

### 1.2 Create Production Environment File
```bash
cp .env.production.example .env.production
```

### 1.3 Configure Production Environment
Edit `.env.production` and update all variables:

**Critical Variables to Change:**
```bash
# Your actual domain
DOMAIN=your-domain.com
FRONTEND_URL=https://your-domain.com
BACKEND_URL=https://your-domain.com/api

# Generate strong secrets (use: openssl rand -base64 32)
JWT_SECRET=your-strong-32-char-secret
JWT_REFRESH_SECRET=your-different-32-char-secret
SESSION_SECRET=your-another-32-char-secret

# OAuth callback URLs (must match provider settings)
GOOGLE_CALLBACK_URL=https://your-domain.com/api/oauth/google/callback
FACEBOOK_CALLBACK_URL=https://your-domain.com/api/oauth/facebook/callback
LINE_CALLBACK_URL=https://your-domain.com/api/oauth/line/callback

# Your OAuth credentials
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret
LINE_CHANNEL_ID=your-line-channel-id
LINE_CHANNEL_SECRET=your-line-channel-secret

# Admin credentials (change these!)
LOYALTY_USERNAME=your-admin-email@domain.com
LOYALTY_PASSWORD=your-secure-admin-password
```

## Step 2: OAuth Provider Configuration

### 2.1 Google OAuth Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select project
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `https://your-domain.com/api/oauth/google/callback`

### 2.2 Facebook OAuth Setup
1. Go to [Facebook Developer Console](https://developers.facebook.com/)
2. Create/select app
3. Add Facebook Login product
4. Add Valid OAuth Redirect URI: `https://your-domain.com/api/oauth/facebook/callback`

### 2.3 LINE OAuth Setup
1. Go to [LINE Developer Console](https://developers.line.biz/)
2. Create/select channel
3. Add Callback URL: `https://your-domain.com/api/oauth/line/callback`

## Step 3: Docker Deployment

### 3.1 Production Deployment
```bash
# Use production environment
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml

# Deploy with production settings
docker-compose --env-file .env.production up -d
```

### 3.2 Verify Containers
```bash
# Check all containers are running
docker-compose ps

# Check logs
docker-compose logs -f backend
docker-compose logs -f frontend
```

### 3.3 Run Database Migrations
```bash
# Database migrations run automatically on first startup
# Check backend logs to ensure migrations completed successfully
docker-compose logs backend | grep migration
```

## Step 4: Cloudflare Zero Trust Setup

### 4.1 Install Cloudflared
```bash
# Ubuntu/Debian
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Or use package manager
sudo apt update && sudo apt install cloudflared
```

### 4.2 Authenticate Cloudflared
```bash
cloudflared tunnel login
```

### 4.3 Create Tunnel
```bash
# Create tunnel
cloudflared tunnel create loyalty-app

# Note the tunnel ID returned
```

### 4.4 Configure Tunnel
Create `/etc/cloudflared/config.yml`:
```yaml
tunnel: <your-tunnel-id>
credentials-file: /root/.cloudflared/<your-tunnel-id>.json

ingress:
  - hostname: your-domain.com
    service: http://localhost:3000
  - service: http_status:404
```

### 4.5 Create DNS Record
```bash
# Create DNS record pointing to tunnel
cloudflared tunnel route dns <tunnel-id> your-domain.com
```

### 4.6 Start Tunnel Service
```bash
# Install as system service
sudo cloudflared --config /etc/cloudflared/config.yml service install

# Start service
sudo systemctl start cloudflared
sudo systemctl enable cloudflared

# Check status
sudo systemctl status cloudflared
```

## Step 5: Testing and Verification

### 5.1 Health Checks
```bash
# Test local container access
curl http://localhost:3000

# Test backend API
curl http://localhost:3000/api/health
```

### 5.2 External Access Testing
1. Visit `https://your-domain.com`
2. Test user registration/login
3. Test OAuth providers (Google, Facebook, LINE)
4. Test admin panel access
5. Test loyalty point operations

### 5.3 Database Verification
```bash
# Connect to database
docker-compose exec postgres psql -U loyalty -d loyalty_db

# Check tables
\dt

# Check user data
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM user_loyalty;
```

## Step 6: Monitoring and Maintenance

### 6.1 Log Monitoring
```bash
# Real-time logs
docker-compose logs -f

# Cloudflare tunnel logs
sudo journalctl -u cloudflared -f
```

### 6.2 SSL Certificate
Cloudflare automatically provides SSL certificates for your domain. Ensure:
- SSL/TLS encryption mode is set to "Full (strict)" in Cloudflare dashboard
- Always Use HTTPS is enabled

### 6.3 Backup Strategy
```bash
# Database backup
docker-compose exec postgres pg_dump -U loyalty loyalty_db > backup-$(date +%Y%m%d).sql

# Environment backup (store securely)
cp .env.production .env.production.backup
```

## Troubleshooting

### Common Issues

**1. OAuth Redirect Mismatch**
- Ensure callback URLs in OAuth providers match exactly
- Check protocol (https://) and domain

**2. Database Connection Issues**
```bash
# Check postgres container
docker-compose logs postgres

# Verify database connectivity
docker-compose exec backend node -e "console.log(process.env.DATABASE_URL)"
```

**3. Cloudflare Tunnel Issues**
```bash
# Check tunnel status
cloudflared tunnel info <tunnel-id>

# Restart tunnel service
sudo systemctl restart cloudflared
```

**4. Environment Variable Issues**
```bash
# Check backend environment
docker-compose exec backend env | grep -E "FRONTEND_URL|GOOGLE_|FACEBOOK_|LINE_"

# Check frontend environment
docker-compose exec frontend env | grep VITE_API_URL
```

**5. Port Conflicts**
```bash
# Check port usage
sudo netstat -tlnp | grep :3000

# If port busy, stop conflicting service or change port
```

## Security Considerations

1. **Environment Variables**: Never commit `.env.production` to version control
2. **Database Access**: Database ports are not exposed externally in production
3. **OAuth Secrets**: Store OAuth secrets securely
4. **Admin Credentials**: Use strong admin passwords
5. **Firewall**: Only port 3000 needs to be accessible to Cloudflare
6. **SSL**: All traffic is encrypted via Cloudflare SSL

## Performance Optimization

1. **Resource Limits**: Set appropriate Docker resource limits
2. **Database**: Consider connection pooling for high traffic
3. **Caching**: Redis is configured for session caching
4. **CDN**: Cloudflare provides CDN and caching automatically

## Support

For deployment issues:
1. Check application logs: `docker-compose logs`
2. Check Cloudflare tunnel logs: `sudo journalctl -u cloudflared`
3. Verify environment configuration
4. Test OAuth provider configurations
5. Check database connectivity and migrations