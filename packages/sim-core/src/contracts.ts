/**
 * Contract money: market value, asking prices, payroll and cap room.
 * Phase 4 replaces fixed asking prices with real negotiation.
 */
import { clamp, deriveSeed, Rng } from './rng';
import { age, overall } from './ratings';
import type { ContractOffer, League, Player, Team } from './types';

export const LEAGUE_MIN_SALARY = 775_000;
export const ELC_SALARY = 950_000;
export const MAX_SALARY = 14_500_000;
export const ROSTER_MAX = 23;
export const PROSPECT_MAX = 20;

/** What a player of this quality and age is worth per season. */
export function marketValue(p: Player, season: number): number {
  const a = age(p, season);
  const ovr = overall(p);
  // Teams pay a little for upside on young players.
  const upside = a <= 24 ? Math.max(0, p.hidden.potential - ovr) * 0.35 : 0;
  const eff = ovr + upside;
  const t = Math.max(0, (eff - 58) / 34);
  return clamp(LEAGUE_MIN_SALARY + 12_500_000 * Math.pow(t, 2.2), LEAGUE_MIN_SALARY, MAX_SALARY);
}

const round25k = (x: number) => Math.round(x / 25_000) * 25_000;

/** What the player asks for this summer. Deterministic per player and season. */
export function askingContract(league: League, p: Player, season = league.season): ContractOffer {
  const rng = new Rng(deriveSeed(league.seed, `ask:${season}:${p.id}`));
  const a = age(p, season) + 1; // next season's age
  let salary = marketValue(p, season) * (0.88 + 0.3 * p.hidden.personality.greed) * rng.normal(1, 0.05);
  // Restricted free agents have less leverage.
  if (p.contract?.expiresAs === 'RFA') salary *= 0.85;
  const years =
    a <= 22 ? rng.int(2, 3) : a <= 26 ? rng.int(2, 5) : a <= 30 ? rng.int(3, overall(p) >= 80 ? 7 : 5) : a <= 33 ? rng.int(1, 3) : 1;
  return { salary: round25k(clamp(salary, LEAGUE_MIN_SALARY, MAX_SALARY)), years };
}

export function payroll(league: League, team: Team): number {
  return team.roster.reduce((s, id) => s + (league.players[id].contract?.salary ?? 0), 0);
}

export function capRoom(league: League, team: Team): number {
  return league.settings.salaryCap - payroll(league, team);
}

export function expiresAsFor(ageNextSeason: number, yearsInLeague: number): 'RFA' | 'UFA' {
  return ageNextSeason >= 27 || yearsInLeague >= 7 ? 'UFA' : 'RFA';
}
