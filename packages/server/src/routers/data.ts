import {
  askingContract,
  isTwoWay,
  minorSalaryOf,
  waiverExemption,
  completeLines,
  DEFAULT_TACTICS,
  EXTRA_ATTACKER_SLOTS,
  FORECHECKS,
  FOUR_SLOTS,
  OZ_STYLES,
  PK3_SLOTS,
  PK_SLOTS,
  PK_STRATEGIES,
  PP4_SLOTS,
  PP_FORMATIONS,
  ROLE_HELP,
  ROLE_LABEL,
  ROLES,
  roleSkills,
  suggestTactics,
  systemFits,
  THREE_SLOTS,
  type Slot,
  type Tactics,
  qualifyingOffer,
  autoLines,
  buyoutTerms,
  canExtend,
  capSeason,
  deadCapFor,
  payroll as teamPayroll,
  priorities,
  betterScratches,
  healthyRoster,
  overall,
  projectionLabel,
  scoutedPotential,
  ROUND_NAMES,
  standings,
  type League,
  type Lines,
  type ScheduledGame,
  unitChemistry,
  age,
  BURY_EXEMPT,
  capHit,
  expiresAsFor,
  affiliateLabel,
  activeRoster,
  ACTIVE_MAX,
  CONTRACT_MAX,
  nhlRoster,
  playerValue,
  type SkaterSeasonStats,
  type GoalieSeasonStats,
  SYSTEM_K,
  SYSTEM_CENTER,
  CHEMISTRY,
  SLOT_BASIS,
  F_JOBS,
  D_JOBS,
  F_STYLE,
  D_STYLE,
  resolvePlan,
  skillLabel,
  projectedSeasonGain,
  type TrainableSkill,
  minorLeagueOf,
  leagueRegion,
  REGION_LABEL,
} from '@hockey-gm/sim-core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { dealTerms } from '../deal';
import { mutateLeague } from '../advance';
import { readBoxScore, readLeague } from '../state';
import { badRequest, memberProcedure, router } from '../trpc';
import { playerName, publicPlayer, teamInfo } from '../views';
import { grade } from './offseason';
import { franchiseRecords, franchiseTopScorers, minorLeaders } from '../records';
import { latestAnswer, offeredBySeason, openOffers } from '../offers';

const overallOf = (L: League, id: string) => overall(L.players[id]);

/** Scouts' read on a player's ceiling, from the viewer's team (never the hidden number). */
function systemImpact(fits: ReturnType<typeof systemFits>) {
  const out: Record<string, Record<string, number>> = {};
  for (const g of ['forecheck', 'offense', 'pp', 'pk'] as const) {
    const f = fits[g] as Record<string, number>;
    const vals = Object.values(f);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    // The forecheck splits its effect between offense and defense (about three-quarters each on average).
    const w = g === 'forecheck' ? 0.75 : 1;
    out[g] = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Math.round(SYSTEM_K[g] * w * (v - mean - SYSTEM_CENTER[g]) * 10) / 10]));
  }
  return out;
}

/** A player's stats for a past season, all time (NHL totals, this season included), or this season. */
function pickStats(L: League, id: string, which: number | 'all' | undefined) {
  const now = { skater: L.skaterStats[id] ?? null, goalie: L.goalieStats[id] ?? null };
  if (which === undefined || which === L.season) return now;
  const lines = L.careerStats?.[id] ?? [];
  if (which !== 'all') {
    const line = lines.find((c) => c.season === which);
    return { skater: line?.skater ?? null, goalie: line?.goalie ?? null };
  }
  const sk = [...lines.map((c) => c.skater), now.skater].filter(Boolean) as SkaterSeasonStats[];
  const gl = [...lines.map((c) => c.goalie), now.goalie].filter(Boolean) as GoalieSeasonStats[];
  const sum = <T extends object>(xs: T[]): T | null =>
    xs.length ? (xs.reduce((a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, ((a as Record<string, number>)[k] ?? 0) + (b as Record<string, number>)[k]])) as T, {} as T) as T) : null;
  return { skater: sum(sk), goalie: sum(gl) };
}

/** Seasons the team's current players have stats for (newest first). */
function statsSeasons(L: League, t: League['teams'][string]): number[] {
  const set = new Set<number>([L.season]);
  for (const id of t.roster) for (const c of L.careerStats?.[id] ?? []) if (c.skater || c.goalie) set.add(c.season);
  return [...set].sort((a, b) => b - a);
}

/**
 * Stat lines to rank: this season, a past season (from career records, retired
 * players included), or all-time totals.
 */
