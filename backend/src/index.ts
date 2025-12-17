import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import passport from 'passport';
import session from 'express-session';
import cookieParser from 'cookie-parser';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const connectRedisModule = require('connect-redis');
const RedisStore = connectRedisModule.RedisStore ?? connectRedisModule.default?.RedisStore ?? connectRedisModule;
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
import { csrfProtection, getCsrfToken } from './middleware/csrf';
import { connectDatabase } from './config/database';
import { connectRedis, getRedisClient } from './config/redis';
import { seedMembershipSequence, seedTiers, seedSurveys, seedE2ETestUser } from './utils/seedDatabase';
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

// Initialize Redis connection first before any app configuration
async function initializeRedis() {
  try {
    await connectRedis();
    const redisClient = getRedisClient();
    if (redisClient && redisClient.isReady) {
      logger.info('Redis connected successfully - session store will use Redis');
      return true;
    } else {
      logger.warn('Redis connection failed - session store will use MemoryStore');
      return false;
    }
  } catch (error) {
    logger.warn('Redis initialization failed, falling back to MemoryStore for sessions:', error);
    return false;
  }
}

// Create Express app after Redis is initialized
function createApp(redisAvailable: boolean) {
  const app = express();

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
        // Use relaxed CSP for OAuth instead of disabling completely
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            formAction: ["'self'", "https://accounts.google.com", "https://access.line.me"],
            frameAncestors: ["'self'"],
            // Allow OAuth provider redirects
            connectSrc: ["'self'", "https://accounts.google.com", "https://api.line.me"],
          },
        },
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
        // Production port (4001)
        'http://localhost:4001',
        'http://127.0.0.1:4001',
        /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:4001$/,
        /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:4001$/,
        /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}:4001$/,
        // Development port (5001)
        'http://localhost:5001',
        'http://127.0.0.1:5001',
        /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:5001$/,
        /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:5001$/,
        /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}:5001$/,
      ];

      // If FRONTEND_URL is set, use it as the primary origin
      if (process.env.FRONTEND_URL) {
        try {
          const frontendUrl = new URL(process.env.FRONTEND_URL);
          // Always allow the exact origin from env
          allowedOrigins.unshift(frontendUrl.origin);

          // Also allow the same host with the opposite protocol to avoid CORS issues
          // when accessing via HTTPS behind a proxy while env is HTTP (or vice versa).
          const altProtocol = frontendUrl.protocol === 'https:' ? 'http:' : 'https:';
          const altOrigin = `${altProtocol}//${frontendUrl.host}`;
          allowedOrigins.push(altOrigin);
        } catch (error) {
          logger.warn('Invalid FRONTEND_URL provided, skipping CORS allowlist entry:', process.env.FRONTEND_URL, error);
        }
      }

      // Parse CORS_ORIGINS env var (comma-separated list of allowed origins)
      if (process.env.CORS_ORIGINS) {
        const customOrigins = process.env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);
        allowedOrigins.push(...customOrigins);
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
  app.use(cookieParser());

  // Serve static files for avatars
  app.use('/storage', express.static('storage'));

  // Determine if cookies should be secure (HTTPS only)
  // SECURITY: Defaults to secure=true unless explicitly in development/test
  // This is a security-critical setting; secure cookies prevent session hijacking via MITM
  //
  // CodeQL Note: This function can return false for development/test environments.
  // This is INTENTIONAL for local development without HTTPS. The security model is:
  // 1. NODE_ENV must be EXPLICITLY set to 'development' or 'test' to allow insecure cookies
  // 2. Default (unset NODE_ENV) = 'production' = secure cookies REQUIRED
  // 3. Production deployments MUST use HTTPS - enforced by productionSecurity middleware
  const shouldUseSecureCookies = (): boolean => {
    const nodeEnv = process.env.NODE_ENV ?? 'production'; // Default to production for safety
    const allowInsecureCookies = ['development', 'test'].includes(nodeEnv);
    return !allowInsecureCookies;
  };

  // Session configuration function that creates store based on Redis availability
  const createSessionConfig = () => {
    const nodeEnv = process.env.NODE_ENV ?? 'production';
    const isProductionEnv = nodeEnv === 'production';

    // SECURITY: Cookies MUST be secure in production to prevent transmission over HTTP
    // Only allow insecure cookies in explicit development/test environments for local testing
    // This is a security-critical setting - secure:true prevents cookie theft via MITM attacks
    const useSecureCookies = shouldUseSecureCookies();

    if (!useSecureCookies) {
      logger.warn('SECURITY: Running with insecure cookies (secure=false) - only acceptable for local development');
    }

    const baseConfig = {
      secret: process.env.SESSION_SECRET ?? 'your-session-secret-change-in-production',
      resave: false,
      saveUninitialized: false,
      name: 'loyalty-session-id',
      proxy: isProductionEnv, // Trust proxy (required for secure cookies behind reverse proxy)
      cookie: {
        // SECURITY: Always require HTTPS in production for cookie transmission
        // This prevents session hijacking via network interception
        secure: useSecureCookies,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax' as const,
        // Ensure cookies work with proxy
        ...(isProductionEnv && {
          domain: process.env.COOKIE_DOMAIN ?? undefined // Allow setting specific domain if needed
        })
      }
    };

    // Use Redis store if available (Redis was already initialized)
    if (redisAvailable) {
      try {
        const redisClient = getRedisClient();
        if (redisClient && redisClient.isReady) {
          // Use connect-redis v7+ syntax (named export, direct instantiation)
          const redisStore = new RedisStore({
            client: redisClient,
            prefix: 'loyalty-app:sess:'
          });
          return { ...baseConfig, store: redisStore };
        }
      } catch (error) {
        logger.warn('Error creating Redis session store, falling back to MemoryStore:', error);
      }
    } else {
      logger.info('Redis not available for session store, using MemoryStore');
    }

    return baseConfig;
  };

  // Configure session middleware
  const sessionConfig = createSessionConfig();
  app.use(session(sessionConfig));

  // Initialize Passport after session configuration
  app.use(passport.initialize());
  app.use(passport.session());

  // CSRF protection - skip for health checks, OAuth, auth routes, and CSRF token endpoint
  // Auth routes (login/register/logout) don't need CSRF because:
  // - Login/register: user isn't authenticated yet (no session to hijack)
  // - Logout: uses refresh token validation, not session cookie
  // - CSRF token endpoint: needs to generate its own token without interference
  app.use((req, res, next) => {
    if (
      req.path === '/health' ||
      req.path === '/api/health' ||
      req.path === '/api/csrf-token' ||
      req.path.startsWith('/api/oauth/') ||
      req.path.startsWith('/api/auth/')
    ) {
      return next();
    }
    csrfProtection(req, res, next);
  });

  app.use(requestLogger);

  return app;
}

