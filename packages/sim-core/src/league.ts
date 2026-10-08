import { playoffMvp, regularSeasonAwards } from './awards';
import { applyScoutPlans, initScouts, scoutingDay } from './scouting';
import { publishCss } from './css';
import { ensureDraftClass } from './draft';
import { refreshTraits } from './traits';
import { altPositions } from './positions';
import { recordChemistry } from './chemistry';
import { initSkillsCoaches, trainingDay } from './skills';
import { developmentDay } from './development';
import { prospectGameDay } from './prospects';
import { initFarm } from './farmInit';
import { simulateGame } from './game';
import { currentRound, HOME_PATTERN, nextRound, seedPlayoffs, WINS_NEEDED } from './playoffs';
import { deriveSeed } from './rng';
import { aiRosterMoves, prepareTeamForGame } from './roster';
import { balanceRoster, returnInjuryCallUps } from './farm';
import { processWaivers } from './waivers';
import { bookGame, initFinances, ownerReviews } from './finances';
import { addNews, gameNews, newsFromTransactions } from './news';
import { initStaff, refillStaffPool, trainerInjuryMultiplier } from './staff';
import { aiTradeDay, invalidateStale, tradeDeadline } from './trades';
import { aiOfferDay } from './offers';
import type {
  GameSummary,
  TeamGameLine,
  TeamGameTotals,
  GoalieSeasonStats,
  League,
  Player,
  PlayEvent,
  PlayerId,
  ScheduledGame,
  PlayoffSeries,
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
/** Sim up to trade deadline day (trades are still allowed that day). */
export function advanceToDeadline(league: League): AdvanceResult {
  if (league.phase !== 'regular-season') throw new Error('The trade deadline is during the regular season');
  const deadline = tradeDeadline(league);
  if (league.day >= deadline) throw new Error(league.day === deadline ? 'It is already deadline day' : 'The trade deadline has passed');
  return advanceDays(league, deadline - league.day);
}

export function advanceToEndOfSeason(league: League): AdvanceResult {
  return advanceDays(league, 10_000);
}

/** @deprecated use advanceToPlayoffs / advanceToEndOfSeason */
export const advanceToEnd = advanceToPlayoffs;

// ---------------------------------------------------------------------------
// One calendar day
// ---------------------------------------------------------------------------

/** Heal a day; returns who's back. */
function healInjuries(league: League): Player[] {
  const back: Player[] = [];
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
      back.push(p);
    }
  }
  return back;
}

function applyInjuries(league: League, res: GameSummary) {
  for (const inj of res.box.injuries) {
    const p = league.players[inj.playerId];
    // A good training staff gets players back sooner.
    const days = Math.max(1, Math.round(inj.days * trainerInjuryMultiplier(league, inj.teamId)));
    inj.days = days;
    p.injury = { type: inj.type, severity: inj.severity, daysLeft: days, sinceDay: league.day };
    (p.injuryLog ??= []).push({ season: league.season, day: league.day, type: inj.type, severity: inj.severity, days });
    if (p.injuryLog.length > 60) p.injuryLog.splice(0, p.injuryLog.length - 60);
    league.transactions.push({
      day: league.day, season: league.season, type: 'injury', teamId: inj.teamId, playerId: p.id,
      note: `${p.firstName} ${p.lastName}: ${inj.type} (${inj.severity}, ~${inj.days} days)`,
    });
  }
}

/** The part of a team's box-score line kept with the result. */
export function teamTotals(t: TeamGameLine): TeamGameTotals {
  return { sog: t.shots, ppg: t.ppGoals, ppo: t.ppOpps, pim: t.pim, fow: t.fow };
}

function playGame(league: League, g: ScheduledGame, playoff: boolean, playedYesterday: Set<TeamId>) {
  const home = league.teams[g.home];
  const away = league.teams[g.away];
  prepareTeamForGame(league, home);
  prepareTeamForGame(league, away);
  // A game that was simcast already happened: use that result.
  const pre = league.presimmed?.find((x) => x.gameId === g.id && x.season === league.season && x.day === league.day);
  const res =
    pre?.result ??
    simulateGame(league, home, away, gameSeed(league, g.id), {
      playoff,
      homeBackToBack: playedYesterday.has(g.home),
      awayBackToBack: playedYesterday.has(g.away),
    });
  if (pre) league.presimmed = league.presimmed!.filter((x) => x !== pre);
  res.teams = { home: teamTotals(res.box.home), away: teamTotals(res.box.away) };
  g.result = res;
  recordChemistry(home);
  recordChemistry(away);
  const before: Record<string, { g: number; pts: number }> = {};
  for (const id of Object.keys(res.box.skaters)) {
    const s = league.skaterStats[id];
    before[id] = { g: s?.g ?? 0, pts: s ? s.g + s.a : 0 };
  }
  if (playoff) recordStats(league, res, league.playoffSkaterStats, league.playoffGoalieStats);
  else recordStats(league, res, league.skaterStats, league.goalieStats);
  applyInjuries(league, res);
  const homeWon = res.homeScore > res.awayScore;
  bookGame(league, home, away, homeWon ? 2 : res.overtime ? 1 : 0, homeWon ? (res.overtime ? 1 : 0) : 2, playoff);
  gameNews(league, g, res.box, playoff, before);
}