function leaderPool(L: League, playoffs: boolean, season: number | 'all' | undefined) {
  const current = { sk: playoffs ? L.playoffSkaterStats : L.skaterStats, gs: playoffs ? L.playoffGoalieStats : L.goalieStats };
  if (season === undefined || season === L.season) return { sk: Object.entries(current.sk), gs: Object.entries(current.gs), teamAt: new Map<string, string | null>() };
  const teamAt = new Map<string, string | null>();
  const careers: Array<[string, League['careerStats'] extends Record<string, infer C> | undefined ? C : never]> = [
    ...Object.entries(L.careerStats ?? {}),
    ...Object.values(L.retired ?? {}).map((r) => [r.id, r.career] as [string, typeof r.career]),
  ];
  const skOut: Record<string, SkaterSeasonStats> = {};
  const gsOut: Record<string, GoalieSeasonStats> = {};
  const add = <T extends object>(out: Record<string, T>, id: string, line: T | null | undefined) => {
    if (!line) return;
    const prev = out[id] as Record<string, number> | undefined;
    out[id] = (prev ? Object.fromEntries(Object.entries(line).map(([k, v]) => [k, (prev[k] ?? 0) + (v as number)])) : { ...line }) as T;
  };
  for (const [id, lines] of careers) {
    for (const c of lines) {
      if (season !== 'all' && c.season !== season) continue;
      if (season !== 'all' && (c.skater || c.goalie || c.playoffSkater || c.playoffGoalie)) teamAt.set(id, c.teamId);
      add(skOut, id, playoffs ? c.playoffSkater : c.skater);
      add(gsOut, id, playoffs ? c.playoffGoalie : c.goalie);
    }
  }
  if (season === 'all' && (L.phase !== 'offseason' || !L.offseason)) {
    for (const [id, line] of Object.entries(current.sk)) add(skOut, id, line);
    for (const [id, line] of Object.entries(current.gs)) add(gsOut, id, line);
  }
  return { sk: Object.entries(skOut), gs: Object.entries(gsOut), teamAt };
}

const chemView = (c: ReturnType<typeof unitChemistry>) => ({
  total: Math.round(c.total * 10) / 10,
  style: Math.round(c.style * 10) / 10,
  familiarity: Math.round(c.familiarity * 10) / 10,
  /** 0–1: how settled the line is. */
  settled: Math.round(c.fam * 100) / 100,
});

function trainingView(L: League, p: League['players'][string]) {
  const gains = p.trainingLog?.season === L.season ? p.trainingLog.gains : {};
  const team = p.teamId ? L.teams[p.teamId] : null;
  const now = team ? resolvePlan(L, team).find((x) => x.player.id === p.id) : undefined;
  return {
    gains: Object.entries(gains).map(([skill, points]) => ({ skill, label: skillLabel(skill as TrainableSkill), points })),
    roleTraining: p.roleTraining ?? {},
    current: now
      ? {
          coach: now.coach.name,
          coachId: now.coach.id,
          skill: now.skill,
          label: skillLabel(now.skill),
          progress: Math.round(((p.trainingProgress?.[now.skill] ?? 0) % 1) * 100) / 100,
          seasonPace: projectedSeasonGain(L, now.coach, p, now.skill),
        }
      : null,
  };
}

export function potentialView(L: League, viewer: string | null, p: League['players'][string]) {
  const s = scoutedPotential(L, viewer ?? 'league', p);
  return { grade: grade(s), projection: projectionLabel(s, p.pos) };
}

const slotView = (xs: Slot[]) => xs.map((s) => ({ label: s.label, role: s.role }));
const entries = <K extends string>(o: Record<K, { label: string; help: string }>) => (Object.keys(o) as K[]).map((id) => ({ id, label: o[id].label, help: o[id].help }));
/** Systems, formations, slots and role names for the lines editor. */
const SYSTEMS_CATALOG = {
  forecheck: entries(FORECHECKS),
  offense: entries(OZ_STYLES),
  pk: entries(PK_STRATEGIES),
  pp: (Object.keys(PP_FORMATIONS) as Array<keyof typeof PP_FORMATIONS>).map((id) => ({ id, label: PP_FORMATIONS[id].label, help: PP_FORMATIONS[id].help, slots: slotView(PP_FORMATIONS[id].slots) })),
  slots: {
    pk: slotView(PK_SLOTS),
    pk3: slotView(PK3_SLOTS),
    pp4: slotView(PP4_SLOTS),
    fourOnFour: slotView(FOUR_SLOTS),
    threeOnThree: slotView(THREE_SLOTS),
    extraAttacker: slotView(EXTRA_ATTACKER_SLOTS),
  },
  roles: ROLES.map((id) => ({ id, label: ROLE_LABEL[id], help: ROLE_HELP[id] })),
  /** Everything the lines editor needs to show chemistry and spot fit live, exactly as the sim computes them. */
  chemistry: { ...CHEMISTRY, basis: SLOT_BASIS, jobsF: F_JOBS, jobsD: D_JOBS, styleF: F_STYLE, styleD: D_STYLE },
};

const tacticsSchema = z.object({
  forecheck: z.enum(['aggressive', 'balanced', 'trap']),
  offense: z.enum(['cycle', 'crash', 'perimeter', 'rush']),
  pp: z.enum(['umbrella', '1-3-1', 'overload']),
  pk: z.enum(['box', 'diamond', 'aggressive']),
}) satisfies z.ZodType<Tactics>;

function allGames(L: League): ScheduledGame[] {
  const po = L.playoffs?.rounds.flatMap((r) => r.flatMap((s) => s.games)) ?? [];
  return [...L.schedule, ...po];
}

function gameView(L: League, g: ScheduledGame) {
  return {
    id: g.id,
    day: g.day,
    home: teamInfo(L.teams[g.home]),
    away: teamInfo(L.teams[g.away]),
    played: !!g.result,
    homeScore: g.result?.homeScore ?? null,
    awayScore: g.result?.awayScore ?? null,
    overtime: g.result?.overtime ?? false,
    shootout: g.result?.shootout ?? false,
    seriesId: g.seriesId ?? null,
    gameNumber: g.gameNumber ?? null,
  };
}

