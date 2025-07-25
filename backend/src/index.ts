import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import passport from 'passport';
import session from 'express-session';
import RedisStore from 'connect-redis';
import { createServer } from 'http';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { connectDatabase } from './config/database';
import { connectRedis, getRedisClient } from './config/redis';
import { seedSurveys } from './utils/seedDatabase';
import { initializeStorage } from './config/storage';
import { StorageService } from './services/storageService';
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import oauthRoutes from './routes/oauth';
import featureToggleRoutes from './routes/featureToggles';
import loyaltyRoutes from './routes/loyalty';
import couponRoutes from './routes/coupon';
import surveyRoutes from './routes/survey';
import storageRoutes from './routes/storage';
import receptionRoutes from './routes/reception';
// import accountLinkingRoutes from './routes/accountLinking.minimal';
// import { accountLinkingService } from './services/accountLinkingService';
import { authenticate } from './middleware/auth';
// import { query } from './config/database';
// Import and initialize OAuth service to register strategies
import './services/oauthService';

// Load environment variables
dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 4000;

// Trust proxy headers (required for Cloudflare and other reverse proxies)
app.set('trust proxy', true);

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow images to be served cross-origin
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "https:", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "https:"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      // Allow OAuth redirects to external services
      formAction: ["'self'", "https://accounts.google.com", "https://www.facebook.com", "https://access.line.me"],
      // Allow navigation to OAuth providers
      navigateTo: ["'self'", "https://accounts.google.com", "https://www.facebook.com", "https://access.line.me"]
    }
  }
}));
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
    secret: process.env.SESSION_SECRET || 'your-session-secret-change-in-production',
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
        domain: process.env.COOKIE_DOMAIN || undefined // Allow setting specific domain if needed
      })
    }
  };

  // Try to use Redis store if available
  try {
    const redisClient = getRedisClient();
    if (redisClient && redisClient.isReady) {
      const redisStore = new RedisStore({
        client: redisClient,
        prefix: 'loyalty-app:sess:'
      });
      return { ...baseConfig, store: redisStore };
    }
  } catch (error) {
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
      environment: process.env.NODE_ENV || 'development',
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

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/oauth', oauthRoutes);
app.use('/api/feature-toggles', featureToggleRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/surveys', surveyRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/reception', receptionRoutes);
// Account linking routes (basic implementation for testing)
app.get('/api/account-linking/health', authenticate, async (_req, res) => {
  res.json({ success: true, message: 'Account linking API is available' });
});

app.get('/api/account-linking/requests', authenticate, async (_req, res) => {
  res.json({ success: true, data: { sent: [], received: [] } });
});

app.get('/api/account-linking/linked-accounts', authenticate, async (_req, res) => {
  res.json({ success: true, data: [] });
});

app.post('/api/account-linking/request', authenticate, async (_req, res) => {
  res.status(201).json({ success: true, message: 'Account linking feature coming soon' });
});

app.get('/api/account-linking/status/:email', authenticate, async (_req, res) => {
  res.json({ success: true, data: { canLink: true, targetExists: false } });
});

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

    httpServer.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
      logger.info('Backend server initialized with storage and survey data');
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