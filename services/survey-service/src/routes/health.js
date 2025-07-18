const express = require('express');
const router = express.Router();
const db = require('../config/database');

router.get('/', async (req, res) => {
  try {
    // Check database connection
    await db.query('SELECT 1');
    
    const healthCheck = {
      uptime: process.uptime(),
      message: 'Survey Service is healthy',
      timestamp: new Date().toISOString(),
      service: 'survey-service',
      version: process.env.npm_package_version || '1.0.0'
    };
    
    res.status(200).json(healthCheck);
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      uptime: process.uptime(),
      message: 'Survey Service is unhealthy',
      timestamp: new Date().toISOString(),
      service: 'survey-service',
      error: error.message
    });
  }
});

module.exports = router;