export function teamsPlayingOn(league: League, day: number): Set<TeamId> {
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

/** Leagues saved before staff/finances existed get them on first use. */
export function ensureLeagueLife(league: League, opts: { farm?: boolean } = {}) {
  const teams = Object.values(league.teams);
  if (teams.some((t) => !t.staff)) initStaff(league);
  if (teams.some((t) => !t.finances)) initFinances(league);
  if (teams.some((t) => !t.skillsCoaches || !t.goalieCoach)) initSkillsCoaches(league);
  // (Not while a fantasy draft is still filling rosters: farms are stocked after it.)
  if (opts.farm !== false && !(league.fantasy && !league.fantasy.done) && teams.some((t) => !t.farmStocked)) initFarm(league);
  if (teams.some((t) => !t.scouts)) initScouts(league);
  ensureDraftClass(league);
  ensureTraits(league);
  refillStaffPool(league); // no-op unless the job market is thin
  league.newsState ??= { txCursor: league.transactions.length, streaks: {}, nextId: 1 };
}

/** Work out traits for new players, and for everyone once a season (after the summer's development). */
export function ensureTraits(league: League) {
  for (const p of Object.values(league.players)) {
    if (p.altPos === undefined) p.altPos = altPositions(league, p);
    if (p.traitsSeason === league.season) continue;
    refreshTraits(p);
    p.traitsSeason = league.season;
  }
}

function simDay(league: League): ScheduledGame[] {
  ensureLeagueLife(league);
  const out = simDayInner(league);
  // (A simcast game is used on its own day, or not at all.)
  if (league.presimmed) league.presimmed = league.presimmed.filter((x) => x.season === league.season && x.day >= league.day);
  if (!league.presimmed?.length) delete league.presimmed;
  newsFromTransactions(league);
  return out;
}

function simDayInner(league: League): ScheduledGame[] {
  if (league.day > 0) {
    const back = healInjuries(league);
    // Yesterday's waiver placements are claimed or clear.
    processWaivers(league);
    // Players back from injury retake their spots: for lineups the AI (or the
    // assistant coach) runs, the call-ups who covered for them go back down,
    // and any extras go down to the farm.
    for (const t of Object.values(league.teams)) {
      returnInjuryCallUps(league, t, back.filter((p) => p.teamId === t.id && !p.farm));
      balanceRoster(league, t);
    }
  }
  const yesterday = teamsPlayingOn(league, league.day - 1);
  const played: ScheduledGame[] = [];

  if (league.phase === 'regular-season') {
    aiTradeDay(league);
    for (const g of league.schedule) {
      if (g.day !== league.day || g.result) continue;
      playGame(league, g, false, yesterday);
      played.push(g);
    }
    trainingDay(league);
    developmentDay(league, lastDay(league) + 1); // natural growth and decline, a little every day
    prospectGameDay(league);
    scoutingDay(league);
    if (league.day % 7 === 6) for (const t of Object.values(league.teams)) aiRosterMoves(league, t);
    league.day++;
    applyScoutPlans(league);
    const deadline = tradeDeadline(league);
    if (league.day === deadline) addNews(league, 'trade', 'It’s trade deadline day: deals must be done before the next game day.');
    else if (league.day === deadline - 7) addNews(league, 'trade', 'One week to the trade deadline. Contenders are shopping.');
    else if (league.day === deadline + 1) addNews(league, 'trade', 'The trade deadline has passed. Rosters are set for the stretch run.');
    aiOfferDay(league); // AI teams call managers (and offers that ran out of time are withdrawn)
    if (league.day > lastDay(league)) startPlayoffs(league);
    else if (league.trades?.length) invalidateStale(league);
    publishCss(league); // Central Scouting's list every two weeks, and the final one at season's end
    return played;
  }

  if (league.phase === 'playoffs' && league.playoffs) {
    played.push(...playoffDay(league, yesterday));
    trainingDay(league);
    scoutingDay(league);
    league.day++;
    applyScoutPlans(league);
  }
  return played;
}

// ---------------------------------------------------------------------------
// Playoffs
// ---------------------------------------------------------------------------

function startPlayoffs(league: League) {
  processWaivers(league, true);
  const st = standings(league);
  league.awards = regularSeasonAwards(league, st);
  for (const [award, w] of Object.entries(league.awards)) {
    const who = w.playerId && league.players[w.playerId] ? `${league.players[w.playerId].firstName} ${league.players[w.playerId].lastName}` : league.teams[w.teamId].city;
    addNews(league, 'award', `${who} wins the ${award} (${w.note})`, [w.teamId], w.playerId ? [w.playerId] : []);
  }
  // One rest day after the regular season.
  league.playoffs = seedPlayoffs(league, st, league.day + 1);
  league.phase = 'playoffs';
}

function nextPlayoffGame(s: PlayoffSeries, idx: number, day: number): ScheduledGame {
  const k = s.games.length + 1;
  const highHome = HOME_PATTERN[k - 1];
  return {
    id: 100_000 + s.round * 1000 + idx * 10 + k,
    day,
    home: highHome ? s.high : s.low,
    away: highHome ? s.low : s.high,
    result: null,
    seriesId: s.id,
    gameNumber: k,
  };
}

/** The games the next sim day will play (the ones that can be simcast). */
export function upcomingGames(league: League): ScheduledGame[] {
  if (league.phase === 'regular-season') return league.schedule.filter((g) => g.day === league.day && !g.result);
  const po = league.playoffs;
  if (league.phase !== 'playoffs' || !po) return [];
  const offset = league.day - po.roundStartDay;
  if (offset < 0 || offset % 2 !== 0) return [];
  const out: ScheduledGame[] = [];
  currentRound(po).forEach((s, idx) => {
    if (!s.winner) out.push(nextPlayoffGame(s, idx, league.day));
  });
  return out;
}

/**
 * Play one of the next day's games now, recording its play-by-play, and keep
 * the result so the day's sim uses it. (The same game, played the same way.)
 */
export function presimGame(league: League, gameId: number): { game: ScheduledGame; result: GameSummary; events: PlayEvent[] } {
  const g = upcomingGames(league).find((x) => x.id === gameId);
  if (!g) throw new Error('That game is not on the next game day');
  const playoff = league.phase === 'playoffs';
  const yesterday = teamsPlayingOn(league, league.day - 1);
  const home = league.teams[g.home];
  const away = league.teams[g.away];
  // Watched once, it stays played: a second simcast of the same game shows the same game.
  const pre = league.presimmed?.find((x) => x.gameId === g.id && x.season === league.season && x.day === league.day);
  if (pre) return { game: g, result: pre.result, events: pre.events ?? [] };
  const events: PlayEvent[] = [];
  prepareTeamForGame(league, home);
  prepareTeamForGame(league, away);
  const result = simulateGame(league, home, away, gameSeed(league, g.id), {
    playoff,
    homeBackToBack: yesterday.has(g.home),
    awayBackToBack: yesterday.has(g.away),
    pbp: events,
  });
  league.presimmed = [
    ...(league.presimmed ?? []).filter((x) => x.season === league.season && x.day === league.day),
    { season: league.season, day: league.day, gameId: g.id, result, events },
  ];
  return { game: g, result, events };
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
    const g = nextPlayoffGame(s, idx, league.day);
    playGame(league, g, true, yesterday);
    s.games.push(g);
    const homeWon = g.result!.homeScore > g.result!.awayScore;
    const winner = homeWon ? g.home : g.away;
    if (winner === s.high) s.highWins++;
    else s.lowWins++;
    if (s.highWins === WINS_NEEDED) s.winner = s.high;
    if (s.lowWins === WINS_NEEDED) s.winner = s.low;
    if (s.winner && s.round < 4) {
      const loser = s.winner === s.high ? s.low : s.high;
      const upset = s.winner === s.low ? ' (upset!)' : '';
      addNews(league, 'playoffs', `${league.teams[s.winner].city} eliminate ${league.teams[loser].city} in ${s.games.length}${upset}`, [s.winner, loser]);
    }
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
  const champ = league.teams[final.winner!];
  addNews(league, 'playoffs', `${champ.city} ${champ.name} win the championship, beating ${league.teams[runnerUp].city} ${final.highWins === 4 && final.lowWins === 0 ? 'in a sweep' : `in ${final.games.length} games`}`, [final.winner!, runnerUp]);
  if (mvp) addNews(league, 'award', `Conn Smythe Trophy: ${mvp.playerId ? `${league.players[mvp.playerId]?.firstName} ${league.players[mvp.playerId]?.lastName}` : ''} (${mvp.note})`, [mvp.teamId], mvp.playerId ? [mvp.playerId] : []);
  const reviews = ownerReviews(league, standings(league));
  for (const t of Object.values(league.teams)) {
    if (t.controller.kind === 'human') addNews(league, 'owner', `${t.city} owner: ${reviews[t.id]}`, [t.id]);
  }
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
