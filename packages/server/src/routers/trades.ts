import {
  aiAsk,
  capRoom,
  describeAsset,
  evaluateForAi,
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
  type TradeAsset,
  type TradeProposal,
} from '@hockey-gm/sim-core';
import { z } from 'zod';
import { mutateLeague } from '../advance';
import { readLeague } from '../state';
import { badRequest, commissionerProcedure, memberProcedure, router, type Membership } from '../trpc';
import { publicPlayer, teamInfo } from '../views';

const asset = z.union([z.object({ kind: z.literal('player'), id: z.string() }), z.object({ kind: z.literal('pick'), key: z.string() })]);
const deal = z.object({ partner: z.string(), give: z.array(asset).max(10), get: z.array(asset).max(10) });

function requireTeam(m: Membership): string {
  if (!m.teamId) throw badRequest('You do not manage a team');
  return m.teamId;
}

function assetView(L: League, a: TradeAsset) {
  if (a.kind === 'pick') return { ...a, label: pickLabel(a.key) };
  const p = L.players[a.id];
  return { ...a, label: describeAsset(L, a), name: p ? `${p.firstName} ${p.lastName}` : a.id, pos: p?.pos, overall: p ? overall(p) : null };
}

function tradeView(L: League, t: TradeProposal) {
  return {
    ...t,
    from: teamInfo(L.teams[t.fromTeam]),
    to: teamInfo(L.teams[t.toTeam]),
    give: t.give.map((a) => assetView(L, a)),
    get: t.get.map((a) => assetView(L, a)),
  };
}

/** Salary change for a team from a deal (positive = takes on money). */
function capDelta(L: League, incoming: TradeAsset[], outgoing: TradeAsset[]) {
  const s = (xs: TradeAsset[]) => xs.reduce((sum, a) => sum + (a.kind === 'player' ? (L.players[a.id]?.contract?.salary ?? 0) : 0), 0);
  return s(incoming) - s(outgoing);
}

export const tradesRouter = router({
  /** Everything a team could put in a deal. */
  assets: memberProcedure.input(z.object({ teamId: z.string() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const t = L.teams[input.teamId];
    if (!t) throw badRequest('No such team');
    return {
      team: teamInfo(t),
      controller: t.controller.kind,
      capRoom: capRoom(L, t),
      payroll: payroll(L, t),
      players: t.roster.map((id) => ({ ...publicPlayer(L, L.players[id]), prospect: false })).sort((a, b) => b.overall - a.overall),
      prospects: (t.prospects ?? []).map((id) => ({ ...publicPlayer(L, L.players[id]), prospect: true })).sort((a, b) => b.overall - a.overall),
      picks: teamPicks(L, t.id).map((key) => ({ key, label: pickLabel(key) })),
    };
  }),

  status: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const w = tradeWindowOpen(L);
    return { open: w.open, reason: w.reason ?? null, deadlineDay: tradeDeadline(L), review: L.settings.tradeReview ?? 'none', phase: L.phase };
  }),

  /** Check a deal without making it. For AI partners, includes how they feel about it. */
  evaluate: memberProcedure.input(deal).query(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    const L = await readLeague(ctx.db, input.leagueId);
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
    };
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
    return mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        return tradeView(L, proposeTrade(L, teamId, input.partner, input.give, input.get));
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    });
  }),

  respond: memberProcedure.input(z.object({ tradeId: z.string(), accept: z.boolean() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    return mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        return tradeView(L, respondToTrade(L, input.tradeId, teamId, input.accept));
      } catch (e) {
        throw badRequest((e as Error).message);
      }
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
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        reviewTrade(L, input.tradeId, input.approve);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
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
