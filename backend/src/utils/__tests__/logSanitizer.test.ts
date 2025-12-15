/**
 * Log Sanitizer Unit Tests
 * Tests log injection attack prevention and sanitization functions
 */

/* eslint-disable no-control-regex -- Intentional: testing control character removal for security */

import { describe, it, expect } from '@jest/globals';
import {
  sanitizeLogValue,
  sanitizeEmail,
  sanitizeUserId,
  sanitizeUrl,
  sanitizeIp,
} from '../logSanitizer';

describe('Log Sanitizer', () => {
  describe('sanitizeLogValue', () => {
    describe('Log injection attacks', () => {
      it('should remove newline characters (\\n)', () => {
        const input = 'User logged in\nADMIN: Fake admin entry';
        const result = sanitizeLogValue(input);

        expect(result).not.toContain('\n');
        expect(result).toBe('User logged in ADMIN: Fake admin entry');
      });

      it('should remove carriage return characters (\\r)', () => {
        const input = 'Normal log\rERROR: Injected error';
        const result = sanitizeLogValue(input);

        expect(result).not.toContain('\r');
        expect(result).toBe('Normal log ERROR: Injected error');
      });

      it('should remove CRLF sequences (\\r\\n)', () => {
        const input = 'Line 1\r\nLine 2\r\nLine 3';
        const result = sanitizeLogValue(input);

        expect(result).not.toContain('\r\n');
        // Note: \r and \n are replaced separately with spaces, so \r\n becomes two spaces
        expect(result).toBe('Line 1  Line 2  Line 3');
      });

      it('should remove control characters (0x00-0x1F, 0x7F)', () => {
        // Test various control characters
        const controlChars = '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0B\x0C\x0E\x0F';
        const input = `Safe text${controlChars}more text`;
        const result = sanitizeLogValue(input);

        expect(result).toBe('Safe textmore text');
        expect(result).not.toMatch(/[\x00-\x1F\x7F]/);
      });

      it('should remove DELETE character (0x7F)', () => {
        const input = 'Text with\x7Fdelete char';
        const result = sanitizeLogValue(input);

        expect(result).toBe('Text withdelete char');
        expect(result).not.toContain('\x7F');
      });

      it('should remove ANSI escape sequences', () => {
        // ANSI color codes: ESC[31m for red, ESC[0m for reset
        const input = '\x1b[31mRed text\x1b[0m Normal text';
        const result = sanitizeLogValue(input);

        expect(result).not.toContain('\x1b');
        // ANSI sequences are fully removed (including the bracketed codes)
        expect(result).toBe('Red text Normal text');
      });

      it('should prevent fake log entry injection', () => {
        const input = 'User action\nERROR: Database compromised\nINFO: Backdoor installed';
        const result = sanitizeLogValue(input);

        expect(result).not.toContain('\n');
        expect(result).toBe('User action ERROR: Database compromised INFO: Backdoor installed');
      });

      it('should handle complex injection attempt with multiple attack vectors', () => {
        const input = 'Normal\r\nERROR: Fake\x00\x1b[31mColored attack\x7F';
        const result = sanitizeLogValue(input);

        expect(result).not.toMatch(/[\r\n\x00-\x1F\x7F]/);
        // \r\n becomes two spaces, ANSI sequence fully removed, control chars removed
        expect(result).toBe('Normal  ERROR: FakeColored attack');
      });

      it('should handle null byte injection', () => {
        const input = 'Text\x00Hidden text after null';
        const result = sanitizeLogValue(input);

        expect(result).not.toContain('\x00');
        expect(result).toBe('TextHidden text after null');
      });

      it('should handle vertical tab and form feed', () => {
        const input = 'Text\x0BVertical tab\x0CForm feed';
        const result = sanitizeLogValue(input);

        expect(result).not.toMatch(/[\x0B\x0C]/);
        expect(result).toBe('TextVertical tabForm feed');
      });
    });

    describe('Edge cases', () => {
      it('should handle null values', () => {
        const result = sanitizeLogValue(null);
        expect(result).toBe('null');
      });

      it('should handle undefined values', () => {
        const result = sanitizeLogValue(undefined);
        expect(result).toBe('undefined');
      });

      it('should handle empty string', () => {
        const result = sanitizeLogValue('');
        expect(result).toBe('');
      });

      it('should handle whitespace-only string', () => {
        const result = sanitizeLogValue('   ');
        expect(result).toBe('   ');
      });

      it('should handle boolean values', () => {
        expect(sanitizeLogValue(true)).toBe('true');
        expect(sanitizeLogValue(false)).toBe('false');
      });

      it('should handle number values', () => {
        expect(sanitizeLogValue(42)).toBe('42');
        expect(sanitizeLogValue(0)).toBe('0');
        expect(sanitizeLogValue(-123.45)).toBe('-123.45');
      });

      it('should handle object values', () => {
        const obj = { key: 'value', nested: { data: 123 } };
        const result = sanitizeLogValue(obj);

        expect(result).toBe('[object Object]');
      });

      it('should handle array values', () => {
        const arr = [1, 2, 3];
        const result = sanitizeLogValue(arr);

        expect(result).toBe('1,2,3');
      });

      it('should truncate very long strings (>500 chars)', () => {
        const longString = 'A'.repeat(600);
        const result = sanitizeLogValue(longString);

        expect(result.length).toBe(514); // 500 + '...[truncated]' (14 chars)
        expect(result).toMatch(/^A{500}\.\.\.\[truncated\]$/);
      });

      it('should not truncate strings at exactly 500 chars', () => {
        const exactString = 'B'.repeat(500);
        const result = sanitizeLogValue(exactString);

        expect(result.length).toBe(500);
        expect(result).not.toContain('[truncated]');
      });

      it('should not truncate strings under 500 chars', () => {
        const shortString = 'C'.repeat(499);
        const result = sanitizeLogValue(shortString);

        expect(result.length).toBe(499);
        expect(result).not.toContain('[truncated]');
      });
    });

    describe('Security payloads', () => {
      it('should sanitize fake authentication success', () => {
        const input = 'Login failed\nINFO: Authentication successful for admin@example.com';
        const result = sanitizeLogValue(input);

        expect(result).not.toContain('\n');
        expect(result).toBe('Login failed INFO: Authentication successful for admin@example.com');
      });

      it('should sanitize fake error messages', () => {
        const input = 'Processing...\nERROR: SQL injection detected\nWARNING: System compromised';
        const result = sanitizeLogValue(input);

        expect(result).not.toContain('\n');
      });

      it('should sanitize path traversal attempts', () => {
        const input = 'File: data.txt\n../../etc/passwd\nFile accessed';
        const result = sanitizeLogValue(input);

        expect(result).not.toContain('\n');
        expect(result).toBe('File: data.txt ../../etc/passwd File accessed');
      });

      it('should handle command injection attempts', () => {
        const input = 'User input\n; rm -rf /\nDangerous command';
        const result = sanitizeLogValue(input);

        expect(result).not.toContain('\n');
        expect(result).toBe('User input ; rm -rf / Dangerous command');
      });

      it('should sanitize timestamp forgery attempt', () => {
        const input = 'Normal log\n2024-01-01 00:00:00 [ADMIN] Backdoor installed';
        const result = sanitizeLogValue(input);

        expect(result).not.toContain('\n');
      });
    });

    describe('Unicode and special characters', () => {
      it('should preserve emoji characters', () => {
        const input = 'User logged in 😀 🎉';
        const result = sanitizeLogValue(input);

        expect(result).toBe('User logged in 😀 🎉');
      });

      it('should preserve non-ASCII characters', () => {
        const input = 'User: José González, Location: 北京';
        const result = sanitizeLogValue(input);

        expect(result).toBe('User: José González, Location: 北京');
      });

      it('should preserve Arabic text', () => {
        const input = 'مرحبا بك في النظام';
        const result = sanitizeLogValue(input);

        expect(result).toBe('مرحبا بك في النظام');
      });

      it('should preserve Cyrillic text', () => {
        const input = 'Привет мир';
        const result = sanitizeLogValue(input);

        expect(result).toBe('Привет мир');
      });

      it('should handle mixed Unicode and injection attempts', () => {
        const input = 'User: José\nERROR: Fake 😈';
        const result = sanitizeLogValue(input);

        expect(result).not.toContain('\n');
        expect(result).toBe('User: José ERROR: Fake 😈');
      });

      it('should handle zero-width characters', () => {
        const input = 'Text\u200Bwith\u200Czero\u200Dwidth';
        const result = sanitizeLogValue(input);

        // Zero-width characters should be preserved (they're not control chars)
        expect(result).toBe('Text\u200Bwith\u200Czero\u200Dwidth');
      });
    });

    describe('Performance', () => {
      it('should handle large strings efficiently', () => {
        const largeString = 'X'.repeat(10000);
        const startTime = Date.now();
        const result = sanitizeLogValue(largeString);
        const duration = Date.now() - startTime;

        expect(result.length).toBe(514); // 500 + '...[truncated]' (14 chars)
        expect(duration).toBeLessThan(100); // Should complete quickly
      });

      it('should handle strings with many control characters', () => {
        const messyString = 'A\nB\rC\x00D\x1bE\x7FF'.repeat(100);
        const result = sanitizeLogValue(messyString);

        expect(result).not.toMatch(/[\r\n\x00-\x1F\x7F]/);
      });
    });
  });

  describe('sanitizeEmail', () => {
    describe('Email masking', () => {
      it('should mask standard email addresses', () => {
        const result = sanitizeEmail('john.doe@example.com');
        expect(result).toBe('jo***@example.com');
      });

      it('should mask email with short local part', () => {
        const result = sanitizeEmail('abc@domain.com');
        expect(result).toBe('ab***@domain.com');
      });

      it('should not mask very short emails (2 chars or less before @)', () => {
        const result = sanitizeEmail('ab@domain.com');
        expect(result).toBe('ab@domain.com');
      });

      it('should handle single character email', () => {
        const result = sanitizeEmail('a@domain.com');
        expect(result).toBe('a@domain.com');
      });

      it('should mask long email addresses', () => {
        const result = sanitizeEmail('verylongemailaddress@example.com');
        expect(result).toBe('ve***@example.com');
      });

      it('should handle email with subdomain', () => {
        const result = sanitizeEmail('user@mail.example.com');
        expect(result).toBe('us***@mail.example.com');
      });

      it('should handle email with plus addressing', () => {
        const result = sanitizeEmail('user+tag@example.com');
        expect(result).toBe('us***@example.com');
      });
    });

    describe('Edge cases', () => {
      it('should handle email without @ symbol', () => {
        const result = sanitizeEmail('notanemail');
        expect(result).toBe('notanemail');
      });

      it('should handle multiple @ symbols (mask based on first @)', () => {
        const result = sanitizeEmail('user@@example.com');
        // First @ is at index 4, so mask shows first 2 chars + *** + from first @
        expect(result).toBe('us***@@example.com');
      });

      it('should handle empty string', () => {
        const result = sanitizeEmail('');
        expect(result).toBe('');
      });

      it('should sanitize log injection in email', () => {
        const result = sanitizeEmail('user@example.com\nADMIN: Fake entry');
        expect(result).not.toContain('\n');
        expect(result).toBe('us***@example.com ADMIN: Fake entry');
      });

      it('should handle control characters in email', () => {
        const result = sanitizeEmail('user\x00@example\x1b.com');
        expect(result).not.toMatch(/[\x00-\x1F\x7F]/);
      });

      it('should truncate very long emails', () => {
        const longEmail = 'a'.repeat(600) + '@example.com';
        const result = sanitizeEmail(longEmail);

        // 500 chars + '...[truncated]' (14 chars) = 514 total
        expect(result.length).toBe(514);
        expect(result).toContain('[truncated]');
      });
    });

    describe('Unicode in emails', () => {
      it('should handle internationalized email addresses', () => {
        const result = sanitizeEmail('josé@example.com');
        expect(result).toBe('jo***@example.com');
      });

      it('should handle emoji in email (though invalid)', () => {
        const result = sanitizeEmail('user😀@example.com');
        expect(result).toBe('us***@example.com');
      });
    });
  });

  describe('sanitizeUserId', () => {
    describe('UUID truncation', () => {
      it('should truncate standard UUID to first 8 characters', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const result = sanitizeUserId(uuid);

        expect(result).toBe('550e8400...');
      });

      it('should truncate long user IDs', () => {
        const longId = 'verylonguserid123456789';
        const result = sanitizeUserId(longId);

        expect(result).toBe('verylong...');
      });

      it('should not truncate short user IDs', () => {
        const shortId = 'user123';
        const result = sanitizeUserId(shortId);

        expect(result).toBe('user123');
      });

      it('should handle exactly 8 character IDs', () => {
        const exactId = '12345678';
        const result = sanitizeUserId(exactId);

        expect(result).toBe('12345678');
      });

      it('should handle 9 character IDs (should truncate)', () => {
        const nineCharId = '123456789';
        const result = sanitizeUserId(nineCharId);

        expect(result).toBe('12345678...');
      });
    });

    describe('Edge cases', () => {
      it('should handle empty string', () => {
        const result = sanitizeUserId('');
        expect(result).toBe('');
      });

      it('should sanitize log injection in user ID', () => {
        const result = sanitizeUserId('user123\nADMIN: admin-id');
        expect(result).not.toContain('\n');
        expect(result).toBe('user123 ...');
      });

      it('should handle control characters in user ID', () => {
        // Input: 'user\x00123\x1b456\x7F'
        // ANSI escape \x1b followed by '4' is removed as escape sequence
        // Other control chars (\x00, \x7F) are removed
        // Result: 'user 12356' -> truncated to 8 chars + '...'
        const result = sanitizeUserId('user\x00123\x1b456\x7F');
        expect(result).not.toMatch(/[\x00-\x1F\x7F]/);
        expect(result).toBe('user1235...');
      });

      it('should handle very long user IDs', () => {
        const veryLongId = 'a'.repeat(1000);
        const result = sanitizeUserId(veryLongId);

        expect(result).toBe('aaaaaaaa...');
      });
    });

    describe('Special formats', () => {
      it('should handle numeric user IDs', () => {
        const result = sanitizeUserId('123456789012345');
        expect(result).toBe('12345678...');
      });

      it('should handle alphanumeric user IDs', () => {
        const result = sanitizeUserId('abc123def456');
        expect(result).toBe('abc123de...');
      });

      it('should handle user IDs with hyphens', () => {
        const result = sanitizeUserId('user-id-123-456');
        expect(result).toBe('user-id-...');
      });
    });
  });

  describe('sanitizeUrl', () => {
    describe('URL sanitization', () => {
      it('should sanitize standard URLs', () => {
        const url = 'https://example.com/path';
        const result = sanitizeUrl(url);

        expect(result).toBe('https://example.com/path');
      });

      it('should remove newlines from URLs', () => {
        const url = 'https://example.com\n/etc/passwd';
        const result = sanitizeUrl(url);

        expect(result).not.toContain('\n');
        expect(result).toBe('https://example.com /etc/passwd');
      });

      it('should handle URL with query parameters', () => {
        const url = 'https://example.com/search?q=test&page=1';
        const result = sanitizeUrl(url);

        expect(result).toBe('https://example.com/search?q=test&page=1');
      });

      it('should handle URL with fragment', () => {
        const url = 'https://example.com/page#section';
        const result = sanitizeUrl(url);

        expect(result).toBe('https://example.com/page#section');
      });
    });

    describe('Edge cases', () => {
      it('should handle empty URL', () => {
        const result = sanitizeUrl('');
        expect(result).toBe('');
      });

      it('should sanitize control characters in URL', () => {
        const url = 'https://example.com/path\x00\x1b';
        const result = sanitizeUrl(url);

        expect(result).not.toMatch(/[\x00-\x1F\x7F]/);
        expect(result).toBe('https://example.com/path');
      });

      it('should truncate very long URLs', () => {
        const longUrl = 'https://example.com/' + 'a'.repeat(600);
        const result = sanitizeUrl(longUrl);

        // 500 chars + '...[truncated]' (14 chars) = 514 total
        expect(result.length).toBe(514);
        expect(result).toContain('[truncated]');
      });

      it('should handle relative URLs', () => {
        const url = '/api/users/123';
        const result = sanitizeUrl(url);

        expect(result).toBe('/api/users/123');
      });

      it('should handle malformed URLs', () => {
        const url = 'not a valid url';
        const result = sanitizeUrl(url);

        expect(result).toBe('not a valid url');
      });
    });

    describe('Security payloads in URLs', () => {
      it('should sanitize log injection in URL', () => {
        const url = '/api/users\nERROR: Database error\nINFO: Hacked';
        const result = sanitizeUrl(url);

        expect(result).not.toContain('\n');
        expect(result).toBe('/api/users ERROR: Database error INFO: Hacked');
      });

      it('should handle URL with encoded characters', () => {
        const url = 'https://example.com/search?q=%20test%20';
        const result = sanitizeUrl(url);

        expect(result).toBe('https://example.com/search?q=%20test%20');
      });

      it('should handle URL with special characters', () => {
        const url = 'https://user:pass@example.com:8080/path';
        const result = sanitizeUrl(url);

        expect(result).toBe('https://user:pass@example.com:8080/path');
      });
    });
  });

  describe('sanitizeIp', () => {
    describe('Valid IPv4 addresses', () => {
      it('should accept valid IPv4 address', () => {
        expect(sanitizeIp('192.168.1.1')).toBe('192.168.1.1');
        expect(sanitizeIp('10.0.0.1')).toBe('10.0.0.1');
        expect(sanitizeIp('172.16.0.1')).toBe('172.16.0.1');
        expect(sanitizeIp('127.0.0.1')).toBe('127.0.0.1');
      });

      it('should accept edge IPv4 addresses', () => {
        expect(sanitizeIp('0.0.0.0')).toBe('0.0.0.0');
        expect(sanitizeIp('255.255.255.255')).toBe('255.255.255.255');
      });

      it('should accept localhost', () => {
        expect(sanitizeIp('127.0.0.1')).toBe('127.0.0.1');
      });
    });

    describe('Valid IPv6 addresses', () => {
      it('should accept full IPv6 address', () => {
        const ipv6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
        expect(sanitizeIp(ipv6)).toBe(ipv6);
      });

      it('should accept compressed IPv6 address', () => {
        const ipv6 = '2001:db8::1';
        expect(sanitizeIp(ipv6)).toBe(ipv6);
      });

      it('should accept IPv6 loopback', () => {
        expect(sanitizeIp('::1')).toBe('::1');
      });

      it('should accept IPv6 with mixed case', () => {
        const ipv6 = '2001:0DB8:85A3::8A2E:0370:7334';
        expect(sanitizeIp(ipv6)).toBe(ipv6);
      });

      it('should accept abbreviated IPv6', () => {
        expect(sanitizeIp('fe80::1')).toBe('fe80::1');
        expect(sanitizeIp('::ffff:192.0.2.1')).toBe('::ffff:192.0.2.1');
      });
    });

    describe('Invalid IP addresses', () => {
      it('should reject IPs with invalid characters (not format validation)', () => {
        // Note: sanitizeIp only validates character set, not IP format
        // 999.999.999.999 passes because it contains only valid chars
        // For format validation, use a dedicated IP validation library
        expect(sanitizeIp('192.168.x.1')).toBe('invalid-ip');
        expect(sanitizeIp('abc.def.ghi.jkl')).toBe('invalid-ip');
      });

      it('should reject IP with invalid letters (g-z except for IPv6 hex)', () => {
        expect(sanitizeIp('192.168.x.1')).toBe('invalid-ip');
        expect(sanitizeIp('ghij.klmn.opqr.stuv')).toBe('invalid-ip');
      });

      it('should reject IP with special characters', () => {
        expect(sanitizeIp('192.168.1.1;')).toBe('invalid-ip');
        expect(sanitizeIp('192.168.1.1\n')).toBe('invalid-ip');
        expect(sanitizeIp('192.168.1.1@')).toBe('invalid-ip');
      });

      it('should reject empty string', () => {
        expect(sanitizeIp('')).toBe('unknown');
      });

      it('should reject invalid characters', () => {
        expect(sanitizeIp('192.168.1.1/24')).toBe('invalid-ip');
        expect(sanitizeIp('192.168.1.1-254')).toBe('invalid-ip');
      });
    });

    describe('Edge cases', () => {
      it('should handle undefined IP', () => {
        expect(sanitizeIp(undefined)).toBe('unknown');
      });

      it('should handle IP with control characters', () => {
        // Control chars are sanitized first, leaving valid IP
        const ip = '192.168.1.1\x00\x1b';
        expect(sanitizeIp(ip)).toBe('192.168.1.1');
      });

      it('should handle very long IP string', () => {
        const longIp = '192.168.1.1' + 'x'.repeat(1000);
        expect(sanitizeIp(longIp)).toBe('invalid-ip');
      });

      it('should handle IP with whitespace', () => {
        expect(sanitizeIp(' 192.168.1.1 ')).toBe('invalid-ip');
        expect(sanitizeIp('192.168. 1.1')).toBe('invalid-ip');
      });
    });

    describe('Log injection attempts', () => {
      it('should prevent log injection in IP field', () => {
        const ip = '192.168.1.1\nERROR: Fake error\nADMIN: admin-ip';
        expect(sanitizeIp(ip)).toBe('invalid-ip');
      });

      it('should prevent command injection in IP field', () => {
        const ip = '192.168.1.1; rm -rf /';
        expect(sanitizeIp(ip)).toBe('invalid-ip');
      });

      it('should prevent SQL injection in IP field', () => {
        const ip = "192.168.1.1' OR '1'='1";
        expect(sanitizeIp(ip)).toBe('invalid-ip');
      });

      it('should prevent script injection in IP field', () => {
        const ip = '192.168.1.1<script>alert(1)</script>';
        expect(sanitizeIp(ip)).toBe('invalid-ip');
      });

      it('should handle null bytes in IP', () => {
        const ip = '192.168.1.1\x00malicious';
        expect(sanitizeIp(ip)).toBe('invalid-ip');
      });
    });

    describe('Common formats', () => {
      it('should accept only digits, dots, and colons', () => {
        // Valid IPv4 and IPv6 characters only
        expect(sanitizeIp('192.168.1.1')).toBe('192.168.1.1');
        expect(sanitizeIp('2001:db8::1')).toBe('2001:db8::1');
      });

      it('should accept hex digits a-f for IPv6', () => {
        expect(sanitizeIp('2001:0abc:0def:1234::1')).toBe('2001:0abc:0def:1234::1');
        expect(sanitizeIp('ABCD:EF01:2345::1')).toBe('ABCD:EF01:2345::1');
      });

      it('should reject invalid hex digits g-z', () => {
        expect(sanitizeIp('2001:ghij::1')).toBe('invalid-ip');
        expect(sanitizeIp('xyz::1')).toBe('invalid-ip');
      });
    });
  });

  describe('Integration scenarios', () => {
    it('should sanitize complete log entry with multiple fields', () => {
      const email = sanitizeEmail('user@example.com\nFake log');
      const userId = sanitizeUserId('12345678-abcd-efgh-ijkl-mnopqrstuvwx');
      const url = sanitizeUrl('/api/login\nERROR: Hacked');
      const ip = sanitizeIp('192.168.1.1');

      expect(email).not.toContain('\n');
      expect(userId).toBe('12345678...');
      expect(url).not.toContain('\n');
      expect(ip).toBe('192.168.1.1');
    });

    it('should handle all sanitization functions with control characters', () => {
      const controlStr = 'value\x00\x1b\r\n';

      expect(sanitizeLogValue(controlStr)).not.toMatch(/[\x00-\x1F\x7F]/);
      expect(sanitizeEmail(`user${controlStr}@example.com`)).not.toMatch(/[\x00-\x1F\x7F]/);
      expect(sanitizeUserId(controlStr)).not.toMatch(/[\x00-\x1F\x7F]/);
      expect(sanitizeUrl(`https://example.com${controlStr}`)).not.toMatch(/[\x00-\x1F\x7F]/);
    });

    it('should handle null/undefined consistently across functions', () => {
      expect(sanitizeLogValue(null)).toBe('null');
      expect(sanitizeLogValue(undefined)).toBe('undefined');
      expect(sanitizeIp(undefined)).toBe('unknown');
    });
  });
});
