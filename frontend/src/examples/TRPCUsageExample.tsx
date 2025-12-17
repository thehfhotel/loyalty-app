/**
 * Example Component: tRPC Usage Demonstration
 * This file demonstrates how to use tRPC in frontend components
 *
 * NOTE: This is an example file for reference only.
 * Delete this file when you no longer need the examples.
 */

import { trpc, getTRPCErrorMessage, isTRPCUnauthorized } from '@/hooks/useTRPC';
import { notify } from '@/utils/notificationManager';

export function TRPCUsageExample() {
  // Example 1: Basic Query
  const { data, isLoading, error } = trpc.loyalty.getStatus.useQuery({});

  // Example 2: Query with parameters (viewing another user as admin)
  // const { data: otherUserStatus } = trpc.loyalty.getStatus.useQuery({
  //   userId: 'some-user-id'
  // });

  // Example 3: Query transactions with pagination
  // const { data: transactions } = trpc.loyalty.getTransactions.useQuery({
  //   page: 1,
  //   pageSize: 20
  // });

  // Example 4: Mutation (admin only)
  const awardPointsMutation = trpc.loyalty.awardPoints.useMutation({
    onSuccess: (transactionId) => {
      notify.success(`Successfully awarded points. Transaction ID: ${transactionId}`);
    },
    onError: (error) => {
      // Use error helper to get message
      const message = getTRPCErrorMessage(error);
      notify.error(`Failed to award points: ${message}`);

      // Check for specific error types
      if (isTRPCUnauthorized(error)) {
        // Redirect to login or refresh token
        // Handle unauthorized error (e.g., redirect to login)
      }
    },
  });

  // Example 5: Trigger mutation
  const handleAwardPoints = () => {
    awardPointsMutation.mutate({
      userId: 'user-id-here',
      points: 100,
      reason: 'Booking reward',
      referenceType: 'booking',
      referenceId: 'booking-123',
      notes: 'Bonus points for first booking',
    });
  };

  // Example 6: Query invalidation after mutation
  const utils = trpc.useUtils();

  // Example of deduct points mutation (admin only)
  const handleDeductPoints = () => {
    const deductPointsMutation = trpc.loyalty.deductPoints.useMutation({
      onSuccess: () => {
        // Invalidate and refetch the getStatus query
        utils.loyalty.getStatus.invalidate();
      },
    });

    deductPointsMutation.mutate({
      userId: 'user-id-here',
      points: 50,
      reason: 'Redemption',
      referenceType: 'redemption',
    });
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {getTRPCErrorMessage(error)}</div>;
  }

  return (
    <div>
      <h1>tRPC Usage Example</h1>

      {data && (
        <div>
          <p>Current Points: {data.current_points}</p>
          <p>Total Nights: {data.total_nights}</p>
          <p>Tier: {data.tier_name}</p>
          <p>Tier Level: {data.tier_level}</p>
          {data.next_tier_name && (
            <p>Next Tier: {data.next_tier_name} ({data.nights_to_next_tier} nights away)</p>
          )}
        </div>
      )}

      <button
        onClick={handleAwardPoints}
        disabled={awardPointsMutation.isPending}
      >
        {awardPointsMutation.isPending ? 'Awarding...' : 'Award Points'}
      </button>

      <button onClick={handleDeductPoints}>
        Deduct Points
      </button>
    </div>
  );
}

/**
 * Common tRPC Patterns:
 *
 * 1. Simple Query:
 *    const { data, isLoading, error } = trpc.loyalty.getStatus.useQuery();
 *
 * 2. Query with Options:
 *    const { data } = trpc.loyalty.getStatus.useQuery(undefined, {
 *      enabled: isAuthenticated,
 *      refetchInterval: 30000,
 *    });
 *
 * 3. Mutation:
 *    const mutation = trpc.loyalty.awardPoints.useMutation();
 *    mutation.mutate({ userId, points, reason });
 *
 * 4. Error Handling:
 *    import { getTRPCErrorMessage, isTRPCUnauthorized } from '@/hooks/useTRPC';
 *    const message = getTRPCErrorMessage(error);
 *    if (isTRPCUnauthorized(error)) { ... }
 *
 * 5. Query Invalidation:
 *    const utils = trpc.useUtils();
 *    utils.loyalty.getStatus.invalidate();
 *
 * 6. Optimistic Updates:
 *    const mutation = trpc.loyalty.updatePoints.useMutation({
 *      onMutate: async (newData) => {
 *        await utils.loyalty.getStatus.cancel();
 *        const previous = utils.loyalty.getStatus.getData();
 *        utils.loyalty.getStatus.setData(undefined, (old) => ({
 *          ...old,
 *          ...newData,
 *        }));
 *        return { previous };
 *      },
 *      onError: (err, newData, context) => {
 *        utils.loyalty.getStatus.setData(undefined, context?.previous);
 *      },
 *      onSettled: () => {
 *        utils.loyalty.getStatus.invalidate();
 *      },
 *    });
 */
