import {
  aiAsk,
  assetFits,
  NEED_LABEL,
  NEED_TAGS,
  setTradeBlock,
  tradeBlock,
  type NeedTag,
  capRoom,
  describeAsset,
  offerDaysLeft,
  evaluateForAi,
  playerValue,
  pickValue,
  retainedAmount,
  retainedCount,
  retainedSeasons,
  RETENTION,
  overall,
  payroll,
  pickLabel,
  proposeTrade,
  respondToTrade,
  reviewTrade,
  teamPicks,
  tradeDeadline,
  tradeWindowOpen,
  validateTrade,
  withdrawTrade,
  type League,
  type Team,
  type TradeAsset,
  type TradeProposal,
  OWNER_GOAL_LABEL,
  standings,
  withMemo,
} from '@hockey-gm/sim-core';
import { z } from 'zod';
import { mutateLeague } from '../advance';
import type { Queryable } from '../db';
import { assetList, deliver, tradePlayers, type Notice } from '../notify';
import { readLeague } from '../state';
import { badRequest, commissionerProcedure, memberProcedure, router, type Membership } from '../trpc';
import { publicPlayer, teamInfo } from '../views';
import { potentialView } from './data';
import { searchCatalog, searchInput, searchPlayers } from '../tradesearch';

const asset = z.union([
  z.object({ kind: z.literal('player'), id: z.string(), retain: z.number().min(0).max(0.5).optional() }),
  z.object({ kind: z.literal('pick'), key: z.string() }),
]);
const deal = z.object({ partner: z.string(), give: z.array(asset).max(10), get: z.array(asset).max(10) });

/** Tell the people involved what happened to a trade (every player in it is named, and links to his page). */
async function tradeNotices(L: League, q: Queryable, leagueId: string, t: TradeProposal, event: 'proposed' | 'responded' | 'reviewed') {
  const from = L.teams[t.fromTeam];
  const to = L.teams[t.toTeam];
  const notices: Notice[] = [];
  const link = '/trades';
  const players = tradePlayers(L, t);
  // The deal as each side sees it.
  const forFrom = `you get ${assetList(L, t.get)} for ${assetList(L, t.give)}`;
  const forTo = `you get ${assetList(L, t.give)} for ${assetList(L, t.get)}`;
  if (event === 'proposed' && t.status === 'pending' && to.controller.kind === 'human') {
    notices.push({ teamId: to.id, kind: 'trade', text: `${from.city} sent you a trade proposal: ${forTo}.`, link, players });
  }
  if (event === 'responded' && from.controller.kind === 'human') {
    const verb = t.status === 'completed' ? 'accepted' : t.status === 'awaiting-approval' ? 'accepted (pending commissioner approval)' : t.status === 'invalid' ? 'accepted, but it was no longer valid' : 'declined';
    notices.push({ teamId: from.id, kind: 'trade', text: `${to.city} ${verb} your trade proposal: ${forFrom}.`, link, players });
  }
  if (event === 'reviewed') {
    const verb = t.status === 'completed' ? 'approved' : 'vetoed';
    for (const team of [from, to]) {
      if (team.controller.kind !== 'human') continue;
      notices.push({ teamId: team.id, kind: 'trade', text: `The commissioner ${verb} your trade with ${team === from ? to.city : from.city}: ${team === from ? forFrom : forTo}.`, link, players });
    }
  }
  if (t.status === 'awaiting-approval' && event !== 'reviewed') {
    const rows = await q.query<{ commissioner_id: string }>('select commissioner_id from leagues where id = $1', [leagueId]);
    notices.push({
      userId: rows[0].commissioner_id,
      kind: 'commissioner',
      text: `A trade between ${from.city} and ${to.city} needs your approval: ${to.city} get ${assetList(L, t.give)}; ${from.city} get ${assetList(L, t.get)}.`,
      link,
      players,
    });
  }
  await deliver(q, leagueId, notices);
}

/** A neutral front office (consensus scouting, no contend/rebuild lean) for league-wide trade values. */
const MARKET = { id: 'league', controller: { kind: 'human', userId: '' }, roster: [] } as unknown as Team;

