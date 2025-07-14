# **Hotel Loyalty App - Integration with Existing Cloudflare Tunnel**

## **Overview**

This guide explains how to deploy the Hotel Loyalty App to work with your existing Cloudflare tunnel infrastructure without breaking any current services.

## **Current Infrastructure Analysis**

### **Existing Services on saichon.com:**
- **memos.saichon.com** → 192.168.100.228:5230
- **proxmox.saichon.com** → 192.168.100.6:8006
- **appsmith.saichon.com** → 192.168.100.228:3000
- **metabase.saichon.com** → 192.168.100.228:3000
- **z2m.saichon.com** → 192.168.100.228:8081
- **homeassistant.saichon.com** → 192.168.100.228:8123
- **odoo.saichon.com** → 192.168.100.228:8069
- **seafile.saichon.com** → 192.168.100.228:80
- **order.saichon.com** → 192.168.100.228:3002
- **staff.saichon.com** → 192.168.100.228:4173

### **Tunnel Configuration:**
- **Tunnel ID:** cfaa5422-f0b3-491f-991c-3ca3ebd2c901
- **Network Mode:** Host networking
- **Management:** Cloudflare dashboard (no local config file)
- **Server IP:** 192.168.100.228

## **Modified Port Allocation**

### **Loyalty App Services (Updated to Avoid Conflicts):**
```yaml
PWA Frontend:       3010  # Changed from 3000 (conflicts with appsmith/metabase)
API Gateway:        8000  # No conflict
User Service:       3011  # Changed from 3001
Loyalty Service:    3012  # Changed from 3002 (conflicts with order service)
Campaign Service:   3013  # Changed from 3003
Survey Service:     3014  # Changed from 3004
Coupon Service:     3015  # Changed from 3005
Notification Service: 3016  # Changed from 3006
Analytics Service:  3017  # Changed from 3007
Integration Service: 3018  # Changed from 3008
Monitoring (Grafana): 3019  # Changed from 3009
```

### **Database & Infrastructure:**
```yaml
PostgreSQL:         5432  # No conflict
Redis:             6379  # No conflict
RabbitMQ:          5672  # No conflict
RabbitMQ Management: 15672  # No conflict
Prometheus:        9090  # No conflict
```

## **Cloudflare Dashboard Configuration**

### **Required DNS Records (Add to Cloudflare Dashboard):**

**Option A: Subdomain Approach (Recommended)**
```
loyalty.saichon.com     → 192.168.100.228:3010
api.saichon.com         → 192.168.100.228:8000
monitoring.saichon.com  → 192.168.100.228:3019
```

**Option B: Path-based Approach**
```
saichon.com/loyalty     → 192.168.100.228:3010
saichon.com/api         → 192.168.100.228:8000
saichon.com/monitoring  → 192.168.100.228:3019
```

### **Steps to Add Routes via Cloudflare Dashboard:**

1. **Access Cloudflare Dashboard:**
   - Go to https://dash.cloudflare.com/
   - Select your account/domain

2. **Navigate to Zero Trust:**
   - Click on "Zero Trust" in the left menu
   - Go to "Access" → "Tunnels"
   - Find your tunnel: `cfaa5422-f0b3-491f-991c-3ca3ebd2c901`

3. **Add Public Hostnames:**
   - Click "Configure" on your tunnel
   - Go to "Public Hostnames" tab
   - Click "Add a public hostname"

4. **Add Loyalty App Routes:**
   
   **Route 1: Main App**
   - Subdomain: `loyalty`
   - Domain: `saichon.com`
   - Path: (leave empty)
   - Type: `HTTP`
   - URL: `192.168.100.228:3010`
   
   **Route 2: API Gateway**
   - Subdomain: `api`
   - Domain: `saichon.com`
   - Path: (leave empty)
   - Type: `HTTP`
   - URL: `192.168.100.228:8000`
   
   **Route 3: Monitoring Dashboard**
   - Subdomain: `monitoring`
   - Domain: `saichon.com`
   - Path: (leave empty)
   - Type: `HTTP`
   - URL: `192.168.100.228:3019`

5. **Save Configuration:**
   - Click "Save hostname" for each route
   - The tunnel will automatically update

## **Deployment Steps**

### **Step 1: Pre-deployment Checks**
```bash
# Check for port conflicts
netstat -tuln | grep -E ":(3010|3011|3012|3013|3014|3015|3016|3017|3018|3019|8000)"

# Verify existing services are still running
curl -I http://localhost:3000  # Should return appsmith
curl -I http://localhost:3002  # Should return order service
curl -I http://localhost:4173  # Should return staff service
```

