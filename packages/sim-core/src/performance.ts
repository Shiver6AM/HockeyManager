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
 * Skaters are compared within their position (centers, wingers, defensemen)
 * on several parts of the game, each per 60 minutes and each against the
 * ratings that drive it and the minutes he plays a night (top-line minutes come
 * with better linemates and power-play time, so more is expected per 60):
 * scoring (power-play points counted for less), goals, assists, plus-minus
 * relative to his own team (so a good team's record isn't credited to everyone
 * on it), hits and blocks, discipline, and faceoffs for centers. How much each
 * part counts depends on his type: a sniper is judged mostly on scoring goals,
 * a playmaker on setting them up, a shutdown defenseman on keeping them out, a
 * grinder or enforcer on two-way and physical play (ROLE_WEIGHTS). Goalies are
 * judged on save percentage.
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
  /** Faceoffs taken for faceoffs to count. */
  minFaceoffs: 150,
};

export type PartKey = 'scoring' | 'goals' | 'assists' | 'defense' | 'physical' | 'faceoffs' | 'discipline';
const PART_KEYS: PartKey[] = ['scoring', 'goals', 'assists', 'defense', 'physical', 'faceoffs', 'discipline'];
const PART_LABEL: Record<PartKey | 'saves', string> = {
  scoring: 'Scoring',
  goals: 'Goal scoring',
  assists: 'Playmaking',
  defense: 'Two-way play (+/- vs team)',
  physical: 'Hits and blocks',
  faceoffs: 'Faceoffs',
  discipline: 'Discipline',
  saves: 'Save %',
};

export interface PerformancePart {
  key: PartKey | 'saves';
  label: string;
  /** Standard deviations above or below what his ratings and minutes predict. */
  z: number;
  /** Its share of his season's verdict. */
  weight: number;
}

type Weights = Partial<Record<PartKey, number>>;
/**
 * What a season is judged on, by player type: a sniper on scoring goals, a playmaker
 * on setting them up, a shutdown defenseman mostly on keeping them out, a grinder or
 * enforcer on two-way play and physical work more than points.
 */
export const ROLE_WEIGHTS: Record<string, Weights> = {
  forward: { scoring: 0.55, goals: 0.1, assists: 0.05, defense: 0.2, physical: 0.05, discipline: 0.05 },
  Sniper: { scoring: 0.35, goals: 0.3, assists: 0.05, defense: 0.2, physical: 0.05, discipline: 0.05 },
  Playmaker: { scoring: 0.35, goals: 0.05, assists: 0.3, defense: 0.2, physical: 0.05, discipline: 0.05 },
  'Power Forward': { scoring: 0.4, goals: 0.1, defense: 0.2, physical: 0.25, discipline: 0.05 },
  'Two-Way': { scoring: 0.3, goals: 0.05, assists: 0.05, defense: 0.45, physical: 0.1, discipline: 0.05 },
  Speedster: { scoring: 0.55, goals: 0.1, assists: 0.05, defense: 0.2, physical: 0.05, discipline: 0.05 },
  Grinder: { scoring: 0.15, defense: 0.4, physical: 0.35, discipline: 0.1 },
  Enforcer: { scoring: 0.1, defense: 0.3, physical: 0.4, discipline: 0.2 },
  Generational: { scoring: 0.6, goals: 0.1, assists: 0.1, defense: 0.15, discipline: 0.05 },
  defense: { scoring: 0.35, assists: 0.05, defense: 0.45, physical: 0.1, discipline: 0.05 },
  'Offensive D': { scoring: 0.55, goals: 0.05, assists: 0.1, defense: 0.25, discipline: 0.05 },
  'Shutdown D': { scoring: 0.1, defense: 0.55, physical: 0.3, discipline: 0.05 },
  'Two-Way D': { scoring: 0.35, assists: 0.05, defense: 0.45, physical: 0.1, discipline: 0.05 },
};
/** Centers are judged on faceoffs too (this share, taken evenly from the rest). */
const CENTER_FACEOFFS = 0.12;

/** A season's parts for keeping with the summer's report: each part's standing (one decimal), in PART_KEYS order. */
export function packParts(parts: PerformancePart[]): Array<number | null> | undefined {
  if (parts.some((x) => x.key === 'saves')) return undefined;
  return PART_KEYS.map((k) => {
    const x = parts.find((y) => y.key === k);
    return x ? Math.round(x.z * 10) / 10 : null;
  });
}

/** …and back, with his type's weights. */
export function unpackParts(p: Pick<Player, 'pos' | 'archetype'>, z: number, packed: Array<number | null> | undefined): PerformancePart[] {
  if (p.pos === 'G') return [{ key: 'saves', label: PART_LABEL.saves, z, weight: 1 }];
  if (!packed) return [];
  const w = roleWeights(p);
  const shown = PART_KEYS.filter((k, i) => w[k] && packed[i] !== null && packed[i] !== undefined);
  const tot = shown.reduce((a, k) => a + w[k]!, 0);
  return shown.map((k) => ({ key: k, label: PART_LABEL[k], z: packed[PART_KEYS.indexOf(k)]!, weight: Math.round((w[k]! / tot) * 100) / 100 }));
}

/** C, W or D. */
export const posGroup = (p: Pick<Player, 'pos'>) => (p.pos === 'D' ? 'D' : p.pos === 'C' ? 'C' : 'W');

