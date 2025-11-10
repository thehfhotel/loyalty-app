/**
 * Example Component: How to Use tRPC
 * This demonstrates type-safe API calls with tRPC
 */

import React from 'react';
import { trpc } from '../utils/trpc';

/**
 * Example: Fetch user loyalty status
 * Notice how you get full type safety and auto-completion!
 */
export function LoyaltyStatusExample() {
  // Type-safe query with auto-completion
  const { data, isLoading, error } = trpc.loyalty.getStatus.useQuery({
    userId: undefined // Will use current user
  });

  if (isLoading) return <div>Loading loyalty status...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!data) return <div>No loyalty data found</div>;

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h2 className="text-xl font-bold mb-4">Loyalty Status (tRPC)</h2>
      <div className="space-y-2">
        <p><strong>Current Points:</strong> {data.current_points}</p>
        <p><strong>Tier:</strong> {data.current_tier}</p>
        <p><strong>Lifetime Points:</strong> {data.lifetime_points}</p>
      </div>
    </div>
  );
}

/**
 * Example: Award points mutation
 * Admin-only operation with type-safe parameters
 */
export function AwardPointsExample({ userId }: { userId: string }) {
  // Type-safe mutation with auto-completion
  const mutation = trpc.loyalty.awardPoints.useMutation({
    onSuccess: () => {
      alert('Points awarded successfully!');
    },
    onError: (error) => {
      alert(`Error: ${error.message}`);
    },
  });

  const handleAwardPoints = () => {
    // All parameters are type-checked!
    mutation.mutate({
      userId,
      points: 100,
      reason: 'Welcome bonus',
      referenceType: 'bonus',
      notes: 'New user welcome'
    });
  };

  return (
    <button
      onClick={handleAwardPoints}
      disabled={mutation.isLoading}
      className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
    >
      {mutation.isLoading ? 'Awarding...' : 'Award 100 Points'}
    </button>
  );
}

/**
 * Example: Get transaction history with pagination
 * Demonstrates query parameters with type safety
 */
export function TransactionHistoryExample() {
  const [page, setPage] = React.useState(1);

  const { data, isLoading } = trpc.loyalty.getTransactions.useQuery({
    userId: undefined, // Current user
    page,
    pageSize: 10
  });

  if (isLoading) return <div>Loading transactions...</div>;
  if (!data) return <div>No transactions found</div>;

  return (
    <div>
      <h3>Transaction History</h3>
      <ul>
        {data.transactions?.map((tx: any) => (
          <li key={tx.id}>
            {tx.points} points - {tx.reason} ({new Date(tx.created_at).toLocaleDateString()})
          </li>
        ))}
      </ul>
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page === 1}
          className="px-3 py-1 bg-gray-200 rounded"
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          onClick={() => setPage(p => p + 1)}
          disabled={!data.hasMore}
          className="px-3 py-1 bg-gray-200 rounded"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/**
 * Benefits of tRPC:
 * 1. ✅ Full type safety - no manual type definitions
 * 2. ✅ Auto-completion in IDE - knows all available endpoints
 * 3. ✅ Compile-time errors - catch issues before runtime
 * 4. ✅ Refactoring support - rename backend endpoint, frontend updates automatically
 * 5. ✅ No code generation - types are inferred directly
 * 6. ✅ React Query integration - automatic caching and loading states
 */
