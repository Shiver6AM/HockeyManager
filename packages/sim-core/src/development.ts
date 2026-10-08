/**
 * Player development: young players grow toward their hidden potential (faster
 * with real ice time), veterans decline (speed first, hockey sense last), and
 * some players surprise in either direction. Also decides who retires.
 *
 * A year's development arrives in two parts. Through the regular season a
 * share of it trickles in day by day, one rating point at a time
 * (`developmentDay`). The summer delivers the rest, along with everything that
 * depends on how the season went: the ice-time bonus or penalty, the random
 * swing, breakouts and busts (`developPlayer`). The two add up to what a
 * summer alone used to give.
 */
import { clamp, deriveSeed, Rng } from './rng';
import { age, ARCHETYPE_CEILING, goalieQuality, overall, skaterOverall } from './ratings';
import { coachDevMultiplier } from './staff';
import type { GoalieRatings, League, Player, SkaterRatings } from './types';
import { slider } from './sliders';

export const DEV_TUNING = {
  /** Share of the gap to potential closed per year, by (effective) age. */
  growth: { 18: 0.3, 19: 0.3, 20: 0.28, 21: 0.26, 22: 0.24, 23: 0.21, 24: 0.17, 25: 0.13, 26: 0.1, 27: 0.06 } as Record<number, number>,
  /** Decline in overall points per year starts at this age... */
  declineStart: 30,
  declineBase: 0.6,
  declinePerYear: 0.55,
  /** The summer's random swing (sd, overall points). (Was 1.4 before season performance took over part of it.) */
  noise: 1.25,
  breakoutChance: 0.04,
  bustChance: 0.04,
  /** Share of a year's expected growth and decline that arrives during the regular season. */
  inSeasonShare: 0.5,
  /** Goalies develop and decline later. */
  goalieAgeShift: 2,
};

type SkaterKey = keyof SkaterRatings;
type GoalieKey = keyof GoalieRatings;

const SKATER_GROWTH: Record<SkaterKey, number> = {
  skating: 1.0, shooting: 1.0, passing: 1.0, handling: 1.0, offIQ: 1.0, defIQ: 1.05, checking: 1.0, faceoffs: 0.8, discipline: 0, endurance: 0.9,
};
const SKATER_DECLINE: Record<SkaterKey, number> = {
  skating: 1.5, shooting: 1.0, passing: 0.7, handling: 1.1, offIQ: 0.5, defIQ: 0.5, checking: 0.9, faceoffs: 0.3, discipline: 0, endurance: 1.4,
};
const GOALIE_GROWTH: Record<GoalieKey, number> = { reflexes: 1.0, positioning: 1.1, rebounds: 1.0, mental: 1.0 };
const GOALIE_DECLINE: Record<GoalieKey, number> = { reflexes: 1.5, positioning: 0.6, rebounds: 0.9, mental: 0.5 };

export interface Usage {
  /** Regular-season games played this season (0 for juniors/minors). */
  gp: number;
  /** Average TOI in minutes (skaters). */
  toi: number;
  onRoster: boolean;
  /** How his season went against expectations, in overall points (see performance.ts). */
  performance?: number;
}

function usageFactor(p: Player, u: Usage): number {
  if (!u.onRoster) return 1.0; // juniors/minors: big minutes at a lower level
  if (p.pos === 'G') return u.gp >= 30 ? 1.15 : u.gp >= 12 ? 1.0 : 0.85;
  if (u.gp >= 40 && u.toi >= 15) return 1.15;
  if (u.gp >= 20) return 1.0;
  return 0.85;
}

/**
 * What a year should bring a player whose overall was `start` when it began:
 * growth toward his potential (before the ice-time factor) and decline with age,
 * in overall points.
 */
