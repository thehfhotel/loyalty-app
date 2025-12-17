/**
 * tRPC Provider Component
 * Wraps the app to provide tRPC and React Query functionality
 */

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from './trpc';
import { API_BASE_URL } from './apiConfig';
import { useAuthStore } from '../store/authStore';

// Log tRPC configuration for E2E debugging
const TRPC_URL = `${API_BASE_URL}/trpc`;
console.log('[trpcProvider] tRPC URL:', TRPC_URL);

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 5 * 60 * 1000, // 5 minutes
      },
    },
  }));

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: TRPC_URL,
          // Include credentials (cookies) in requests
          fetch(url, options) {
            // Log headers to debug auth issues
            const headers = options?.headers as Record<string, string> | undefined;
            console.error('[tRPC fetch] Request headers:', {
              hasAuthHeader: !!headers?.authorization || !!headers?.Authorization,
              authHeaderPreview: headers?.authorization?.substring(0, 30) || headers?.Authorization?.substring(0, 30) || 'none',
              allHeaders: Object.keys(headers || {})
            });
            console.log('[tRPC fetch] Making request:', {
              url: typeof url === 'string' ? url : url.toString(),
              method: options?.method || 'GET',
            });
            const fetchPromise = fetch(url, {
              ...options,
              credentials: 'include',
            });
            fetchPromise.then(
              (res) => console.log('[tRPC fetch] Response:', res.status, res.statusText),
              (err) => console.log('[tRPC fetch] Error:', err.message)
            );
            return fetchPromise;
          },
          // Add auth headers from zustand store (reads from in-memory state)
          headers() {
            // Read token directly from zustand store state (synchronous)
            const state = useAuthStore.getState();
            const token = state.accessToken;
            // Use console.error for logging so it's not stripped in production builds
            console.error('[tRPC headers] Auth state:', {
              hasToken: !!token,
              isAuthenticated: state.isAuthenticated,
              hasUser: !!state.user,
              tokenPrefix: token ? token.substring(0, 20) + '...' : null
            });
            return token ? { authorization: `Bearer ${token}` } : {};
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
