/* eslint-disable no-console -- Safe access utility uses console for security warnings */
/* eslint-disable security/detect-object-injection -- This utility is specifically designed for safe object access */
/**
 * Safe Object Property Access Utility
 *
 * Prevents object injection vulnerabilities by validating property access
 * against an allowed list of keys before accessing object properties.
 *
 * @example
 * ```typescript
 * const ALLOWED_USER_KEYS = ['id', 'email', 'name', 'role'] as const;
 * const safeGetUserProp = createSafeAccessor(ALLOWED_USER_KEYS);
 *
 * const email = safeGetUserProp(user, 'email'); // Safe
 * const unsafe = safeGetUserProp(user, '__proto__'); // Returns undefined, logs warning
 * ```
 */

/**
 * Creates a type-safe property accessor function
 *
 * @param allowedKeys - Readonly array of allowed property names
 * @returns Safe accessor function that validates keys before access
 */
export function createSafeAccessor<T extends readonly string[]>(
  allowedKeys: T
) {
  type AllowedKey = T[number];

  /**
   * Safely gets a property value from an object
   *
   * @param obj - Object to access
   * @param key - Property key to retrieve
   * @returns Property value if key is allowed, undefined otherwise
   */
  return function safeGet<V>(
    obj: Record<string, V>,
    key: string
  ): V | undefined {
    if (allowedKeys.includes(key as AllowedKey)) {
      return obj[key];
    }

    // Log security warning for attempted access to non-allowed key
    console.warn(`[Security] Invalid key access attempt: "${key}". Allowed keys:`, allowedKeys);
    return undefined;
  };
}

/**
 * Common allowed keys for translation objects
 */
export const TRANSLATION_KEYS = [
  'title',
  'description',
  'label',
  'placeholder',
  'error',
  'success',
  'warning',
  'info',
  'message',
  'hint',
  'help'
] as const;

/**
 * Common allowed keys for user objects
 */
export const USER_KEYS = [
  'id',
  'email',
  'firstName',
  'lastName',
  'name',
  'role',
  'createdAt',
  'updatedAt'
] as const;

/**
 * Common allowed keys for loyalty objects
 */
export const LOYALTY_KEYS = [
  'userId',
  'currentPoints',
  'tierName',
  'tierLevel',
  'pointsToNextTier',
  'lifetimePoints',
  'updatedAt'
] as const;

/**
 * Pre-configured safe accessors for common use cases
 */
export const safeGetTranslation = createSafeAccessor(TRANSLATION_KEYS);
export const safeGetUserProp = createSafeAccessor(USER_KEYS);
export const safeGetLoyaltyProp = createSafeAccessor(LOYALTY_KEYS);
