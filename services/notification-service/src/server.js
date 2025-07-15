const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const notificationsRoutes = require('./routes/notifications');
const tokensRoutes = require('./routes/tokens');
const templatesRoutes = require('./routes/templates');
const healthRoutes = require('./routes/health');
const errorHandler = require('./middleware/errorHandler');
const authMiddleware = require('./middleware/auth');

// Initialize notification services
require('./services/firebaseService');
require('./services/emailService');
require('./services/smsService');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3010'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300, // Higher limit for notification service
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/health', healthRoutes);
app.use('/api/v1/notifications', authMiddleware.authenticateToken, notificationsRoutes);
app.use('/api/v1/tokens', authMiddleware.authenticateToken, tokensRoutes);
app.use('/api/v1/templates', authMiddleware.authenticateToken, templatesRoutes);

// Internal routes (no auth required for service-to-service calls)
app.use('/internal/send', require('./routes/internal'));

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Notification Service running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;