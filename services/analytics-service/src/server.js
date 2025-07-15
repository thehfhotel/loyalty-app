const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const eventsRoutes = require('./routes/events');
const metricsRoutes = require('./routes/metrics');
const dashboardRoutes = require('./routes/dashboard');
const reportsRoutes = require('./routes/reports');
const healthRoutes = require('./routes/health');
const errorHandler = require('./middleware/errorHandler');
const authMiddleware = require('./middleware/auth');

// Initialize analytics processors
require('./services/metricsProcessor');
require('./services/realtimeProcessor');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3010'],
  credentials: true
}));

// Higher rate limit for analytics (lots of events)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/health', healthRoutes);
app.use('/api/v1/events', authMiddleware.optionalAuth, eventsRoutes);
app.use('/api/v1/metrics', authMiddleware.authenticateToken, metricsRoutes);
app.use('/api/v1/dashboard', authMiddleware.authenticateToken, dashboardRoutes);
app.use('/api/v1/reports', authMiddleware.authenticateToken, reportsRoutes);

// Internal routes (no auth for service-to-service)
app.use('/internal/track', require('./routes/internal'));

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
  console.log(`Analytics Service running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;