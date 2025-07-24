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

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" } // Allow images to be served cross-origin
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4001',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files for avatars
app.use('/storage', express.static('storage'));

// Note: Session middleware and Passport are configured in startServer() after Redis connection

app.use(requestLogger);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
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
    
    // Configure session store after Redis connection
    const redisClient = getRedisClient();
    const redisStore = new RedisStore({
      client: redisClient,
      prefix: 'loyalty-app:sess:'
    });
    
    // Update session configuration to use Redis store
    app.use(session({
      store: redisStore,
      secret: process.env.SESSION_SECRET || 'your-session-secret-change-in-production',
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
    
    // Initialize Passport after session configuration
    app.use(passport.initialize());
    app.use(passport.session());

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