/**
 * Offseason actions (draft, re-signing, free agency) and roster moves that
 * work year-round (promote/send down prospects, release, in-season signings).
 */
import {
  age,
  askingContract,
  capRoom,
  deadCapFor,
  demoteToProspects,
  FA_DAYS,
  FA_LISTEN_DAYS,
  faDayOf,
  faDecidesIn,
  NEGOTIATION,
  offerExtension,
  offersAreDeferred,
  submitResignOffer,
  withdrawResignOffer,
  acceptCounter,
  RESIGN_DAYS,
  placeBid,
  priorities,
  qualifyingOffer,
  withdrawBid,
  freeAgents,
  makePick,
  offseasonStep,
  onTheClock,
  OFFSEASON_STAGES,
  payroll,
  projectionLabel,
  promoteProspect,
  releasePlayer,
  ROSTER_MAX,
  scoutedPotential,
  negotiateFreeAgent,
  arbitrationEligible,
  expectedAward,
  qoResponse,
  compensationPicks,
  compensationTable,
  decideOfferSheet,
  pickLabel,
  tenderOfferSheet,
  walkAwayFromAward,
  walkAwayThreshold,
  withdrawOfferSheet,
  STAGE_LABELS,
  SUMMER_ROSTER_MAX,
  type League,
  type Player,
  proSeasons,
  MINOR_LEAGUES,
  minorLeagueOf,
  playerRegion,
  REGION_LABEL,
  SCOUTING,
  scoutConfidence,
  balanceRoster,
  callUp,
  contractCount,
  CONTRACT_MAX,
  nhlRoster,
  sendDown,
  activeRoster,
  ACTIVE_MAX,
  affiliateLabel,
  signProspectToFarm,
  fantasyOnClock,
  overall,
  fantasyAvailable,
  fantasyPick,
  fantasyPickProblem,
  fantasyValue,
  FANTASY_ROUNDS,
  centralScouting,
  autoLines,
  healthyRoster,
} from '@hockey-gm/sim-core';
import { z } from 'zod';
import { mutateLeague } from '../advance';
import { dealTerms } from '../deal';
import { deliver } from '../notify';
import { readLeague } from '../state';
import { advancerProcedure, badRequest, memberProcedure, router, type Membership } from '../trpc';
import { publicPlayer, teamInfo } from '../views';

/** Letter grade from a scout's ceiling estimate. */
export function grade(scouted: number): string {
  const scale: Array<[number, string]> = [
    [88, 'A+'], [84, 'A'], [80, 'A-'], [77, 'B+'], [74, 'B'], [71, 'B-'], [68, 'C+'], [65, 'C'], [62, 'C-'], [58, 'D'],
  ];
  return scale.find(([min]) => scouted >= min)?.[1] ?? 'F';
}

/** What the viewer's scouts think of a player. Managers without a team see a league-wide consensus. */
/** His most recent NHL season: this one if he's played, otherwise his last. */
function recentStats(L: League, p: Player) {
  const now = { skater: L.skaterStats[p.id] ?? null, goalie: L.goalieStats[p.id] ?? null };
  if ((now.skater?.gp ?? now.goalie?.gp ?? 0) > 0) return { statsSeason: L.season, skaterStats: now.skater, goalieStats: now.goalie };
  const last = [...(L.careerStats?.[p.id] ?? [])].reverse().find((c) => (c.skater?.gp ?? c.goalie?.gp ?? 0) > 0);
  return { statsSeason: last?.season ?? null, skaterStats: last?.skater ?? null, goalieStats: last?.goalie ?? null };
}

function scouting(L: League, viewerTeam: string | null, p: Player) {
  const s = scoutedPotential(L, viewerTeam ?? 'league', p);
  return { grade: grade(s), projection: projectionLabel(s, p.pos) };
}

/**
 * A draft-eligible prospect as the viewer's scouts see him: where he plays,
 * his stats, and a projection only if they've scouted his region (with how
 * confident they are). Unscouted players show no ratings or projection.
 */
