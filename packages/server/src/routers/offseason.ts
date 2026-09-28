/**
 * Offseason actions (draft, re-signing, free agency) and roster moves that
 * work year-round (promote/send down prospects, release, in-season signings).
 */
import {
  age,
  askingContract,
  capRoom,
  demoteToProspects,
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
  signFreeAgent,
  STAGE_LABELS,
  SUMMER_ROSTER_MAX,
  type League,
  type Player,
} from '@hockey-gm/sim-core';
import { z } from 'zod';
import { mutateLeague } from '../advance';
import { readLeague } from '../state';
import { badRequest, memberProcedure, router, type Membership } from '../trpc';
import { publicPlayer, teamInfo } from '../views';

/** Letter grade from a scout's ceiling estimate. */
export function grade(scouted: number): string {
  const scale: Array<[number, string]> = [
    [88, 'A+'], [84, 'A'], [80, 'A-'], [77, 'B+'], [74, 'B'], [71, 'B-'], [68, 'C+'], [65, 'C'], [62, 'C-'], [58, 'D'],
  ];
  return scale.find(([min]) => scouted >= min)?.[1] ?? 'F';
}

/** What the viewer's scouts think of a player. Managers without a team see a league-wide consensus. */
function scouting(L: League, viewerTeam: string | null, p: Player) {
  const s = scoutedPotential(L, viewerTeam ?? 'league', p);
  return { grade: grade(s), projection: projectionLabel(s) };
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
      stages: OFFSEASON_STAGES.map((s) => ({ id: s, label: STAGE_LABELS[s] })),
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
          seasons: r.career.length,
          team: r.lastTeamId ? teamInfo(L.teams[r.lastTeamId]) : null,
          points: r.career.reduce((s, c) => s + (c.skater ? c.skater.g + c.skater.a : 0), 0),
        })),
    };
  }),

  draftBoard: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const d = L.offseason?.draft;
    if (!d) return null;
    const my = ctx.membership.teamId;
    const taken = new Set(d.picks.map((p) => p.playerId).filter(Boolean));
    const list = (my && L.offseason?.draftLists?.[my]) || [];
    const prospectView = (p: Player) => ({
      ...publicPlayer(L, p),
      age: age(p, d.season),
      ...scouting(L, my, p),
      scoutValue: scoutedPotential(L, my ?? 'league', p),
    });
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
    return mutateLeague(ctx.db, input.leagueId, (L) => {
      mustBeStage(L, 'draft');
      try {
        makePick(L, teamId, input.playerId);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      // Keep the draft moving until the next human is on the clock.
      const step = offseasonStep(L, { force: false });
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
    const ids = Object.keys(os.expiring).filter((id) => L.players[id]?.teamId === my);
    const committed = team.roster
      .filter((id) => !os.expiring[id])
      .reduce((s, id) => s + (L.players[id].contract?.salary ?? 0), 0);
    const kept = ids.filter((id) => os.resign[id]).reduce((s, id) => s + os.expiring[id].salary, 0);
    return {
      stage: os.stage,
      salaryCap: L.settings.salaryCap,
      committed,
      committedWithResigns: committed + kept,
      players: ids
        .map((id) => {
          const p = L.players[id];
          return {
            ...publicPlayer(L, p),
            ask: os.expiring[id],
            decision: os.resign[id] ?? null,
            status: p.contract?.expiresAs ?? 'UFA',
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
      os.resign[input.playerId] = input.resign;
    });
    return { ok: true };
  }),

  freeAgents: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const my = ctx.membership.teamId;
    const team = my ? L.teams[my] : null;
    const os = L.offseason;
    const canSign = L.phase !== 'offseason' || os?.stage === 'free-agency' || os?.stage === 'training-camp';
    return {
      canSign,
      phase: L.phase,
      stage: os?.stage ?? null,
      capRoom: team ? capRoom(L, team) : null,
      payroll: team ? payroll(L, team) : null,
      rosterCount: team ? team.roster.length : null,
      rosterMax: L.phase === 'offseason' ? SUMMER_ROSTER_MAX : ROSTER_MAX,
      players: freeAgents(L)
        .map((p) => {
          const ask = os?.freeAgentAsks[p.id] ?? inSeasonAsk(L, p);
          return { ...publicPlayer(L, p), ask, ...scouting(L, my, p), careerGp: (L.careerStats?.[p.id] ?? []).reduce((s, c) => s + (c.skater?.gp ?? c.goalie?.gp ?? 0), 0) };
        })
        .sort((a, b) => b.overall - a.overall)
        .slice(0, 150),
    };
  }),

  signFreeAgent: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      if (L.phase === 'offseason') mustBeStage(L, 'free-agency', 'training-camp');
      const team = L.teams[teamId];
      const p = L.players[input.playerId];
      if (!p || !freeAgents(L).includes(p)) throw badRequest('That player is not a free agent');
      const ask = L.offseason?.freeAgentAsks[p.id] ?? inSeasonAsk(L, p);
      const max = L.phase === 'offseason' ? SUMMER_ROSTER_MAX : ROSTER_MAX + team.roster.filter((id) => L.players[id].injury).length;
      if (team.roster.length >= max) throw badRequest(`Your roster is full (${max}). Release or send down a player first.`);
      if (ask.salary > capRoom(L, team)) throw badRequest(`Not enough cap room: he asks $${(ask.salary / 1e6).toFixed(2)}M`);
      signFreeAgent(L, team, p, ask);
    });
    return { ok: true };
  }),

  promote: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      const team = L.teams[teamId];
      const p = L.players[input.playerId];
      if (!p || p.prospectOf !== teamId) throw badRequest('Not one of your prospects');
      const max = L.phase === 'offseason' ? SUMMER_ROSTER_MAX : ROSTER_MAX + team.roster.filter((id) => L.players[id].injury).length;
      if (team.roster.length >= max) throw badRequest(`Your roster is full (${max}). Release or send down a player first.`);
      if (capRoom(L, team) < 950_000) throw badRequest('Not enough cap room for an entry-level deal');
      promoteProspect(L, team, p);
    });
    return { ok: true };
  }),

  sendDown: memberProcedure.input(z.object({ playerId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = requireTeam(ctx.membership);
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        demoteToProspects(L, L.teams[teamId], L.players[input.playerId]);
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
  if (ids.includes(playerId)) t.autoLines = true;
}