function requireTeam(m: Membership): string {
  if (!m.teamId) throw badRequest('You do not manage a team');
  return m.teamId;
}

function assetView(L: League, a: TradeAsset) {
  if (a.kind === 'pick') return { ...a, label: pickLabel(a.key, L) };
  const p = L.players[a.id];
  return { ...a, label: describeAsset(L, a), name: p ? `${p.firstName} ${p.lastName}` : a.id, pos: p?.pos, overall: p ? overall(p) : null };
}

function tradeView(L: League, t: TradeProposal) {
  return {
    ...t,
    /** An AI team made this offer: what their GM said, and how long it stands (days; 1 = today only). */
    fromAi: !!t.ai,
    pitch: t.ai?.pitch ?? null,
    daysLeft: offerDaysLeft(L, t),
    from: teamInfo(L.teams[t.fromTeam]),
    to: teamInfo(L.teams[t.toTeam]),
    give: t.give.map((a) => assetView(L, a)),
    get: t.get.map((a) => assetView(L, a)),
  };
}

/** Salary change for a team from a deal (positive = takes on money). */
function capDelta(L: League, incoming: TradeAsset[], outgoing: TradeAsset[]) {
  // (Retained salary stays with the team sending him.)
  const s = (xs: TradeAsset[]) =>
    xs.reduce((sum, a) => {
      if (a.kind !== 'player' || !L.players[a.id]) return sum;
      const p = L.players[a.id];
      return sum + (p.contract?.salary ?? 0) - (a.retain ? retainedAmount(p, a.retain) : 0);
    }, 0);
  return s(incoming) - s(outgoing);
}

