/**
 * Player development over the summer: young players grow toward their
 * hidden potential (faster with real ice time), veterans decline (speed
 * first, hockey sense last), and some players surprise in either direction.
 * Also decides who retires.
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
  noise: 1.4,
  breakoutChance: 0.04,
  bustChance: 0.04,
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
}

function usageFactor(p: Player, u: Usage): number {
  if (!u.onRoster) return 1.0; // juniors/minors: big minutes at a lower level
  if (p.pos === 'G') return u.gp >= 30 ? 1.15 : u.gp >= 12 ? 1.0 : 0.85;
  if (u.gp >= 40 && u.toi >= 15) return 1.15;
  if (u.gp >= 20) return 1.0;
  return 0.85;
}

/** Change a player's ratings for one summer. Returns [overall before, after]. */
export function developPlayer(league: League, p: Player, u: Usage): [number, number] {
  const rng = new Rng(deriveSeed(league.seed, `dev:${league.season}:${p.id}`));
  const T = DEV_TUNING;
  const before = overall(p);
  const newAge = age(p, league.season) + 1;
  const effAge = newAge - (p.pos === 'G' ? T.goalieAgeShift : 0);

  const rate = effAge <= 18 ? T.growth[18] : (T.growth[effAge] ?? 0);
  let delta = Math.max(0, p.hidden.potential - before) * rate * usageFactor(p, u) * coachDevMultiplier(league, p.teamId ?? p.prospectOf) * slider(league, 'development');
  if (effAge >= T.declineStart) delta -= (T.declineBase + (effAge - T.declineStart) * T.declinePerYear) * slider(league, 'aging');
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
  return [before, after];
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
