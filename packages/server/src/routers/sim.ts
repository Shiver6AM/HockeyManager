import { z } from 'zod';
import { advanceLeague, allHumansReady, type AdvanceSummary } from '../advance';
import { readLeague } from '../state';
import { badRequest, commissionerProcedure, memberProcedure, router } from '../trpc';

const target = z.union([
  z.object({ days: z.number().int().min(1).max(400) }),
  z.object({ to: z.enum(['playoffs', 'end-of-season']) }),
]);

export const simRouter = router({
  /** Commissioner-driven advance. Works in both modes (a manual override for scheduled leagues). */
  advance: commissionerProcedure.input(z.object({ target })).mutation(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    if (L.phase === 'offseason') throw badRequest('The season is over');
    const summary = await advanceLeague(ctx.db, input.leagueId, input.target, `commissioner:${ctx.user.id}`);
    await ctx.scheduler.sync(input.leagueId).catch(() => undefined);
    return summary;
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
    let advanced: AdvanceSummary | null = null;
    if (input.ready) {
      const rows = await ctx.db.query<{ advance: { mode: string; daysPerTick?: number; advanceEarlyWhenAllReady?: boolean } }>(
        'select advance from leagues where id = $1',
        [input.leagueId],
      );
      const adv = rows[0].advance;
      const L = await readLeague(ctx.db, input.leagueId);
      if (adv.mode === 'scheduled' && adv.advanceEarlyWhenAllReady && L.phase !== 'offseason' && (await allHumansReady(ctx.db, input.leagueId))) {
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