### **Step 2: Deploy Loyalty App**
```bash
# Navigate to loyalty app directory
cd /home/nut/loyalty-app

# Build and start services
docker-compose up -d

# Verify services are running
docker-compose ps
```

### **Step 3: Test Local Services**
```bash
# Test PWA Frontend
curl -I http://localhost:3010

# Test API Gateway
curl -I http://localhost:8000

# Test Grafana
curl -I http://localhost:3019
```

### **Step 4: Configure Cloudflare Routes**
Follow the "Cloudflare Dashboard Configuration" steps above to add the new routes.

### **Step 5: Test External Access**
```bash
# Test through Cloudflare tunnel
curl -I https://loyalty.saichon.com
curl -I https://api.saichon.com
curl -I https://monitoring.saichon.com
```

## **Security Considerations**

### **Firewall Rules (Optional)**
Since you're using Cloudflare's security features, you may want to add these rules:

```yaml
# Add to your Cloudflare dashboard
Rate Limiting:
  - Path: "/api/*"
    Requests: 100/minute
  
  - Path: "/loyalty/*"
    Requests: 200/minute

Access Control:
  - Path: "/monitoring/*"
    Allow: Specific IPs only
  
  - Path: "/api/admin/*"
    Allow: Admin team only
```

### **SSL/TLS Settings**
Your existing SSL settings should work fine:
- Mode: "Full (strict)"
- Min TLS version: 1.2
- TLS 1.3: Enabled

## **Monitoring & Maintenance**

### **Health Checks**
```bash
#!/bin/bash
# Save as: /home/nut/loyalty-app/health-check.sh

echo "Checking loyalty app services..."
docker-compose ps

echo "Checking port availability..."
netstat -tuln | grep -E ":(3010|3011|3012|3013|3014|3015|3016|3017|3018|3019|8000)"

echo "Testing external access..."
curl -s -o /dev/null -w "%{http_code}" https://loyalty.saichon.com
curl -s -o /dev/null -w "%{http_code}" https://api.saichon.com
```

### **Log Monitoring**
```bash
# View loyalty app logs
docker-compose logs -f

# Check Cloudflare tunnel logs
docker logs f448dceda30a

# Monitor for errors
docker-compose logs --tail=100 | grep -i error
```

## **Rollback Plan**

### **If Issues Occur:**

1. **Stop Loyalty App Services:**
   ```bash
   cd /home/nut/loyalty-app
   docker-compose down
   ```

2. **Remove Cloudflare Routes:**
   - Go to Cloudflare Dashboard
   - Delete the loyalty app routes
   - Existing services remain unaffected

3. **Verify Existing Services:**
   ```bash
   curl -I https://appsmith.saichon.com
   curl -I https://order.saichon.com
   curl -I https://staff.saichon.com
   ```

## **Integration with Existing Services**

### **Database Connectivity**
The loyalty app uses its own PostgreSQL instance to avoid conflicts with your existing databases.

### **Network Isolation**
Services run on the `loyalty-network` Docker network, isolated from your existing services.

### **Resource Management**
Monitor resource usage:
```bash
# Check Docker resource usage
docker stats

# Check system resources
htop
df -h
```

## **Future Considerations**

### **Scaling**
- Add load balancer for high availability
- Implement service mesh for better service communication
- Consider container orchestration with Kubernetes

### **Backup Strategy**
- Regular database backups
- Docker volume backups
- Cloudflare configuration backups

### **Monitoring Enhancement**
- Set up alerts for service downtime
- Monitor API response times
- Track user engagement metrics

## **Troubleshooting**

### **Common Issues:**

**Port Conflicts:**
```bash
# Find what's using a port
sudo lsof -i :3010
sudo netstat -tulpn | grep :3010
```

**DNS Resolution:**
```bash
# Test DNS resolution
nslookup loyalty.saichon.com
dig loyalty.saichon.com
```

**SSL Certificate Issues:**
```bash
# Check SSL certificate
openssl s_client -connect loyalty.saichon.com:443
```

**Service Health:**
```bash
# Check service health
curl -f https://loyalty.saichon.com/health
curl -f https://api.saichon.com/health
```

## **Support**

### **Service URLs:**
- **Main App:** https://loyalty.saichon.com
- **API Gateway:** https://api.saichon.com
- **Monitoring:** https://monitoring.saichon.com
- **API Documentation:** https://api.saichon.com/docs

### **Log Locations:**
- **Docker Logs:** `docker-compose logs [service-name]`
- **Cloudflare Tunnel:** `docker logs f448dceda30a`
- **System Logs:** `/var/log/docker/`

---

**Note:** This deployment strategy ensures zero disruption to your existing services while providing a robust foundation for the Hotel Loyalty App.