const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const pmsRoutes = require('./routes/pms');
const webhooksRoutes = require('./routes/webhooks');
const syncRoutes = require('./routes/sync');
const healthRoutes = require('./routes/health');
const errorHandler = require('./middleware/errorHandler');
const authMiddleware = require('./middleware/auth');

// Initialize sync services
require('./services/pmsSync');
require('./services/dataSync');

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
  max: 500, // Higher limit for integration operations
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '50mb' })); // Larger limit for bulk data
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/health', healthRoutes);
app.use('/api/v1/pms', authMiddleware.authenticateToken, pmsRoutes);
app.use('/api/v1/sync', authMiddleware.authenticateToken, syncRoutes);

// Webhook routes (no auth - external systems)
app.use('/webhooks', webhooksRoutes);

// Internal routes (service-to-service)
app.use('/internal/sync', require('./routes/internal'));

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
  console.log(`Integration Service running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;