export const tradesRouter = router({
  /**
   * Everything a team could put in a deal, with its trade block. With
   * `fitsFor`, each asset also lists which of that team's needs it would fill.
   */
  assets: memberProcedure.input(z.object({ teamId: z.string(), fitsFor: z.string().optional() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    // (Read-only from here: team rankings and the like are worked out once for the whole page.)
    return withMemo(() => {
    const t = L.teams[input.teamId];
    if (!t) throw badRequest('No such team');
    const block = tradeBlock(L, t);
    const onBlock = new Set([...block.players, ...block.picks]);
    const needs = input.fitsFor && L.teams[input.fitsFor] ? tradeBlock(L, L.teams[input.fitsFor]).needs : [];
    const player = (id: string, prospect: boolean) => ({
      ...publicPlayer(L, L.players[id]),
      /** League-wide trade value (a neutral front office's view: league scouting, no strategy). */
      value: Math.round(playerValue(L, MARKET, L.players[id])),
      potential: potentialView(L, ctx.membership.teamId, L.players[id]),
      prospect,
      onBlock: onBlock.has(id),
      fits: assetFits(L, { kind: 'player', id }, needs),
    });
    return {
      team: teamInfo(t),
      controller: t.controller.kind,
      capRoom: capRoom(L, t),
      payroll: payroll(L, t),
      block: { ...block, needLabels: block.needs.map((n) => NEED_LABEL[n]) },
      players: t.roster.map((id) => player(id, false)).sort((a, b) => b.overall - a.overall),
      prospects: (t.prospects ?? []).filter((id) => L.players[id]).map((id) => player(id, true)).sort((a, b) => b.overall - a.overall),
      picks: teamPicks(L, t.id).map((key) => {
        const [season, round, orig] = key.split(':');
        return { key, label: pickLabel(key, L), season: Number(season), round: Number(round), original: orig, onBlock: onBlock.has(key), fits: assetFits(L, { kind: 'pick', key }, needs), value: Math.round(pickValue(L, MARKET, key)) };
      }),
    };
    });
  }),

  /** Search every other team's players for a trade target (filters and sorting run here; at most `limit` rows come back). */
  search: memberProcedure.input(searchInput).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    return withMemo(() => searchPlayers(L, ctx.membership.teamId, input));
  }),

  /** What the trade search form offers: player types, traits, grades, ratings, teams. */
  searchCatalog: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    return searchCatalog(L);
  }),

  /** Set your trade block: who and what you're shopping, and what you want back. */
  setBlock: memberProcedure
    .input(
      z.object({
        players: z.array(z.string()).max(40),
        picks: z.array(z.string()).max(40),
        needs: z.array(z.enum(NEED_TAGS as [NeedTag, ...NeedTag[]])).max(9),
        note: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = requireTeam(ctx.membership);
      return mutateLeague(ctx.db, input.leagueId, (L) => {
        try {
          setTradeBlock(L, L.teams[teamId], { players: input.players, picks: input.picks, needs: input.needs, note: input.note });
        } catch (e) {
          throw badRequest((e as Error).message);
        }
        return tradeBlock(L, L.teams[teamId]);
      });
    }),

  /** Every team's trade block, for the league-wide view. */
  leagueBlock: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    return withMemo(() => {
    const my = ctx.membership.teamId;
    const myNeeds = my ? tradeBlock(L, L.teams[my]).needs : [];
    return {
      needLabels: NEED_LABEL,
      teams: Object.values(L.teams)
        .filter((t) => t.id !== my)
        .map((t) => {
          const b = tradeBlock(L, t);
          return {
            team: teamInfo(t),
            needs: b.needs,
            note: b.note ?? null,
            players: b.players
              .map((id) => L.players[id])
              .filter(Boolean)
              .map((p) => ({ ...publicPlayer(L, p), prospect: !p.teamId, potential: potentialView(L, my, p), fits: assetFits(L, { kind: 'player', id: p.id }, myNeeds) })),
            picks: b.picks.map((key) => ({ key, label: pickLabel(key, L) })),
          };
        }),
    };
    });
  }),

  /**
   * Every team, in league-standings order, with its record, the owner's goal
   * for the season and (AI teams) its front office's direction: who's buying,
   * who's selling.
   */
  partners: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const st = standings(L);
    const managers = new Map(
      (
        await ctx.db.query<{ team_id: string; display_name: string }>(
          'select m.team_id, u.display_name from league_members m join users u on u.id = m.user_id where m.league_id = $1 and m.team_id is not null',
          [input.leagueId],
        )
      ).map((r) => [r.team_id, r.display_name]),
    );
    return st.map((r, i) => {
      const t = L.teams[r.teamId];
      return {
        rank: i + 1,
        team: teamInfo(t),
        gp: r.gp,
        w: r.w,
        l: r.l,
        otl: r.otl,
        pts: r.pts,
        pointsPct: r.gp ? r.pts / (2 * r.gp) : null,
        diff: r.gf - r.ga,
        manager: managers.get(t.id) ?? null,
        goal: t.owner ? OWNER_GOAL_LABEL[t.owner.goal] : null,
        goalKey: t.owner?.goal ?? null,
        strategy: t.controller.kind === 'ai' ? t.controller.strategy : null,
      };
    });
  }),

  status: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const w = tradeWindowOpen(L);
    const deadline = tradeDeadline(L);
    return {
      open: w.open,
      reason: w.reason ?? null,
      deadlineDay: deadline,
      /** Days until the deadline during the regular season (0 = deadline day), else null. */
      daysToDeadline: L.phase === 'regular-season' ? deadline - L.day : null,
      duringDraft: L.phase === 'offseason' && L.offseason?.stage === 'draft',
      review: L.settings.tradeReview ?? 'none',
      phase: L.phase,
    };
  }),

  /** Check a deal without making it. For AI partners, includes how they feel about it. */
  evaluate: memberProcedure.input(deal).query(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    const L = await readLeague(ctx.db, input.leagueId);
    // (Read-only from here: team rankings and the like are worked out once for the whole page.)
    return withMemo(() => {
    const error = validateTrade(L, teamId, input.partner, input.give, input.get);
    const partner = L.teams[input.partner];
    const verdict = partner?.controller.kind === 'ai' && !error ? evaluateForAi(L, input.partner, input.give, input.get) : null;
    return {
      error,
      verdict: verdict
        ? {
            accept: verdict.accept,
            reason: verdict.reason,
            // Coarse meter only: managers see "how close", not the AI's numbers.
            meter: verdict.accept ? 1 : Math.max(0, Math.min(0.95, Math.round(verdict.ratio * 20) / 20)),
          }
        : null,
      myCapChange: capDelta(L, input.get, input.give),
      theirCapChange: capDelta(L, input.give, input.get),
      /** Retained salary each side would carry (per season, and for how many seasons). */
      retained: [...input.give.map((a) => ({ a, side: 'me' as const })), ...input.get.map((a) => ({ a, side: 'them' as const }))]
        .filter((x) => x.a.kind === 'player' && x.a.retain && L.players[x.a.id])
        .map(({ a, side }) => {
          const p = L.players[(a as { id: string }).id];
          return { side, playerId: p.id, name: `${p.firstName} ${p.lastName}`, share: (a as { retain: number }).retain, amount: retainedAmount(p, (a as { retain: number }).retain), seasons: retainedSeasons(L, p) };
        }),
      myRetainedCount: retainedCount(L, L.teams[teamId]),
      theirRetainedCount: partner ? retainedCount(L, partner) : 0,
      retentionMax: RETENTION,
    };
    });
  }),

  /** For an AI partner: the smallest thing they'd want added from your side. */
  askAi: memberProcedure.input(deal).query(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    const L = await readLeague(ctx.db, input.leagueId);
    if (L.teams[input.partner]?.controller.kind !== 'ai') throw badRequest('Only AI teams answer that');
    const extra = aiAsk(L, input.partner, teamId, input.give, input.get);
    return extra ? extra.map((a) => assetView(L, a)) : null;
  }),

  propose: memberProcedure.input(deal).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    return mutateLeague(ctx.db, input.leagueId, async (L, q) => {
      let t: TradeProposal;
      try {
        t = proposeTrade(L, teamId, input.partner, input.give, input.get);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      await tradeNotices(L, q, input.leagueId, t, 'proposed');
      return tradeView(L, t);
    });
  }),

  respond: memberProcedure.input(z.object({ tradeId: z.string(), accept: z.boolean() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    return mutateLeague(ctx.db, input.leagueId, async (L, q) => {
      let t: TradeProposal;
      try {
        t = respondToTrade(L, input.tradeId, teamId, input.accept);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      await tradeNotices(L, q, input.leagueId, t, 'responded');
      return tradeView(L, t);
    });
  }),

  withdraw: memberProcedure.input(z.object({ tradeId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        withdrawTrade(L, input.tradeId, teamId);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    });
    return { ok: true };
  }),

  review: commissionerProcedure.input(z.object({ tradeId: z.string(), approve: z.boolean() })).mutation(async ({ ctx, input }) => {
    await mutateLeague(ctx.db, input.leagueId, async (L, q) => {
      try {
        reviewTrade(L, input.tradeId, input.approve);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      await tradeNotices(L, q, input.leagueId, L.trades!.find((t) => t.id === input.tradeId)!, 'reviewed');
    });
    return { ok: true };
  }),

  setReview: commissionerProcedure.input(z.object({ review: z.enum(['none', 'commissioner']) })).mutation(async ({ ctx, input }) => {
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      L.settings.tradeReview = input.review;
    });
    return { ok: true };
  }),

  list: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const my = ctx.membership.teamId;
    const all = (L.trades ?? []).slice().reverse();
    const mine = (t: TradeProposal) => t.fromTeam === my || t.toTeam === my;
    return {
      incoming: all.filter((t) => t.status === 'pending' && t.toTeam === my).map((t) => tradeView(L, t)),
      outgoing: all.filter((t) => (t.status === 'pending' || t.status === 'awaiting-approval') && t.fromTeam === my).map((t) => tradeView(L, t)),
      awaitingApproval: ctx.membership.isCommissioner ? all.filter((t) => t.status === 'awaiting-approval').map((t) => tradeView(L, t)) : [],
      myHistory: all.filter((t) => mine(t) && t.status !== 'pending' && t.status !== 'awaiting-approval').slice(0, 20).map((t) => tradeView(L, t)),
      leagueCompleted: all.filter((t) => t.status === 'completed').slice(0, 30).map((t) => tradeView(L, t)),
    };
  }),
});