/** Which teams would make the playoffs if the season ended today. */
function playoffSpots(L: League, st: ReturnType<typeof standings>): Set<string> {
  const spots = new Set<string>();
  for (const conf of new Set(Object.values(L.teams).map((t) => t.conference))) {
    const rows = st.filter((r) => L.teams[r.teamId].conference === conf);
    for (const div of new Set(rows.map((r) => L.teams[r.teamId].division))) {
      rows.filter((r) => L.teams[r.teamId].division === div).slice(0, 3).forEach((r) => spots.add(r.teamId));
    }
    rows.filter((r) => !spots.has(r.teamId)).slice(0, 2).forEach((r) => spots.add(r.teamId));
  }
  return spots;
}

const idList = (n: number) => z.array(z.string()).length(n);
const linesSchema = z.object({
  forwards: z.array(idList(3)).length(4),
  defense: z.array(idList(2)).length(3),
  goalies: idList(2),
  pp: z.array(idList(5)).length(2),
  pk: z.array(idList(4)).length(2),
  fourOnFour: z.array(idList(4)).length(2).optional(),
  threeOnThree: z.array(idList(3)).length(3).optional(),
  pp4: idList(4).optional(),
  pk3: idList(3).optional(),
  extraAttacker: idList(6).optional(),
  shootout: idList(5).optional(),
});

export function validateLines(L: League, teamId: string, lines: Lines): string | null {
  const team = L.teams[teamId];
  const onTeam = new Set(team.roster);
  const skaters = [...lines.forwards.flat(), ...lines.defense.flat()];
  const dressed = [...skaters, ...lines.goalies];
  for (const id of dressed) {
    if (!onTeam.has(id)) return `${playerName(L, id)} is not on your roster`;
    if (L.players[id].injury) return `${playerName(L, id)} is injured`;
  }
  for (const id of skaters) if (L.players[id].pos === 'G') return `${playerName(L, id)} is a goalie and can't play as a skater`;
  for (const id of lines.goalies) if (L.players[id].pos !== 'G') return `${playerName(L, id)} is not a goalie`;
  if (new Set(dressed).size !== dressed.length) return 'A player is listed in more than one lineup spot';
  const dressedSkaters = new Set(skaters);
  const extras = [...(lines.fourOnFour ?? []), ...(lines.threeOnThree ?? []), lines.pp4, lines.pk3, lines.extraAttacker, lines.shootout].filter((u): u is string[] => !!u);
  for (const unit of [...lines.pp, ...lines.pk, ...extras]) {
    if (new Set(unit).size !== unit.length) return 'A special-teams unit lists the same player twice';
    for (const id of unit) if (!dressedSkaters.has(id)) return `${playerName(L, id)} is on a special-teams unit but isn't dressed`;
  }
  return null;
}

