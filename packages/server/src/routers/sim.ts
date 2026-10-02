import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { advanceLeague, allHumansReady, cancelSim, jobView, simJob, startAdvance, summaryOf, type AdvanceSummary } from '../advance';
import { publish } from '../events';
import { simcastBlocking } from '../simcast';
import { advancerProcedure, badRequest, commissionerProcedure, memberProcedure, router } from '../trpc';

const target = z.union([
  z.object({ days: z.number().int().min(1).max(400) }),
  z.object({ to: z.enum(['playoffs', 'end-of-season', 'next-season', 'trade-deadline', 'free-agency', 'training-camp']) }),
]);

export const simRouter = router({
  /** Commissioner-driven advance. Works in both modes (a manual override for scheduled leagues). */
  advance: advancerProcedure.input(z.object({ target, background: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
    let started;
    try {
      started = await startAdvance(ctx.db, input.leagueId, input.target, `commissioner:${ctx.user.id}`, {
        startedBy: ctx.user.displayName,
        onDone: () => void ctx.scheduler.sync(input.leagueId).catch(() => undefined),
      });
    } catch (e) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: (e as Error).message });
    }
    // The browser gets the job straight away and follows its progress; other callers wait for the result.
    if (input.background) return { ...summaryOf(started.job), jobId: started.job.id, running: true };
    const j = await started.finished;
    if (j.status === 'failed') throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: j.error ?? 'The sim failed' });
    return { ...summaryOf(j), jobId: j.id, running: false };
  }),

  /** The league's sim in progress (or the one that just finished), for everyone in the league. */
  status: memberProcedure.query(({ input }) => {
    const j = simJob(input.leagueId);
    if (!j) return null;
    // Keep a finished job visible briefly so every client sees how it ended.
    if (j.status !== 'running' && Date.now() - (j.finishedAt ?? 0) > 60_000) return null;
    return jobView(j);
  }),

  cancel: advancerProcedure.mutation(({ input }) => {
    if (!cancelSim(input.leagueId)) throw badRequest('Nothing is simming');
    const j = simJob(input.leagueId);
    if (j) publish(input.leagueId, { type: 'sim', job: jobView(j) });
    return { ok: true };
  }),

  /**
   * Ready up. In a scheduled league with early advance on, the last manager
   * to ready up triggers the next tick immediately.
   */
  setReady: memberProcedure.input(z.object({ ready: z.boolean() })).mutation(async ({ ctx, input }) => {
    if (!ctx.membership.teamId) throw badRequest('Claim a team before readying up');
    await ctx.db.query('update league_members set ready = $1 where league_id = $2 and user_id = $3', [
      input.ready,
      input.leagueId,
      ctx.user.id,
    ]);
    publish(input.leagueId, { type: 'changed' });
    let advanced: AdvanceSummary | null = null;
    if (input.ready) {
      const rows = await ctx.db.query<{ advance: { mode: string; daysPerTick?: number; advanceEarlyWhenAllReady?: boolean } }>(
        'select advance from leagues where id = $1',
        [input.leagueId],
      );
      const adv = rows[0].advance;
      // (Not while a game is being simcast: the league waits for it.)
      if (adv.mode === 'scheduled' && adv.advanceEarlyWhenAllReady && !simcastBlocking(input.leagueId) && (await allHumansReady(ctx.db, input.leagueId))) {
        advanced = await advanceLeague(ctx.db, input.leagueId, { days: adv.daysPerTick ?? 1 }, 'all-ready');
        await ctx.scheduler.sync(input.leagueId);
      }
    }
    return { ready: input.ready, advanced };
  }),

  log: memberProcedure.query(async ({ ctx, input }) => {
    const rows = await ctx.db.query<{
      id: string;
      triggered_by: string;
      from_day: number;
      to_day: number;
      games: number;
      phase_changes: string[];
      created_at: Date;
    }>('select * from advance_log where league_id = $1 order by id desc limit 50', [input.leagueId]);
    const names = new Map(
      (await ctx.db.query<{ id: string; display_name: string }>('select id, display_name from users')).map((u) => [u.id, u.display_name]),
    );
    return rows.map((r) => ({
      id: Number(r.id),
      by: r.triggered_by.startsWith('commissioner:')
        ? `${names.get(r.triggered_by.slice('commissioner:'.length)) ?? 'Commissioner'} (commissioner)`
        : r.triggered_by === 'schedule'
          ? 'Schedule'
          : 'Everyone ready',
      fromDay: r.from_day,
      toDay: r.to_day,
      games: r.games,
      phaseChanges: r.phase_changes,
      at: r.created_at,
    }));
  }),
});

