import { playoffMvp, regularSeasonAwards } from './awards';
import { simulateGame } from './game';
import { currentRound, HOME_PATTERN, nextRound, seedPlayoffs, WINS_NEEDED } from './playoffs';
import { deriveSeed } from './rng';
import { prepareTeamForGame } from './roster';
import { aiTradeDay, invalidateStale } from './trades';
import type {
  GameSummary,
  GoalieSeasonStats,
  League,
  PlayerId,
  ScheduledGame,
  SkaterSeasonStats,
  StandingsRow,
  TeamId,
} from './types';

export interface AdvanceResult {
  fromDay: number;
  toDay: number;
  games: ScheduledGame[];
  /** Phase changes that happened during this advance, e.g. "playoffs", "offseason". */
  phaseChanges: League['phase'][];
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
 * `settings.advance.daysPerTick`. Results are identical either way, because
 * every day is processed the same way and every game has its own seed.
 */
export function advanceDays(league: League, days: number): AdvanceResult {
  const fromDay = league.day;
  const games: ScheduledGame[] = [];
  const phaseChanges: League['phase'][] = [];
  for (let i = 0; i < days && league.phase !== 'offseason'; i++) {
    const before = league.phase;
    games.push(...simDay(league));
    if (league.phase !== before) phaseChanges.push(league.phase);
  }
  return { fromDay, toDay: league.day, games, phaseChanges };
}

/** Play out the rest of the regular season (stops before playoff game 1). */
export function advanceToPlayoffs(league: League): AdvanceResult {
  const out: AdvanceResult = { fromDay: league.day, toDay: league.day, games: [], phaseChanges: [] };
  while (league.phase === 'regular-season') {
    const r = advanceDays(league, 1);
    out.games.push(...r.games);
    out.phaseChanges.push(...r.phaseChanges);
  }
  out.toDay = league.day;
  return out;
}

/** Play out the rest of the season, playoffs included. */
export function advanceToEndOfSeason(league: League): AdvanceResult {
  return advanceDays(league, 10_000);
}

/** @deprecated use advanceToPlayoffs / advanceToEndOfSeason */
export const advanceToEnd = advanceToPlayoffs;

// ---------------------------------------------------------------------------
// One calendar day
// ---------------------------------------------------------------------------

function healInjuries(league: League) {
  for (const p of Object.values(league.players)) {
    if (!p.injury) continue;
    p.injury.daysLeft--;
    if (p.injury.daysLeft <= 0) {
      if (p.teamId) {
        league.transactions.push({
          day: league.day, season: league.season, type: 'return', teamId: p.teamId, playerId: p.id,
          note: `${p.firstName} ${p.lastName} returns from injury (${p.injury.type})`,
        });
      }
      p.injury = null;
    }
  }
}

function applyInjuries(league: League, res: GameSummary) {
  for (const inj of res.box.injuries) {
    const p = league.players[inj.playerId];
    p.injury = { type: inj.type, severity: inj.severity, daysLeft: inj.days, sinceDay: league.day };
    league.transactions.push({
      day: league.day, season: league.season, type: 'injury', teamId: inj.teamId, playerId: p.id,
      note: `${p.firstName} ${p.lastName}: ${inj.type} (${inj.severity}, ~${inj.days} days)`,
    });
  }
}

function playGame(league: League, g: ScheduledGame, playoff: boolean, playedYesterday: Set<TeamId>) {
  const home = league.teams[g.home];
  const away = league.teams[g.away];
  prepareTeamForGame(league, home);
  prepareTeamForGame(league, away);
  const res = simulateGame(league, home, away, gameSeed(league, g.id), {
    playoff,
    homeBackToBack: playedYesterday.has(g.home),
    awayBackToBack: playedYesterday.has(g.away),
  });
  g.result = res;
  if (playoff) recordStats(league, res, league.playoffSkaterStats, league.playoffGoalieStats);
  else recordStats(league, res, league.skaterStats, league.goalieStats);
  applyInjuries(league, res);
}

function teamsPlayingOn(league: League, day: number): Set<TeamId> {
  const out = new Set<TeamId>();
  for (const g of league.schedule) {
    if (g.day === day) {
      out.add(g.home);
      out.add(g.away);
    }
  }
  if (league.playoffs) {
    for (const round of league.playoffs.rounds) {
      for (const s of round) {
        for (const g of s.games) {
          if (g.day === day) {
            out.add(g.home);
            out.add(g.away);
          }
        }
      }
    }
  }
  return out;
}

function simDay(league: League): ScheduledGame[] {
  if (league.day > 0) healInjuries(league);
  const yesterday = teamsPlayingOn(league, league.day - 1);
  const played: ScheduledGame[] = [];

  if (league.phase === 'regular-season') {
    aiTradeDay(league);
    for (const g of league.schedule) {
      if (g.day !== league.day || g.result) continue;
      playGame(league, g, false, yesterday);
      played.push(g);
    }
    league.day++;
    if (league.day > lastDay(league)) startPlayoffs(league);
    else if (league.trades?.length) invalidateStale(league);
    return played;
  }

  if (league.phase === 'playoffs' && league.playoffs) {
    played.push(...playoffDay(league, yesterday));
    league.day++;
  }
  return played;
}

// ---------------------------------------------------------------------------
// Playoffs
// ---------------------------------------------------------------------------

function startPlayoffs(league: League) {
  const st = standings(league);
  league.awards = regularSeasonAwards(league, st);
  // One rest day after the regular season.
  league.playoffs = seedPlayoffs(league, st, league.day + 1);
  league.phase = 'playoffs';
}

function playoffDay(league: League, yesterday: Set<TeamId>): ScheduledGame[] {
  const po = league.playoffs!;
  const offset = league.day - po.roundStartDay;
  // Games every other day within a round.
  if (offset < 0 || offset % 2 !== 0) return [];
  const round = currentRound(po);
  const played: ScheduledGame[] = [];
  round.forEach((s, idx) => {
    if (s.winner) return;
    const k = s.games.length + 1;
    const highHome = HOME_PATTERN[k - 1];
    const g: ScheduledGame = {
      id: 100_000 + s.round * 1000 + idx * 10 + k,
      day: league.day,
      home: highHome ? s.high : s.low,
      away: highHome ? s.low : s.high,
      result: null,
      seriesId: s.id,
      gameNumber: k,
    };
    playGame(league, g, true, yesterday);
    s.games.push(g);
    const homeWon = g.result!.homeScore > g.result!.awayScore;
    const winner = homeWon ? g.home : g.away;
    if (winner === s.high) s.highWins++;
    else s.lowWins++;
    if (s.highWins === WINS_NEEDED) s.winner = s.high;
    if (s.lowWins === WINS_NEEDED) s.winner = s.low;
    played.push(g);
  });

  if (round.every((s) => s.winner)) {
    const next = nextRound(league, po, standings(league));
    if (next) {
      po.rounds.push(next);
      po.roundStartDay = league.day + 2; // a rest day between rounds
    } else {
      finishSeason(league);
    }
  }
  return played;
}

function finishSeason(league: League) {
  const po = league.playoffs!;
  const final = currentRound(po)[0];
  po.champion = final.winner;
  const runnerUp = final.winner === final.high ? final.low : final.high;
  const mvp = playoffMvp(league, final.winner!, runnerUp);
  if (mvp) league.awards['Conn Smythe Trophy'] = mvp;
  league.history.push({ season: league.season, champion: final.winner, runnerUp, awards: { ...league.awards } });
  // Season review: final stats stay browsable until the league moves on,
  // which runs development/retirements and opens the draft (offseasonStep).
  league.phase = 'offseason';
  league.offseason = null;
}

const emptySkater = (): SkaterSeasonStats => ({
  gp: 0, g: 0, a: 0, pm: 0, pim: 0, sog: 0, att: 0, ppg: 0, ppa: 0, shg: 0, gwg: 0, hits: 0, blk: 0, fow: 0, fol: 0, toi: 0,
});
const emptyGoalie = (): GoalieSeasonStats => ({ gp: 0, gs: 0, w: 0, l: 0, otl: 0, sa: 0, ga: 0, so: 0, toi: 0 });

function recordStats(
  league: League,
  res: GameSummary,
  skaterStats: Record<PlayerId, SkaterSeasonStats>,
  goalieStats: Record<PlayerId, GoalieSeasonStats>,
) {
  const b = res.box;
  for (const [id, l] of Object.entries(b.skaters)) {
    const s = (skaterStats[id] ??= emptySkater());
    s.gp++;
    s.g += l.g; s.a += l.a; s.pm += l.pm; s.pim += l.pim; s.sog += l.sog; s.att += l.att;
    s.ppg += l.ppg; s.ppa += l.ppa; s.shg += l.shg; s.hits += l.hits; s.blk += l.blk;
    s.fow += l.fow; s.fol += l.fol; s.toi += l.toi;
    if (b.gwg === id) s.gwg++;
  }
  for (const [id, l] of Object.entries(b.goalies)) {
    if (l.toi === 0 && l.sa === 0) continue;
    const s = (goalieStats[id] ??= emptyGoalie());
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
    const s = goalieStats[id];
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
    if (goalieStats[starter]) goalieStats[starter].gs++;
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
