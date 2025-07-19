import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import passport from 'passport';
import session from 'express-session';
import { createServer } from 'http';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import oauthRoutes from './routes/oauth';
import featureToggleRoutes from './routes/featureToggles';
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
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware for OAuth
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

app.use(requestLogger);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/oauth', oauthRoutes);
app.use('/api/feature-toggles', featureToggleRoutes);
// Account linking routes (basic implementation for testing)
app.get('/api/account-linking/health', authenticate, async (req, res) => {
  res.json({ success: true, message: 'Account linking API is available' });
});

app.get('/api/account-linking/requests', authenticate, async (req, res) => {
  res.json({ success: true, data: { sent: [], received: [] } });
});

app.get('/api/account-linking/linked-accounts', authenticate, async (req, res) => {
  res.json({ success: true, data: [] });
});

app.post('/api/account-linking/request', authenticate, async (req, res) => {
  res.status(201).json({ success: true, message: 'Account linking feature coming soon' });
});

app.get('/api/account-linking/status/:email', authenticate, async (req, res) => {
  res.json({ success: true, data: { canLink: true, targetExists: false } });
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
async function startServer() {
  try {
    // Connect to databases
    await connectDatabase();
    await connectRedis();

    httpServer.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
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