function yearPlan(league: League, p: Player, start: number): { growth: number; decline: number; newAge: number; effAge: number } {
  const T = DEV_TUNING;
  const newAge = age(p, league.season) + 1;
  const effAge = newAge - (p.pos === 'G' ? T.goalieAgeShift : 0);
  const rate = effAge <= 18 ? T.growth[18] : (T.growth[effAge] ?? 0);
  let growth = Math.max(0, p.hidden.potential - start) * rate * coachDevMultiplier(league, p.teamId ?? p.prospectOf) * slider(league, 'development');
  // Late bloomers (sleepers) grow fast once they get going.
  if (p.hidden.sleeper && newAge <= 23) growth *= 1.8;
  const decline = effAge >= T.declineStart ? (T.declineBase + (effAge - T.declineStart) * T.declinePerYear) * slider(league, 'aging') : 0;
  return { growth, decline, newAge, effAge };
}

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

/**
 * One regular-season day of natural development for everyone still playing:
 * NHL rosters, farm teams, prospects and free agents alike. Each player is owed
 * a share of his year's growth (or decline) spread evenly over the season; when
 * a whole rating point has built up, one of his ratings moves by one.
 */
export function developmentDay(league: League, seasonDays: number) {
  const T = DEV_TUNING;
  if (seasonDays <= 0 || T.inSeasonShare <= 0) return;
  for (const p of Object.values(league.players)) {
    if (league.retired?.[p.id] || p.draftClass !== undefined) continue;
    let ds = p.devSeason?.season === league.season ? p.devSeason : null;
    const plan = yearPlan(league, p, ds ? ds.start : overallFloat(p));
    const perDay = ((plan.growth - plan.decline) * T.inSeasonShare) / seasonDays;
    if (!ds) {
      if (perDay === 0) continue; // (mid-career: nothing to track)
      ds = p.devSeason = { season: league.season, start: r4(overallFloat(p)), applied: 0, carry: 0 };
    }
    if (perDay === 0) continue;
    const growing = perDay > 0;
    const ratings = (p.skater ?? p.goalie) as unknown as Record<string, number>;
    const weights = (p.skater ? (growing ? SKATER_GROWTH : SKATER_DECLINE) : growing ? GOALIE_GROWTH : GOALIE_DECLINE) as Record<string, number>;
    // The summer moves every rating by about the same amount; here that amount arrives one rating at a time.
    let sumW = 0;
    for (const k in weights) sumW += weights[k];
    let carry = ds.carry + perDay * sumW;
    if (Math.abs(carry) >= 1) {
      const rng = new Rng(deriveSeed(league.seed, `dev-day:${league.season}:${league.day}:${p.id}`));
      while (Math.abs(carry) >= 1) {
        const up = carry > 0;
        const keys = Object.keys(weights).filter((k) => weights[k] > 0 && (up ? ratings[k] < 99 : ratings[k] > 20));
        if (!keys.length) {
          carry = 0;
          break;
        }
        const k = keys[rng.weighted(keys.map((x) => weights[x]))];
        const was = overallFloat(p);
        ratings[k] += up ? 1 : -1;
        ds.applied = r4(ds.applied + overallFloat(p) - was);
        carry -= up ? 1 : -1;
      }
    }
    ds.carry = r4(carry);
  }
}

/**
 * Change a player's ratings for one summer: the rest of the year's development
 * after what arrived during the season. Returns [overall when the season began, after].
 */
