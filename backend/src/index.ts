import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import passport from 'passport';
import session from 'express-session';
import RedisStore from 'connect-redis';
import { createServer } from 'http';

// Load environment variables first
dotenv.config();

// Import environment validation (will validate and exit if invalid)
import { serverConfig, isProduction } from './config/environment';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { 
  securityHeaders, 
  customSecurityHeaders, 
  createRateLimiter, 
  createApiRateLimiter, 
  createUserRateLimiter,
  createAuthRateLimiter,
  inputSanitization,
  securityMonitoring,
  productionSecurity
} from './middleware/security';
import { connectDatabase } from './config/database';
import { connectRedis, getRedisClient } from './config/redis';
import { seedSurveys } from './utils/seedDatabase';
import { initializeStorage } from './config/storage';
import { StorageService } from './services/storageService';
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import oauthRoutes from './routes/oauth';
import loyaltyRoutes from './routes/loyalty';
import couponRoutes from './routes/coupon';
import surveyRoutes from './routes/survey';
import storageRoutes from './routes/storage';
import membershipRoutes from './routes/membership';
import translationRoutes from './routes/translation';
import notificationRoutes from './routes/notifications';
import analyticsRoutes from './routes/analyticsRoutes';
// Import and initialize OAuth service to register strategies
import './services/oauthService';
import { oauthCleanupService } from './services/oauthCleanupService';

// tRPC imports
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { createContext } from './trpc/context';
import { appRouter } from './trpc/routers/_app';

const app = express();
const httpServer = createServer(app);
const PORT = serverConfig.port;

// Trust proxy headers (required for Cloudflare and other reverse proxies)
// Set to 1 to trust first proxy (Cloudflare Tunnel)
app.set('trust proxy', 1);

// Security middleware - Apply production security checks first
if (isProduction()) {
  app.use(productionSecurity);
}

// Security monitoring for all requests
app.use(securityMonitoring);

// Input sanitization middleware
app.use(inputSanitization);

// Custom security headers
app.use(customSecurityHeaders);

// Rate limiting middleware
const generalRateLimit = createRateLimiter();
app.use(generalRateLimit);

// OAuth-friendly security headers configuration
app.use((req, res, next) => {
  // Skip strict security headers for OAuth endpoints
  if (req.path.startsWith('/api/oauth/')) {
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginOpenerPolicy: false, // Disable COOP for OAuth redirects
      contentSecurityPolicy: false, // Disable CSP for OAuth redirects
    })(req, res, next);
  } else {
    // Use our security headers middleware instead of inline helmet
    securityHeaders(req, res, next);
  }
});
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:4001',
      'http://127.0.0.1:4001',
      // Allow any IP address on port 4001 for local network access
      /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:4001$/,
      /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:4001$/,
      /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}:4001$/,
    ];
    
    // If FRONTEND_URL is set, use it as the primary origin
    if (process.env.FRONTEND_URL) {
      allowedOrigins.unshift(process.env.FRONTEND_URL);
    }
    
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return origin === allowedOrigin;
      } else {
        return allowedOrigin.test(origin);
      }
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files for avatars
app.use('/storage', express.static('storage'));

// Session configuration function that creates store based on Redis availability
const createSessionConfig = (req?: express.Request) => {
  // Determine if connection is secure (works with proxies like Cloudflare)
  const isSecure = process.env.NODE_ENV === 'production' && 
    (req ? req.get('X-Forwarded-Proto') === 'https' : true);
  
  const baseConfig = {
    secret: process.env.SESSION_SECRET ?? 'your-session-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    name: 'loyalty-session-id',
    proxy: process.env.NODE_ENV === 'production', // Trust proxy
    cookie: {
      secure: isSecure,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax' as const,
      // Ensure cookies work with proxy
      ...(process.env.NODE_ENV === 'production' && {
        domain: process.env.COOKIE_DOMAIN ?? undefined // Allow setting specific domain if needed
      })
    }
  };

  // Try to use Redis store if available
  try {
    const redisClient = getRedisClient();
    if (redisClient && redisClient.isReady) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const redisStore = new (RedisStore as any)({
        client: redisClient,
        prefix: 'loyalty-app:sess:'
      });
      return { ...baseConfig, store: redisStore };
    }
  } catch {
    logger.warn('Redis not available for session store, using MemoryStore');
  }

  return baseConfig;
};

