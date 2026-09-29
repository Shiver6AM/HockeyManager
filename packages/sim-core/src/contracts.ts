/**
 * Contract money: market value, asking prices, payroll and cap room.
 * Phase 4 replaces fixed asking prices with real negotiation.
 */
import { capHit } from './farm';
import { clamp, deriveSeed, Rng } from './rng';
import { age, overall } from './ratings';
import type { ContractOffer, League, Player, Team } from './types';

export const LEAGUE_MIN_SALARY = 775_000;
export const ELC_SALARY = 950_000;
export const MAX_SALARY = 16_000_000;
/** The cap the salary scale was tuned for; salaries scale with the real cap as it grows. */
export const BASE_CAP = 104_000_000;

/** Salary for a given (effective) overall on the league's pay scale. */
export function salaryScale(eff: number, cap = BASE_CAP): number {
  const t = Math.max(0, (eff - 58) / 34);
  const scale = cap / BASE_CAP;
  return clamp((LEAGUE_MIN_SALARY + 14_500_000 * Math.pow(t, 1.6)) * scale, LEAGUE_MIN_SALARY, MAX_SALARY * scale);
}
export const ROSTER_MAX = 23;
export const PROSPECT_MAX = 20;
/** Roster size allowed during the summer; teams cut to ROSTER_MAX at camp. */
export const SUMMER_ROSTER_MAX = 28;

/** What a player of this quality and age is worth per season. */
export function marketValue(p: Player, season: number, cap = BASE_CAP): number {
  const a = age(p, season);
  const ovr = overall(p);
  // Teams pay a little for upside on young players.
  const upside = a <= 24 ? Math.max(0, p.hidden.potential - ovr) * 0.35 : 0;
  return salaryScale(ovr + upside, cap);
}

const round25k = (x: number) => Math.round(x / 25_000) * 25_000;

/** What the player asks for this summer. Deterministic per player and season. */
export function askingContract(league: League, p: Player, season = league.season): ContractOffer {
  const rng = new Rng(deriveSeed(league.seed, `ask:${season}:${p.id}`));
  const a = age(p, season) + 1; // next season's age
  let salary = marketValue(p, season, league.settings.salaryCap) * (0.88 + 0.3 * p.hidden.personality.greed) * rng.normal(1, 0.05);
  // Restricted free agents have less leverage.
  if (p.contract?.expiresAs === 'RFA') salary *= 0.85;
  const years =
    a <= 22 ? rng.int(2, 3) : a <= 26 ? rng.int(2, 5) : a <= 30 ? rng.int(3, overall(p) >= 80 ? 7 : 5) : a <= 33 ? rng.int(1, 3) : 1;
  return { salary: round25k(clamp(salary, LEAGUE_MIN_SALARY, MAX_SALARY * (league.settings.salaryCap / BASE_CAP))), years };
}

/** The season the cap is being planned for: next season once the offseason starts. */
export function capSeason(league: League): number {
  return league.phase === 'offseason' ? league.season + 1 : league.season;
}

export function deadCapFor(league: League, team: Team, season = capSeason(league)): number {
  return (team.deadCap ?? []).filter((d) => d.fromSeason <= season && season <= d.untilSeason).reduce((s, d) => s + d.amount, 0);
}

export function payroll(league: League, team: Team): number {
  return team.roster.reduce((s, id) => s + capHit(league.players[id]), 0) + deadCapFor(league, team);
}

/**
 * NHL-style buyout: two-thirds of the remaining money (one-third for players
 * under 26), spread over twice the remaining years.
 */
export function buyoutTerms(league: League, p: Player): { perSeason: number; seasons: number; total: number } | null {
  const c = p.contract;
  if (!c) return null;
  // Before re-signing wraps up, the season that just ended is still counted in yearsLeft.
  const beforeRollover = league.phase === 'offseason' && (!league.offseason || league.offseason.stage === 'draft' || league.offseason.stage === 're-sign');
  const remaining = beforeRollover ? c.yearsLeft - 1 : c.yearsLeft;
  if (remaining <= 0) return null;
  const share = age(p, league.season) < 26 ? 1 / 3 : 2 / 3;
  const total = c.salary * remaining * share;
  const seasons = remaining * 2;
  return { perSeason: Math.round(total / seasons / 25_000) * 25_000, seasons, total: Math.round(total) };
}

/**
 * Qualifying-offer tiers (NHL-style), in dollars at the base cap; they scale
 * with the cap. Low salaries get a raise, mid-range salaries a smaller one
 * (never above the upper threshold), and anyone above it is qualified at his
 * current salary.
 */
export const QO_TIERS = { lowMax: 800_000, lowRate: 1.1, midMax: 1_100_000, midRate: 1.05 };

/** Qualifying offer for a restricted free agent: always a one-year deal. */
export function qualifyingOffer(p: Player, league?: League): ContractOffer {
  const scale = league ? league.settings.salaryCap / BASE_CAP : 1;
  const prev = p.contract?.salary ?? LEAGUE_MIN_SALARY;
  const lowMax = QO_TIERS.lowMax * scale;
  const midMax = QO_TIERS.midMax * scale;
  const salary = prev <= lowMax ? prev * QO_TIERS.lowRate : prev <= midMax ? Math.min(prev * QO_TIERS.midRate, midMax) : prev;
  return { salary: Math.max(LEAGUE_MIN_SALARY, round25k(salary)), years: 1 };
}

export function capRoom(league: League, team: Team): number {
  return league.settings.salaryCap - payroll(league, team);
}

export function expiresAsFor(ageNextSeason: number, yearsInLeague: number): 'RFA' | 'UFA' {
  return ageNextSeason >= 27 || yearsInLeague >= 7 ? 'UFA' : 'RFA';
}
