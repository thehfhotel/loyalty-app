import { Router } from 'express';
import { oauthDebugger } from '../utils/oauthDebugger';
import { logger } from '../utils/logger';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// OAuth Debug Dashboard (public for debugging)
router.get('/dashboard', async (req, res) => {
  try {
    const stats = oauthDebugger.getProviderStats();
    const recentLogs = oauthDebugger.getLogs(undefined, 20);
    const recentErrors = oauthDebugger.getRecentErrors(10);
    const configuration = oauthDebugger.validateConfiguration();

    res.json({
      timestamp: new Date().toISOString(),
      stats,
      recentLogs,
      recentErrors,
      configuration,
      debugMode: process.env.OAUTH_DEBUG === 'true'
    });
  } catch (error) {
    logger.error('OAuth debug dashboard error:', error);
    res.status(500).json({ error: 'Failed to get debug information' });
  }
});

// Get logs for specific provider
router.get('/logs/:provider', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { provider } = req.params;
    const { limit } = req.query;
    
    if (!['google', 'line'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    const logs = oauthDebugger.getLogs(provider, limit ? parseInt(limit as string) : undefined);
    
    res.json({
      provider,
      count: logs.length,
      logs
    });
  } catch (error) {
    logger.error(`OAuth debug logs error for ${req.params.provider}:`, error);
    res.status(500).json({ error: 'Failed to get provider logs' });
  }
});

// Configuration validation endpoint (public for debugging)
router.get('/config', async (req, res) => {
  try {
    const configuration = oauthDebugger.validateConfiguration();
    
    res.json({
      timestamp: new Date().toISOString(),
      configuration,
      environment: {
        nodeEnv: process.env.NODE_ENV,
        oauthDebug: process.env.OAUTH_DEBUG,
        frontendUrl: process.env.FRONTEND_URL,
        backendUrl: process.env.BACKEND_URL
      }
    });
  } catch (error) {
    logger.error('OAuth config validation error:', error);
    res.status(500).json({ error: 'Failed to validate configuration' });
  }
});

// Test OAuth provider configuration (public for debugging)
router.post('/test/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    
    if (!['google', 'line'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    const config = oauthDebugger.validateConfiguration();
    const providerConfig = config[provider as keyof typeof config];

    // Test basic configuration
    const testResults = {
      provider,
      timestamp: new Date().toISOString(),
      configured: providerConfig.configured,
      issues: providerConfig.issues,
      tests: {
        clientIdSet: !!providerConfig.clientId,
        clientSecretSet: !!providerConfig.clientSecret,
        callbackUrlSet: !!providerConfig.callbackUrl,
        callbackUrlValid: false,
        httpsInProduction: true
      }
    };

    // Validate callback URL format
    if (providerConfig.callbackUrl) {
      try {
        const url = new URL(providerConfig.callbackUrl);
        testResults.tests.callbackUrlValid = true;
        
        if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
          testResults.tests.httpsInProduction = false;
        }
      } catch (e) {
        testResults.tests.callbackUrlValid = false;
      }
    }

    // Log the test
    oauthDebugger.logStep('config_test', provider, testResults.tests.callbackUrlValid, testResults, undefined, req);

    res.json(testResults);
  } catch (error) {
    logger.error(`OAuth test error for ${req.params.provider}:`, error);
    res.status(500).json({ error: 'Failed to test provider configuration' });
  }
});

// Clear debug logs
router.delete('/logs', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    oauthDebugger.clearLogs();
    logger.info(`OAuth debug logs cleared by user ${(req.user as any)?.email}`);
    
    res.json({
      message: 'Debug logs cleared successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('OAuth clear logs error:', error);
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

// Toggle debug mode
router.post('/debug-mode', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    oauthDebugger.setDebugMode(enabled);
    logger.info(`OAuth debug mode ${enabled ? 'enabled' : 'disabled'} by user ${(req.user as any)?.email}`);
    
    res.json({
      message: `Debug mode ${enabled ? 'enabled' : 'disabled'}`,
      debugMode: enabled,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('OAuth debug mode toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle debug mode' });
  }
});

// Real-time OAuth flow simulation for testing
router.post('/simulate/:provider', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { provider } = req.params;
    
    if (!['google', 'line'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    // Simulate OAuth flow steps
    oauthDebugger.logInitiate(provider, req);
    
    // Simulate callback with test data
    setTimeout(() => {
      oauthDebugger.logCallback(provider, req, true);
      oauthDebugger.logAuthentication(provider, true, { email: 'test@example.com', isNewUser: false }, undefined, req);
      oauthDebugger.logTokenGeneration(provider, true, { accessToken: 'test-token', refreshToken: 'test-refresh' }, undefined, req);
      oauthDebugger.logRedirect(provider, true, `${process.env.FRONTEND_URL}/oauth/success?token=test-token`, undefined, req);
    }, 100);

    res.json({
      message: `OAuth flow simulation started for ${provider}`,
      provider,
      timestamp: new Date().toISOString(),
      note: 'Check debug logs for simulation results'
    });
  } catch (error) {
    logger.error(`OAuth simulation error for ${req.params.provider}:`, error);
    res.status(500).json({ error: 'Failed to simulate OAuth flow' });
  }
});

// Get OAuth session information for current request
router.get('/session-info', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const sessionInfo = {
      timestamp: new Date().toISOString(),
      session: {
        id: req.sessionID,
        cookie: req.session?.cookie,
        hasSession: !!req.session
      },
      request: {
        secure: req.secure,
        protocol: req.protocol,
        host: req.get('host'),
        forwardedProto: req.get('x-forwarded-proto'),
        forwardedHost: req.get('x-forwarded-host'),
        userAgent: req.get('user-agent'),
        ip: req.ip
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        trustProxy: req.app.get('trust proxy'),
        frontendUrl: process.env.FRONTEND_URL
      },
      cookies: req.cookies
    };

    res.json(sessionInfo);
  } catch (error) {
    logger.error('OAuth session info error:', error);
    res.status(500).json({ error: 'Failed to get session information' });
  }
});

// Export recent errors as downloadable JSON
router.get('/export/errors', authenticate, requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const errors = oauthDebugger.getRecentErrors(50);
    const exportData = {
      timestamp: new Date().toISOString(),
      exported_by: (req.user as any)?.email,
      error_count: errors.length,
      errors
    };

    res.setHeader('Content-Disposition', `attachment; filename="oauth-errors-${new Date().toISOString().split('T')[0]}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportData);
  } catch (error) {
    logger.error('OAuth export errors error:', error);
    res.status(500).json({ error: 'Failed to export errors' });
  }
});

export default router;