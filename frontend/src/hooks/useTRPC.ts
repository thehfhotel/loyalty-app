/**
 * tRPC Hooks Utility
 * Provides easy access to tRPC client and helper utilities for common patterns
 */

import { TRPCClientError } from '@trpc/client';
import type { AppRouter } from '../../../backend/src/trpc/routers/_app';
import { trpc } from '../utils/trpc';
import i18next from 'i18next';

/**
 * Re-export the tRPC client for easy imports
 * Usage: import { trpc } from '@/hooks/useTRPC';
 * const { data } = trpc.loyalty.getStatus.useQuery();
 */
export { trpc };

/**
 * Type guard to check if an error is a tRPC error
 */
export function isTRPCError(error: unknown): error is TRPCClientError<AppRouter> {
  return error instanceof TRPCClientError;
}

/**
 * Extract error code from tRPC error
 * Returns the custom error code if available (e.g., 'EMAIL_ALREADY_IN_USE')
 */
export function getTRPCCustomErrorCode(error: unknown): string | undefined {
  if (isTRPCError(error)) {
    // Try to get custom code from error data
    // tRPC preserves the data field from backend errors
    const errorData = error.data as { code?: string } | undefined;
    return errorData?.code;
  }
  return undefined;
}

/**
 * Extract error message from tRPC error with translation support
 * Handles both tRPC errors and generic errors
 * Maps error codes to translation keys when available
 */
export function getTRPCErrorMessage(error: unknown): string {
  // Check for custom error code and translate if available
  const customCode = getTRPCCustomErrorCode(error);
  if (customCode) {
    const errorCodeMap: Record<string, string> = {
      'EMAIL_ALREADY_REGISTERED': 'errors.emailAlreadyRegistered',
      'EMAIL_ALREADY_IN_USE': 'errors.emailAlreadyInUse',
    };

    const translationKey = errorCodeMap[customCode];
    if (translationKey) {
      return i18next.t(translationKey);
    }
  }

  if (isTRPCError(error)) {
    // Return the error message from tRPC
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected error occurred';
}

/**
 * Get error code from tRPC error
 * Returns the HTTP status code if available
 */
export function getTRPCErrorCode(error: unknown): number | undefined {
  if (isTRPCError(error)) {
    return error.data?.httpStatus;
  }
  return undefined;
}

/**
 * Check if tRPC error is of a specific type
 */
export function isTRPCErrorCode(error: unknown, code: number): boolean {
  return getTRPCErrorCode(error) === code;
}

/**
 * Common error code checks
 */
export const isTRPCUnauthorized = (error: unknown): boolean => isTRPCErrorCode(error, 401);
export const isTRPCForbidden = (error: unknown): boolean => isTRPCErrorCode(error, 403);
export const isTRPCNotFound = (error: unknown): boolean => isTRPCErrorCode(error, 404);
export const isTRPCBadRequest = (error: unknown): boolean => isTRPCErrorCode(error, 400);
export const isTRPCServerError = (error: unknown): boolean => {
  const code = getTRPCErrorCode(error);
  return code !== undefined && code >= 500;
};
