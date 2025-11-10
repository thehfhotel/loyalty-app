/**
 * Shared E2E Test Retry Helpers
 * Implements exponential backoff and retry logic for resilient E2E tests
 */

/**
 * Retry an HTTP request with exponential backoff
 */
export async function retryRequest(
  request: any,
  url: string,
  maxAttempts = 5,
  options: any = {}
): Promise<any> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await request.get(url, options);
      return response;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(
          `Failed to connect to ${url} after ${maxAttempts} attempts: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      // Exponential backoff: 2s, 4s, 8s, 16s (capped at 30s)
      const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
      console.log(`Attempt ${attempt}/${maxAttempts} failed, retrying in ${waitTime / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw new Error(`Retry logic failed for ${url}`);
}

/**
 * Retry page navigation with exponential backoff
 */
export async function retryPageGoto(
  page: any,
  url: string,
  maxAttempts = 5,
  options: any = {}
): Promise<void> {
  const defaultOptions = {
    timeout: 30000,
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

      if (attempt === maxAttempts) {
        throw new Error(
          `Failed to load page ${url} after ${maxAttempts} attempts: ${lastError.message}`
        );
      }

      const waitTime = Math.min(3000 * attempt, 30000);
      console.log(`Page load attempt ${attempt}/${maxAttempts} failed, retrying in ${waitTime / 1000}s...`);
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
