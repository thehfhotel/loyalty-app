import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { connectDatabase } from './config/database.js';
import { connectRedis } from './config/redis.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { logger, requestLogger } from './utils/logger.js';
import authRoutes from './routes/auth.js';
import customerRoutes from './routes/customer.js';
import loyaltyRoutes from './routes/loyalty.js';
import { createCouponRoutes } from './routes/coupons.js';
import { createSurveyRoutes } from './routes/surveys.js';

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200,
}));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(morgan('combined', {
  stream: {
    write: (message: string) => {
      requestLogger.info(message.trim());
    },
  },
}));

// Rate limiting
app.use('/api', apiLimiter);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    const { databaseHealthCheck } = await import('./config/database.js');
    const { redisHealthCheck } = await import('./config/redis.js');
    
    const dbHealthy = await databaseHealthCheck();
    const redisHealthy = await redisHealthCheck();
    
    const isHealthy = dbHealthy && redisHealthy;
    
    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? 'up' : 'down',
        redis: redisHealthy ? 'up' : 'down',
      },
    });
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});

// Initialize connections and get database pool
let dbPool: any = null;

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/loyalty', loyaltyRoutes);

// Routes that need database connection
app.use('/api/coupons', (req, res, next) => {
  if (!dbPool) {
    return res.status(503).json({
      success: false,
      message: 'Database not available'
    });
  }
  next();
}, createCouponRoutes(dbPool));

app.use('/api/surveys', (req, res, next) => {
  if (!dbPool) {
    return res.status(503).json({
      success: false,
      message: 'Database not available'
    });
  }
  next();
}, createSurveyRoutes(dbPool));

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', error);
  
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
  });
});

// Initialize connections
export async function initializeApp(): Promise<void> {
  try {
    const { pool } = await connectDatabase();
    dbPool = pool;
    await connectRedis();
    logger.info('Application initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    throw error;
  }
}

export default app;