// Configure session middleware with dynamic secure detection
app.use((req, res, next) => {
  const sessionConfig = createSessionConfig(req);
  session(sessionConfig)(req, res, next);
});

// Initialize Passport after session configuration
app.use(passport.initialize());
app.use(passport.session());

app.use(requestLogger);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Comprehensive API health check endpoint
app.get('/api/health', async (_req, res) => {
  try {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '3.1.1',
      environment: process.env.NODE_ENV ?? 'development',
      services: {
        database: 'unknown',
        redis: 'unknown',
        storage: 'unknown'
      },
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      }
    };

    // Check database connectivity
    try {
      const { query } = await import('./config/database');
      await query('SELECT 1 as health_check');
      healthStatus.services.database = 'healthy';
    } catch (error) {
      healthStatus.services.database = 'unhealthy';
      healthStatus.status = 'degraded';
      logger.warn('Database health check failed:', error);
    }

    // Check Redis connectivity
    try {
      const redisClient = getRedisClient();
      if (redisClient && redisClient.isReady) {
        await redisClient.ping();
        healthStatus.services.redis = 'healthy';
      } else {
        healthStatus.services.redis = 'disconnected';
        healthStatus.status = 'degraded';
      }
    } catch (error) {
      healthStatus.services.redis = 'unhealthy';
      healthStatus.status = 'degraded';
      logger.warn('Redis health check failed:', error);
    }

    // Check storage service
    try {
      // Storage service is initialized during startup, mark as healthy if server is running
      healthStatus.services.storage = 'healthy';
    } catch (error) {
      healthStatus.services.storage = 'unavailable';
      logger.warn('Storage health check failed:', error);
    }

    // Determine overall status code
    const statusCode = healthStatus.status === 'healthy' ? 200 : 
                      healthStatus.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json(healthStatus);
  } catch (error) {
    logger.error('Health check endpoint failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      uptime: process.uptime()
    });
  }
});

// API Routes with layered rate limiting
const apiRateLimit = createApiRateLimiter(); // IP-based with user awareness
const userRateLimit = createUserRateLimiter(); // Per-user rate limiting
const authRateLimit = createAuthRateLimiter(); // Authentication rate limiting

// Auth routes with strict rate limiting
app.use('/api/auth', authRateLimit, authRoutes);

// Other API routes with layered rate limiting (IP + User-based)
app.use('/api/users', apiRateLimit, userRateLimit, userRoutes);
app.use('/api/oauth', oauthRoutes); // OAuth routes don't need extra rate limiting
app.use('/api/loyalty', apiRateLimit, userRateLimit, loyaltyRoutes);
app.use('/api/coupons', apiRateLimit, userRateLimit, couponRoutes);
app.use('/api/surveys', apiRateLimit, userRateLimit, surveyRoutes);
app.use('/api/storage', apiRateLimit, storageRoutes); // File uploads use IP-based only
app.use('/api/membership', apiRateLimit, userRateLimit, membershipRoutes);
app.use('/api/translation', apiRateLimit, translationRoutes); // Public translations use IP-based only
app.use('/api/notifications', apiRateLimit, userRateLimit, notificationRoutes);
app.use('/api/analytics', apiRateLimit, userRateLimit, analyticsRoutes);

// tRPC endpoint - Type-safe API with end-to-end type safety
app.use(
  '/api/trpc',
  apiRateLimit,
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
async function startServer() {
  try {
    // Connect to databases
    await connectDatabase();
    await connectRedis();
    
    // Reconfigure session middleware with Redis store now that it's available
    const redisClient = getRedisClient();
    if (redisClient && redisClient.isReady) {
      logger.info('Upgrading session store to use Redis');
      // Note: The session middleware is already configured above. 
      // In production, we would restart the app to use Redis from the start.
    } else {
      logger.warn('Redis not ready, sessions will use MemoryStore');
    }

    // Initialize storage directories and services
    await initializeStorage();
    StorageService.initialize();

    // Seed database with sample surveys only in development
    if (process.env.NODE_ENV === 'development') {
      await seedSurveys();
    }

    // Start OAuth state cleanup service
    oauthCleanupService.start();

    httpServer.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
      logger.info('Backend server initialized with storage, survey data, and OAuth state cleanup');
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  httpServer.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

startServer();