export function developPlayer(league: League, p: Player, u: Usage): [number, number] {
  const rng = new Rng(deriveSeed(league.seed, `dev:${league.season}:${p.id}`));
  const T = DEV_TUNING;
  const before = overall(p);
  // What already arrived during the season (nothing, for a league or a player that didn't play one).
  const applied = p.devSeason?.season === league.season ? p.devSeason.applied : 0;
  const yearStart = p.devSeason?.season === league.season ? Math.round(p.devSeason.start) : before;
  delete p.devSeason;
  const { growth, decline, newAge, effAge } = yearPlan(league, p, before - applied);

  // The whole year's development, with the ice-time factor now that the season is known, less what he already has.
  let delta = growth * usageFactor(p, u) - decline - applied;
  // A strong season adds to it and a poor one takes away: growth for the young, a gentler or steeper slide for veterans.
  // It bends the path he was on; it doesn't lay a new one. A strong season can't carry a young player past his
  // potential or make a veteran better than he was (at most half a point either way), so a player who lands in a
  // good spot year after year doesn't climb without limit.
  let perf = u.performance ?? 0;
  if (perf > 0) {
    const room = effAge >= 28 ? decline : Math.max(0, p.hidden.potential - (before + delta));
    perf = Math.min(perf, room + 0.5);
  }
  delta += perf;
  delta += rng.normal(0, T.noise);
  if (effAge <= 24 && rng.chance(T.breakoutChance)) {
    delta += rng.int(3, 6);
    p.hidden.potential += rng.int(2, 5);
    const cap = ARCHETYPE_CEILING[p.archetype];
    if (cap !== undefined) p.hidden.potential = Math.min(p.hidden.potential, Math.max(before, cap + 3));
  } else if (effAge <= 24 && rng.chance(T.bustChance)) {
    delta -= rng.int(2, 5);
    p.hidden.potential -= rng.int(3, 6);
  }

  const growing = delta >= 0;
  const ratings = (p.skater ?? p.goalie) as unknown as Record<string, number>;
  const weights = (p.skater ? (growing ? SKATER_GROWTH : SKATER_DECLINE) : growing ? GOALIE_GROWTH : GOALIE_DECLINE) as Record<string, number>;
  for (const k in ratings) {
    if (k === 'discipline') {
      // Players settle down with age.
      if (newAge <= 30) ratings[k] = Math.round(clamp(ratings[k] + rng.normal(0.4, 1), 25, 99));
      continue;
    }
    ratings[k] = clamp(ratings[k] + delta * weights[k] + rng.normal(0, 0.8), 20, 99);
  }
  // Correct so the overall moves by (about) delta, then round.
  const target = before + delta;
  for (let i = 0; i < 3; i++) {
    const diff = target - overallFloat(p);
    for (const k in ratings) if (k !== 'discipline') ratings[k] = clamp(ratings[k] + diff, 20, 99);
  }
  for (const k in ratings) ratings[k] = Math.round(ratings[k]);

  const after = overall(p);
  if (effAge >= 27) p.hidden.potential = Math.max(after, Math.min(p.hidden.potential, after + 1));
  else p.hidden.potential = Math.round(Math.max(after, p.hidden.potential + rng.normal(0, 1.2)));
  p.hidden.potential = Math.min(99, p.hidden.potential);
  return [yearStart, after];
}

function overallFloat(p: Player): number {
  return p.skater ? skaterOverall(p.skater, p.pos) : goalieQuality(p.goalie!);
}

/** Probability this player hangs up the skates this summer. */
/**
 * Chance a player retires this summer. Age drives it, but so does whether he
 * can still play: a serviceable veteran keeps going (elite ones into their
 * 40s), a fading one hangs them up early, and every so often someone walks
 * away young for his own reasons.
 */
export function retirementChance(p: Player, newAge: number, signed: boolean): number {
  const effAge = newAge - (p.pos === 'G' ? 1 : 0);
  const ovr = overall(p);
  if (!signed && newAge >= 28 && ovr < 56) return 0.6; // career ends in the minors
  if (effAge >= 44) return 1;
  let base: number;
  if (effAge < 29) base = 0.002;
  else if (effAge < 32) base = 0.006;
  else if (effAge === 32) base = 0.03;
  else base = 0.05 + (effAge - 33) * 0.11 + (effAge >= 40 ? 0.15 : 0);
  // How far above (or below) a replacement-level player he is, in tens of rating points.
  const serviceable = (ovr - 66) / 10;
  let pr = base * Math.exp(-0.9 * serviceable);
  if (!signed && effAge >= 30) pr += 0.25;
  if (effAge >= 41) pr = Math.max(pr, 0.3);
  return clamp(pr, 0, 0.97);
}
