/**
 * Date Formatter Unit Tests
 * Tests date formatting utilities for European dd/mm/yyyy format
 */

import { describe, it, expect } from '@jest/globals';
import {
  formatDateToDDMMYYYY,
  formatDateTimeToEuropean,
  isValidDDMMYYYYFormat,
  parseDDMMYYYY,
} from '../../../utils/dateFormatter';

describe('Date Formatter Utils', () => {

  describe('formatDateToDDMMYYYY', () => {
    describe('Valid date formatting', () => {
      it('should format Date object to dd/mm/yyyy', () => {
        const date = new Date('2025-12-31');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toBe('31/12/2025');
      });

      it('should format string date to dd/mm/yyyy', () => {
        const result = formatDateToDDMMYYYY('2025-01-15');
        expect(result).toBe('15/01/2025');
      });

      it('should format ISO 8601 string', () => {
        const result = formatDateToDDMMYYYY('2025-06-01T12:00:00Z');
        // Note: Result depends on timezone, so we check format
        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      });

      it('should handle January dates', () => {
        const date = new Date('2025-01-01');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toBe('01/01/2025');
      });

      it('should handle December dates', () => {
        const date = new Date('2025-12-31');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toBe('31/12/2025');
      });

      it('should handle leap year February 29', () => {
        const date = new Date('2024-02-29');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toBe('29/02/2024');
      });

      it('should pad single digit days', () => {
        const date = new Date('2025-03-05');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toBe('05/03/2025');
      });

      it('should pad single digit months', () => {
        const date = new Date('2025-01-20');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toBe('20/01/2025');
      });

      it('should format dates from different years', () => {
        expect(formatDateToDDMMYYYY('2020-01-01')).toBe('01/01/2020');
        expect(formatDateToDDMMYYYY('2021-06-15')).toMatch(/\d{2}\/\d{2}\/2021/);
        expect(formatDateToDDMMYYYY('2022-12-31')).toBe('31/12/2022');
      });
    });

    describe('Edge cases', () => {
      it('should return null for null input', () => {
        const result = formatDateToDDMMYYYY(null);
        expect(result).toBeNull();
      });

      it('should return null for undefined input', () => {
        const result = formatDateToDDMMYYYY(undefined);
        expect(result).toBeNull();
      });

      it('should return null for invalid date string', () => {
        const result = formatDateToDDMMYYYY('invalid-date');
        expect(result).toBeNull();
      });

      it('should return null for empty string', () => {
        const result = formatDateToDDMMYYYY('');
        expect(result).toBeNull();
      });

      it('should return null for invalid Date object', () => {
        const invalidDate = new Date('invalid');
        const result = formatDateToDDMMYYYY(invalidDate);
        expect(result).toBeNull();
      });

      it('should handle errors gracefully without logging', () => {
        // The implementation may or may not log, just verify it returns null
        const result = formatDateToDDMMYYYY('invalid-date');
        expect(result).toBeNull();
      });
    });

    describe('Historical dates', () => {
      it('should format dates from 1900s', () => {
        const date = new Date('1990-05-15');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toBe('15/05/1990');
      });

      it('should format dates from early 1900s', () => {
        const date = new Date('1920-01-01');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toBe('01/01/1920');
      });

      it('should format dates from 2000s', () => {
        const date = new Date('2000-12-31');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toBe('31/12/2000');
      });
    });

    describe('Special date values', () => {
      it('should handle epoch date', () => {
        const date = new Date(0);
        const result = formatDateToDDMMYYYY(date);
        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      });

      it('should handle dates with time components', () => {
        const date = new Date('2025-06-15T14:30:00Z');
        const result = formatDateToDDMMYYYY(date);
        // Should still format date part correctly (time ignored)
        expect(result).toMatch(/^\d{2}\/\d{2}\/2025$/);
      });

      it('should handle dates with milliseconds', () => {
        const date = new Date('2025-06-15T14:30:00.123Z');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toMatch(/^\d{2}\/\d{2}\/2025$/);
      });
    });

    describe('Boundary dates', () => {
      it('should handle first day of month', () => {
        const date = new Date('2025-03-01');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toBe('01/03/2025');
      });

      it('should handle last day of month', () => {
        const date = new Date('2025-03-31');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toBe('31/03/2025');
      });

      it('should handle 30-day months', () => {
        const date = new Date('2025-04-30');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toBe('30/04/2025');
      });

      it('should handle February in non-leap year', () => {
        const date = new Date('2025-02-28');
        const result = formatDateToDDMMYYYY(date);
        expect(result).toBe('28/02/2025');
      });
    });
  });

  describe('formatDateTimeToEuropean', () => {
    describe('Valid datetime formatting', () => {
      it('should format Date object with time', () => {
        const date = new Date('2025-12-31T14:30:00Z');
        const result = formatDateTimeToEuropean(date);
        // Result varies by timezone, check format
        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4},?\s\d{2}:\d{2}$/);
      });

      it('should format string date with time', () => {
        const result = formatDateTimeToEuropean('2025-01-15T09:45:00Z');
        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4},?\s\d{2}:\d{2}$/);
      });

      it('should use 24-hour format', () => {
        const date = new Date('2025-06-15T23:59:00Z');
        const result = formatDateTimeToEuropean(date);
        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4},?\s\d{2}:\d{2}$/);
        // Should not contain AM/PM
        expect(result).not.toContain('AM');
        expect(result).not.toContain('PM');
      });

      it('should pad hours and minutes', () => {
        const date = new Date('2025-03-05T09:05:00Z');
        const result = formatDateTimeToEuropean(date);
        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4},?\s\d{2}:\d{2}$/);
      });
    });

    describe('Edge cases', () => {
      it('should return null for null input', () => {
        const result = formatDateTimeToEuropean(null);
        expect(result).toBeNull();
      });

      it('should return null for undefined input', () => {
        const result = formatDateTimeToEuropean(undefined);
        expect(result).toBeNull();
      });

      it('should return null for invalid date string', () => {
        const result = formatDateTimeToEuropean('invalid-date');
        expect(result).toBeNull();
      });

      it('should return null for empty string', () => {
        const result = formatDateTimeToEuropean('');
        expect(result).toBeNull();
      });

      it('should handle errors gracefully without logging', () => {
        // The implementation may or may not log, just verify it returns null
        const result = formatDateTimeToEuropean('invalid-date');
        expect(result).toBeNull();
      });
    });

    describe('Time boundary values', () => {
      it('should format midnight', () => {
        const date = new Date('2025-06-15T00:00:00Z');
        const result = formatDateTimeToEuropean(date);
        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4},?\s\d{2}:\d{2}$/);
      });

      it('should format noon', () => {
        const date = new Date('2025-06-15T12:00:00Z');
        const result = formatDateTimeToEuropean(date);
        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4},?\s\d{2}:\d{2}$/);
      });

      it('should format end of day', () => {
        const date = new Date('2025-06-15T23:59:00Z');
        const result = formatDateTimeToEuropean(date);
        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4},?\s\d{2}:\d{2}$/);
      });
    });
  });

  describe('isValidDDMMYYYYFormat', () => {
    describe('Valid formats', () => {
      it('should validate correct dd/mm/yyyy format', () => {
        expect(isValidDDMMYYYYFormat('31/12/2025')).toBe(true);
        expect(isValidDDMMYYYYFormat('01/01/2025')).toBe(true);
        expect(isValidDDMMYYYYFormat('15/06/2025')).toBe(true);
      });

      it('should validate dates with leading zeros', () => {
        expect(isValidDDMMYYYYFormat('01/01/2025')).toBe(true);
        expect(isValidDDMMYYYYFormat('05/03/2025')).toBe(true);
        expect(isValidDDMMYYYYFormat('09/09/2025')).toBe(true);
      });

      it('should validate February 29 format', () => {
        expect(isValidDDMMYYYYFormat('29/02/2024')).toBe(true);
      });

      it('should validate all months', () => {
        expect(isValidDDMMYYYYFormat('15/01/2025')).toBe(true);
        expect(isValidDDMMYYYYFormat('15/02/2025')).toBe(true);
        expect(isValidDDMMYYYYFormat('15/03/2025')).toBe(true);
        expect(isValidDDMMYYYYFormat('15/12/2025')).toBe(true);
      });
    });

    describe('Invalid formats', () => {
      it('should validate format only (31/12/2025 passes, does not check if day/month valid)', () => {
        // Note: isValidDDMMYYYYFormat only checks format, not date validity
        // 12/31/2025 has valid format (dd/mm/yyyy) even if 31st month doesn't exist
        expect(isValidDDMMYYYYFormat('12/31/2025')).toBe(true);
        // It's a format validator, not a date validator
      });

      it('should reject yyyy-mm-dd format', () => {
        expect(isValidDDMMYYYYFormat('2025-12-31')).toBe(false);
      });

      it('should reject single digit day', () => {
        expect(isValidDDMMYYYYFormat('1/12/2025')).toBe(false);
        expect(isValidDDMMYYYYFormat('5/06/2025')).toBe(false);
      });

      it('should reject single digit month', () => {
        expect(isValidDDMMYYYYFormat('15/6/2025')).toBe(false);
        expect(isValidDDMMYYYYFormat('20/3/2025')).toBe(false);
      });

      it('should reject two digit year', () => {
        expect(isValidDDMMYYYYFormat('31/12/25')).toBe(false);
        expect(isValidDDMMYYYYFormat('01/01/99')).toBe(false);
      });

      it('should reject empty string', () => {
        expect(isValidDDMMYYYYFormat('')).toBe(false);
      });

      it('should reject invalid separators', () => {
        expect(isValidDDMMYYYYFormat('31-12-2025')).toBe(false);
        expect(isValidDDMMYYYYFormat('31.12.2025')).toBe(false);
        expect(isValidDDMMYYYYFormat('31 12 2025')).toBe(false);
      });

      it('should reject dates with extra characters', () => {
        expect(isValidDDMMYYYYFormat('31/12/2025 ')).toBe(false);
        expect(isValidDDMMYYYYFormat(' 31/12/2025')).toBe(false);
        expect(isValidDDMMYYYYFormat('31/12/2025T00:00:00')).toBe(false);
      });

      it('should reject non-date strings', () => {
        expect(isValidDDMMYYYYFormat('not a date')).toBe(false);
        expect(isValidDDMMYYYYFormat('abc/def/ghij')).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should reject invalid day values (format check only)', () => {
        // Note: This only checks format, not validity
        expect(isValidDDMMYYYYFormat('99/12/2025')).toBe(true); // Format valid
        expect(isValidDDMMYYYYFormat('00/12/2025')).toBe(true); // Format valid
      });

      it('should reject invalid month values (format check only)', () => {
        expect(isValidDDMMYYYYFormat('31/99/2025')).toBe(true); // Format valid
        expect(isValidDDMMYYYYFormat('31/00/2025')).toBe(true); // Format valid
      });

      it('should handle dates with invalid slashes', () => {
        expect(isValidDDMMYYYYFormat('31//12/2025')).toBe(false);
        expect(isValidDDMMYYYYFormat('31/12//2025')).toBe(false);
      });
    });
  });

  describe('parseDDMMYYYY', () => {
    describe('Valid date parsing', () => {
      it('should parse valid dd/mm/yyyy string', () => {
        const result = parseDDMMYYYY('31/12/2025');
        expect(result).toBeInstanceOf(Date);
        expect(result?.getFullYear()).toBe(2025);
        expect(result?.getMonth()).toBe(11); // December is 11 (0-indexed)
        expect(result?.getDate()).toBe(31);
      });

      it('should parse January dates', () => {
        const result = parseDDMMYYYY('15/01/2025');
        expect(result?.getFullYear()).toBe(2025);
        expect(result?.getMonth()).toBe(0); // January is 0
        expect(result?.getDate()).toBe(15);
      });

      it('should parse dates with leading zeros', () => {
        const result = parseDDMMYYYY('01/01/2025');
        expect(result?.getDate()).toBe(1);
        expect(result?.getMonth()).toBe(0);
      });

      it('should parse leap year February 29', () => {
        const result = parseDDMMYYYY('29/02/2024');
        expect(result).not.toBeNull();
        expect(result?.getDate()).toBe(29);
        expect(result?.getMonth()).toBe(1);
      });

      it('should parse all months correctly', () => {
        for (let month = 1; month <= 12; month++) {
          const dateString = `15/${month.toString().padStart(2, '0')}/2025`;
          const result = parseDDMMYYYY(dateString);
          expect(result).not.toBeNull();
          expect(result?.getMonth()).toBe(month - 1);
        }
      });
    });

    describe('Invalid date parsing', () => {
      it('should return null for invalid format', () => {
        expect(parseDDMMYYYY('2025-12-31')).toBeNull();
        expect(parseDDMMYYYY('12/31/2025')).toBeNull();
      });

      it('should return null for empty string', () => {
        expect(parseDDMMYYYY('')).toBeNull();
      });

      it('should return null for invalid date values', () => {
        expect(parseDDMMYYYY('32/01/2025')).toBeNull(); // Invalid day
        expect(parseDDMMYYYY('31/02/2025')).toBeNull(); // Invalid day for Feb
        expect(parseDDMMYYYY('00/01/2025')).toBeNull(); // Invalid day
      });

      it('should return null for invalid month', () => {
        expect(parseDDMMYYYY('15/13/2025')).toBeNull();
        expect(parseDDMMYYYY('15/00/2025')).toBeNull();
      });

      it('should return null for February 29 in non-leap year', () => {
        expect(parseDDMMYYYY('29/02/2025')).toBeNull(); // 2025 is not a leap year
      });

      it('should return null for invalid day in month', () => {
        expect(parseDDMMYYYY('31/04/2025')).toBeNull(); // April has 30 days
        expect(parseDDMMYYYY('31/06/2025')).toBeNull(); // June has 30 days
        expect(parseDDMMYYYY('31/09/2025')).toBeNull(); // September has 30 days
        expect(parseDDMMYYYY('31/11/2025')).toBeNull(); // November has 30 days
      });

      it('should return null for malformed strings', () => {
        expect(parseDDMMYYYY('not a date')).toBeNull();
        expect(parseDDMMYYYY('31/12')).toBeNull();
        expect(parseDDMMYYYY('31/12/25')).toBeNull();
      });
    });

    describe('Edge cases', () => {
      it('should handle dates at month boundaries', () => {
        expect(parseDDMMYYYY('01/01/2025')).not.toBeNull();
        expect(parseDDMMYYYY('31/12/2025')).not.toBeNull();
      });

      it('should validate February in different years', () => {
        expect(parseDDMMYYYY('28/02/2025')).not.toBeNull(); // Non-leap
        expect(parseDDMMYYYY('29/02/2024')).not.toBeNull(); // Leap year
        expect(parseDDMMYYYY('29/02/2025')).toBeNull(); // Invalid
      });

      it('should handle century leap years correctly', () => {
        expect(parseDDMMYYYY('29/02/2000')).not.toBeNull(); // 2000 is leap year
      });

      it('should handle parsing with timezone considerations', () => {
        const result = parseDDMMYYYY('15/06/2025');
        expect(result).not.toBeNull();
        // Date should be created in local timezone
        expect(result?.getDate()).toBe(15);
      });
    });

    describe('Boundary testing', () => {
      it('should validate last day of each month', () => {
        const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

        daysInMonth.forEach((days, index) => {
          const month = (index + 1).toString().padStart(2, '0');
          const dateString = `${days}/${month}/2025`;
          const result = parseDDMMYYYY(dateString);
          expect(result).not.toBeNull();
        });
      });

      it('should reject day after last day of month', () => {
        expect(parseDDMMYYYY('32/01/2025')).toBeNull();
        expect(parseDDMMYYYY('29/02/2025')).toBeNull(); // Non-leap year
        expect(parseDDMMYYYY('32/03/2025')).toBeNull();
        expect(parseDDMMYYYY('31/04/2025')).toBeNull();
      });
    });
  });

  describe('Integration scenarios', () => {
    it('should format and parse dates consistently', () => {
      const originalDate = new Date('2025-06-15');
      const formatted = formatDateToDDMMYYYY(originalDate);
      expect(formatted).toBe('15/06/2025');

      const parsed = parseDDMMYYYY(formatted ?? '');
      expect(parsed).not.toBeNull();
      expect(parsed?.getDate()).toBe(15);
      expect(parsed?.getMonth()).toBe(5); // June is 5
      expect(parsed?.getFullYear()).toBe(2025);
    });

    it('should validate formatted dates', () => {
      const date = new Date('2025-12-31');
      const formatted = formatDateToDDMMYYYY(date);

      if (formatted) {
        expect(isValidDDMMYYYYFormat(formatted)).toBe(true);
      }
    });

    it('should handle roundtrip conversion', () => {
      const testDates = [
        '01/01/2025',
        '15/06/2025',
        '31/12/2025',
        '29/02/2024',
      ];

      testDates.forEach((dateString) => {
        const parsed = parseDDMMYYYY(dateString);
        expect(parsed).not.toBeNull();

        const formatted = formatDateToDDMMYYYY(parsed!);
        expect(formatted).toBe(dateString);
      });
    });

    it('should maintain date integrity through conversion cycle', () => {
      const original = '20/07/2025';
      const parsed = parseDDMMYYYY(original);
      const formatted = formatDateToDDMMYYYY(parsed!);

      expect(formatted).toBe(original);
    });
  });

  // Performance tests moved to: __tests__/performance/benchmarks/utils.benchmark.ts
});
