/**
 * How a player's season went against what his rating predicts.
 *
 * Production is compared across the league, position by position: what
 * players with his ratings usually produce is fitted from everyone's season,
 * and each player is placed above or below it. A 75 who produced like an 80
 * had a strong season; an 85 who produced like an 80 had a poor one. Scoring
 * is judged against a player's offensive ratings and plus-minus against his
 * two-way ratings, so a playing style isn't mistaken for a good or bad year. That standing feeds the summer's
 * development (see development.ts): strong seasons add to growth or soften
 * decline, poor ones do the reverse.
 *
 * Skaters are judged on scoring rate (points per 60 minutes, power-play points
 * counted for less) and on plus-minus per 60 relative to their own team, so a
 * good team's record isn't credited to everyone on it. Forwards lean on
 * scoring, defensemen evenly on both. Goalies are judged on save percentage.
 *
 * Because it is measured against the league's own curve, the adjustments
 * average out to zero: this moves players relative to each other and leaves
 * the league's overall talent level alone.
 */
import { memo } from './memo';
import { defensiveDrive, goalieQuality, offensiveDrive, skaterOverall } from './ratings';
import { slider } from './sliders';
import type { League, Player, PlayerId } from './types';

export const PERFORMANCE = {
  /** Overall points per standard deviation above or below expectation. */
  pointsPerSd: 0.6,
  /** Seasons further out than this many standard deviations count as this many. */
  cap: 2.5,
  /** Games (and, for skaters, minutes a night) to be judged at all… */
  minGames: { skater: 25, goalie: 15 },
  minToi: 8 * 60,
  /** …and games for the season to count in full. */
  fullGames: { skater: 60, goalie: 40 },
  /** A power-play point counts this much of an even-strength one. */
  ppWeight: 0.6,
  /** Scoring's share of a skater's season (the rest is relative plus-minus). */
  scoringShare: { F: 0.75, D: 0.5 },
};

export type PerformanceLabel = 'Far above expectations' | 'Above expectations' | 'As expected' | 'Below expectations' | 'Far below expectations';

export interface SeasonPerformance {
  /** Standard deviations above (+) or below (−) what his rating predicts. */
  z: number;
  /** What it adds to this summer's development, in overall points. */
  bonus: number;
  label: PerformanceLabel;
  gp: number;
}

export function performanceLabel(z: number): PerformanceLabel {
  return z >= 1.5 ? 'Far above expectations' : z >= 0.5 ? 'Above expectations' : z > -0.5 ? 'As expected' : z > -1.5 ? 'Below expectations' : 'Far below expectations';
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
function standardize(xs: number[]): number[] {
  const m = mean(xs);
  const sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
  return xs.map((x) => (sd > 1e-9 ? (x - m) / sd : 0));
}

/**
 * What's left of `y` after fitting it on the given columns (least squares, with
 * a constant): how far each point sits from what its ratings predict, in
 * standard deviations.
 */
function residualZ(columns: number[][], y: number[]): number[] {
  const n = y.length;
  if (n < 12) return y.map(() => 0);
  // Centre and scale each column so the equations are well behaved.
  const X = [y.map(() => 1), ...columns.map((c) => standardize(c))];
  const k = X.length;
  const A = X.map((xi) => X.map((xj) => xi.reduce((s, v, r) => s + v * xj[r], 0)));
  const b = X.map((xi) => xi.reduce((s, v, r) => s + v * y[r], 0));
  // Gaussian elimination with pivoting.
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    if (Math.abs(A[c][c]) < 1e-9) return standardize(y);
    for (let r = c + 1; r < k; r++) {
      const f = A[r][c] / A[c][c];
      for (let j = c; j < k; j++) A[r][j] -= f * A[c][j];
      b[r] -= f * b[c];
    }
  }
  const w = new Array<number>(k).fill(0);
  for (let r = k - 1; r >= 0; r--) {
    let v = b[r];
    for (let j = r + 1; j < k; j++) v -= A[r][j] * w[j];
    w[r] = v / A[r][r];
  }
  return standardize(y.map((v, r) => v - X.reduce((s, col, j) => s + w[j] * col[r], 0)));
}

