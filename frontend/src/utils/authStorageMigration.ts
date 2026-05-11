/**
 * One-time browser-side cleanup tied to the HttpOnly-cookie refresh-token
 * migration (Phase 2 of PR #194's three-phase rollout).
 *
 * Before Phase 2, the frontend persisted the refresh token to
 * `localStorage` — both inside the Zustand `auth-storage` blob and, for
 * defence-in-depth against any prior code path, potentially as a
 * top-level `refreshToken` key. After Phase 2 the refresh token lives
 * only in the browser's HttpOnly cookie jar (`refresh_token`), set by
 * the backend on /login, /register, /refresh and the OAuth callbacks.
 *
 * This helper scrubs both surfaces on app startup so the stale value
 * can't be read by any future code path (e.g. an XSS payload, a
 * regression that re-introduces a localStorage read, or an old browser
 * tab that hasn't reloaded yet).
 *
 * Idempotent: safe to call on every app startup.
 *
 * Risk note: a user with an in-flight session at deploy time will have
 * had their old localStorage refresh token *removed* by this helper. If
 * the backend cookie was never set (e.g. they logged in before Phase 1
 * shipped and never refreshed since), the next 401 will force-logout
 * them. That is an accepted one-time UX cost (single re-login).
 */

import { logger } from './logger';

const AUTH_STORAGE_KEY = 'auth-storage';
const TOP_LEVEL_REFRESH_TOKEN_KEY = 'refreshToken';

interface PersistedAuthBlob {
  state?: Record<string, unknown> & { refreshToken?: unknown };
  version?: number;
}

/**
 * Result of the migration scrub. Useful for tests and dev-mode logging
 * so we can prove the cleanup actually fired (or short-circuited
 * because there was nothing to remove).
 */
export interface AuthStorageMigrationResult {
  /** True if a top-level `refreshToken` localStorage key was removed. */
  removedTopLevelRefreshToken: boolean;
  /** True if `state.refreshToken` was deleted from the auth-storage blob. */
  removedNestedRefreshToken: boolean;
  /** True if reading or rewriting auth-storage threw — non-fatal. */
  encounteredError: boolean;
}

/**
 * Scrub any stale refresh-token material from `localStorage` left over
 * from before the HttpOnly-cookie migration. Called once during app
 * startup (see `App.tsx#initializeAuth`).
 *
 * Optional `storage` arg lets tests inject a mock. Defaults to
 * `window.localStorage` in the browser; if `localStorage` isn't
 * available (SSR, very old runtimes) the function is a no-op.
 */
export function migrateAuthStorageForCookieRefreshToken(
  storage: Storage | null = typeof window !== 'undefined' ? window.localStorage : null,
): AuthStorageMigrationResult {
  const result: AuthStorageMigrationResult = {
    removedTopLevelRefreshToken: false,
    removedNestedRefreshToken: false,
    encounteredError: false,
  };

  if (!storage) {
    return result;
  }

  // 1. Remove a top-level `refreshToken` key if any code path ever wrote
  //    one. We never wrote this in our codebase, but custom integrations
  //    or third-party plugins might have, so we scrub defensively.
  try {
    if (storage.getItem(TOP_LEVEL_REFRESH_TOKEN_KEY) !== null) {
      storage.removeItem(TOP_LEVEL_REFRESH_TOKEN_KEY);
      result.removedTopLevelRefreshToken = true;
      logger.debug('Phase 2 migration: removed stale top-level refreshToken from localStorage');
    }
  } catch (error) {
    result.encounteredError = true;
    logger.warn('Phase 2 migration: failed to remove top-level refreshToken:', error);
  }

  // 2. Remove `state.refreshToken` from the persisted Zustand blob.
  //    Zustand's `partialize` no longer includes it, but the *existing*
  //    persisted blob on a returning user's machine still does until we
  //    rewrite it.
  try {
    const raw = storage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedAuthBlob;
      if (parsed?.state && 'refreshToken' in parsed.state) {
        delete parsed.state.refreshToken;
        storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(parsed));
        result.removedNestedRefreshToken = true;
        logger.debug('Phase 2 migration: removed stale refreshToken from auth-storage blob');
      }
    }
  } catch (error) {
    result.encounteredError = true;
    logger.warn('Phase 2 migration: failed to scrub auth-storage blob:', error);
  }

  return result;
}
