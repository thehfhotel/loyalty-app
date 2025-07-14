const express = require('express');
const router = express.Router();
const db = require('../config/database');
const redis = require('../config/redis');

// Health check endpoint
router.get('/', async (req, res) => {
  const health = {
    service: 'user-service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    checks: {
      database: 'unknown',
      redis: 'unknown',
      memory: 'unknown'
    }
  };

  try {
    // Check database connection
    const dbResult = await db.query('SELECT 1');
    health.checks.database = dbResult ? 'healthy' : 'unhealthy';
  } catch (error) {
    health.checks.database = 'unhealthy';
    health.status = 'degraded';
  }

  try {
    // Check Redis connection
    await redis.ping();
    health.checks.redis = 'healthy';
  } catch (error) {
    health.checks.redis = 'unhealthy';
    health.status = 'degraded';
  }

  // Check memory usage
  const memUsage = process.memoryUsage();
  const memUsagePercentage = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  health.checks.memory = memUsagePercentage > 90 ? 'high' : 'healthy';

  if (health.checks.memory === 'high') {
    health.status = 'degraded';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

module.exports = router;