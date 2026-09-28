import { simulateGame } from './game';
import { deriveSeed } from './rng';
import type {
  GameSummary,
  GoalieSeasonStats,
  League,
  ScheduledGame,
  SkaterSeasonStats,
  StandingsRow,
  TeamId,
} from './types';

export interface AdvanceResult {
  fromDay: number;
  toDay: number;
  games: ScheduledGame[];
  seasonComplete: boolean;
}

/** Seed for a specific game: depends only on league seed, season and game id. */
export function gameSeed(league: League, gameId: number): number {
  return deriveSeed(league.seed, `${league.season}:game:${gameId}`);
}

export function lastDay(league: League): number {
  return league.schedule.reduce((m, g) => Math.max(m, g.day), 0);
}

/**
 * Simulate the next `days` calendar days. Mutates the league in place.
 *
 * This is the only entry point the server needs for both advance modes:
 * the commissioner button calls it with N days; the scheduler calls it with
 * `settings.advance.daysPerTick`. Results are identical either way.
 */
export function advanceDays(league: League, days: number): AdvanceResult {
  if (league.phase !== 'regular-season') {
    return { fromDay: league.day, toDay: league.day, games: [], seasonComplete: true };
  }
  const fromDay = league.day;
  const end = Math.min(fromDay + days, lastDay(league) + 1);
  const played: ScheduledGame[] = [];
  for (const g of league.schedule) {
    if (g.day < fromDay || g.day >= end || g.result) continue;
    const res = simulateGame(league, league.teams[g.home], league.teams[g.away], gameSeed(league, g.id));
    g.result = res;
    recordStats(league, res);
    played.push(g);
  }
  league.day = end;
  const seasonComplete = league.day > lastDay(league);
  if (seasonComplete) league.phase = 'playoffs';
  return { fromDay, toDay: end, games: played, seasonComplete };
}

export function advanceToEnd(league: League): AdvanceResult {
  return advanceDays(league, lastDay(league) + 1 - league.day);
}

const emptySkater = (): SkaterSeasonStats => ({
  gp: 0, g: 0, a: 0, pm: 0, pim: 0, sog: 0, att: 0, ppg: 0, ppa: 0, shg: 0, gwg: 0, hits: 0, blk: 0, fow: 0, fol: 0, toi: 0,
});
const emptyGoalie = (): GoalieSeasonStats => ({ gp: 0, gs: 0, w: 0, l: 0, otl: 0, sa: 0, ga: 0, so: 0, toi: 0 });

function recordStats(league: League, res: GameSummary) {
  const b = res.box;
  for (const [id, l] of Object.entries(b.skaters)) {
    const s = (league.skaterStats[id] ??= emptySkater());
    s.gp++;
    s.g += l.g; s.a += l.a; s.pm += l.pm; s.pim += l.pim; s.sog += l.sog; s.att += l.att;
    s.ppg += l.ppg; s.ppa += l.ppa; s.shg += l.shg; s.hits += l.hits; s.blk += l.blk;
    s.fow += l.fow; s.fol += l.fol; s.toi += l.toi;
    if (b.gwg === id) s.gwg++;
  }
  for (const [id, l] of Object.entries(b.goalies)) {
    if (l.toi === 0 && l.sa === 0) continue;
    const s = (league.goalieStats[id] ??= emptyGoalie());
    s.gp++;
    s.sa += l.sa;
    s.ga += l.ga;
    s.toi += l.toi;
    if (l.decision === 'W') s.w++;
    if (l.decision === 'L') s.l++;
    if (l.decision === 'OTL') s.otl++;
  }
  // Shutout: one goalie played the whole game and allowed nothing.
  for (const [id, l] of Object.entries(b.goalies)) {
    const s = league.goalieStats[id];
    if (!s) continue;
    const teammates = Object.entries(b.goalies).filter(
      ([other]) => other !== id && league.players[other].teamId === league.players[id].teamId,
    );
    if (l.ga === 0 && l.decision === 'W' && teammates.length === 0 && !b.shootout) s.so++;
  }
  // Games started: whichever goalie for each team logged the first second.
  const byTeam = new Map<TeamId, [string, number][]>();
  for (const [id, l] of Object.entries(b.goalies)) {
    const t = league.players[id].teamId!;
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t)!.push([id, l.toi]);
  }
  for (const [, list] of byTeam) {
    // The starter is the one who entered first: when a swap happens the reliever
    // is added later, so insertion order tells us who started.
    const starter = list[0][0];
    if (league.goalieStats[starter]) league.goalieStats[starter].gs++;
  }
}

export function standings(league: League): StandingsRow[] {
  const rows = new Map<TeamId, StandingsRow & { results: string[] }>();
  for (const id of Object.keys(league.teams)) {
    rows.set(id, { teamId: id, gp: 0, w: 0, l: 0, otl: 0, pts: 0, rw: 0, row: 0, gf: 0, ga: 0, pointsPct: 0, streak: '', last10: '', results: [] });
  }
  const games = league.schedule.filter((g) => g.result).sort((a, b) => a.day - b.day || a.id - b.id);
  for (const g of games) {
    const r = g.result!;
    const h = rows.get(g.home)!;
    const a = rows.get(g.away)!;
    h.gp++; a.gp++;
    h.gf += r.homeScore; h.ga += r.awayScore;
    a.gf += r.awayScore; a.ga += r.homeScore;
    // Shootout winner's extra goal is not counted in GF/GA.
    if (r.shootout) {
      if (r.homeScore > r.awayScore) { h.gf--; a.ga--; } else { a.gf--; h.ga--; }
    }
    const [win, lose] = r.homeScore > r.awayScore ? [h, a] : [a, h];
    win.w++;
    win.pts += 2;
    if (!r.overtime) win.rw++;
    if (!r.shootout) win.row++;
    win.results.push('W');
    if (r.overtime) {
      lose.otl++;
      lose.pts++;
      lose.results.push('O');
    } else {
      lose.l++;
      lose.results.push('L');
    }
  }
  const out: StandingsRow[] = [];
  for (const r of rows.values()) {
    r.pointsPct = r.gp ? r.pts / (2 * r.gp) : 0;
    const res = r.results;
    if (res.length) {
      const last = res[res.length - 1];
      let n = 0;
      for (let i = res.length - 1; i >= 0 && res[i] === last; i--) n++;
      r.streak = `${last === 'O' ? 'OT' : last}${n}`;
      const l10 = res.slice(-10);
      r.last10 = `${l10.filter((x) => x === 'W').length}-${l10.filter((x) => x === 'L').length}-${l10.filter((x) => x === 'O').length}`;
    }
    const { results, ...row } = r;
    void results;
    out.push(row);
  }
  // NHL tiebreakers: points, points %, RW, ROW, W, goal differential.
  out.sort(
    (a, b) =>
      b.pts - a.pts || b.pointsPct - a.pointsPct || b.rw - a.rw || b.row - a.row || b.w - a.w || b.gf - b.ga - (a.gf - a.ga),
  );
  return out;
}
