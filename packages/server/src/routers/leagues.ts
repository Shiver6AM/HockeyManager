import { cleanSliders, createLeague, describeAsset, offerDaysLeft, FA_DAYS, faDayOf, fantasyOnClock, lotteryShowLength, RESIGN_DAYS, SIM_SLIDERS, slider, tradeDeadline, type AdvanceMode, type League, type SimSlider } from '@hockey-gm/sim-core';
import { simcastSummary } from '../simcast';
import { publish } from '../events';
import { TRPCError } from '@trpc/server';
import { randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import { describeCron, mutateLeague } from '../advance';
import { newId } from '../auth';
import { leagueMeta, packState, readLeague } from '../state';
import { deliver } from '../notify';
import { authedProcedure, badRequest, commissionerProcedure, memberProcedure, router } from '../trpc';
import { teamInfo, teamRating } from '../views';

export const advanceModeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('commissioner') }),
  z.object({
    mode: z.literal('scheduled'),
    cron: z.string().min(9).max(100),
    timezone: z.string().min(1).max(64),
    daysPerTick: z.number().int().min(1).max(14),
    advanceEarlyWhenAllReady: z.boolean(),
  }),
]);

function validateAdvance(adv: AdvanceMode) {
  if (adv.mode !== 'scheduled') return;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: adv.timezone });
  } catch {
    throw badRequest(`Unknown timezone "${adv.timezone}"`);
  }
  try {
    if (!describeCron(adv.cron, adv.timezone)) throw new Error('never fires');
  } catch (e) {
    throw badRequest(`Invalid schedule "${adv.cron}": ${(e as Error).message}`);
  }
}

const inviteCode = () => randomBytes(4).toString('hex').toUpperCase();

