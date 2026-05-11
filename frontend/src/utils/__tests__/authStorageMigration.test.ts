import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateAuthStorageForCookieRefreshToken } from '../authStorageMigration';

vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Build a fresh in-memory `Storage` mock that satisfies the DOM
 * `Storage` interface. Using a real backing object (rather than vitest
 * spies on `window.localStorage`) keeps the tests independent and
 * deterministic — particularly for the "no-op when nothing to clean"
 * and "rewrites the blob" paths where we assert on the post-call state.
 */
function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const store: Record<string, string> = { ...initial };
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      for (const key of Object.keys(store)) delete store[key];
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },
    removeItem(key: string) {
      delete store[key];
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
  } as Storage;
}

describe('migrateAuthStorageForCookieRefreshToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes a stale top-level refreshToken localStorage key', () => {
    const storage = createMemoryStorage({ refreshToken: 'leftover-from-pre-phase-2' });

    const result = migrateAuthStorageForCookieRefreshToken(storage);

    expect(result.removedTopLevelRefreshToken).toBe(true);
    expect(result.encounteredError).toBe(false);
    expect(storage.getItem('refreshToken')).toBeNull();
  });

  it('removes refreshToken from inside the persisted auth-storage Zustand blob', () => {
    const storage = createMemoryStorage({
      'auth-storage': JSON.stringify({
        state: {
          user: { id: 'u1', email: 'a@b.com' },
          accessToken: 'still-valid-jwt',
          refreshToken: 'stale-refresh-token-from-old-zustand-partialize',
          isAuthenticated: true,
        },
        version: 0,
      }),
    });

    const result = migrateAuthStorageForCookieRefreshToken(storage);

    expect(result.removedNestedRefreshToken).toBe(true);
    expect(result.encounteredError).toBe(false);

    const rewritten = JSON.parse(storage.getItem('auth-storage') ?? '{}');
    expect(rewritten.state).toBeDefined();
    expect(rewritten.state).not.toHaveProperty('refreshToken');
    // Other fields preserved — we only scrub the refresh token.
    expect(rewritten.state.accessToken).toBe('still-valid-jwt');
    expect(rewritten.state.isAuthenticated).toBe(true);
    expect(rewritten.state.user.email).toBe('a@b.com');
  });

  it('is idempotent — second call is a no-op when the storage is already clean', () => {
    const storage = createMemoryStorage({
      'auth-storage': JSON.stringify({
        state: {
          user: null,
          accessToken: null,
          isAuthenticated: false,
        },
        version: 0,
      }),
    });

    const first = migrateAuthStorageForCookieRefreshToken(storage);
    expect(first.removedTopLevelRefreshToken).toBe(false);
    expect(first.removedNestedRefreshToken).toBe(false);

    const before = storage.getItem('auth-storage');
    const second = migrateAuthStorageForCookieRefreshToken(storage);
    expect(second.removedTopLevelRefreshToken).toBe(false);
    expect(second.removedNestedRefreshToken).toBe(false);
    // The blob isn't rewritten on the second pass.
    expect(storage.getItem('auth-storage')).toBe(before);
  });

  it('handles a corrupted auth-storage blob without throwing and reports the error', () => {
    const storage = createMemoryStorage({ 'auth-storage': '{not json' });

    const result = migrateAuthStorageForCookieRefreshToken(storage);

    expect(result.encounteredError).toBe(true);
    // Top-level wasn't present so that flag stays false; the nested
    // scrub couldn't run because JSON.parse threw.
    expect(result.removedNestedRefreshToken).toBe(false);
    // Importantly: the bad blob is left in place. App.tsx has its own
    // "corrupted blob → clear" path that will handle this case; this
    // helper's job is narrow (only scrub refreshToken).
    expect(storage.getItem('auth-storage')).toBe('{not json');
  });

  it('is a safe no-op when no Storage is available (SSR / missing localStorage)', () => {
    const result = migrateAuthStorageForCookieRefreshToken(null);

    expect(result.removedTopLevelRefreshToken).toBe(false);
    expect(result.removedNestedRefreshToken).toBe(false);
    expect(result.encounteredError).toBe(false);
  });

  it('cleans both surfaces in a single call', () => {
    const storage = createMemoryStorage({
      refreshToken: 'top-level-stale',
      'auth-storage': JSON.stringify({
        state: { accessToken: 'jwt', refreshToken: 'nested-stale', isAuthenticated: true },
      }),
    });

    const result = migrateAuthStorageForCookieRefreshToken(storage);

    expect(result.removedTopLevelRefreshToken).toBe(true);
    expect(result.removedNestedRefreshToken).toBe(true);
    expect(storage.getItem('refreshToken')).toBeNull();

    const rewritten = JSON.parse(storage.getItem('auth-storage') ?? '{}');
    expect(rewritten.state).not.toHaveProperty('refreshToken');
    expect(rewritten.state.accessToken).toBe('jwt');
  });
});
