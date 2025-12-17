/**
 * tRPC Provider Component
 * Wraps the app to provide tRPC and React Query functionality
 */

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from './trpc';
import { API_BASE_URL } from './apiConfig';

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
            return fetch(url, {
              ...options,
              credentials: 'include',
            });
          },
          // Add auth headers from zustand persisted store
          headers() {
            // Read token from zustand persisted auth store
            const authStorage = localStorage.getItem('auth-storage');
            if (authStorage) {
              try {
                const parsed = JSON.parse(authStorage);
                const token = parsed.state?.accessToken;
                return token ? { authorization: `Bearer ${token}` } : {};
              } catch {
                return {};
              }
            }
            return {};
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
