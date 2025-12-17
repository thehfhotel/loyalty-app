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
            // This is more reliable than reading from localStorage which is async
            const token = useAuthStore.getState().accessToken;
            console.log('[tRPC headers] Token present:', !!token);
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
