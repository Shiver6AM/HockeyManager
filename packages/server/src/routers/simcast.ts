/** Simcasts: watch one of the next day's games live, together. */
import { upcomingGames } from '@hockey-gm/sim-core';
import { z } from 'zod';
import { isSimming, mutateLeague } from '../advance';
import { controlSimcast, simcastSummary, simcastView, startSimcast } from '../simcast';
import { readLeague } from '../state';
import { badRequest, memberProcedure, router } from '../trpc';
import { teamInfo } from '../views';

export const simcastRouter = router({
  /** The next game day's games (the ones you can watch), and the simcast on now, if any. */
  games: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const my = ctx.membership.teamId;
    return {
      live: simcastSummary(input.leagueId),
      day: L.day,
      phase: L.phase,
      games: upcomingGames(L)
        .map((g) => ({
          id: g.id,
          home: teamInfo(L.teams[g.home]),
          away: teamInfo(L.teams[g.away]),
          mine: g.home === my || g.away === my,
          gameNumber: g.gameNumber ?? null,
          watched: !!L.presimmed?.some((x) => x.gameId === g.id && x.day === L.day && x.season === L.season),
        }))
        .sort((a, b) => Number(b.mine) - Number(a.mine)),
    };
  }),

  start: memberProcedure.input(z.object({ gameId: z.number().int() })).mutation(async ({ ctx, input }) => {
    if (isSimming(input.leagueId)) throw badRequest('The league is simming right now');
    return mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        return startSimcast(L, input.leagueId, input.gameId, { id: ctx.user.id, name: ctx.user.displayName });
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    });
  }),

  state: memberProcedure.query(({ ctx, input }) => {
    const v = simcastView(input.leagueId, { id: ctx.user.id, name: ctx.user.displayName });
    if (!v) return null;
    const { hostId, ...rest } = v;
    return { ...rest, canControl: hostId === ctx.user.id || ctx.membership.canAdvance };
  }),

  control: memberProcedure
    .input(
      z.object({
        action: z.enum(['speed', 'pause', 'resume', 'skip-period', 'skip-end', 'end']),
        speed: z.number().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      try {
        const action = input.action === 'speed' ? { kind: 'speed' as const, speed: input.speed ?? 1 } : { kind: input.action };
        return controlSimcast(input.leagueId, { id: ctx.user.id, canAdvance: ctx.membership.canAdvance }, action);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    }),
});
