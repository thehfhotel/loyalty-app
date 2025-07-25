import { Request, Response } from 'express';
import { logger } from './logger';

export interface OAuthDebugInfo {
  timestamp: string;
  step: string;
  provider: string;
  success: boolean;
  data?: any;
  error?: any;
  request?: {
    url: string;
    method: string;
    headers: Record<string, any>;
    query: Record<string, any>;
    cookies: Record<string, any>;
    session?: any;
    ip: string;
    userAgent: string;
  };
  environment?: {
    nodeEnv: string;
    isProduction: boolean;
    isSecure: boolean;
    domain: string;
    forwardedProto?: string;
    forwardedHost?: string;
  };
}

class OAuthDebugger {
  private debugLogs: OAuthDebugInfo[] = [];
  private maxLogs = 100;
  private isDebugMode: boolean;

  constructor() {
    this.isDebugMode = process.env.OAUTH_DEBUG === 'true' || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'production';
    logger.info(`OAuth Debugger initialized - Debug mode: ${this.isDebugMode}`);
  }

  log(info: Partial<OAuthDebugInfo>, req?: Request): void {
    const debugInfo: OAuthDebugInfo = {
      timestamp: new Date().toISOString(),
      step: info.step || 'unknown',
      provider: info.provider || 'unknown',
      success: info.success ?? false,
      data: info.data,
      error: info.error,
      ...this.extractRequestInfo(req),
      ...this.extractEnvironmentInfo(req)
    };

    // Add to in-memory logs
    this.debugLogs.unshift(debugInfo);
    if (this.debugLogs.length > this.maxLogs) {
      this.debugLogs.pop();
    }

    // Log to console/file based on debug mode
    if (this.isDebugMode) {
      logger.debug(`[OAuth Debug] ${debugInfo.step}`, debugInfo);
    } else {
      // In production, only log errors and important steps
      if (!debugInfo.success || ['initiate', 'callback_received', 'auth_success', 'auth_failed'].includes(debugInfo.step)) {
        logger.info(`[OAuth] ${debugInfo.step} - Provider: ${debugInfo.provider}, Success: ${debugInfo.success}`);
      }
    }
  }

  logStep(step: string, provider: string, success: boolean, data?: any, error?: any, req?: Request): void {
    this.log({ step, provider, success, data, error }, req);
  }

  logInitiate(provider: string, req: Request): void {
    this.logStep('initiate', provider, true, {
      scopes: this.getProviderScopes(provider),
      clientId: this.getClientId(provider),
      callbackUrl: this.getCallbackUrl(provider)
    }, undefined, req);
  }

  logCallback(provider: string, req: Request, success: boolean, error?: any): void {
    this.logStep('callback_received', provider, success, {
      query: req.query,
      hasCode: !!req.query.code,
      hasError: !!req.query.error,
      hasState: !!req.query.state
    }, error, req);
  }

  logAuthentication(provider: string, success: boolean, userData?: any, error?: any, req?: Request): void {
    this.logStep('authentication', provider, success, {
      hasUser: !!userData,
      userEmail: userData?.email,
      isNewUser: userData?.isNewUser
    }, error, req);
  }

  logTokenGeneration(provider: string, success: boolean, tokenInfo?: any, error?: any, req?: Request): void {
    this.logStep('token_generation', provider, success, {
      hasAccessToken: !!tokenInfo?.accessToken,
      hasRefreshToken: !!tokenInfo?.refreshToken,
      tokenLength: tokenInfo?.accessToken?.length
    }, error, req);
  }

  logRedirect(provider: string, success: boolean, redirectUrl?: string, error?: any, req?: Request): void {
    this.logStep('redirect', provider, success, {
      redirectUrl,
      hasTokens: redirectUrl?.includes('token=')
    }, error, req);
  }

  logError(provider: string, step: string, error: any, req?: Request): void {
    this.logStep(`error_${step}`, provider, false, undefined, {
      message: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name
    }, req);
  }