/**
 * Every qualified player's standing for the season in progress (or the one
 * just finished, until the new season's stats begin). Players who haven't
 * played enough aren't listed.
 */
export function seasonPerformance(league: League): Record<PlayerId, SeasonPerformance> {
  return memo(`season-performance:${league.season}:${league.day}:${league.phase}`, () => compute(league));
}

function compute(league: League): Record<PlayerId, SeasonPerformance> {
  const P = PERFORMANCE;
  const out: Record<PlayerId, SeasonPerformance> = {};
  const scale = P.pointsPerSd * slider(league, 'performance');
  const put = (p: Player, z: number, gp: number, full: number) => {
    const zr = Math.round(z * 100) / 100;
    const capped = Math.max(-P.cap, Math.min(P.cap, zr));
    out[p.id] = { z: zr, bonus: Math.round(capped * scale * Math.min(1, gp / full) * 100) / 100, label: performanceLabel(zr), gp };
  };

  // ---- Skaters
  const skaters = Object.values(league.players).filter((p) => {
    const s = league.skaterStats[p.id];
    return p.skater && p.teamId && !league.retired?.[p.id] && s && s.gp >= P.minGames.skater && s.toi / s.gp >= P.minToi;
  });
  // Plus-minus per 60 for each team as a whole, to judge its players against.
  const team: Record<string, { pm: number; toi: number }> = {};
  for (const p of skaters) {
    const s = league.skaterStats[p.id];
    const t = (team[p.teamId!] ??= { pm: 0, toi: 0 });
    t.pm += s.pm;
    t.toi += s.toi;
  }
  for (const g of ['F', 'D'] as const) {
    const group = skaters.filter((p) => (p.pos === 'D') === (g === 'D'));
    if (group.length < 12) continue;
    const scoring = group.map((p) => {
      const s = league.skaterStats[p.id];
      return ((s.g + s.a - (1 - P.ppWeight) * (s.ppg + s.ppa)) / s.toi) * 3600;
    });
    const relPm = group.map((p) => {
      const s = league.skaterStats[p.id];
      const t = team[p.teamId!];
      return (s.pm / s.toi - (t.toi ? t.pm / t.toi : 0)) * 3600;
    });
    // Each half is judged against the ratings that drive it, so a sniper isn't credited for scoring like a sniper
    // or a shutdown defenseman for defending like one: scoring against his offensive ratings (with a curve, since
    // stars' production runs ahead of a straight line), plus-minus against his two-way ratings.
    const off = group.map((p) => offensiveDrive(p.skater!));
    const shot = group.map((p) => p.skater!.shooting);
    const support = group.map((p) => (p.skater!.passing + p.skater!.offIQ) / 2);
    const blend = standardize(off.map((v, i) => (v + shot[i] + support[i]) / 3));
    const zs = residualZ([off, shot, support, blend.map((v) => v * v)], scoring);
    const zr = residualZ([group.map((p) => defensiveDrive(p.skater!)), off], relPm);
    const w = P.scoringShare[g];
    // (…and whatever is left that still tracks overall rating is taken out too.)
    const z = residualZ(
      [group.map((p) => skaterOverall(p.skater!, p.pos))],
      group.map((_, i) => w * zs[i] + (1 - w) * zr[i]),
    );
    group.forEach((p, i) => put(p, z[i], league.skaterStats[p.id].gp, P.fullGames.skater));
  }

  // ---- Goalies
  const goalies = Object.values(league.players).filter((p) => {
    const s = league.goalieStats[p.id];
    return p.goalie && p.teamId && !league.retired?.[p.id] && s && s.gp >= P.minGames.goalie && s.sa > 0;
  });
  if (goalies.length >= 12) {
    const z = residualZ(
      [goalies.map((p) => goalieQuality(p.goalie!))],
      goalies.map((p) => 1 - league.goalieStats[p.id].ga / league.goalieStats[p.id].sa),
    );
    goalies.forEach((p, i) => put(p, z[i], league.goalieStats[p.id].gp, P.fullGames.goalie));
  }
  return out;
}