export function classView(L: League, viewerTeam: string | null, p: Player, draftSeason: number) {
  const conf = scoutConfidence(L, viewerTeam ?? 'league', p);
  const scouted = conf >= SCOUTING.showAt;
  const s = scoutedPotential(L, viewerTeam ?? 'league', p);
  const mt = minorLeagueOf(L, p);
  const region = playerRegion(L, p);
  const base = publicPlayer(L, p);
  const stats = L.prospectStats?.[p.id] ?? null;
  return {
    ...base,
    overall: scouted ? base.overall : null,
    skater: scouted ? base.skater : null,
    goalie: scouted ? base.goalie : null,
    age: age(p, draftSeason),
    league: MINOR_LEAGUES[mt.league]?.name ?? mt.league,
    club: mt.team,
    region,
    regionLabel: REGION_LABEL[region],
    stats,
    confidence: Math.round(conf * 100) / 100,
    /** Central Scouting's consensus ranking (the same for every team). */
    css: centralScouting(L, draftSeason).get(p.id) ?? null,
    scouted,
    grade: scouted ? grade(s) : null,
    projection: scouted ? projectionLabel(s, p.pos) : null,
    /** For sorting: the scouts' read, or a stats-based guess for players nobody has seen. */
    scoutValue: scouted ? s : 40 + (stats ? Math.min(25, ((stats.g + stats.a) / Math.max(1, stats.gp)) * 12) : 0),
  };
}

/** Tell the manager now on the clock (fantasy or entry draft). */
async function notifyClock(q: Parameters<typeof deliver>[0], leagueId: string, L: League, except?: string) {
  const f = L.fantasy && !L.fantasy.done ? fantasyOnClock(L) : null;
  const e = !f && L.offseason?.stage === 'draft' ? onTheClock(L) : null;
  const clock = f ?? e;
  if (!clock || clock.teamId === except || L.teams[clock.teamId].controller.kind !== 'human') return;
  const text = f ? `You're on the clock in the fantasy draft: round ${clock.round}, pick #${clock.overall}.` : `You're on the clock: round ${clock.round}, pick #${clock.overall}.`;
  await deliver(q, leagueId, [{ teamId: clock.teamId, kind: 'draft', text, link: f ? '/fantasy' : '/draft' }]);
}

function requireTeam(m: Membership): string {
  if (!m.teamId) throw badRequest('You do not manage a team');
  return m.teamId;
}

function mustBeStage(L: League, ...stages: string[]) {
  if (L.phase !== 'offseason' || !stages.includes(L.offseason!.stage)) {
    throw badRequest(`That can only be done during: ${stages.map((s) => STAGE_LABELS[s as keyof typeof STAGE_LABELS] ?? s).join(', ')}`);
  }
}

const isFreeAgentNow = (L: League, id: string) => !!L.players[id] && !L.players[id].teamId && !L.players[id].prospectOf;

