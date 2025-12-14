import { describe, it, expect } from 'vitest';
import { createSafeAccessor, safeGetTranslation, safeGetUserProp, safeGetLoyaltyProp } from '../safeAccess';

describe('safeAccess - Security Tests', () => {
  describe('createSafeAccessor', () => {
    it('should create a safe accessor function', () => {
      const ALLOWED_KEYS = ['name', 'email'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      expect(typeof safeGet).toBe('function');
    });

    it('should allow access to allowed keys', () => {
      const ALLOWED_KEYS = ['name', 'email', 'id'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      const obj = { name: 'John', email: 'john@example.com', id: '123' };

      expect(safeGet(obj, 'name')).toBe('John');
      expect(safeGet(obj, 'email')).toBe('john@example.com');
      expect(safeGet(obj, 'id')).toBe('123');
    });

    it('should prevent access to disallowed keys', () => {
      const ALLOWED_KEYS = ['name', 'email'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      const obj = { name: 'John', email: 'john@example.com', secret: 'sensitive' };

      expect(safeGet(obj, 'secret')).toBeUndefined();
    });

    it('should prevent __proto__ pollution', () => {
      const ALLOWED_KEYS = ['name', 'email'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      const obj: Record<string, string> = { name: 'John', email: 'john@example.com' };

      // Attempt to access __proto__
      const result = safeGet(obj, '__proto__');

      expect(result).toBeUndefined();
      // Verify prototype wasn't polluted
      expect(Object.prototype).not.toHaveProperty('polluted');
    });

    it('should prevent constructor access', () => {
      const ALLOWED_KEYS = ['name', 'email'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      const obj: Record<string, string> = { name: 'John', email: 'john@example.com' };

      const result = safeGet(obj, 'constructor');

      expect(result).toBeUndefined();
    });

    it('should handle non-existent allowed keys gracefully', () => {
      const ALLOWED_KEYS = ['name', 'email', 'phone'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      const obj: Record<string, string> = { name: 'John', email: 'john@example.com' };

      expect(safeGet(obj, 'phone')).toBeUndefined();
    });

    it('should work with different value types', () => {
      const ALLOWED_KEYS = ['count', 'active', 'data'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      const obj: Record<string, any> = {
        count: 42,
        active: true,
        data: { nested: 'value' }
      };

      expect(safeGet(obj, 'count')).toBe(42);
      expect(safeGet(obj, 'active')).toBe(true);
      expect(safeGet(obj, 'data')).toEqual({ nested: 'value' });
    });
  });

  describe('Pre-configured safe accessors', () => {
    describe('safeGetTranslation', () => {
      it('should allow access to translation keys', () => {
        const translations = {
          title: 'Hello',
          description: 'Welcome message',
          label: 'Name',
          placeholder: 'Enter name'
        };

        expect(safeGetTranslation(translations, 'title')).toBe('Hello');
        expect(safeGetTranslation(translations, 'description')).toBe('Welcome message');
      });

      it('should prevent access to non-translation keys', () => {
        const obj: Record<string, string> = Object.create(null);
        obj.title = 'Hello';
        // Explicitly set __proto__ as a data property to simulate prototype pollution input
        Object.defineProperty(obj, '__proto__', {
          value: Object.prototype, // use an object value to avoid invalid prototype warnings
          enumerable: true,
          writable: true,
          configurable: true
        });

        expect(safeGetTranslation(obj, '__proto__')).toBeUndefined();
      });
    });

    describe('safeGetUserProp', () => {
      it('should allow access to user property keys', () => {
        const user = {
          id: 'user-123',
          email: 'user@example.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'customer'
        };

        expect(safeGetUserProp(user, 'id')).toBe('user-123');
        expect(safeGetUserProp(user, 'email')).toBe('user@example.com');
        expect(safeGetUserProp(user, 'firstName')).toBe('John');
      });

      it('should prevent access to sensitive properties', () => {
        const user: Record<string, string> = {
          id: 'user-123',
          email: 'user@example.com',
          password: 'secret123'
        };

        expect(safeGetUserProp(user, 'password')).toBeUndefined();
      });
    });

    describe('safeGetLoyaltyProp', () => {
      it('should allow access to loyalty property keys', () => {
        const loyalty = {
          userId: 'user-123',
          currentPoints: 500,
          tierName: 'Gold',
          tierLevel: 2
        };

        expect(safeGetLoyaltyProp(loyalty, 'userId')).toBe('user-123');
        expect(safeGetLoyaltyProp(loyalty, 'currentPoints')).toBe(500);
        expect(safeGetLoyaltyProp(loyalty, 'tierName')).toBe('Gold');
      });

      it('should prevent access to non-loyalty keys', () => {
        const obj: Record<string, any> = {
          userId: 'user-123',
          currentPoints: 500,
          internalData: 'sensitive'
        };

        expect(safeGetLoyaltyProp(obj, 'internalData')).toBeUndefined();
      });
    });
  });

  describe('Security Attack Scenarios', () => {
    it('should prevent prototype pollution via __proto__', () => {
      const ALLOWED_KEYS = ['data'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      const maliciousKey = '__proto__';
      const obj: Record<string, any> = {};

      // Attempt pollution
      const result = safeGet(obj, maliciousKey);

      expect(result).toBeUndefined();
      // Verify Object.prototype is clean
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('should prevent constructor modification attacks', () => {
      const ALLOWED_KEYS = ['data'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      const obj: Record<string, any> = { data: 'safe' };

      const result = safeGet(obj, 'constructor');

      expect(result).toBeUndefined();
    });

    it('should handle empty string as key', () => {
      const ALLOWED_KEYS = ['name', 'email'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      const obj: Record<string, string> = { name: 'John', '': 'empty key value' };

      expect(safeGet(obj, '')).toBeUndefined();
    });

    it('should handle numeric string keys safely', () => {
      const ALLOWED_KEYS = ['name', 'email'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      const obj: Record<string, any> = { name: 'John', '0': 'numeric key' };

      expect(safeGet(obj, '0')).toBeUndefined();
    });

    it('should handle special characters in keys', () => {
      const ALLOWED_KEYS = ['name', 'email'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      const obj: Record<string, any> = {
        name: 'John',
        'eval': 'dangerous',
        'toString': 'overridden'
      };

      expect(safeGet(obj, 'eval')).toBeUndefined();
      expect(safeGet(obj, 'toString')).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null object gracefully', () => {
      const ALLOWED_KEYS = ['name'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      // TypeScript won't allow this, but runtime might
      expect(() => safeGet(null as any, 'name')).toThrow();
    });

    it('should handle undefined values in allowed keys', () => {
      const ALLOWED_KEYS = ['name', 'optional'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      const obj: Record<string, string | undefined> = {
        name: 'John',
        optional: undefined
      };

      expect(safeGet(obj, 'optional')).toBeUndefined();
    });

    it('should handle objects with null prototype', () => {
      const ALLOWED_KEYS = ['name'] as const;
      const safeGet = createSafeAccessor(ALLOWED_KEYS);

      const obj = Object.create(null);
      obj.name = 'John';

      expect(safeGet(obj, 'name')).toBe('John');
    });
  });
});
