import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Scheduler } from './advance';
import type { User } from './auth';
import type { Db } from './db';

export interface Context {
  db: Db;
  scheduler: Scheduler;
  user: User | null;
  sessionToken: string | null;
  setSession: (token: string | null) => void;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Please log in' });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export interface Membership {
  leagueId: string;
  teamId: string | null;
  ready: boolean;
  isCommissioner: boolean;
  /** Appointed by the commissioner: may advance the league. */
  isCoCommissioner: boolean;
  canAdvance: boolean;
}

/** Any procedure taking `leagueId` requires the caller to be a member. */
export const memberProcedure = authedProcedure.input(z.object({ leagueId: z.string() })).use(async ({ ctx, input, next }) => {
  const rows = await ctx.db.query<{ team_id: string | null; ready: boolean; commissioner_id: string; co_commissioner: boolean }>(
    `select m.team_id, m.ready, l.commissioner_id, m.co_commissioner from league_members m join leagues l on l.id = m.league_id
     where m.league_id = $1 and m.user_id = $2`,
    [input.leagueId, ctx.user.id],
  );
  if (!rows[0]) throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not in this league' });
  const membership: Membership = {
    leagueId: input.leagueId,
    teamId: rows[0].team_id,
    ready: rows[0].ready,
    isCommissioner: rows[0].commissioner_id === ctx.user.id,
    isCoCommissioner: !!rows[0].co_commissioner,
    canAdvance: rows[0].commissioner_id === ctx.user.id || !!rows[0].co_commissioner,
  };
  return next({ ctx: { ...ctx, membership } });
});

export const commissionerProcedure = memberProcedure.use(({ ctx, next }) => {
  if (!ctx.membership.isCommissioner) throw new TRPCError({ code: 'FORBIDDEN', message: 'Commissioner only' });
  return next();
});

/** Commissioner or co-commissioner: may advance the league. */
export const advancerProcedure = memberProcedure.use(({ ctx, next }) => {
  if (!ctx.membership.canAdvance) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the commissioner or a co-commissioner can advance the league' });
  return next();
});

export const badRequest = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });
