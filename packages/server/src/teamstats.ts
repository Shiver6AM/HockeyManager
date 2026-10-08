/**
 * Team stats for the season: goals, shots, power play, penalty kill,
 * penalties, faceoffs. Built from each game's team totals, which are kept with
 * the result (the full box score moves to its own table once a game is saved).
 */
import { standings, teamTotals, type GameSummary, type League, type TeamGameTotals, type TeamId } from '@hockey-gm/sim-core';
import { isSimming, mutateLeague } from './advance';
import type { Db } from './db';
import { readLeague } from './state';

/** A game's totals for both sides: kept with the result, or (a game not yet saved) from its box score. */
export function gameTotals(r: GameSummary | null): { home: TeamGameTotals; away: TeamGameTotals } | null {
  if (!r) return null;
  if (r.teams) return r.teams;
  if (r.box) return { home: teamTotals(r.box.home), away: teamTotals(r.box.away) };
  return null;
}

export interface TeamSeasonStats {
  teamId: TeamId;
  gp: number;
  w: number;
  l: number;
  otl: number;
  pts: number;
  gf: number;
  ga: number;
  /** Games with team totals on record (all of them, except in a season that was under way before they were kept). */
  games: number;
  sf: number;
  sa: number;
  /** Power-play goals and opportunities; power-play goals allowed and times shorthanded. */
  ppg: number;
  ppo: number;
  ppga: number;
  tsh: number;
  pim: number;
  fow: number;
  fo: number;
  ppPct: number | null;
  pkPct: number | null;
  /** League rank (1 = best) on the power play and the penalty kill. */
  ppRank: number | null;
  pkRank: number | null;
}

/** Every team's regular-season stats so far (or, in the summer, for the season just played). */
export function teamSeasonStats(L: League): Record<TeamId, TeamSeasonStats> {
  const out: Record<TeamId, TeamSeasonStats> = {};
  for (const r of standings(L)) {
    out[r.teamId] = { teamId: r.teamId, gp: r.gp, w: r.w, l: r.l, otl: r.otl, pts: r.pts, gf: r.gf, ga: r.ga, games: 0, sf: 0, sa: 0, ppg: 0, ppo: 0, ppga: 0, tsh: 0, pim: 0, fow: 0, fo: 0, ppPct: null, pkPct: null, ppRank: null, pkRank: null };
  }
  for (const g of L.schedule) {
    const t = gameTotals(g.result);
    if (!t) continue;
    for (const [me, mine, theirs] of [
      [g.home, t.home, t.away],
      [g.away, t.away, t.home],
    ] as const) {
      const s = out[me];
      if (!s) continue;
      s.games++;
      s.sf += mine.sog;
      s.sa += theirs.sog;
      s.ppg += mine.ppg;
      s.ppo += mine.ppo;
      s.ppga += theirs.ppg;
      s.tsh += theirs.ppo;
      s.pim += mine.pim;
      s.fow += mine.fow;
      s.fo += mine.fow + theirs.fow;
    }
  }
  const all = Object.values(out);
  for (const s of all) {
    s.ppPct = s.ppo ? s.ppg / s.ppo : null;
    s.pkPct = s.tsh ? 1 - s.ppga / s.tsh : null;
  }
  const rank = (key: 'ppPct' | 'pkPct', set: 'ppRank' | 'pkRank') => {
    const ranked = all.filter((s) => s[key] !== null).sort((a, b) => b[key]! - a[key]!);
    ranked.forEach((s, i) => (s[set] = i + 1));
  };
  rank('ppPct', 'ppRank');
  rank('pkPct', 'pkRank');
  return out;
}

/**
 * Games played before team totals were kept with results have them only in
 * their box scores. Copy them over once per league and season: just those few
 * numbers are read out of the database, not the box scores.
 */
const filled = new Set<string>();
export async function ensureTeamTotals(db: Db, leagueId: string): Promise<void> {
  const L = await readLeague(db, leagueId);
  const key = `${leagueId}:${L.season}`;
  if (filled.has(key) || isSimming(leagueId)) return;
  const missing = L.schedule.filter((g) => g.result && !gameTotals(g.result)).map((g) => g.id);
  if (!missing.length) {
    filled.add(key);
    return;
  }
  const side = (s: 'home' | 'away') =>
    ['shots', 'ppGoals', 'ppOpps', 'pim', 'fow'].map((k) => `coalesce((box->'${s}'->>'${k}')::int, 0)`).join(', ');
  const rows = await db.query<{ game_id: number; h: number[]; a: number[] }>(
    `select game_id, array[${side('home')}] as h, array[${side('away')}] as a from box_scores where league_id = $1 and season = $2 and game_id = any($3::int[])`,
    [leagueId, L.season, missing],
  );
  const lines = new Map(rows.map((r) => [Number(r.game_id), r]));
  const toTotals = (v: number[]): TeamGameTotals => ({ sog: Number(v[0]), ppg: Number(v[1]), ppo: Number(v[2]), pim: Number(v[3]), fow: Number(v[4]) });
  try {
    await mutateLeague(db, leagueId, (M) => {
      if (M.season !== L.season) return;
      for (const g of M.schedule) {
        const r = lines.get(g.id);
        if (g.result && !gameTotals(g.result) && r) g.result.teams = { home: toTotals(r.h), away: toTotals(r.a) };
      }
    });
    filled.add(key);
  } catch {
    // (Busy right now: the next visit tries again.)
  }
}
