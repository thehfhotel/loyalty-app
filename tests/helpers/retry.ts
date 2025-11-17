/**
 * Shared E2E Test Retry Helpers
 * Optimized for fast failure detection and minimal retry overhead
 */

/**
 * Fatal errors that should not be retried
 * These indicate infrastructure failures, not transient network issues
 */
const FATAL_ERRORS = [
  'ECONNREFUSED',  // Backend is down
  'ENOTFOUND',     // DNS/hostname resolution failed
  'ETIMEDOUT',     // Connection timeout (backend not responding)
  'ECONNRESET',    // Connection reset by peer
  'EHOSTUNREACH',  // Host unreachable
];

/**
 * Check if an error is fatal and should not be retried
 */
function isFatalError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return FATAL_ERRORS.some(fatalError => errorMessage.includes(fatalError));
}

/**
 * Retry an HTTP request with aggressive backoff and fast-fail for fatal errors
 *
 * Optimizations:
 * - Reduced max attempts from 5→2 (1.5s total vs 30s)
 * - Fast-fail for ECONNREFUSED and other fatal errors
 * - Aggressive backoff: 500ms → 1s (vs 2s → 4s → 8s)
 */
export async function retryRequest(
  request: any,
  url: string,
  maxAttempts = 2,  // Reduced from 5 for faster feedback
  options: any = {}
): Promise<any> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await request.get(url, options);
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Fast-fail for fatal errors (don't waste time retrying)
      if (isFatalError(error)) {
        throw new Error(
          `Fatal error (not retrying): ${errorMessage}\n` +
          `URL: ${url}\n` +
          `This indicates the backend is unavailable or network is down.`
        );
      }

      if (attempt === maxAttempts) {
        throw new Error(
          `Failed to connect to ${url} after ${maxAttempts} attempts: ${errorMessage}`
        );
      }

      // Aggressive backoff: 500ms, 1s (total: 1.5s for 2 attempts)
      // Much faster than old 2s → 4s → 8s → 16s (30s total)
      const waitTime = 500 * Math.pow(2, attempt - 1);
      console.log(`Attempt ${attempt}/${maxAttempts} failed, retrying in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw new Error(`Retry logic failed for ${url}`);
}

/**
 * Retry page navigation with aggressive backoff and fast-fail
 *
 * Optimizations:
 * - Reduced max attempts from 5→2
 * - Fast-fail for fatal network errors
 * - Aggressive backoff: 1s → 2s (vs 3s → 6s → 9s)
 */
export async function retryPageGoto(
  page: any,
  url: string,
  maxAttempts = 2,  // Reduced from 5 for faster feedback
  options: any = {}
): Promise<void> {
  const defaultOptions = {
    timeout: 20000,  // Reduced from 30s
    waitUntil: 'domcontentloaded',
    ...options
  };

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto(url, defaultOptions);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Fast-fail for fatal errors
      if (isFatalError(error)) {
        throw new Error(
          `Fatal error loading page (not retrying): ${lastError.message}\n` +
          `URL: ${url}\n` +
          `This indicates the server is unavailable.`
        );
      }

      if (attempt === maxAttempts) {
        throw new Error(
          `Failed to load page ${url} after ${maxAttempts} attempts: ${lastError.message}`
        );
      }

      // Aggressive backoff: 1s, 2s (vs old 3s, 6s, 9s)
      const waitTime = 1000 * Math.pow(2, attempt - 1);
      console.log(`Page load attempt ${attempt}/${maxAttempts} failed, retrying in ${waitTime}ms...`);
      await page.waitForTimeout(waitTime);
    }
  }

  throw lastError;
}

/**
 * Wait for service to be ready with health check
 */
export async function waitForService(
  request: any,
  healthUrl: string,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await request.get(healthUrl, { timeout: 5000 });

      if (response.status() === 200) {
        console.log(`✅ Service ready at ${healthUrl}`);
        return;
      }
    } catch (error) {
      // Service not ready yet
    }

    if (attempt === maxAttempts) {
      throw new Error(`Service at ${healthUrl} not ready after ${maxAttempts} attempts`);
    }

    console.log(`Waiting for service... (${attempt}/${maxAttempts})`);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