export const leaguesRouter = router({
  mine: authedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query<{ id: string; name: string; team_id: string | null; commissioner_id: string; members: string }>(
      `select l.id, l.name, m.team_id, l.commissioner_id,
              (select count(*) from league_members m2 where m2.league_id = l.id) as members
       from league_members m join leagues l on l.id = m.league_id
       where m.user_id = $1 order by l.created_at desc`,
      [ctx.user.id],
    );
    return Promise.all(
      rows.map(async (r) => {
        const L = await readLeague(ctx.db, r.id);
        const team = r.team_id ? teamInfo(L.teams[r.team_id]) : null;
        return {
          id: r.id,
          name: r.name,
          season: L.season,
          day: L.day,
          phase: L.phase,
          myTeam: team,
          isCommissioner: r.commissioner_id === ctx.user.id,
          members: Number(r.members),
        };
      }),
    );
  }),

  create: authedProcedure
    .input(
      z.object({
        name: z.string().trim().min(3).max(60),
        advance: advanceModeSchema.optional(),
        /** Where the league begins (default: the offseason, the week before free agency). */
        start: z.enum(['re-sign', 'draft', 'season']).default('re-sign'),
        /** Redistribute every player in a fantasy draft first. */
        fantasy: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const advance: AdvanceMode = input.advance ?? { mode: 'commissioner' };
      validateAdvance(advance);
      const id = newId('lg');
      const seed = randomInt(1, 2 ** 31 - 1);
      const league = createLeague({ seed, name: input.name, advance, start: input.start, fantasy: input.fantasy });
      league.id = id;
      await ctx.db.tx(async (q) => {
        const { summary, z } = packState(league);
        await q.query(
          'insert into leagues (id, name, commissioner_id, invite_code, seed, advance, state, state_z) values ($1, $2, $3, $4, $5, $6, $7, $8)',
          [id, input.name, ctx.user.id, inviteCode(), seed, JSON.stringify(advance), summary, z],
        );
        await q.query('insert into league_members (league_id, user_id) values ($1, $2)', [id, ctx.user.id]);
      });
      await ctx.scheduler.sync(id);
      return { id };
    }),

  join: authedProcedure.input(z.object({ inviteCode: z.string().trim().toUpperCase() })).mutation(async ({ ctx, input }) => {
    const rows = await ctx.db.query<{ id: string }>('select id from leagues where invite_code = $1', [input.inviteCode]);
    if (!rows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'No league with that invite code' });
    await ctx.db.query('insert into league_members (league_id, user_id) values ($1, $2) on conflict do nothing', [rows[0].id, ctx.user.id]);
    publish(rows[0].id, { type: 'changed' });
    return { id: rows[0].id };
  }),

  overview: memberProcedure.query(async ({ ctx, input }) => {
    const meta = (await leagueMeta(ctx.db, input.leagueId))!;
    const L = await readLeague(ctx.db, input.leagueId);
    const members = await ctx.db.query<{ user_id: string; display_name: string; team_id: string | null; ready: boolean; co_commissioner: boolean }>(
      `select m.user_id, u.display_name, m.team_id, m.ready, m.co_commissioner from league_members m join users u on u.id = m.user_id
       where m.league_id = $1 order by m.joined_at`,
      [input.leagueId],
    );
    const last = await ctx.db.query<{ triggered_by: string; from_day: number; to_day: number; games: number; created_at: Date }>(
      'select triggered_by, from_day, to_day, games, created_at from advance_log where league_id = $1 order by id desc limit 1',
      [input.leagueId],
    );
    const lastRegularDay = L.schedule.reduce((m, g) => Math.max(m, g.day), 0);
    const gamesToday = L.schedule.filter((g) => g.day === L.day).length;
    return {
      id: meta.id,
      name: meta.name,
      /** Bumps on every saved change to the league: clients refresh their views when it moves. */
      version: meta.version,
      /** Every team (for logos and names wherever a team id shows up). */
      teams: Object.values(L.teams).map(teamInfo),
      inviteCode: meta.invite_code,
      season: L.season,
      day: L.day,
      lastRegularDay,
      gamesToday,
      phase: L.phase,
      /** Where the league is, in a few words ("Pre-draft", "Free agency · day 3 of 10", "Playoffs · round 2"). */
      stageLabel: stageLabel(L),
      /** A game being simcast right now (the league can't sim until it ends). */
      simcast: simcastSummary(input.leagueId),
      /** Offseason stage and, during the re-signing week, which day it is. */
      offseasonStage: L.offseason?.stage ?? null,
      resignDay: L.offseason?.stage === 're-sign' ? (L.offseason.resignDay ?? RESIGN_DAYS) : null,
      resignDays: RESIGN_DAYS,
      faDay: L.offseason?.stage === 'free-agency' ? faDayOf(L.offseason) : null,
      faDays: FA_DAYS,
      /** A new league that hasn't played a season yet. */
      freshStart: !!L.freshStart,
      /** The fantasy draft, while it's on. */
      fantasy:
        L.fantasy && !L.fantasy.done
          ? {
              started: L.fantasy.started,
              current: L.fantasy.current,
              total: L.fantasy.picks.length,
              onClock: fantasyOnClock(L)?.teamId ?? null,
            }
          : null,
      /** Trade deadline (regular season): the day, and days left (0 = deadline day). */
      tradeDeadlineDay: L.phase === 'regular-season' ? tradeDeadline(L) : null,
      daysToDeadline: L.phase === 'regular-season' ? tradeDeadline(L) - L.day : null,
      /** Trade offers waiting on my answer (shown on every page so none is missed). */
      tradeOffers: (L.trades ?? [])
        .filter((t) => t.status === 'pending' && !!ctx.membership.teamId && t.toTeam === ctx.membership.teamId)
        .map((t) => ({
          id: t.id,
          from: teamInfo(L.teams[t.fromTeam]),
          fromAi: !!t.ai,
          youGet: t.give.map((a) => describeAsset(L, a)),
          youGive: t.get.map((a) => describeAsset(L, a)),
          daysLeft: offerDaysLeft(L, t),
        })),
      champion: L.playoffs?.champion ? teamInfo(L.teams[L.playoffs.champion]) : null,
      advance: meta.advance,
      nextAdvanceAt: meta.next_advance_at,
      isCommissioner: ctx.membership.isCommissioner,
      isCoCommissioner: ctx.membership.isCoCommissioner,
      canAdvance: ctx.membership.canAdvance,
      myTeamId: ctx.membership.teamId,
      myReady: ctx.membership.ready,
      commissionerId: meta.commissioner_id,
      members: members.map((m) => ({
        userId: m.user_id,
        displayName: m.display_name,
        teamId: m.team_id,
        team: m.team_id ? teamInfo(L.teams[m.team_id]) : null,
        ready: m.ready,
        coCommissioner: !!m.co_commissioner,
        isCommissioner: m.user_id === meta.commissioner_id,
      })),
      lastAdvance: last[0] ?? null,
    };
  }),

  teams: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const managers = await ctx.db.query<{ team_id: string; display_name: string }>(
      `select m.team_id, u.display_name from league_members m join users u on u.id = m.user_id
       where m.league_id = $1 and m.team_id is not null`,
      [input.leagueId],
    );
    const byTeam = new Map(managers.map((m) => [m.team_id, m.display_name]));
    return Object.values(L.teams)
      .map((t) => ({ ...teamInfo(t), manager: byTeam.get(t.id) ?? null, rating: teamRating(L, t) }))
      .sort((a, b) => a.conference.localeCompare(b.conference) || a.division.localeCompare(b.division) || a.city.localeCompare(b.city));
  }),

  claimTeam: memberProcedure.input(z.object({ teamId: z.string() })).mutation(async ({ ctx, input }) => {
    if (ctx.membership.teamId) throw badRequest('You already manage a team. Release it first.');
    await mutateLeague(ctx.db, input.leagueId, async (L, q) => {
      const team = L.teams[input.teamId];
      if (!team) throw badRequest('No such team');
      if (team.controller.kind === 'human') throw badRequest('That team already has a manager');
      team.controller = { kind: 'human', userId: ctx.user.id };
      team.autoLines = true;
      await q.query('update league_members set team_id = $1, ready = false where league_id = $2 and user_id = $3', [
        input.teamId,
        input.leagueId,
        ctx.user.id,
      ]);
    });
    return { ok: true };
  }),

  releaseTeam: memberProcedure
    .input(z.object({ userId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const target = input.userId ?? ctx.user.id;
      if (target !== ctx.user.id && !ctx.membership.isCommissioner) throw badRequest('Only the commissioner can remove another manager');
      const rows = await ctx.db.query<{ team_id: string | null }>(
        'select team_id from league_members where league_id = $1 and user_id = $2',
        [input.leagueId, target],
      );
      const teamId = rows[0]?.team_id;
      if (!teamId) throw badRequest('That member does not manage a team');
      await mutateLeague(ctx.db, input.leagueId, async (L, q) => {
        L.teams[teamId].controller = { kind: 'ai', strategy: 'balanced' };
        delete L.teams[teamId].autoLines;
        await q.query('update league_members set team_id = null, ready = false where league_id = $1 and user_id = $2', [
          input.leagueId,
          target,
        ]);
      });
      return { ok: true };
    }),

  updateAdvance: commissionerProcedure.input(z.object({ advance: advanceModeSchema })).mutation(async ({ ctx, input }) => {
    validateAdvance(input.advance);
    await mutateLeague(ctx.db, input.leagueId, async (L, q) => {
      L.settings.advance = input.advance;
      await q.query('update leagues set advance = $1 where id = $2', [JSON.stringify(input.advance), input.leagueId]);
    });
    await ctx.scheduler.sync(input.leagueId);
    return { nextAdvanceAt: ctx.scheduler.nextRun(input.leagueId) };
  }),

  /** Let another member advance the league (settings and trade approvals stay with the commissioner). */
  setCoCommissioner: commissionerProcedure.input(z.object({ userId: z.string(), value: z.boolean() })).mutation(async ({ ctx, input }) => {
    const rows = await ctx.db.query<{ commissioner_id: string }>('select commissioner_id from leagues where id = $1', [input.leagueId]);
    if (rows[0]?.commissioner_id === input.userId) throw badRequest('You are already the commissioner');
    const updated = await ctx.db.query<{ user_id: string }>(
      'update league_members set co_commissioner = $1 where league_id = $2 and user_id = $3 returning user_id',
      [input.value, input.leagueId, input.userId],
    );
    if (!updated.length) throw badRequest('That person is not in this league');
    await deliver(ctx.db, input.leagueId, [
      {
        userId: input.userId,
        kind: 'commissioner',
        text: input.value ? 'You are now a co-commissioner: you can advance the league.' : 'You are no longer a co-commissioner.',
        link: '/',
      },
    ]);
    return { ok: true };
  }),

  /** Commissioner sliders: current values and their ranges. */
  simSettings: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    return {
      sliders: (Object.keys(SIM_SLIDERS) as SimSlider[]).map((key) => ({ key, ...SIM_SLIDERS[key], value: slider(L, key) })),
      canEdit: ctx.membership.isCommissioner,
    };
  }),

  updateSimSettings: commissionerProcedure.input(z.object({ sim: z.record(z.string(), z.number()) })).mutation(async ({ ctx, input }) => {
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      L.settings.sim = cleanSliders(input.sim);
    });
    return { ok: true };
  }),

  regenerateInvite: commissionerProcedure.mutation(async ({ ctx, input }) => {
    const code = inviteCode();
    await ctx.db.query('update leagues set invite_code = $1 where id = $2', [code, input.leagueId]);
    return { inviteCode: code };
  }),
});

