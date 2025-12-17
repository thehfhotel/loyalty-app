/**
 * tRPC Provider Component
 * Wraps the app to provide tRPC and React Query functionality
 */

import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from './trpc';
import { API_BASE_URL } from './apiConfig';
import { useAuthStore } from '../store/authStore';
import { fetchCsrfToken } from './axiosInterceptor';

const TRPC_URL = `${API_BASE_URL}/trpc`;

// Module-level CSRF token cache for synchronous access
let cachedCsrfToken: string | null = null;

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  // Pre-fetch CSRF token on mount (only once)
  useEffect(() => {
    if (!cachedCsrfToken) {
      fetchCsrfToken()
        .then((token) => {
          cachedCsrfToken = token;
        })
        .catch(() => {
          // Silent fail - will retry on next mutation
        });
    }
  }, []);

  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 5 * 60 * 1000, // 5 minutes
      },
      mutations: {
        retry: 0, // Don't retry mutations automatically
      },
    },
  }));

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: TRPC_URL,
          fetch(url, options) {
            return fetch(url, {
              ...options,
              credentials: 'include',
            });
          },
          // Add auth headers and CSRF token synchronously
          headers() {
            const state = useAuthStore.getState();
            const token = state.accessToken;

            const headers: Record<string, string> = {};
            if (token) {
              headers.authorization = `Bearer ${token}`;
            }
            // Use cached CSRF token (pre-fetched on mount)
            if (cachedCsrfToken) {
              headers['X-CSRF-Token'] = cachedCsrfToken;
            }
            return headers;
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}

/**
 * Clear the cached CSRF token (call on logout)
 */
export function clearTrpcCsrfToken(): void {
  cachedCsrfToken = null;
}
