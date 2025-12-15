import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { sanitizeUrl, sanitizeIp, sanitizeLogValue } from '../utils/logSanitizer';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const sanitizedUrl = sanitizeUrl(req.originalUrl);
    const sanitizedMethod = sanitizeLogValue(req.method);
    // codeql[js/log-injection] - Values sanitized via sanitizeLogValue/sanitizeUrl
    const message = `${sanitizedMethod} ${sanitizedUrl}`;

    const logData = {
      method: sanitizedMethod,
      url: sanitizedUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: sanitizeIp(req.ip),
      userAgent: sanitizeLogValue(req.get('user-agent') ?? ''),
    };

    if (res.statusCode >= 400) {
      logger.warn(message, logData);
    } else {
      logger.info(message, logData);
    }
  });

  next();
}