/** The weights his season is judged on: his type's, by position, with faceoffs for centers. */
export function roleWeights(p: Pick<Player, 'pos' | 'archetype'>): Weights {
  const base = p.archetype === 'Generational' && p.pos === 'D' ? ROLE_WEIGHTS['Offensive D'] : (ROLE_WEIGHTS[p.archetype] ?? ROLE_WEIGHTS[p.pos === 'D' ? 'defense' : 'forward']);
  // (A defenseman's weights for a forward type, or the reverse, after a position change.)
  const fits = (p.pos === 'D') === (p.archetype in { 'Offensive D': 1, 'Shutdown D': 1, 'Two-Way D': 1 }) || p.archetype === 'Generational';
  const w: Weights = { ...(fits ? base : ROLE_WEIGHTS[p.pos === 'D' ? 'defense' : 'forward']) };
  if (p.pos === 'C') {
    for (const k of PART_KEYS) if (w[k]) w[k] = w[k]! * (1 - CENTER_FACEOFFS);
    w.faceoffs = CENTER_FACEOFFS;
  }
  return w;
}

export type PerformanceLabel = 'Far above expectations' | 'Above expectations' | 'As expected' | 'Below expectations' | 'Far below expectations';

export interface SeasonPerformance {
  /** Standard deviations above (+) or below (−) what his rating predicts. */
  z: number;
  /** What it adds to this summer's development, in overall points. */
  bonus: number;
  label: PerformanceLabel;
  gp: number;
  /** What it was judged on: each part's standing and its share of the verdict. */
  parts: PerformancePart[];
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
  const put = (p: Player, z: number, gp: number, full: number, parts: PerformancePart[]) => {
    const zr = Math.round(z * 100) / 100;
    const capped = Math.max(-P.cap, Math.min(P.cap, zr));
    out[p.id] = { z: zr, bonus: Math.round(capped * scale * Math.min(1, gp / full) * 100) / 100, label: performanceLabel(zr), gp, parts };
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
  for (const g of ['C', 'W', 'D'] as const) {
    const group = skaters.filter((p) => posGroup(p) === g);
    if (group.length < 12) continue;
    const st = group.map((p) => league.skaterStats[p.id]);
    const per60 = (f: (s: (typeof st)[number]) => number) => st.map((s) => (f(s) / s.toi) * 3600);
    // Minutes a night: top-line players get better linemates and power-play time, so they're expected to produce
    // more per 60 than the same player on the fourth line. Every part is judged with his minutes in the picture.
    const toi = st.map((s) => s.toi / s.gp / 60);
    const r = (k: keyof NonNullable<Player['skater']>) => group.map((p) => p.skater![k]);
    const off = group.map((p) => offensiveDrive(p.skater!));
    const def = group.map((p) => defensiveDrive(p.skater!));
    const support = group.map((p) => (p.skater!.passing + p.skater!.offIQ) / 2);
    const blend = standardize(off.map((v, i) => (v + r('shooting')[i] + support[i]) / 3));
    // Each part is judged against the ratings that drive it, so a sniper isn't credited for scoring like a sniper
    // or a shutdown defenseman for defending like one (scoring with a curve, since stars' production runs ahead of a straight line).
    const parts: Record<PartKey, number[]> = {
      scoring: residualZ([off, r('shooting'), support, blend.map((v) => v * v), toi], per60((s) => s.g + s.a - (1 - P.ppWeight) * (s.ppg + s.ppa))),
      goals: residualZ([r('shooting'), r('offIQ'), r('handling'), toi], per60((s) => s.g - (1 - P.ppWeight) * s.ppg)),
      assists: residualZ([r('passing'), r('offIQ'), r('handling'), toi], per60((s) => s.a - (1 - P.ppWeight) * s.ppa)),
      defense: residualZ(
        [def, off, toi],
        group.map((p, i) => {
          const t = team[p.teamId!];
          return (st[i].pm / st[i].toi - (t.toi ? t.pm / t.toi : 0)) * 3600;
        }),
      ),
      physical: residualZ([r('checking'), r('defIQ'), toi], per60((s) => s.hits + 1.5 * s.blk)),
      // (Taking few penalties is the good direction.)
      discipline: residualZ([r('discipline'), r('checking'), toi], per60((s) => -s.pim)),
      faceoffs: (() => {
        const ok = st.map((s) => s.fow + s.fol >= P.minFaceoffs);
        const idx = st.map((_, i) => i).filter((i) => ok[i]);
        const z = residualZ([idx.map((i) => group[i].skater!.faceoffs), idx.map((i) => toi[i])], idx.map((i) => st[i].fow / (st[i].fow + st[i].fol)));
        const out = st.map(() => Number.NaN);
        idx.forEach((i, k) => (out[i] = z[k]));
        return out;
      })(),
    };
    const blendZ = group.map((p, i) => {
      const w = roleWeights(p);
      let sum = 0;
      let tot = 0;
      for (const k of PART_KEYS) {
        const v = parts[k][i];
        if (!w[k] || !Number.isFinite(v)) continue;
        sum += w[k]! * v;
        tot += w[k]!;
      }
      return tot ? sum / tot : 0;
    });
    // (…and whatever is left that still tracks overall rating is taken out too.)
    const z = residualZ([group.map((p) => skaterOverall(p.skater!, p.pos))], blendZ);
    group.forEach((p, i) => {
      const w = roleWeights(p);
      const shown = PART_KEYS.filter((k) => w[k] && Number.isFinite(parts[k][i]));
      const tot = shown.reduce((a, k) => a + w[k]!, 0);
      put(p, z[i], st[i].gp, P.fullGames.skater, shown.map((k) => ({ key: k, label: PART_LABEL[k], z: Math.round(parts[k][i] * 100) / 100, weight: Math.round((w[k]! / tot) * 100) / 100 })));
    });
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
    goalies.forEach((p, i) => put(p, z[i], league.goalieStats[p.id].gp, P.fullGames.goalie, [{ key: 'saves', label: 'Save %', z: z[i], weight: 1 }]));
  }
  return out;
}