  getLogs(provider?: string, limit?: number): OAuthDebugInfo[] {
    let logs = this.debugLogs;
    
    if (provider) {
      logs = logs.filter(log => log.provider === provider);
    }
    
    if (limit) {
      logs = logs.slice(0, limit);
    }
    
    return logs;
  }

  getRecentErrors(limit = 10): OAuthDebugInfo[] {
    return this.debugLogs
      .filter(log => !log.success)
      .slice(0, limit);
  }

  getProviderStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    
    ['google', 'facebook', 'line'].forEach(provider => {
      const providerLogs = this.debugLogs.filter(log => log.provider === provider);
      const successful = providerLogs.filter(log => log.success);
      const failed = providerLogs.filter(log => !log.success);
      
      stats[provider] = {
        total: providerLogs.length,
        successful: successful.length,
        failed: failed.length,
        successRate: providerLogs.length > 0 ? (successful.length / providerLogs.length * 100).toFixed(2) + '%' : '0%',
        lastAttempt: providerLogs[0]?.timestamp,
        lastSuccess: successful[0]?.timestamp,
        lastError: failed[0]?.timestamp,
        commonErrors: this.getCommonErrors(provider)
      };
    });
    
    return stats;
  }

  private getCommonErrors(provider: string): Array<{ error: string; count: number }> {
    const errorCounts: Record<string, number> = {};
    
    this.debugLogs
      .filter(log => log.provider === provider && !log.success && log.error)
      .forEach(log => {
        const errorKey = log.error.message || log.error.toString();
        errorCounts[errorKey] = (errorCounts[errorKey] || 0) + 1;
      });
    
    return Object.entries(errorCounts)
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  private extractRequestInfo(req?: Request): { request?: OAuthDebugInfo['request'] } {
    if (!req) return {};
    
    return {
      request: {
        url: req.originalUrl || req.url,
        method: req.method,
        headers: {
          host: req.get('host'),
          userAgent: req.get('user-agent'),
          referer: req.get('referer'),
          origin: req.get('origin'),
          forwardedFor: req.get('x-forwarded-for'),
          forwardedProto: req.get('x-forwarded-proto'),
          forwardedHost: req.get('x-forwarded-host')
        },
        query: req.query,
        cookies: req.cookies,
        session: req.session ? {
          id: req.sessionID,
          cookie: req.session.cookie
        } : undefined,
        ip: req.ip,
        userAgent: req.get('user-agent') || 'unknown'
      }
    };
  }

  private extractEnvironmentInfo(req?: Request): { environment: OAuthDebugInfo['environment'] } {
    const isProduction = process.env.NODE_ENV === 'production';
    const isSecure = req ? (req.secure || req.get('x-forwarded-proto') === 'https') : false;
    
    return {
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        isProduction,
        isSecure,
        domain: req?.get('host') || 'unknown',
        forwardedProto: req?.get('x-forwarded-proto'),
        forwardedHost: req?.get('x-forwarded-host')
      }
    };
  }

  private getProviderScopes(provider: string): string[] {
    switch (provider) {
      case 'google':
        return ['profile', 'email'];
      case 'facebook':
        return ['email'];
      case 'line':
        return ['profile'];
      default:
        return [];
    }
  }

  private getClientId(provider: string): string | undefined {
    switch (provider) {
      case 'google':
        return process.env.GOOGLE_CLIENT_ID;
      case 'facebook':
        return process.env.FACEBOOK_APP_ID;
      case 'line':
        return process.env.LINE_CHANNEL_ID;
      default:
        return undefined;
    }
  }

  private getCallbackUrl(provider: string): string | undefined {
    switch (provider) {
      case 'google':
        return process.env.GOOGLE_CALLBACK_URL;
      case 'facebook':
        return process.env.FACEBOOK_CALLBACK_URL;
      case 'line':
        return process.env.LINE_CALLBACK_URL;
      default:
        return undefined;
    }
  }

  validateConfiguration(): Record<string, any> {
    const validation = {
      google: this.validateProviderConfig('google'),
      facebook: this.validateProviderConfig('facebook'),
      line: this.validateProviderConfig('line'),
      session: this.validateSessionConfig(),
      security: this.validateSecurityConfig()
    };

    return validation;
  }

  private validateProviderConfig(provider: string): any {
    const config = {
      provider,
      configured: false,
      clientId: null as string | null,
      clientSecret: null as string | null,
      callbackUrl: null as string | null,
      issues: [] as string[]
    };

    switch (provider) {
      case 'google':
        config.clientId = process.env.GOOGLE_CLIENT_ID || null;
        config.clientSecret = process.env.GOOGLE_CLIENT_SECRET || null;
        config.callbackUrl = process.env.GOOGLE_CALLBACK_URL || null;
        break;
      case 'facebook':
        config.clientId = process.env.FACEBOOK_APP_ID || null;
        config.clientSecret = process.env.FACEBOOK_APP_SECRET || null;
        config.callbackUrl = process.env.FACEBOOK_CALLBACK_URL || null;
        break;
      case 'line':
        config.clientId = process.env.LINE_CHANNEL_ID || null;
        config.clientSecret = process.env.LINE_CHANNEL_SECRET || null;
        config.callbackUrl = process.env.LINE_CALLBACK_URL || null;
        break;
    }

    // Validate configuration
    if (!config.clientId || config.clientId.startsWith('your-')) {
      config.issues.push('Client ID not configured or using placeholder value');
    }

    if (!config.clientSecret || config.clientSecret.startsWith('your-')) {
      config.issues.push('Client secret not configured or using placeholder value');
    }

    if (!config.callbackUrl) {
      config.issues.push('Callback URL not configured');
    } else {
      if (!config.callbackUrl.startsWith('https://') && process.env.NODE_ENV === 'production') {
        config.issues.push('Callback URL should use HTTPS in production');
      }
    }

    config.configured = config.issues.length === 0;
    return config;
  }

  private validateSessionConfig(): any {
    const config = {
      sessionSecret: !!process.env.SESSION_SECRET,
      redisAvailable: false,
      sessionSecretStrong: false,
      issues: [] as string[]
    };

    if (!process.env.SESSION_SECRET) {
      config.issues.push('SESSION_SECRET not configured');
    } else if (process.env.SESSION_SECRET === 'your-session-secret-change-in-production') {
      config.issues.push('SESSION_SECRET is using default value - change for production');
    } else if (process.env.SESSION_SECRET.length < 32) {
      config.issues.push('SESSION_SECRET should be at least 32 characters long');
    } else {
      config.sessionSecretStrong = true;
    }

    // Check Redis availability
    try {
      const { getRedisClient } = require('../config/redis');
      const redisClient = getRedisClient();
      config.redisAvailable = !!(redisClient && redisClient.isReady);
    } catch (error) {
      config.issues.push('Redis not available for session storage');
    }

    return config;
  }

  private validateSecurityConfig(): any {
    const config = {
      jwtSecret: !!process.env.JWT_SECRET,
      jwtRefreshSecret: !!process.env.JWT_REFRESH_SECRET,
      corsConfigured: !!process.env.FRONTEND_URL,
      httpsInProduction: true,
      issues: [] as string[]
    };

    if (!process.env.JWT_SECRET) {
      config.issues.push('JWT_SECRET not configured');
    }

    if (!process.env.JWT_REFRESH_SECRET) {
      config.issues.push('JWT_REFRESH_SECRET not configured');
    }

    if (!process.env.FRONTEND_URL) {
      config.issues.push('FRONTEND_URL not configured - may affect CORS');
    }

    if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL?.startsWith('https://')) {
      config.httpsInProduction = false;
      config.issues.push('FRONTEND_URL should use HTTPS in production');
    }

    return config;
  }

  clearLogs(): void {
    this.debugLogs = [];
    logger.info('OAuth debug logs cleared');
  }

  setDebugMode(enabled: boolean): void {
    this.isDebugMode = enabled;
    logger.info(`OAuth debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }
}

export const oauthDebugger = new OAuthDebugger();