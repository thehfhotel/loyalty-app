/**
 * Log Sanitizer Utility
 * Prevents log injection attacks by sanitizing user-controlled input before logging.
 *
 * Log injection occurs when attackers inject newlines or control characters
 * into logged data to forge log entries or corrupt log analysis.
 *
 * OWASP References:
 * - https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
 * - https://owasp.org/www-community/attacks/Log_Injection
 *
 * Security Controls:
 * - Removes CR (\r), LF (\n), and CRLF sequences
 * - Removes ASCII control characters (\x00-\x1F, \x7F)
 * - Removes Unicode control characters (C0, C1 control sets)
 * - Removes ANSI escape sequences (terminal color codes)
 * - Explicitly removes null bytes (\x00)
 * - Truncates to prevent log flooding
 * - Strict mode: Allowlist-only approach (alphanumerics + safe punctuation)
 */

/**
 * Maximum length for sanitized log values to prevent log flooding
 */
const MAX_LOG_LENGTH = 500;

/**
 * Options for log sanitization
 */
export interface SanitizeOptions {
  /**
   * Strict mode uses an allowlist approach, permitting only:
   * - Alphanumerics (a-zA-Z0-9)
   * - Spaces
   * - Common safe punctuation: . , : ; ! ? - _ @ / ( ) [ ]
   *
   * Use strict mode for high-security contexts where additional
   * restrictions are required.
   *
   * Default: false (uses blocklist approach)
   */
  strict?: boolean;

  /**
   * Maximum length before truncation
   * Default: 500
   */
  maxLength?: number;
}

/**
 * Sanitizes a string value for safe logging following OWASP best practices.
 *
 * **Security Features:**
 * - Removes CR (\r), LF (\n), CRLF (prevents log forging)
 * - Removes ASCII control characters \x00-\x1F, \x7F (prevents terminal manipulation)
 * - Removes Unicode control characters U+0080-U+009F, U+2028, U+2029
 * - Removes ANSI escape sequences (prevents colored terminal output injection)
 * - Explicitly removes null bytes \x00 (prevents string truncation attacks)
 * - Truncates to maximum length (prevents log flooding/DoS)
 *
 * **Strict Mode:**
 * When `options.strict = true`, uses allowlist approach permitting only:
 * - Alphanumerics: a-zA-Z0-9
 * - Spaces
 * - Safe punctuation: . , : ; ! ? - _ @ / ( ) [ ]
 *
 * **OWASP References:**
 * - https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
 * - https://owasp.org/www-community/attacks/Log_Injection
 *
 * @param value - The value to sanitize (any type, will be converted to string)
 * @param options - Sanitization options
 * @returns Sanitized string safe for logging
 *
 * @example
 * // Basic usage (blocklist mode)
 * sanitizeLogValue("user\ninput") // "user input"
 * sanitizeLogValue("test\x1b[31mred\x1b[0m") // "testred"
 *
 * @example
 * // Strict mode (allowlist only)
 * sanitizeLogValue("user<script>", { strict: true }) // "userscript"
 * sanitizeLogValue("test@example.com", { strict: true }) // "test@example.com"
 */
export function sanitizeLogValue(
  value: unknown,
  options: SanitizeOptions = {}
): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  const str = typeof value === 'string' ? value : String(value);
  const maxLength = options.maxLength ?? MAX_LOG_LENGTH;

  let sanitized: string;

  if (options.strict) {
    // STRICT MODE: Allowlist approach
    // Only permit alphanumerics, spaces, and common safe punctuation
    // This is the most secure option for high-security contexts
    sanitized = str.replace(/[^a-zA-Z0-9 .,;:!?\-_@/()[\]]/g, '');
  } else {
    // STANDARD MODE: Blocklist approach (backward compatible)
    // Step 1: Remove ANSI escape sequences (e.g., \x1b[31m for colors)
    // Matches ESC followed by [ and any characters until m
    // Also matches other ESC sequences: ESC followed by any char
    // eslint-disable-next-line no-control-regex -- Intentional: removing ANSI escape sequences for security
    sanitized = str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b./g, '');

    // Step 2: Explicitly remove null bytes (can cause string truncation)
    // eslint-disable-next-line no-control-regex -- Intentional: removing null bytes for security
    sanitized = sanitized.replace(/\x00/g, '');

    // Step 3: Remove CR, LF, and CRLF (prevents log forging)
    sanitized = sanitized.replace(/[\r\n]/g, ' ');

    // Step 4: Remove ASCII control characters (C0 set: \x00-\x1F, DEL: \x7F)
    // eslint-disable-next-line no-control-regex -- Intentional: removing control chars for security
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

    // Step 5: Remove Unicode control characters
    // C1 control set (U+0080 to U+009F)
    sanitized = sanitized.replace(/[\u0080-\u009F]/g, '');

    // Step 6: Remove Unicode line/paragraph separators
    // U+2028 (Line Separator), U+2029 (Paragraph Separator)
    sanitized = sanitized.replace(/[\u2028\u2029]/g, ' ');
  }

  // Truncate to prevent log flooding (applies to both modes)
  if (sanitized.length > maxLength) {
    return sanitized.substring(0, maxLength) + '...[truncated]';
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
