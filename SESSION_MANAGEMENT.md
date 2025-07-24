# Session Management - Redis Store Implementation

## Overview

The loyalty app now uses Redis as the session store instead of the default in-memory store, resolving the production warning and enabling horizontal scaling.

## Implementation Details

### Session Store Configuration

**Before (MemoryStore - Not Production Ready)**:
```javascript
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  // Uses default MemoryStore - causes memory leaks
}));
```

**After (Redis Store - Production Ready)**:
```javascript
import RedisStore from 'connect-redis';

// Configure after Redis connection
const redisClient = getRedisClient();
const redisStore = new RedisStore({
  client: redisClient,
  prefix: 'loyalty-app:sess:'
});

app.use(session({
  store: redisStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'loyalty-session-id',
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'lax' : false
  }
}));
```

### Benefits

1. **Production Ready**: No memory leaks or single-process limitations
2. **Horizontal Scaling**: Sessions persist across multiple server instances
3. **Session Persistence**: Sessions survive server restarts
4. **Performance**: Redis provides fast session lookup and storage
5. **Security**: Enhanced cookie security settings for production

### Session Security Features

- **HttpOnly cookies**: Prevents XSS access to session cookies
- **Secure cookies**: HTTPS-only in production
- **SameSite protection**: CSRF protection in production
- **Custom session name**: Obscures default session identifier
- **Session prefix**: Organized Redis key namespace

### Dependencies Added

```json
{
  "dependencies": {
    "connect-redis": "^7.1.1",
    "@types/connect-redis": "^0.0.23"
  }
}
```

## Redis Configuration

The app uses the existing Redis connection configured in `backend/src/config/redis.ts`:

```typescript
export async function connectRedis(): Promise<void> {
  redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });
  await redisClient.connect();
}
```

### Environment Variables

- `REDIS_URL`: Redis connection string (default: `redis://localhost:6379`)
- `SESSION_SECRET`: Secret key for session signing (required)

## Session Storage

Sessions are stored in Redis with the prefix `loyalty-app:sess:` followed by the session ID:

```
loyalty-app:sess:abc123def456... (session data)
```

## Development vs Production

### Development
- Redis runs in Docker container (port 6379)
- Sessions use HTTP cookies
- Less restrictive CORS and sameSite settings

### Production
- Redis should be a dedicated instance or cluster
- Sessions use HTTPS-only secure cookies
- Strict CORS and sameSite settings
- Consider Redis persistence and backup strategies

## Monitoring

### Session Health Check

You can monitor session storage by checking Redis:

```bash
# Connect to Redis container
docker compose exec redis redis-cli

# List all session keys
KEYS "loyalty-app:sess:*"

# View session data (replace with actual session ID)
GET "loyalty-app:sess:session-id-here"
```

### Metrics to Monitor

1. **Active Sessions**: Number of active session keys in Redis
2. **Session Duration**: Average session lifetime
3. **Redis Memory Usage**: Memory consumed by session data
4. **Session Creation Rate**: New sessions per minute/hour

## Scaling Considerations

### Multiple Server Instances

With Redis sessions, you can now run multiple backend instances:

```yaml
# docker-compose.prod.yml
services:
  backend:
    deploy:
      replicas: 3  # Run 3 backend instances
    # All instances share the same Redis store
```

### Redis High Availability

For production, consider:

1. **Redis Cluster**: Multiple Redis nodes for high availability
2. **Redis Sentinel**: Automatic failover
3. **Persistent Storage**: Redis persistence (RDB/AOF)
4. **Monitoring**: Redis monitoring and alerting

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   ```
   Error: Redis connection failed
   ```
   - Check `REDIS_URL` environment variable
   - Ensure Redis server is running
   - Verify network connectivity

2. **Session Not Persisting**
   ```
   Sessions lost after server restart
   ```
   - Verify Redis is running and accessible
   - Check session configuration in startup logs
   - Ensure `connect-redis` is properly installed

3. **Cookie Issues**
   ```
   Session cookies not working
   ```
   - Check `secure` cookie setting matches HTTP/HTTPS
   - Verify `sameSite` settings for cross-origin requests
   - Ensure session secret is set

### Debug Session Storage

```bash
# Check if sessions are being created
docker compose exec redis redis-cli MONITOR

# In another terminal, make requests that should create sessions
curl -c cookies.txt http://localhost:4001/api/oauth/google

# Watch Redis commands in the monitor output
```

## Future Enhancements

1. **Session Analytics**: Track session patterns and user behavior
2. **Session Compression**: Compress session data for large payloads
3. **Session Cleanup**: Automated cleanup of expired sessions
4. **Session Encryption**: Encrypt sensitive session data
5. **Multi-tenant Sessions**: Separate session namespaces per tenant

---

**Result**: The loyalty app now supports multiple concurrent users without memory leaks and can scale horizontally across multiple server instances.