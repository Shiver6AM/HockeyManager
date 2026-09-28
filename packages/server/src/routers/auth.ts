import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createSession, deleteSession, hashPassword, newId, verifyPassword } from '../auth';
import { authedProcedure, publicProcedure, router } from '../trpc';

const username = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Letters, numbers, dots, dashes and underscores only');

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),

  register: publicProcedure
    .input(z.object({ username, password: z.string().min(8).max(200), displayName: z.string().trim().min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      const exists = await ctx.db.query('select 1 from users where lower(username) = lower($1)', [input.username]);
      if (exists.length) throw new TRPCError({ code: 'CONFLICT', message: 'That username is taken' });
      const id = newId('usr');
      await ctx.db.query('insert into users (id, username, display_name, password_hash) values ($1, $2, $3, $4)', [
        id,
        input.username,
        input.displayName,
        await hashPassword(input.password),
      ]);
      const token = await createSession(ctx.db, id);
      ctx.setSession(token);
      return { id, username: input.username, displayName: input.displayName, token };
    }),

  login: publicProcedure
    .input(z.object({ username: z.string().trim(), password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db.query<{ id: string; username: string; display_name: string; password_hash: string }>(
        'select id, username, display_name, password_hash from users where lower(username) = lower($1)',
        [input.username],
      );
      const u = rows[0];
      if (!u || !(await verifyPassword(input.password, u.password_hash))) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Wrong username or password' });
      }
      const token = await createSession(ctx.db, u.id);
      ctx.setSession(token);
      return { id: u.id, username: u.username, displayName: u.display_name, token };
    }),

  logout: authedProcedure.mutation(async ({ ctx }) => {
    if (ctx.sessionToken) await deleteSession(ctx.db, ctx.sessionToken);
    ctx.setSession(null);
    return { ok: true };
  }),
});
