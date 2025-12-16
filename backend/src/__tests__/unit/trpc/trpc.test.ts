import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure, adminProcedure } from '../../../trpc/trpc';
import type { Context } from '../../../trpc/context';

describe('tRPC Middleware Procedures', () => {
  const adminUser = { id: 'admin-1', role: 'admin' as const, email: 'admin@test.com' };
  const customerUser = { id: 'customer-1', role: 'customer' as const, email: 'customer@test.com' };

  /**
   * Helper to create a tRPC caller with context
   */
  const createTestRouter = () => {
    return router({
      publicTest: publicProcedure.query(({ ctx }) => {
        return { userId: ctx.user?.id || null };
      }),
      publicWithUser: publicProcedure.query(({ ctx }) => {
        return { user: ctx.user };
      }),
      protectedTest: protectedProcedure.query(({ ctx }) => {
        return { userId: ctx.user.id };
      }),
      protectedWithDetails: protectedProcedure.query(({ ctx }) => {
        return {
          userId: ctx.user.id,
          userRole: ctx.user.role,
          userEmail: ctx.user.email,
        };
      }),
      adminTest: adminProcedure.query(({ ctx }) => {
        return { userId: ctx.user.id, role: ctx.user.role };
      }),
      adminWithDetails: adminProcedure.query(({ ctx }) => {
        return {
          userId: ctx.user.id,
          userRole: ctx.user.role,
          userEmail: ctx.user.email,
        };
      }),
    });
  };

  const createCaller = (ctx: Context) => {
    const testRouter = createTestRouter();
    return testRouter.createCaller(ctx);
  };

  describe('publicProcedure', () => {
    it('should allow execution without authentication', async () => {
      const caller = createCaller({ user: null });

      const result = await caller.publicTest();

      expect(result).toEqual({ userId: null });
    });

    it('should allow execution with authenticated user', async () => {
      const caller = createCaller({ user: customerUser });

      const result = await caller.publicTest();

      expect(result).toEqual({ userId: 'customer-1' });
    });

    it('should pass context correctly', async () => {
      const caller = createCaller({ user: adminUser });

      const result = await caller.publicWithUser();

      expect(result).toEqual({ user: adminUser });
    });
  });

  describe('protectedProcedure', () => {
    it('should throw UNAUTHORIZED when ctx.user is null', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.protectedTest()).rejects.toThrow(TRPCError);

      await expect(caller.protectedTest()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Not authenticated',
      });
    });

    it('should throw UNAUTHORIZED when ctx.user.id is undefined', async () => {
      const caller = createCaller({ user: { id: undefined as any, role: 'customer', email: 'test@test.com' } });

      await expect(caller.protectedTest()).rejects.toThrow(TRPCError);

      await expect(caller.protectedTest()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Not authenticated',
      });
    });

    it('should allow execution when ctx.user has valid id', async () => {
      const caller = createCaller({ user: customerUser });

      const result = await caller.protectedTest();

      expect(result).toEqual({ userId: 'customer-1' });
    });

    it('should pass user context correctly to next()', async () => {
      const caller = createCaller({ user: customerUser });

      const result = await caller.protectedWithDetails();

      expect(result).toEqual({
        userId: 'customer-1',
        userRole: 'customer',
        userEmail: 'customer@test.com',
      });
    });

    it('should work with admin user', async () => {
      const caller = createCaller({ user: adminUser });

      const result = await caller.protectedTest();

      expect(result).toEqual({ userId: 'admin-1' });
    });

    it('should throw UNAUTHORIZED with empty string user id', async () => {
      const caller = createCaller({ user: { id: '', role: 'customer', email: 'test@test.com' } });

      await expect(caller.protectedTest()).rejects.toThrow(TRPCError);

      await expect(caller.protectedTest()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  describe('adminProcedure', () => {
    it('should throw UNAUTHORIZED when ctx.user is null', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.adminTest()).rejects.toThrow(TRPCError);

      await expect(caller.adminTest()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Not authenticated',
      });
    });

    it('should throw FORBIDDEN when user.role is customer', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(caller.adminTest()).rejects.toThrow(TRPCError);

      await expect(caller.adminTest()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Admin access required',
      });
    });

    it('should allow execution when user.role is admin', async () => {
      const caller = createCaller({ user: adminUser });

      const result = await caller.adminTest();

      expect(result).toEqual({ userId: 'admin-1', role: 'admin' });
    });

    it('should inherit protection from protectedProcedure - reject undefined user id', async () => {
      const caller = createCaller({ user: { id: undefined as any, role: 'admin', email: 'admin@test.com' } });

      await expect(caller.adminTest()).rejects.toThrow(TRPCError);

      await expect(caller.adminTest()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Not authenticated',
      });
    });

    it('should inherit protection from protectedProcedure - reject empty string user id', async () => {
      const caller = createCaller({ user: { id: '', role: 'admin', email: 'admin@test.com' } });

      await expect(caller.adminTest()).rejects.toThrow(TRPCError);

      await expect(caller.adminTest()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should pass admin user context correctly', async () => {
      const caller = createCaller({ user: adminUser });

      const result = await caller.adminWithDetails();

      expect(result).toEqual({
        userId: 'admin-1',
        userRole: 'admin',
        userEmail: 'admin@test.com',
      });
    });

    it('should check admin role before executing query', async () => {
      const caller = createCaller({ user: { id: 'user-1', role: 'customer' as const, email: 'user@test.com' } });

      await expect(caller.adminTest()).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('should check authentication before checking admin role', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.adminTest()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });
});
