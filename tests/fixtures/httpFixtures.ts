/**
 * Custom HTTP Request Fixtures for E2E Tests
 *
 * Playwright's built-in apiRequestContext doesn't work reliably in Docker-in-Docker
 * environments with network_mode: host. This fixture uses Node.js's native http module
 * which has proven to work correctly.
 */

import { test as base } from '@playwright/test';
import http from 'http';
import https from 'https';

interface HTTPResponse {
  status: () => number;
  statusText: () => string;
  headers: () => Record<string, string>;
  text: () => Promise<string>;
  json: () => Promise<any>;
  ok: () => boolean;
  url: () => string;
}

interface HTTPRequest {
  get: (url: string, options?: RequestOptions) => Promise<HTTPResponse>;
  post: (url: string, options?: RequestOptions) => Promise<HTTPResponse>;
  put: (url: string, options?: RequestOptions) => Promise<HTTPResponse>;
  delete: (url: string, options?: RequestOptions) => Promise<HTTPResponse>;
}

interface RequestOptions {
  headers?: Record<string, string>;
  data?: any;
  timeout?: number;
  maxRedirects?: number;
}

/**
 * Custom HTTP request implementation using Node.js http/https modules
 */
class NodeHTTPRequest implements HTTPRequest {
  private makeRequest(
    method: string,
    url: string,
    options: RequestOptions = {}
  ): Promise<HTTPResponse> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: method,
        headers: options.headers || {},
        timeout: options.timeout || 30000,
      };

      // Add Content-Type for POST/PUT requests with data
      if (options.data && (method === 'POST' || method === 'PUT')) {
        requestOptions.headers['Content-Type'] = 'application/json';
      }

      const req = httpModule.request(requestOptions, (res) => {
        // Handle redirects
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          const maxRedirects = options.maxRedirects !== undefined ? options.maxRedirects : 10;

          if (maxRedirects === 0) {
            // Return redirect response without following
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              resolve(this.createResponse(res, data, url));
            });
            return;
          }

          // Follow redirect
          const redirectUrl = new URL(res.headers.location, url).toString();
          resolve(this.makeRequest(method, redirectUrl, {
            ...options,
            maxRedirects: maxRedirects - 1
          }));
          return;
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve(this.createResponse(res, data, url));
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout after ${options.timeout || 30000}ms`));
      });

      // Send request body for POST/PUT
      if (options.data) {
        const body = typeof options.data === 'string'
          ? options.data
          : JSON.stringify(options.data);
        req.write(body);
      }

      req.end();
    });
  }

  private createResponse(
    res: http.IncomingMessage,
    data: string,
    url: string
  ): HTTPResponse {
    const statusCode = res.statusCode || 500;
    const statusMessage = res.statusMessage || '';
    const headers: Record<string, string> = {};

    // Convert headers
    for (const [key, value] of Object.entries(res.headers)) {
      if (Array.isArray(value)) {
        headers[key] = value.join(', ');
      } else if (value) {
        headers[key] = value;
      }
    }

    return {
      status: () => statusCode,
      statusText: () => statusMessage,
      headers: () => headers,
      text: async () => data,
      json: async () => JSON.parse(data),
      ok: () => statusCode >= 200 && statusCode < 300,
      url: () => url,
    };
  }

  async get(url: string, options?: RequestOptions): Promise<HTTPResponse> {
    return this.makeRequest('GET', url, options);
  }

  async post(url: string, options?: RequestOptions): Promise<HTTPResponse> {
    return this.makeRequest('POST', url, options);
  }

  async put(url: string, options?: RequestOptions): Promise<HTTPResponse> {
    return this.makeRequest('PUT', url, options);
  }

  async delete(url: string, options?: RequestOptions): Promise<HTTPResponse> {
    return this.makeRequest('DELETE', url, options);
  }
}

/**
 * Custom test fixtures that provide a reliable HTTP client for Docker-in-Docker environments
 */
export const test = base.extend<{ request: HTTPRequest }>({
  request: async ({}, use) => {
    const httpRequest = new NodeHTTPRequest();
    await use(httpRequest);
  },
});

export { expect } from '@playwright/test';