// Configure routes and middleware for the app
function configureApp(app: express.Express) {
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

  // CSRF token endpoint - allows frontend to fetch token for subsequent requests
  app.get('/api/csrf-token', getCsrfToken);

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
}

const PORT = serverConfig.port;

// Start server
async function startServer() {
  try {
    logger.info('🔄 Initializing Redis connection first...');
    const redisAvailable = await initializeRedis();

    logger.info('🔗 Connecting to database...');
    await connectDatabase();

    logger.info('📦 Creating Express app with proper Redis session store...');
    const app = createApp(redisAvailable);

    logger.info('🛣️  Configuring routes and middleware...');
    configureApp(app);

    const httpServer = createServer(app);

    logger.info('📁 Initializing storage directories and services...');
    await initializeStorage();
    StorageService.initialize();

    // Seed essential database data (runs in ALL environments)
    // These are required for core functionality and must always be present
    logger.info('🌱 Initializing essential database data...');
    await seedMembershipSequence(); // Required: User registration needs membership ID generation
    await seedTiers();              // Required: Loyalty system needs tier definitions
    logger.info('✅ Essential database data initialized');

    // Seed sample data (development only)
    if (process.env.NODE_ENV === 'development') {
      logger.info('🌱 Seeding sample data for development...');
      await seedE2ETestUser(); // E2E browser test user
      await seedSurveys(); // Optional: Sample surveys for testing
      logger.info('✅ Sample data seeded');
      // Note: Admin users register normally and get auto-upgraded on login
    }

    // Start OAuth state cleanup service
    oauthCleanupService.start();

    httpServer.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
      logger.info(`Session store: ${redisAvailable ? 'Redis' : 'MemoryStore'}`);
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
  process.exit(0);
});

startServer();