/** A granular description of where the league is in its year. */
export function stageLabel(L: League): string {
  if (L.fantasy && !L.fantasy.done) return L.fantasy.started ? `Fantasy draft · pick ${L.fantasy.current + 1} of ${L.fantasy.picks.length}` : 'Pre-draft (fantasy)';
  if (L.phase === 'regular-season') {
    if (L.day === 0) return 'Opening night';
    const d = tradeDeadline(L) - L.day;
    if (d > 0 && d <= 7) return `Regular season · deadline in ${d}d`;
    if (d === 0) return 'Trade deadline day';
    return d < 0 ? 'Regular season · stretch run' : 'Regular season';
  }
  if (L.phase === 'playoffs') {
    const rounds = L.playoffs?.rounds ?? [];
    const r = rounds.length;
    return ['Playoffs', 'Playoffs · first round', 'Playoffs · second round', 'Conference finals', 'Championship final'][r] ?? 'Playoffs';
  }
  const os = L.offseason;
  if (!os) return 'Season review';
  switch (os.stage) {
    case 'fantasy-draft':
      return 'Fantasy draft';
    case 'draft':
      if (os.draft.lotteryHeld === false || (os.draft.lotteryShow && Date.now() < os.draft.lotteryShow + lotteryShowLength(L))) return 'Draft lottery';
      return os.draft.current === 0 && !os.draft.clock ? 'Pre-draft' : `Entry draft · pick ${Math.min(os.draft.current + 1, os.draft.picks.length)} of ${os.draft.picks.length}`;
    case 're-sign':
      return `Re-signing window · day ${os.resignDay ?? RESIGN_DAYS} of ${RESIGN_DAYS}`;
    case 'free-agency':
      return `Free agency · day ${faDayOf(os)} of ${FA_DAYS}`;
    case 'training-camp':
      return 'Pre-season · training camp';
  }
  return 'Offseason';
}
