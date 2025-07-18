import winston from 'winston';

const logLevel = process.env.LOG_LEVEL || 'info';

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    return log;
  })
);

// Create logger instance
export const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  defaultMeta: { service: 'hotel-loyalty-backend' },
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// Security logging
export const securityLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  defaultMeta: { service: 'hotel-loyalty-security' },
  transports: [
    new winston.transports.File({
      filename: 'logs/security.log',
      maxsize: 5242880, // 5MB
      maxFiles: 10,
    }),
  ],
});

// Add console for development
if (process.env.NODE_ENV !== 'production') {
  securityLogger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// Express.js request logging
export const requestLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  defaultMeta: { service: 'hotel-loyalty-requests' },
  transports: [
    new winston.transports.File({
      filename: 'logs/requests.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

export default logger;