export const dataRouter = router({
  standings: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const st = standings(L);
    const spots = playoffSpots(L, st);
    // Playoff format: top three in each division, plus two wild cards per conference.
    const seed = new Map<string, { label: string; wildCard: number | null; divRank: number | null }>();
    for (const conf of [...new Set(Object.values(L.teams).map((t) => t.conference))]) {
      const rows = st.filter((r) => L.teams[r.teamId].conference === conf);
      const top = new Set<string>();
      for (const div of [...new Set(rows.map((r) => L.teams[r.teamId].division))]) {
        rows
          .filter((r) => L.teams[r.teamId].division === div)
          .forEach((r, i) => {
            if (i < 3) {
              top.add(r.teamId);
              seed.set(r.teamId, { label: `${div[0]}${i + 1}`, wildCard: null, divRank: i + 1 });
            }
          });
      }
      rows
        .filter((r) => !top.has(r.teamId))
        .forEach((r, i) => seed.set(r.teamId, { label: i < 2 ? `WC${i + 1}` : '', wildCard: i + 1, divRank: null }));
    }
    return st.map((r, i) => ({
      ...r,
      rank: i + 1,
      team: teamInfo(L.teams[r.teamId]),
      inPlayoffSpot: spots.has(r.teamId),
      /** "M1" (first in the Metro-style division), "WC1"/"WC2" for wild cards. */
      seed: seed.get(r.teamId)?.label ?? '',
      /** Place in the conference wild-card race (teams outside their division's top three). */
      wildCard: seed.get(r.teamId)?.wildCard ?? null,
    }));
  }),

  day: memberProcedure.input(z.object({ day: z.number().int().optional() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const games = allGames(L);
    const days = [...new Set(games.map((g) => g.day))].sort((a, b) => a - b);
    let day = input.day;
    if (day === undefined) {
      const played = days.filter((d) => d < L.day);
      day = played.length ? played[played.length - 1] : (days[0] ?? 0);
    }
    const idx = days.indexOf(day);
    return {
      day,
      today: L.day,
      games: games.filter((g) => g.day === day).map((g) => gameView(L, g)),
      prevDay: idx > 0 ? days[idx - 1] : days.filter((d) => d < day!).pop() ?? null,
      nextDay: idx >= 0 && idx < days.length - 1 ? days[idx + 1] : (days.find((d) => d > day!) ?? null),
    };
  }),

  boxScore: memberProcedure.input(z.object({ gameId: z.number().int() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const g = allGames(L).find((x) => x.id === input.gameId);
    if (!g) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such game' });
    const box = g.result ? await readBoxScore(ctx.db, input.leagueId, L.season, g.id) : null;
    const name = (id: string) => playerName(L, id);
    const side = (which: 'home' | 'away') => {
      if (!box) return null;
      const dressed = new Set(box.rosters[which]);
      const skaters = Object.entries(box.skaters)
        .filter(([id]) => dressed.has(id))
        .map(([id, s]) => ({ id, name: name(id), pos: L.players[id].pos, ...s }));
      const goalies = Object.entries(box.goalies)
        .filter(([id]) => dressed.has(id))
        .map(([id, s]) => ({ id, name: name(id), ...s }));
      return { skaters, goalies };
    };
    return {
      game: gameView(L, g),
      home: box ? { ...box.home, ...side('home') } : null,
      away: box ? { ...box.away, ...side('away') } : null,
      goals: box?.goals.map((x) => ({ ...x, scorerName: name(x.scorer), assistNames: x.assists.map(name) })) ?? [],
      penalties: box?.penalties.map((x) => ({ ...x, playerName: name(x.playerId) })) ?? [],
      injuries: box?.injuries.map((x) => ({ ...x, playerName: name(x.playerId) })) ?? [],
      stars: box?.stars.map((id) => ({ id, name: name(id), teamId: L.players[id]?.teamId, pos: L.players[id]?.pos })) ?? [],
    };
  }),

  team: memberProcedure.input(z.object({ teamId: z.string(), statsSeason: z.union([z.number().int(), z.literal('all')]).optional() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const t = L.teams[input.teamId];
    if (!t) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such team' });
    // Stats shown in the roster: this season (default), a past season, or career totals.
    const statsFor = (id: string) => pickStats(L, id, input.statsSeason);
    const viewer = L.teams[ctx.membership.teamId ?? ''] ?? t;
    const st = standings(L);
    const record = st.find((r) => r.teamId === t.id)!;
    const games = allGames(L).filter((g) => g.home === t.id || g.away === t.id).sort((a, b) => a.day - b.day);
    const payroll = teamPayroll(L, t);
    return {
      team: teamInfo(t),
      isMine: ctx.membership.teamId === t.id,
      record: { ...record, rank: st.indexOf(record) + 1 },
      payroll,
      salaryCap: L.settings.salaryCap,
      deadCap: (t.deadCap ?? []).filter((x) => x.untilSeason >= capSeason(L)),
      deadCapThisSeason: deadCapFor(L, t),
      players: t.roster.map((id) => ({
        ...publicPlayer(L, L.players[id]),
        roles: roleSkills(L.players[id]),
        potential: potentialView(L, ctx.membership.teamId, L.players[id]),
        extension: L.players[id].extension ?? null,
        canExtend: ctx.membership.teamId === t.id && canExtend(L, L.players[id]) && !L.players[id].extension,
        deal:
          ctx.membership.teamId === t.id && canExtend(L, L.players[id])
            ? dealTerms(L, L.players[id], t, L.offseason?.expiring[id] ?? askingContract(L, L.players[id]))
            : null,
        /** Expiring RFAs: what his qualifying offer would cost. */
        qualifyingOffer:
          L.players[id].contract?.expiresAs === 'RFA' && (L.players[id].contract?.yearsLeft ?? 0) <= 1 && !L.players[id].extension
            ? qualifyingOffer(L.players[id], L)
            : null,
        attemptsLeft: L.negotiations?.[id]?.teamId === t.id && L.negotiations[id].season === L.season ? Math.max(0, 3 - L.negotiations[id].attempts) : 3,
        buyout: ctx.membership.teamId === t.id ? buyoutTerms(L, L.players[id]) : null,
        stats: statsFor(id).skater,
        goalieStats: statsFor(id).goalie,
        /** With the AHL affiliate. */
        farm: !!L.players[id].farm,
        /** On waivers right now; and whether a send-down would need waivers (null: exempt, else why not). */
        onWaivers: !!L.players[id].onWaivers,
        waiverExempt: waiverExemption(L, L.players[id]),
        injuryCallUp: !!L.players[id].injuryCallUp,
        /** Two-way deals pay an AHL salary on the farm. */
        twoWay: isTwoWay(L.players[id].contract),
        minorSalary: L.players[id].contract && isTwoWay(L.players[id].contract) ? minorSalaryOf(L.players[id].contract!) : null,
        minor: L.players[id].farm ? (L.prospectStats?.[id] ?? null) : null,
        /** Trade value from your front office's point of view (0–1 scale, like the trade screen's meter). */
        tradeValue: Math.round(Math.min(1, Math.sqrt(Math.max(0, playerValue(L, viewer, L.players[id]))) / 30) * 100) / 100,
        playoffStats: L.playoffSkaterStats[id] ?? null,
        playoffGoalieStats: L.playoffGoalieStats[id] ?? null,
      })),
      prospects: (t.prospects ?? [])
        .map((id) => L.players[id])
        .filter(Boolean)
        .map((p) => {
          const s = scoutedPotential(L, ctx.membership.teamId ?? 'league', p);
          const m = minorLeagueOf(L, p);
          return {
            ...publicPlayer(L, p),
            grade: grade(s),
            projection: projectionLabel(s, p.pos),
            potentialValue: s,
            draft: p.draft ?? null,
            minor: L.prospectStats?.[p.id] ?? null,
            league: m.league,
            club: m.team,
            region: REGION_LABEL[leagueRegion(m.league) as keyof typeof REGION_LABEL] ?? 'North American pro',
          };
        })
        .sort((a, b) => b.overall - a.overall),
      phase: L.phase,
      // (No lines yet while a fantasy draft is still filling the roster.)
      lines: t.lines.forwards.length ? completeLines(t.lines, nhlRoster(L, t), t.tactics ?? DEFAULT_TACTICS) : t.lines,
      /** Lines can be edited once there's a roster to dress. */
      hasLines: t.lines.forwards.length > 0,
      affiliate: affiliateLabel(L, t),
      contracts: t.roster.length,
      contractMax: CONTRACT_MAX,
      active: activeRoster(L, t).length,
      activeMax: ACTIVE_MAX,
      statsSeasons: statsSeasons(L, t),
      /** Games each line/pair has played together recently (for live chemistry in the editor). */
      chemistryGames: t.chemistry ?? {},
      /** Chemistry of each forward line and defense pair: style fit + familiarity, in rating points. */
      chemistry: {
        forwards: t.lines.forwards.map((ids) => chemView(unitChemistry(t, ids.map((id) => L.players[id]).filter(Boolean), false))),
        defense: t.lines.defense.map((ids) => chemView(unitChemistry(t, ids.map((id) => L.players[id]).filter(Boolean), true))),
      },
      autoLines: t.controller.kind === 'human' ? !!t.autoLines : true,
      tactics: t.tactics ?? DEFAULT_TACTICS,
      systemFits: systemFits(healthyRoster(L, t).filter((p) => p.pos !== 'G'), t.tactics ?? DEFAULT_TACTICS),
      recommendedTactics: suggestTactics(healthyRoster(L, t).filter((p) => p.pos !== 'G')),
      /** Roughly what each option is worth to this roster, in rating points across the players on the ice (0 = a typical pick). */
      systemImpact: systemImpact(systemFits(healthyRoster(L, t).filter((p) => p.pos !== 'G'), t.tactics ?? DEFAULT_TACTICS)),
      systems: SYSTEMS_CATALOG,
      scratchWarnings:
        t.controller.kind === 'human' && !t.autoLines
          ? betterScratches(L, t).map((w) => ({
              scratched: { id: w.scratched.id, name: playerName(L, w.scratched.id), overall: overallOf(L, w.scratched.id) },
              dressedInstead: { id: w.dressedInstead.id, name: playerName(L, w.dressedInstead.id), overall: overallOf(L, w.dressedInstead.id) },
            }))
          : [],
      recent: games.filter((g) => g.result).slice(-5).map((g) => gameView(L, g)),
      upcoming: games.filter((g) => !g.result).slice(0, 5).map((g) => gameView(L, g)),
    };
  }),

  /**
   * The contracts tab: every signed player's deal season by season (with any
   * agreed extension and when he becomes a free agent), the cap picture for
   * the next several seasons, and how keen each player is to stay.
   */
  contracts: memberProcedure.input(z.object({ teamId: z.string() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const t = L.teams[input.teamId];
    if (!t) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such team' });
    const isMine = ctx.membership.teamId === t.id;
    const first = capSeason(L);
    const beforeRollover = L.phase === 'offseason' && (!L.offseason || ['fantasy-draft', 'draft', 're-sign'].includes(L.offseason.stage));
    const seasons = Array.from({ length: 7 }, (_, i) => first + i);
    const offers = isMine ? openOffers(L, t.id) : [];
    const offerFor = new Map(offers.filter((o) => o.kind === 're-sign').map((o) => [o.playerId, o]));
    const players = t.roster
      .map((id) => L.players[id])
      .filter(Boolean)
      .map((p) => {
        const c = p.contract;
        const remaining = c ? Math.max(0, c.yearsLeft - (beforeRollover ? 1 : 0)) : 0;
        const ext = p.extension ?? null;
        const pend = offerFor.get(p.id);
        const grid = seasons.map((season) => {
          const i = season - first;
          if (i < remaining) return { season, salary: c!.salary, kind: 'contract' as const };
          if (ext && i < remaining + ext.years) return { season, salary: ext.salary, kind: 'extension' as const };
          // An offer he hasn't answered yet: shown where it would land (not counted as committed).
          if (!ext && pend && i >= pend.startIndex && i < pend.startIndex + pend.offer.years) return { season, salary: pend.offer.salary, kind: 'offer' as const };
          if (i === remaining + (ext?.years ?? 0)) {
            const status = ext ? expiresAsFor(age(p, first + remaining + ext.years), 99) : (c?.expiresAs ?? 'UFA');
            return { season, salary: null, kind: status === 'RFA' ? ('rfa' as const) : ('ufa' as const) };
          }
          return { season, salary: null, kind: null };
        });
        const expiringSoon = remaining <= 1 && !ext;
        const terms = isMine ? dealTerms(L, p, t, L.offseason?.expiring[p.id] ?? askingContract(L, p)) : null;
        return {
          ...publicPlayer(L, p),
          farm: !!p.farm,
          potential: potentialView(L, ctx.membership.teamId, p),
          capHit: capHit(p),
          twoWay: isTwoWay(p.contract),
          minorSalary: p.contract && isTwoWay(p.contract) ? minorSalaryOf(p.contract) : null,
          remaining,
          grid,
          extension: ext,
          expiringSoon,
          /** How keen he is to stay (contender status, role, loyalty, ambition, market, age). */
          interest: terms?.interest ?? null,
          priorities: terms?.priorities ?? null,
          canExtend: isMine && canExtend(L, p) && !p.extension,
          deal: isMine && canExtend(L, p) ? terms : null,
          attemptsLeft: L.negotiations?.[p.id]?.teamId === t.id && L.negotiations[p.id].season === L.season ? Math.max(0, 3 - L.negotiations[p.id].attempts) : 3,
          buyout: isMine ? buyoutTerms(L, p) : null,
          /** Your offer waiting for his answer, and his latest answer this summer. */
          myOffer: pend ? { offer: pend.offer, status: pend.status } : null,
          answer: isMine && !ext ? latestAnswer(L, t.id, p.id) : null,
        };
      })
      .sort((a, b) => Number(a.farm) - Number(b.farm) || b.capHit - a.capHit);
    const offeredPer = offeredBySeason(offers, seasons.length);
    const cap = seasons.map((season, i) => {
      const projectedCap = Math.round((L.settings.salaryCap * Math.pow(1.025, i + (L.phase === 'offseason' ? 0 : 0))) / 100_000) * 100_000;
      const committed = players.reduce((sum, p) => {
        const g = p.grid[i];
        if (!g.salary || g.kind === 'offer') return sum;
        return sum + (p.farm ? Math.max(0, g.salary - BURY_EXEMPT) : g.salary);
      }, 0);
      const dead = deadCapFor(L, t, season);
      const signed = players.filter((p) => p.grid[i].salary && p.grid[i].kind !== 'offer').length;
      return {
        season,
        cap: projectedCap,
        committed: committed + dead,
        dead,
        space: projectedCap - committed - dead,
        signed,
        /** AAV of your open offers that would count this season if accepted. */
        offered: offeredPer[i],
        /** Space left if every open offer were accepted. */
        spaceIfAccepted: projectedCap - committed - dead - offeredPer[i],
      };
    });
    return { team: teamInfo(t), isMine, seasons, players, cap, offers, contractMax: CONTRACT_MAX, affiliate: affiliateLabel(L, t) };
  }),

  player: memberProcedure.input(z.object({ playerId: z.string() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const p = L.players[input.playerId];
    const retired = L.retired?.[input.playerId];
    if (!p && !retired) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such player' });
    const career = [...(p ? (L.careerStats?.[p.id] ?? []) : retired!.career)];
    // Add the season in progress.
    const minorNow = p ? (L.prospectStats?.[p.id] ?? null) : null;
    if (p && L.phase !== 'offseason' && (L.skaterStats[p.id] || L.goalieStats[p.id] || minorNow)) {
      career.push({
        season: L.season,
        teamId: p.teamId,
        age: L.season - p.birthYear,
        overall: overall(p),
        skater: L.skaterStats[p.id] ?? null,
        goalie: L.goalieStats[p.id] ?? null,
        playoffSkater: L.playoffSkaterStats[p.id] ?? null,
        playoffGoalie: L.playoffGoalieStats[p.id] ?? null,
        minor: minorNow,
        orgId: minorNow ? (p.prospectOf ?? p.teamId ?? null) : null,
      });
    }
    const teamOf = (id: string | null) => (id && L.teams[id] ? teamInfo(L.teams[id]) : null);
    const awards = L.history.flatMap((h) =>
      Object.entries(h.awards)
        .filter(([, w]) => w.playerId === input.playerId)
        .map(([award]) => ({ season: h.season, award })),
    );
    const scout = p ? scoutedPotential(L, ctx.membership.teamId ?? 'league', p) : null;
    return {
      player: p ? publicPlayer(L, p) : null,
      /** Role skills (net front, point, PK…), skaters only. */
      roles: p?.skater ? ROLES.map((r) => ({ id: r, label: ROLE_LABEL[r], help: ROLE_HELP[r], value: roleSkills(p)[r] })) : null,
      potential: p ? potentialView(L, ctx.membership.teamId, p) : null,
      retired: retired ? { name: retired.name, pos: retired.pos, retiredAfter: retired.retiredAfter, peakOverall: retired.peakOverall } : null,
      team: p ? teamOf(p.teamId ?? p.prospectOf ?? null) : teamOf(retired!.lastTeamId),
      isProspect: !!p?.prospectOf,
      draft: p?.draft ? { ...p.draft, team: teamOf(p.draft.teamId) } : null,
      scouting: scout !== null && p && L.season - p.birthYear <= 25 ? { grade: grade(scout), projection: projectionLabel(scout, p!.pos) } : null,
      career: career.map((c) => ({ ...c, team: teamOf(c.teamId), org: teamOf(c.orgId ?? null) })),
      /** Skills coaching: points gained this season by skill, and who's working with him now. */
      training: p ? trainingView(L, p) : null,
      awards,
      /** Your open offer to him (re-signing, free agent or offer sheet), and his latest answer to a re-signing offer. */
      myOffer: p && ctx.membership.teamId ? (openOffers(L, ctx.membership.teamId).find((o) => o.playerId === p.id) ?? null) : null,
      myAnswer: p && ctx.membership.teamId && !p.extension ? latestAnswer(L, ctx.membership.teamId, p.id) : null,
    };
  }),

  /** Suggested lines for the caller's team (the same logic the AI uses). */
  suggestLines: memberProcedure.query(async ({ ctx, input }) => {
    if (!ctx.membership.teamId) throw badRequest('You do not manage a team');
    const L = await readLeague(ctx.db, input.leagueId);
    const team = L.teams[ctx.membership.teamId];
    return autoLines(healthyRoster(L, team), team.tactics);
  }),

  setLines: memberProcedure.input(z.object({ lines: linesSchema })).mutation(async ({ ctx, input }) => {
    const teamId = ctx.membership.teamId;
    if (!teamId) throw badRequest('You do not manage a team');
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      const err = validateLines(L, teamId, input.lines);
      if (err) throw badRequest(err);
      L.teams[teamId].lines = input.lines;
      // Hand-set lines mean the manager is taking over from the assistant coach.
      L.teams[teamId].autoLines = false;
    });
    return { ok: true };
  }),

  setAutoLines: memberProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    const teamId = ctx.membership.teamId;
    if (!teamId) throw badRequest('You do not manage a team');
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      const team = L.teams[teamId];
      team.autoLines = input.enabled;
      if (input.enabled) team.lines = autoLines(healthyRoster(L, team), team.tactics);
    });
    return { ok: true };
  }),

  /** Set your coaching systems. With the assistant coach on, special units are rebuilt to fit. */
  setTactics: memberProcedure.input(z.object({ tactics: tacticsSchema })).mutation(async ({ ctx, input }) => {
    const teamId = ctx.membership.teamId;
    if (!teamId) throw badRequest('You do not manage a team');
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      const team = L.teams[teamId];
      const formationChanged = (team.tactics ?? DEFAULT_TACTICS).pp !== input.tactics.pp;
      team.tactics = input.tactics;
      if (team.autoLines) team.lines = autoLines(healthyRoster(L, team), team.tactics);
      // A new formation re-slots the power play; the rest of the manager's lines stay.
      else if (formationChanged) team.lines = completeLines({ ...team.lines, pp: [] }, healthyRoster(L, team), team.tactics);
    });
    return { ok: true };
  }),

  leaders: memberProcedure
    .input(z.object({ playoffs: z.boolean().default(false), season: z.union([z.number().int(), z.literal('all')]).optional() }))
    .query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const { sk, gs, teamAt } = leaderPool(L, input.playoffs, input.season);
    const who = (id: string) => {
      const p = L.players[id];
      const r = L.retired?.[id];
      // A past season shows the team he played for then.
      const teamId = teamAt.has(id) ? (teamAt.get(id) ?? null) : (p?.teamId ?? null);
      return { id, name: p ? `${p.firstName} ${p.lastName}` : (r?.name ?? id), pos: p?.pos ?? r?.pos ?? '', teamId, active: !!p && !r };
    };
    const teamLabel = (id: string) => L.teams[who(id).teamId ?? '']?.abbr ?? (!L.players[id] || L.retired?.[id] ? 'RET' : 'FA');
    const maxGp = Math.max(1, ...sk.map(([, s]) => s.gp));
    const minGoalieGp = Math.max(1, Math.round(maxGp * 0.3));
    const top = <T,>(rows: T[], key: (r: T) => number, asc = false, n = 10) =>
      [...rows].sort((a, b) => (asc ? key(a) - key(b) : key(b) - key(a))).slice(0, n);
    const skater = (label: string, key: (s: (typeof sk)[number][1]) => number, fmt: 'int' | 'pct' | 'dec' = 'int') => ({
      label,
      fmt,
      rows: top(sk, ([, s]) => key(s)).map(([id, s]) => ({ ...who(id), gp: s.gp, value: key(s) })),
    });
    const goalie = (label: string, key: (g: (typeof gs)[number][1]) => number, fmt: 'int' | 'pct' | 'dec' = 'int', asc = false) => ({
      label,
      fmt,
      rows: top(
        gs.filter(([, g]) => g.gp >= minGoalieGp),
        ([, g]) => key(g),
        asc,
      ).map(([id, g]) => ({ ...who(id), gp: g.gp, value: key(g) })),
    });
    return {
      skaters: [
        skater('Points', (s) => s.g + s.a),
        skater('Goals', (s) => s.g),
        skater('Assists', (s) => s.a),
        skater('Plus/Minus', (s) => s.pm),
        skater('Power-play goals', (s) => s.ppg),
        skater('Hits', (s) => s.hits),
      ],
      goalies: [
        goalie('Wins', (g) => g.w),
        goalie('Save %', (g) => (g.sa ? 1 - g.ga / g.sa : 0), 'pct'),
        goalie('Goals against avg.', (g) => (g.toi ? (g.ga * 3600) / g.toi : 99), 'dec', true),
        goalie('Shutouts', (g) => g.so),
      ],
      minGoalieGp,
      /** Every player's line for the full sortable tables. */
      allSkaters: sk
        .filter(([, s]) => s.gp > 0)
        .map(([id, s]) => ({
          ...who(id),
          team: teamLabel(id),
          gp: s.gp,
          g: s.g,
          a: s.a,
          p: s.g + s.a,
          pm: s.pm,
          pim: s.pim,
          ppg: s.ppg,
          ppp: s.ppg + s.ppa,
          shg: s.shg,
          gwg: s.gwg ?? 0,
          sog: s.sog,
          hits: s.hits,
          blk: s.blk,
          fow: s.fow,
          fol: s.fol,
          toi: s.toi,
        })),
      allGoalies: gs
        .filter(([, g]) => g.gp > 0)
        .map(([id, g]) => ({
          ...who(id),
          team: teamLabel(id),
          gp: g.gp,
          gs: g.gs,
          w: g.w,
          l: g.l,
          otl: g.otl,
          sa: g.sa,
          ga: g.ga,
          so: g.so,
          toi: g.toi,
        })),
      season: input.season ?? L.season,
      /** Seasons with stats to browse (newest first). */
      seasons: [...new Set([L.season, ...L.history.map((h) => h.season)])].sort((x, y) => y - x),
    };
  }),

  /** Top 100 scorers outside the NHL: drafted prospects (junior, college, Europe, AHL) or players not yet drafted. */
  minorLeaders: memberProcedure
    .input(z.object({ scope: z.enum(['prospects', 'undrafted']), season: z.number().int().optional() }))
    .query(async ({ ctx, input }) => {
      const L = await readLeague(ctx.db, input.leagueId);
      return { season: input.season ?? L.season, ...minorLeaders(L, input.scope, input.season ?? L.season) };
    }),

  /** A team's all-time records: career leaders with the club and its best seasons. */
  franchiseRecords: memberProcedure.input(z.object({ teamId: z.string() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    if (!L.teams[input.teamId]) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such team' });
    return franchiseRecords(L, input.teamId);
  }),

  /**
   * A team's season game by game: points pace against the league average and
   * the conference's playoff line, and rolling goals for/against.
   */
  teamTrends: memberProcedure.input(z.object({ teamId: z.string() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const t = L.teams[input.teamId];
    if (!t) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such team' });
    // Per-team game logs, in order.
    const logs = new Map<string, Array<{ day: number; opp: string; home: boolean; gf: number; ga: number; pts: number; ot: boolean }>>();
    for (const id of Object.keys(L.teams)) logs.set(id, []);
    for (const g of [...L.schedule].filter((x) => x.result).sort((a, b) => a.day - b.day)) {
      const r = g.result!;
      const extra = r.overtime || r.shootout;
      for (const [me, them, gf, ga, home] of [
        [g.home, g.away, r.homeScore, r.awayScore, true],
        [g.away, g.home, r.awayScore, r.homeScore, false],
      ] as const) {
        logs.get(me)!.push({ day: g.day, opp: L.teams[them].abbr, home, gf, ga, pts: gf > ga ? 2 : extra ? 1 : 0, ot: extra });
      }
    }
    const cum = new Map([...logs].map(([id, l]) => [id, l.reduce<number[]>((acc, x) => [...acc, (acc.at(-1) ?? 0) + x.pts], [])]));
    const mine = logs.get(t.id)!;
    const conf = Object.values(L.teams).filter((x) => x.conference === t.conference);
    const n = mine.length;
    // At each game number, only once most teams have played that many (otherwise the few ahead skew it).
    const leagueAvg: Array<number | null> = [];
    const playoffLine: Array<number | null> = [];
    const teams = [...cum.values()];
    for (let i = 0; i < n; i++) {
      const at = teams.map((c) => c[i]).filter((v): v is number => v !== undefined);
      leagueAvg.push(at.length >= teams.length * 0.75 ? Math.round((at.reduce((a, b) => a + b, 0) / at.length) * 10) / 10 : null);
      const c = conf.map((x) => cum.get(x.id)![i]).filter((v): v is number => v !== undefined).sort((a, b) => b - a);
      playoffLine.push(c.length >= Math.max(8, conf.length * 0.75) ? c[7] : null);
    }
    const roll = (k: 'gf' | 'ga') => mine.map((_, i) => {
      const w = mine.slice(Math.max(0, i - 9), i + 1);
      return Math.round((w.reduce((s, x) => s + x[k], 0) / w.length) * 100) / 100;
    });
    return {
      games: mine.map((g, i) => ({ ...g, n: i + 1, cum: cum.get(t.id)![i] })),
      leagueAvg,
      playoffLine,
      gfRolling: roll('gf'),
      gaRolling: roll('ga'),
      totalGames: L.schedule.filter((g) => g.home === t.id || g.away === t.id).length,
    };
  }),

  /** Every team's all-time leading scorer. */
  franchiseTopScorers: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    return franchiseTopScorers(L);
  }),

  playoffs: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    if (!L.playoffs) return null;
    return {
      champion: L.playoffs.champion ? teamInfo(L.teams[L.playoffs.champion]) : null,
      rounds: L.playoffs.rounds.map((round, i) => ({
        name: ROUND_NAMES[i],
        series: round.map((s) => ({
          id: s.id,
          conference: s.conference,
          high: teamInfo(L.teams[s.high]),
          low: teamInfo(L.teams[s.low]),
          highWins: s.highWins,
          lowWins: s.lowWins,
          winner: s.winner,
          games: s.games.map((g) => gameView(L, g)),
        })),
      })),
    };
  }),

  transactions: memberProcedure
    .input(z.object({ teamId: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      const L = await readLeague(ctx.db, input.leagueId);
      return L.transactions
        .filter((t) => !input.teamId || t.teamId === input.teamId)
        .slice(-input.limit)
        .reverse()
        .map((t) => ({ ...t, team: teamInfo(L.teams[t.teamId]) }));
    }),

  awards: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const view = (awards: League['awards']) =>
      Object.entries(awards).map(([award, w]) => ({
        award,
        playerId: w.playerId,
        playerName: w.playerId ? playerName(L, w.playerId) : null,
        team: teamInfo(L.teams[w.teamId]),
        note: w.note,
      }));
    return {
      current: view(L.awards),
      history: L.history.map((h) => ({
        season: h.season,
        champion: h.champion ? teamInfo(L.teams[h.champion]) : null,
        runnerUp: h.runnerUp ? teamInfo(L.teams[h.runnerUp]) : null,
        awards: view(h.awards),
      })),
    };
  }),
});