export const offseasonRouter = router({
  overview: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const os = L.offseason;
    if (L.phase !== 'offseason' || !os) return null;
    const my = ctx.membership.teamId;
    const d = os.draft;
    const clock = onTheClock(L);
    const myPicks = my ? d.picks.filter((p) => p.teamId === my) : [];
    const topDev = Object.entries(os.development)
      .filter(([id]) => L.players[id] && (L.players[id].teamId || L.players[id].prospectOf))
      .map(([id, [a, b]]) => ({ id, delta: b - a, before: a, after: b }))
      .sort((x, y) => y.delta - x.delta);
    const devView = (x: (typeof topDev)[number]) => ({
      ...x,
      name: `${L.players[x.id].firstName} ${L.players[x.id].lastName}`,
      teamId: L.players[x.id].teamId ?? L.players[x.id].prospectOf ?? null,
      age: age(L.players[x.id], L.season + 1),
    });
    return {
      season: os.season,
      stage: os.stage,
      stages: (L.fantasy ? (['fantasy-draft', ...OFFSEASON_STAGES] as const) : OFFSEASON_STAGES).map((s) => ({ id: s, label: STAGE_LABELS[s] })),
      /** A new league: no season has been played yet. */
      fresh: !!L.freshStart,
      draft: {
        done: d.current >= d.picks.length,
        current: d.current,
        total: d.picks.length,
        onTheClock: clock ? { ...clock, team: teamInfo(L.teams[clock.teamId]), isMe: clock.teamId === my } : null,
        myNextPick: myPicks.find((p) => !p.playerId) ?? null,
        lottery: d.lottery.map(([t, from, to]) => ({ team: teamInfo(L.teams[t]), from, to })),
      },
      myExpiringCount: my ? Object.keys(os.expiring).filter((id) => L.players[id]?.teamId === my).length : 0,
      myUndecided: my ? Object.keys(os.expiring).filter((id) => L.players[id]?.teamId === my && os.resign[id] === undefined).length : 0,
      risers: topDev.slice(0, 8).map(devView),
      fallers: topDev.slice(-5).reverse().map(devView),
      retired: Object.values(L.retired ?? {})
        .filter((r) => r.retiredAfter === os.season)
        .sort((a, b) => b.peakOverall - a.peakOverall)
        .slice(0, 10)
        .map((r) => ({
          id: r.id,
          name: r.name,
          pos: r.pos,
          peakOverall: r.peakOverall,
          seasons: proSeasons(r.career).length,
          team: r.lastTeamId ? teamInfo(L.teams[r.lastTeamId]) : null,
          points: r.career.reduce((s, c) => s + (c.skater ? c.skater.g + c.skater.a : 0), 0),
        })),
    };
  }),

  /**
   * Commissioner: get a draft going (the fantasy draft, or the entry draft at a
   * draft start). Picks run until a manager is on the clock.
   */
  proceed: advancerProcedure.mutation(async ({ ctx, input }) =>
    mutateLeague(ctx.db, input.leagueId, async (L, q) => {
      const stage = L.offseason?.stage;
      if (L.phase !== 'offseason' || (stage !== 'fantasy-draft' && stage !== 'draft')) throw badRequest('There is no draft to start');
      const step = offseasonStep(L, { force: false });
      await notifyClock(q, input.leagueId, L);
      return { to: step.to, note: step.note };
    }),
  ),

  fantasyBoard: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const f = L.fantasy;
    if (!f) return null;
    const my = ctx.membership.teamId;
    const team = my ? L.teams[my] : null;
    const clock = fantasyOnClock(L);
    const nameOf = (id: string) => `${L.players[id]?.firstName} ${L.players[id]?.lastName}`;
    const mine = team ? team.roster.map((id) => L.players[id]).filter(Boolean) : [];
    const count = (g: string) => mine.filter((p) => (g === 'G' ? p.pos === 'G' : g === 'D' ? p.pos === 'D' : p.pos !== 'G' && p.pos !== 'D')).length;
    return {
      started: f.started,
      done: !!f.done,
      current: f.current,
      total: f.picks.length,
      rounds: FANTASY_ROUNDS,
      then: f.then,
      onTheClock: clock ? { ...clock, team: teamInfo(L.teams[clock.teamId]), isMe: clock.teamId === my } : null,
      myNextPick: my ? (f.picks.slice(f.current).find((p) => p.teamId === my) ?? null) : null,
      auto: my ? !!f.auto[my] : false,
      myList: my ? (f.lists?.[my] ?? []).filter((id) => L.players[id]?.inFantasyPool) : [],
      me: team
        ? {
            capRoom: capRoom(L, team),
            payroll: payroll(L, team),
            counts: { F: count('F'), D: count('D'), G: count('G') },
            picksLeft: f.picks.slice(f.current).filter((p) => p.teamId === my).length,
            roster: mine.map((p) => ({ ...publicPlayer(L, p), potential: scouting(L, my, p) })).sort((a, b) => b.overall - a.overall),
          }
        : null,
      recent: f.picks
        .slice(Math.max(0, f.current - 40), f.current)
        .reverse()
        .map((p) => ({ ...p, team: teamInfo(L.teams[p.teamId]), name: p.playerId ? nameOf(p.playerId) : null, pos: p.playerId ? L.players[p.playerId].pos : null, ovr: p.playerId ? overall(L.players[p.playerId]) : null })),
      available: fantasyAvailable(L)
        .map((p) => ({
          ...publicPlayer(L, p),
          ...scouting(L, my, p),
          potentialValue: scoutedPotential(L, my ?? 'league', p),
          value: Math.round(fantasyValue(L, my ?? Object.keys(L.teams)[0], p) * 10) / 10,
          problem: my ? fantasyPickProblem(L, my, p) : null,
        }))
        .sort((a, b) => b.value - a.value),
    };
  }),

  fantasyPick: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    return mutateLeague(ctx.db, input.leagueId, async (L, q) => {
      mustBeStage(L, 'fantasy-draft');
      try {
        fantasyPick(L, teamId, input.playerId);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      const step = offseasonStep(L, { force: false });
      await notifyClock(q, input.leagueId, L, teamId);
      return { next: step.to };
    });
  }),

  /** Let the AI pick for me for the rest of the fantasy draft (or stop it). */
  setFantasyAuto: memberProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    return mutateLeague(ctx.db, input.leagueId, async (L, q) => {
      mustBeStage(L, 'fantasy-draft');
      L.fantasy!.auto[teamId] = input.enabled;
      if (input.enabled && L.fantasy!.started && fantasyOnClock(L)?.teamId === teamId) {
        offseasonStep(L, { force: false });
        await notifyClock(q, input.leagueId, L, teamId);
      }
      return { ok: true };
    });
  }),

  setFantasyList: memberProcedure.input(z.object({ playerIds: z.array(z.string()).max(200) })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      mustBeStage(L, 'fantasy-draft');
      (L.fantasy!.lists ??= {})[teamId] = input.playerIds.filter((id) => L.players[id]?.inFantasyPool);
    });
    return { ok: true };
  }),

  draftBoard: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const d = L.offseason?.draft;
    if (!d) return null;
    const my = ctx.membership.teamId;
    const taken = new Set(d.picks.map((p) => p.playerId).filter(Boolean));
    const list = (my && L.offseason?.draftLists?.[my]) || [];
    const prospectView = (p: Player) => classView(L, my, p, d.season);
    return {
      season: d.season,
      current: d.current,
      picks: d.picks.map((p) => ({
        ...p,
        team: teamInfo(L.teams[p.teamId]),
        player: p.playerId && L.players[p.playerId] ? { id: p.playerId, name: `${L.players[p.playerId].firstName} ${L.players[p.playerId].lastName}`, pos: L.players[p.playerId].pos } : null,
      })),
      available: d.classIds
        .filter((id) => !taken.has(id) && L.players[id])
        .map((id) => prospectView(L.players[id]))
        .sort((a, b) => b.scoutValue - a.scoutValue),
      myList: list.filter((id) => !taken.has(id) && L.players[id]),
      myTeamId: my,
    };
  }),

  makePick: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    return mutateLeague(ctx.db, input.leagueId, async (L, q) => {
      mustBeStage(L, 'draft');
      try {
        makePick(L, teamId, input.playerId);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      // Keep the draft moving until the next human is on the clock.
      const step = offseasonStep(L, { force: false });
      const next = onTheClock(L);
      if (next && next.teamId !== teamId && L.teams[next.teamId].controller.kind === 'human') {
        await deliver(q, input.leagueId, [{ teamId: next.teamId, kind: 'draft', text: `You're on the clock: round ${next.round}, pick #${next.overall}.`, link: '/draft' }]);
      }
      return { next: step.to };
    });
  }),

  setDraftList: memberProcedure.input(z.object({ playerIds: z.array(z.string()).max(100) })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      mustBeStage(L, 'draft');
      const os = L.offseason!;
      const cls = new Set(os.draft.classIds);
      (os.draftLists ??= {})[teamId] = input.playerIds.filter((id) => cls.has(id));
    });
    return { ok: true };
  }),

  expiring: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const my = ctx.membership.teamId;
    const os = L.offseason;
    if (!os || !my) return null;
    const team = L.teams[my];
    // RFAs with an open case are shown in their own list (offer sheets, arbitration).
    const ids = Object.keys(os.expiring).filter((id) => L.players[id]?.teamId === my && !os.rfa?.[id]);
    const closed = !['fantasy-draft', 'draft', 're-sign'].includes(os.stage);
    const committed = team.roster
      .filter((id) => !os.expiring[id])
      .reduce((s, id) => s + (L.players[id].contract?.salary ?? 0), 0) + deadCapFor(L, team);
    const kept = ids.reduce((s, id) => {
      const p = L.players[id];
      if (p.extension) return s + p.extension.salary;
      if (os.qualified?.[id]) return s + qualifyingOffer(p, L).salary;
      return s;
    }, 0);
    const mine = <T extends { teamId: string }>(x: T | undefined) => (x && x.teamId === my ? x : null);
    return {
      stage: os.stage,
      open: ['fantasy-draft', 'draft', 're-sign'].includes(os.stage),
      /** Day of the re-signing week (null during the draft), and its length. */
      resignDay: os.stage === 're-sign' ? (os.resignDay ?? RESIGN_DAYS) : null,
      resignDays: RESIGN_DAYS,
      deferred: offersAreDeferred(L),
      salaryCap: L.settings.salaryCap,
      committed,
      committedWithResigns: committed + kept,
      players: ids
        .map((id) => {
          const p = L.players[id];
          const neg = L.negotiations?.[id];
          const status = p.contract?.expiresAs ?? 'UFA';
          return {
            ...publicPlayer(L, p),
            status,
            ...dealTerms(L, p, team, os.expiring[id]),
            /** After the window closes: the deal he's on now. */
            signedNow: closed ? p.contract : null,
            agreed: p.extension ?? null,
            /** Offer waiting for his answer (tomorrow), and his latest answer. */
            pending: mine(os.pendingOffers?.[id]),
            response: mine(os.responses?.[id]),
            letGo: os.resign[id] === false,
            qualified: !!os.qualified?.[id],
            qualifyingOffer: status === 'RFA' ? qualifyingOffer(p, L) : null,
            /** If qualified: how he'd likely respond, and roughly what an arbitrator would award. */
            qoOutlook:
              status === 'RFA'
                ? {
                    response: qoResponse(L, p),
                    arbitrationEligible: arbitrationEligible(L, p),
                    expectedAward: Math.round(expectedAward(L, p) / 250_000) * 250_000,
                  }
                : null,
            attemptsLeft: neg && neg.teamId === my && neg.season === L.season ? Math.max(0, NEGOTIATION.maxAttempts - neg.attempts) : NEGOTIATION.maxAttempts,
            stats: L.skaterStats[id] ?? null,
            goalieStats: L.goalieStats[id] ?? null,
            ...scouting(L, my, p),
          };
        })
        .sort((a, b) => b.overall - a.overall),
    };
  }),

  setResign: memberProcedure.input(z.object({ playerId: z.string(), resign: z.boolean() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      mustBeStage(L, 'draft', 're-sign');
      const os = L.offseason!;
      if (!os.expiring[input.playerId] || L.players[input.playerId]?.teamId !== teamId) throw badRequest('Not one of your expiring players');
      if (input.resign) delete os.resign[input.playerId];
      else os.resign[input.playerId] = false;
    });
    return { ok: true };
  }),

  /** Offer a contract to one of your players: an expiring player this summer, or a final-year player in season. */
  negotiate: memberProcedure
    .input(z.object({ playerId: z.string(), salary: z.number().int().min(0).max(30_000_000), years: z.number().int().min(1).max(8) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = requireTeam(ctx.membership);
      return mutateLeague(ctx.db, input.leagueId, (L) => {
        const p = L.players[input.playerId];
        if (!p) throw badRequest('No such player');
        try {
          // During the draft and the re-signing week, his agent answers the next day.
          if (offersAreDeferred(L) && L.offseason?.expiring[p.id]) {
            const r = submitResignOffer(L, L.teams[teamId], p, { salary: input.salary, years: input.years });
            return { result: 'pending' as const, message: r.message };
          }
          return offerExtension(L, L.teams[teamId], p, { salary: input.salary, years: input.years });
        } catch (e) {
          throw badRequest((e as Error).message);
        }
      });
    }),

  withdrawOffer: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => withdrawResignOffer(L, L.teams[teamId], input.playerId));
    return { ok: true };
  }),

  acceptCounter: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    return mutateLeague(ctx.db, input.leagueId, (L) => {
      const p = L.players[input.playerId];
      if (!p) throw badRequest('No such player');
      try {
        acceptCounter(L, L.teams[teamId], p);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      return { ok: true };
    });
  }),

  setQualify: memberProcedure.input(z.object({ playerId: z.string(), qualify: z.boolean() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      mustBeStage(L, 'draft', 're-sign');
      const os = L.offseason!;
      const p = L.players[input.playerId];
      if (!os.expiring[input.playerId] || p?.teamId !== teamId) throw badRequest('Not one of your expiring players');
      if (p.contract?.expiresAs !== 'RFA') throw badRequest('Only restricted free agents can be qualified');
      (os.qualified ??= {})[input.playerId] = input.qualify;
    });
    return { ok: true };
  }),

  /** Qualify (or un-qualify) every one of your expiring RFAs who doesn't have a deal yet. */
  setQualifyAll: memberProcedure.input(z.object({ qualify: z.boolean() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    return mutateLeague(ctx.db, input.leagueId, (L) => {
      mustBeStage(L, 'draft', 're-sign');
      const os = L.offseason!;
      let n = 0;
      for (const id of Object.keys(os.expiring)) {
        const p = L.players[id];
        if (p?.teamId !== teamId || p.contract?.expiresAs !== 'RFA' || p.extension || os.resign[id] === false) continue;
        (os.qualified ??= {})[id] = input.qualify;
        n++;
      }
      return { changed: n };
    });
  }),

  freeAgents: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const my = ctx.membership.teamId;
    const team = my ? L.teams[my] : null;
    const os = L.offseason;
    const bidding = os?.stage === 'free-agency';
    const canSign = L.phase !== 'offseason' || os?.stage === 'training-camp';
    const myBids = (my && os?.bids?.[my]) || {};
    const nameOf = (id: string) => (L.players[id] ? `${L.players[id].firstName} ${L.players[id].lastName}` : id);
    return {
      canSign,
      bidding,
      faDay: bidding && os ? faDayOf(os) : null,
      faDays: FA_DAYS,
      listenDays: FA_LISTEN_DAYS,
      phase: L.phase,
      stage: os?.stage ?? null,
      capRoom: team ? capRoom(L, team) : null,
      payroll: team ? payroll(L, team) : null,
      /** Contracts count toward the 50-contract limit (NHL + farm). */
      rosterCount: team ? contractCount(team) : null,
      rosterMax: CONTRACT_MAX,
      active: team ? activeRoster(L, team).length : null,
      activeMax: ACTIVE_MAX,
      myBids: Object.entries(myBids).map(([id, offer]) => ({ playerId: id, name: nameOf(id), offer, decidesIn: faDecidesIn(L, id) })),
      results: (os?.faLog ?? [])
        .slice()
        .sort((a, b) => b.round - a.round || b.offer.salary - a.offer.salary)
        .slice(0, 60)
        .map((r) => ({ ...r, name: nameOf(r.playerId), team: teamInfo(L.teams[r.teamId]), mine: r.teamId === my })),
      /** Free agents who turned down every offer (most recent first). */
      holdouts: (os?.faHoldoutLog ?? [])
        .slice(-40)
        .reverse()
        .map((h) => ({ day: h.day, playerId: h.playerId, name: nameOf(h.playerId), bidders: h.teamIds.length, mine: !!my && h.teamIds.includes(my), signed: !isFreeAgentNow(L, h.playerId) })),
      players: freeAgents(L)
        .map((p) => {
          const base = os?.freeAgentAsks[p.id] ?? inSeasonAsk(L, p);
          return {
            ...publicPlayer(L, p),
            ask: base,
            priorities: priorities(p),
            deal: team && (bidding || canSign) ? dealTerms(L, p, team, base, bidding ? (os?.faHoldouts?.[p.id] ?? 0) * 1.2 : 2) : null,
            /** Days until he decides on the offers he has (null: nobody has made one yet). */
            decidesIn: bidding ? faDecidesIn(L, p.id) : null,
            /** How many teams have an offer in (the terms stay sealed). */
            offers: bidding ? Object.values(os?.bids ?? {}).filter((b) => b[p.id]).length : 0,
            holdouts: os?.faHoldouts?.[p.id] ?? 0,
            attemptsLeft: attemptsLeft(L, p.id, my),
            myBid: myBids[p.id] ?? null,
            ...scouting(L, my, p),
            potentialValue: scoutedPotential(L, my ?? 'league', p),
            careerGp: (L.careerStats?.[p.id] ?? []).reduce((s, c) => s + (c.skater?.gp ?? c.goalie?.gp ?? 0), 0),
            ...recentStats(L, p),
          };
        })
        .sort((a, b) => b.overall - a.overall)
        .slice(0, 400),
    };
  }),

  placeBid: memberProcedure
    .input(z.object({ playerId: z.string(), salary: z.number().int().min(0).max(30_000_000), years: z.number().int().min(1).max(8) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = requireTeam(ctx.membership);
      await mutateLeague(ctx.db, input.leagueId, (L) => {
        const p = L.players[input.playerId];
        const team = L.teams[teamId];
        if (!p) throw badRequest('No such player');
        if (contractCount(team) >= CONTRACT_MAX) throw badRequest(`You're at the ${CONTRACT_MAX}-contract limit. Release a player first.`);
        try {
          placeBid(L, team, p, { salary: input.salary, years: input.years });
        } catch (e) {
          throw badRequest((e as Error).message);
        }
      });
      return { ok: true };
    }),

  withdrawBid: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => withdrawBid(L, L.teams[teamId], input.playerId));
    return { ok: true };
  }),

  /** Negotiate with a leftover free agent (training camp or in season). He signs on acceptance. */
  negotiateFreeAgent: memberProcedure
    .input(z.object({ playerId: z.string(), salary: z.number().int().min(0).max(30_000_000), years: z.number().int().min(1).max(8) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = requireTeam(ctx.membership);
      return mutateLeague(ctx.db, input.leagueId, (L) => {
        const team = L.teams[teamId];
        const p = L.players[input.playerId];
        if (!p || !freeAgents(L).includes(p)) throw badRequest('That player is not a free agent');
        if (contractCount(team) >= CONTRACT_MAX) throw badRequest(`You're at the ${CONTRACT_MAX}-contract limit. Release a player first.`);
        const base = L.offseason?.freeAgentAsks[p.id] ?? inSeasonAsk(L, p);
        try {
          const r = negotiateFreeAgent(L, team, p, { salary: input.salary, years: input.years }, base);
          // In season, a full 23-man roster means he reports to the farm team; call him up when you're ready.
          if (r.result === 'accept' && L.phase !== 'offseason' && activeRoster(L, team).length > ACTIVE_MAX) {
            sendDown(L, team, p, 'signed with the NHL roster full');
            return { ...r, message: `${r.message} Your NHL roster is full, so he reports to ${affiliateLabel(L, team)} until you call him up.`.trim() };
          }
          return r;
        } catch (e) {
          throw badRequest((e as Error).message);
        }
      });
    }),

  /** Restricted free agents: your open cases (offer sheets, arbitration) and other teams' sheet-eligible RFAs. */
  rfa: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const my = ctx.membership.teamId;
    const os = L.offseason;
    if (!os?.rfa) return null;
    const team = my ? L.teams[my] : null;
    const myTenders = (my && os.sheets?.[my]) || {};
    const cases = Object.entries(os.rfa).filter(([id]) => L.players[id]);
    return {
      stage: os.stage,
      walkAwayThreshold: walkAwayThreshold(L),
      compensation: compensationTable(L),
      capRoom: team ? capRoom(L, team) : null,
      mine: cases
        .filter(([, c]) => c.teamId === my)
        .map(([id, c]) => {
          const p = L.players[id];
          return {
            ...publicPlayer(L, p),
            status: c.status,
            arbitration: c.arbitration,
            qualifyingOffer: c.qualifyingOffer,
            award: c.award ?? null,
            canWalkAway: os.stage === 'training-camp' && c.status === 'awarded' && (c.award?.salary ?? 0) >= walkAwayThreshold(L),
            sheet: c.sheet
              ? { from: teamInfo(L.teams[c.sheet.fromTeam]), offer: c.sheet.offer, compensation: c.sheet.compensation.map((k) => pickLabel(k, L)), decision: c.sheet.decision ?? null }
              : null,
            attemptsLeft: attemptsLeft(L, id, my),
            deal: c.status === 'unsigned' && team ? dealTerms(L, p, team, os.expiring[id] ?? askingContract(L, p)) : null,
          };
        }),
      others: cases
        .filter(([, c]) => c.teamId !== my && c.status === 'unsigned')
        .map(([id, c]) => {
          const p = L.players[id];
          return {
            ...publicPlayer(L, p),
            team: teamInfo(L.teams[c.teamId]),
            arbitration: c.arbitration,
            qualifyingOffer: c.qualifyingOffer,
            signedSheet: !!c.sheet,
            myTender: myTenders[id] ?? null,
            deal: team && os.stage === 'free-agency' && !c.sheet ? dealTerms(L, p, team, askingContract(L, p)) : null,
            ...scouting(L, my, p),
          };
        })
        .sort((a, b) => b.overall - a.overall),
    };
  }),

  tenderOfferSheet: memberProcedure
    .input(z.object({ playerId: z.string(), salary: z.number().int().min(0).max(30_000_000), years: z.number().int().min(1).max(8) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = requireTeam(ctx.membership);
      return mutateLeague(ctx.db, input.leagueId, (L) => {
        const p = L.players[input.playerId];
        if (!p) throw badRequest('No such player');
        try {
          tenderOfferSheet(L, L.teams[teamId], p, { salary: input.salary, years: input.years });
        } catch (e) {
          throw badRequest((e as Error).message);
        }
        return { ok: true, compensation: (compensationPicks(L, teamId, input.salary) ?? []).map((k) => pickLabel(k, L)) };
      });
    }),

  withdrawOfferSheet: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => withdrawOfferSheet(L, L.teams[teamId], input.playerId));
    return { ok: true };
  }),

  decideOfferSheet: memberProcedure.input(z.object({ playerId: z.string(), match: z.boolean() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        decideOfferSheet(L, L.teams[teamId], input.playerId, input.match);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    });
    return { ok: true };
  }),

  walkAway: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        walkAwayFromAward(L, L.teams[teamId], input.playerId);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    });
    return { ok: true };
  }),

  promote: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      const team = L.teams[teamId];
      const p = L.players[input.playerId];
      if (!p || p.prospectOf !== teamId) throw badRequest('Not one of your prospects');
      if (contractCount(team) >= CONTRACT_MAX) throw badRequest(`You're at the ${CONTRACT_MAX}-contract limit. Release a player first.`);
      if (capRoom(L, team) < 950_000) throw badRequest('Not enough cap room for an entry-level deal');
      promoteProspect(L, team, p);
      balanceRoster(L, team);
      fixLines(L, teamId, p.id);
    });
    return { ok: true };
  }),

  /** Sign a prospect to his entry-level deal and send him to the farm team. */
  signToFarm: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      const p = L.players[input.playerId];
      if (!p) throw badRequest('No such player');
      try {
        signProspectToFarm(L, L.teams[teamId], p);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    });
    return { ok: true };
  }),

  /** Call a player up from the farm team (someone else may have to go down). */
  callUp: memberProcedure.input(z.object({ playerId: z.string(), sendDownId: z.string().optional() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      const team = L.teams[teamId];
      const p = L.players[input.playerId];
      if (!p) throw badRequest('No such player');
      try {
        if (input.sendDownId) sendDown(L, team, L.players[input.sendDownId]);
        callUp(L, team, p);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      fixLines(L, teamId, input.sendDownId ?? p.id);
    });
    return { ok: true };
  }),

  sendDown: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        const team = L.teams[teamId];
        const p = L.players[input.playerId];
        if (!p) throw new Error('No such player');
        if (nhlRoster(L, team).filter((x) => x.id !== p.id).length < 20) throw new Error('You need at least 20 players on the NHL roster');
        sendDown(L, team, p);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      fixLines(L, teamId, input.playerId);
    });
    return { ok: true };
  }),

  release: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      const p = L.players[input.playerId];
      if (!p) throw badRequest('No such player');
      try {
        releasePlayer(L, L.teams[teamId], p);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      fixLines(L, teamId, input.playerId);
    });
    return { ok: true };
  }),
});

/** In-season free agents sign one-year deals at a discount (it's slim pickings mid-year). */
function inSeasonAsk(L: League, p: Player) {
  const a = askingContract(L, p);
  return { salary: Math.max(775_000, Math.round((a.salary * 0.6) / 25_000) * 25_000), years: 1 };
}

/** If a removed player was in the lineup, hand lines to the assistant coach until the manager fixes them. */
function fixLines(L: League, teamId: string, playerId: string) {
  const t = L.teams[teamId];
  const ids = [...t.lines.forwards.flat(), ...t.lines.defense.flat(), ...t.lines.goalies];
  if (ids.includes(playerId) || t.autoLines) {
    t.autoLines = true;
    try {
      t.lines = autoLines(healthyRoster(L, t), t.tactics);
    } catch {
      /* short of bodies until the next game-day call-up */
    }
  }
}

function attemptsLeft(L: League, playerId: string, teamId: string | null) {
  const neg = L.negotiations?.[playerId];
  return neg && neg.teamId === teamId && neg.season === L.season ? Math.max(0, NEGOTIATION.maxAttempts - neg.attempts) : NEGOTIATION.maxAttempts;
}
