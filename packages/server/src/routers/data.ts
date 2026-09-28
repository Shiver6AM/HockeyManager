import {
  askingContract,
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
} from '@hockey-gm/sim-core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { mutateLeague } from '../advance';
import { readBoxScore, readLeague } from '../state';
import { badRequest, memberProcedure, router } from '../trpc';
import { playerName, publicPlayer, teamInfo } from '../views';
import { grade } from './offseason';

const overallOf = (L: League, id: string) => overall(L.players[id]);

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
  for (const unit of [...lines.pp, ...lines.pk]) {
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
    return st.map((r, i) => ({ ...r, rank: i + 1, team: teamInfo(L.teams[r.teamId]), inPlayoffSpot: spots.has(r.teamId) }));
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

  team: memberProcedure.input(z.object({ teamId: z.string() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const t = L.teams[input.teamId];
    if (!t) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such team' });
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
        extension: L.players[id].extension ?? null,
        canExtend: ctx.membership.teamId === t.id && canExtend(L, L.players[id]) && !L.players[id].extension,
        ask: ctx.membership.teamId === t.id && canExtend(L, L.players[id]) ? (L.offseason?.expiring[id] ?? askingContract(L, L.players[id])) : null,
        priorities: ctx.membership.teamId === t.id ? priorities(L.players[id]) : null,
        buyout: ctx.membership.teamId === t.id ? buyoutTerms(L, L.players[id]) : null,
        stats: L.skaterStats[id] ?? null,
        goalieStats: L.goalieStats[id] ?? null,
        playoffStats: L.playoffSkaterStats[id] ?? null,
        playoffGoalieStats: L.playoffGoalieStats[id] ?? null,
      })),
      prospects: (t.prospects ?? [])
        .map((id) => L.players[id])
        .filter(Boolean)
        .map((p) => {
          const s = scoutedPotential(L, ctx.membership.teamId ?? 'league', p);
          return { ...publicPlayer(L, p), grade: grade(s), projection: projectionLabel(s), draft: p.draft ?? null };
        })
        .sort((a, b) => b.overall - a.overall),
      phase: L.phase,
      lines: t.lines,
      autoLines: t.controller.kind === 'human' ? !!t.autoLines : true,
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

  player: memberProcedure.input(z.object({ playerId: z.string() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const p = L.players[input.playerId];
    const retired = L.retired?.[input.playerId];
    if (!p && !retired) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such player' });
    const career = [...(p ? (L.careerStats?.[p.id] ?? []) : retired!.career)];
    // Add the season in progress.
    if (p && L.phase !== 'offseason' && (L.skaterStats[p.id] || L.goalieStats[p.id])) {
      career.push({
        season: L.season,
        teamId: p.teamId,
        age: L.season - p.birthYear,
        overall: overall(p),
        skater: L.skaterStats[p.id] ?? null,
        goalie: L.goalieStats[p.id] ?? null,
        playoffSkater: L.playoffSkaterStats[p.id] ?? null,
        playoffGoalie: L.playoffGoalieStats[p.id] ?? null,
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
      retired: retired ? { name: retired.name, pos: retired.pos, retiredAfter: retired.retiredAfter, peakOverall: retired.peakOverall } : null,
      team: p ? teamOf(p.teamId ?? p.prospectOf ?? null) : teamOf(retired!.lastTeamId),
      isProspect: !!p?.prospectOf,
      draft: p?.draft ? { ...p.draft, team: teamOf(p.draft.teamId) } : null,
      scouting: scout !== null && p && L.season - p.birthYear <= 25 ? { grade: grade(scout), projection: projectionLabel(scout) } : null,
      career: career.map((c) => ({ ...c, team: teamOf(c.teamId) })),
      awards,
    };
  }),

  /** Suggested lines for the caller's team (the same logic the AI uses). */
  suggestLines: memberProcedure.query(async ({ ctx, input }) => {
    if (!ctx.membership.teamId) throw badRequest('You do not manage a team');
    const L = await readLeague(ctx.db, input.leagueId);
    return autoLines(healthyRoster(L, L.teams[ctx.membership.teamId]));
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
      if (input.enabled) team.lines = autoLines(healthyRoster(L, team));
    });
    return { ok: true };
  }),

  leaders: memberProcedure.input(z.object({ playoffs: z.boolean().default(false) })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const sk = Object.entries(input.playoffs ? L.playoffSkaterStats : L.skaterStats);
    const gs = Object.entries(input.playoffs ? L.playoffGoalieStats : L.goalieStats);
    const who = (id: string) => ({ id, name: playerName(L, id), pos: L.players[id].pos, teamId: L.players[id].teamId });
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
    };
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
