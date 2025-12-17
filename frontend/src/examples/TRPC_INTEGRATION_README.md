# tRPC Integration Guide

## Overview

The loyalty app frontend now includes full tRPC integration for type-safe API calls. This guide explains how to use tRPC in your components.

## Setup Complete

1. **TRPCProvider** is mounted in `main.tsx`
2. **Path alias** `@/` is configured for cleaner imports
3. **useTRPC hooks** utility is available at `@/hooks/useTRPC`

## Basic Usage

### Import the tRPC client

```typescript
import { trpc } from '@/hooks/useTRPC';
```

### Query Data

```typescript
function MyComponent() {
  // Simple query
  const { data, isLoading, error } = trpc.loyalty.getStatus.useQuery({});

  // Query with parameters
  const { data: transactions } = trpc.loyalty.getTransactions.useQuery({
    page: 1,
    pageSize: 20
  });

  // Query with options
  const { data: tierConfig } = trpc.loyalty.getTierConfig.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <div>Current Points: {data?.current_points}</div>;
}
```

### Mutate Data

```typescript
function AwardPointsComponent() {
  const awardPoints = trpc.loyalty.awardPoints.useMutation({
    onSuccess: (transactionId) => {
      console.log('Points awarded!', transactionId);
    },
    onError: (error) => {
      console.error('Failed to award points:', error.message);
    }
  });

  const handleClick = () => {
    awardPoints.mutate({
      userId: 'user-123',
      points: 100,
      reason: 'Booking reward',
      referenceType: 'booking',
      referenceId: 'booking-456',
    });
  };

  return (
    <button
      onClick={handleClick}
      disabled={awardPoints.isPending}
    >
      {awardPoints.isPending ? 'Awarding...' : 'Award Points'}
    </button>
  );
}
```

## Error Handling

Use the error handling utilities from `@/hooks/useTRPC`:

```typescript
import {
  trpc,
  getTRPCErrorMessage,
  isTRPCUnauthorized,
  isTRPCForbidden,
  isTRPCNotFound
} from '@/hooks/useTRPC';

function MyComponent() {
  const query = trpc.loyalty.getStatus.useQuery({});

  if (query.error) {
    const message = getTRPCErrorMessage(query.error);

    if (isTRPCUnauthorized(query.error)) {
      // Redirect to login
      return <div>Please log in</div>;
    }

    if (isTRPCForbidden(query.error)) {
      // Show forbidden message
      return <div>Access denied</div>;
    }

    return <div>Error: {message}</div>;
  }

  // ... rest of component
}
```

## Cache Invalidation

Invalidate queries after mutations to refetch fresh data:

```typescript
function UpdateComponent() {
  const utils = trpc.useUtils();

  const updateMutation = trpc.loyalty.updateTierConfig.useMutation({
    onSuccess: () => {
      // Invalidate single query
      utils.loyalty.getStatus.invalidate();

      // Invalidate all loyalty queries
      utils.loyalty.invalidate();

      // Invalidate all queries
      utils.invalidate();
    }
  });

  // ... rest of component
}
```

## Optimistic Updates

Update UI immediately before server responds:

```typescript
function OptimisticComponent() {
  const utils = trpc.useUtils();

  const mutation = trpc.loyalty.awardPoints.useMutation({
    onMutate: async (newData) => {
      // Cancel outgoing queries
      await utils.loyalty.getStatus.cancel();

      // Snapshot current value
      const previous = utils.loyalty.getStatus.getData();

      // Optimistically update
      utils.loyalty.getStatus.setData({}, (old) => ({
        ...old!,
        current_points: (old?.current_points || 0) + newData.points,
      }));

      return { previous };
    },
    onError: (err, newData, context) => {
      // Rollback on error
      if (context?.previous) {
        utils.loyalty.getStatus.setData({}, context.previous);
      }
    },
    onSettled: () => {
      // Refetch to ensure data is correct
      utils.loyalty.getStatus.invalidate();
    },
  });

  // ... rest of component
}
```

## Available Endpoints

### Loyalty Router

- `trpc.loyalty.getStatus.useQuery({ userId?: string })`
  - Get user's loyalty status (points, tier, etc.)
  - Optional userId parameter for admins

- `trpc.loyalty.getTransactions.useQuery({ userId?: string, page: number, pageSize: number })`
  - Get user's transaction history with pagination
  - Optional userId parameter for admins

- `trpc.loyalty.getTierConfig.useQuery()`
  - Get tier configuration

- `trpc.loyalty.awardPoints.useMutation()` (Admin only)
  - Award points to a user
  - Input: `{ userId, points, reason, referenceType?, referenceId?, notes? }`

- `trpc.loyalty.deductPoints.useMutation()` (Admin only)
  - Deduct points from a user
  - Input: `{ userId, points, reason, referenceType?, referenceId?, notes? }`

- `trpc.loyalty.updateTierConfig.useMutation()` (Admin only)
  - Update tier configuration
  - Input: `{ tierId, name?, required_points?, benefits?, color?, icon? }`

## Type Safety

All endpoints are fully typed. Your IDE will provide:
- Auto-completion for endpoint names
- Type checking for input parameters
- Type inference for response data

```typescript
// TypeScript knows the shape of data
const { data } = trpc.loyalty.getStatus.useQuery({});

// data is typed as:
// {
//   user_id: string;
//   current_points: number;
//   total_nights: number;
//   tier_name: string;
//   tier_color: string;
//   tier_benefits: Record<string, unknown>;
//   tier_level: number;
//   progress_percentage: number;
//   next_tier_nights: number | null;
//   next_tier_name: string | null;
//   nights_to_next_tier: number | null;
// } | null
```

## Path Alias

The `@/` path alias maps to the `src/` directory:

```typescript
// Instead of:
import { trpc } from '../../../hooks/useTRPC';

// Use:
import { trpc } from '@/hooks/useTRPC';
```

## Example Component

See `TRPCUsageExample.tsx` in this directory for a complete working example.

## React Query Integration

tRPC uses React Query under the hood, so all React Query features are available:

- Query options: `enabled`, `refetchInterval`, `staleTime`, etc.
- Mutation callbacks: `onSuccess`, `onError`, `onMutate`, `onSettled`
- Cache management: `invalidate`, `setData`, `cancel`, etc.

For more details, see: https://tanstack.com/query/latest/docs/react/overview

## Development Tips

1. **Use TypeScript**: tRPC's main benefit is type safety
2. **Handle loading states**: Always check `isLoading`
3. **Handle errors**: Use error helpers for consistent error handling
4. **Invalidate queries**: Refresh data after mutations
5. **Use optimistic updates**: For better UX on slow connections

## Troubleshooting

### "Cannot find module '@/...'"

Make sure your IDE has restarted after the path alias configuration. VS Code may need to reload the TypeScript server.

### Type errors on tRPC calls

Ensure the backend types are up to date. The frontend imports types directly from:
`../../../backend/src/trpc/routers/_app`

### Authentication errors

tRPC automatically includes:
- Cookies (credentials: 'include')
- Bearer token from localStorage (if available)

Make sure your auth token is set before making authenticated calls.

## Next Steps

1. Delete the example files when you're comfortable with tRPC
2. Replace existing axios calls with tRPC where appropriate
3. Add new tRPC routers in the backend as needed
4. Keep the frontend and backend types in sync

---

**Note**: This is a reference document. Delete this file and `TRPCUsageExample.tsx` when you no longer need the examples.
