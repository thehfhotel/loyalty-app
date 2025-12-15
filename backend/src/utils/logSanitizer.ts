/**
 * Log Sanitizer Utility
 * Prevents log injection attacks by sanitizing user-controlled input before logging.
 *
 * Log injection occurs when attackers inject newlines or control characters
 * into logged data to forge log entries or corrupt log analysis.
 */

/**
 * Maximum length for sanitized log values to prevent log flooding
 */
const MAX_LOG_LENGTH = 500;

/**
 * Sanitizes a string value for safe logging.
 * - Removes newlines and carriage returns (prevents log forging)
 * - Removes control characters (prevents terminal escape sequences)
 * - Truncates to maximum length (prevents log flooding)
 *
 * @param value - The value to sanitize
 * @returns Sanitized string safe for logging
 */
export function sanitizeLogValue(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  const str = typeof value === 'string' ? value : String(value);

  // Remove newlines, carriage returns, and control characters
  // This prevents log forging attacks where attackers inject fake log entries
  const sanitized = str
    .replace(/[\r\n]/g, ' ')  // Replace newlines with spaces
    // eslint-disable-next-line no-control-regex -- Intentional: removing control chars for security
    .replace(/[\x00-\x1F\x7F]/g, ''); // Remove other control characters

  // Truncate to prevent log flooding
  if (sanitized.length > MAX_LOG_LENGTH) {
    return sanitized.substring(0, MAX_LOG_LENGTH) + '...[truncated]';
  }

  return sanitized;
}

/**
 * Sanitizes an email for logging (masks part of the email)
 * @param email - The email to sanitize
 * @returns Partially masked email
 */
export function sanitizeEmail(email: string): string {
  const sanitized = sanitizeLogValue(email);
  const atIndex = sanitized.indexOf('@');
  if (atIndex > 2) {
    return sanitized.substring(0, 2) + '***' + sanitized.substring(atIndex);
  }
  return sanitized;
}

/**
 * Sanitizes a user ID for logging (shows first 8 chars of UUID)
 * @param userId - The user ID to sanitize
 * @returns Truncated user ID
 */
export function sanitizeUserId(userId: string): string {
  const sanitized = sanitizeLogValue(userId);
  // For UUIDs, show first 8 characters
  if (sanitized.length > 8) {
    return sanitized.substring(0, 8) + '...';
  }
  return sanitized;
}

/**
 * Sanitizes a URL path for logging
 * @param url - The URL to sanitize
 * @returns Sanitized URL
 */
export function sanitizeUrl(url: string): string {
  return sanitizeLogValue(url);
}

/**
 * Sanitizes an IP address for logging
 * @param ip - The IP address to sanitize
 * @returns Sanitized IP
 */
export function sanitizeIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  // IP addresses should only contain numbers, dots, and colons (for IPv6)
  const sanitized = sanitizeLogValue(ip);
  if (/^[\d.:a-fA-F]+$/.test(sanitized)) {
    return sanitized;
  }
  return 'invalid-ip';
}
