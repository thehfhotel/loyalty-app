/**
 * Logger utility for consistent logging across the application
 * Can be disabled in production by setting VITE_DISABLE_LOGS=true
 */

/* eslint-disable no-console -- Logger is the designated place for console calls */

const IS_PRODUCTION = import.meta.env.PROD;
const DISABLE_LOGS = import.meta.env.VITE_DISABLE_LOGS === 'true';
const IS_DEV_MODE = import.meta.env.DEV;

class Logger {
  private shouldLog(): boolean {
    return !DISABLE_LOGS;
  }

  private shouldLogInProd(): boolean {
    return !IS_PRODUCTION || !DISABLE_LOGS;
  }

  debug(...args: unknown[]): void {
    if (this.shouldLog() && IS_DEV_MODE) {
      console.log('[DEBUG]', ...args);
    }
  }

  log(...args: unknown[]): void {
    if (this.shouldLog()) {
      console.log('[LOG]', ...args);
    }
  }

  info(...args: unknown[]): void {
    if (this.shouldLog()) {
      console.info('[INFO]', ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (this.shouldLogInProd()) {
      console.warn('[WARN]', ...args);
    }
  }

  error(...args: unknown[]): void {
    if (this.shouldLogInProd()) {
      console.error('[ERROR]', ...args);
    }
  }
}

export const logger = new Logger();
