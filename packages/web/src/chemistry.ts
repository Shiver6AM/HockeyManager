/**
 * Live chemistry and spot fit for the lines editor. Mirrors sim-core's
 * chemistry.ts using the constants the server sends, so what you see while
 * dragging players around is what the game will use.
 */
import type { Outputs } from './trpc';

type TeamData = Outputs['data']['team'];
type Chem = TeamData['systems']['chemistry'];
type Roles = Record<string, number>;
export type Basis = 'pp' | 'pk' | 'ev';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

export function roleEdge(roles: Roles, role: string, over: string[]): number {
  return roles[role] - mean(over.map((r) => roles[r]));
}

export function styleComplement(units: Roles[], defense: boolean, C: Chem): number {
  const jobs = defense ? C.jobsD : C.jobsF;
  const over = defense ? C.styleD : C.styleF;
  let total = 0;
  for (const job of jobs) {
    let best = -Infinity;
    for (const r of units) for (const role of job) best = Math.max(best, roleEdge(r, role, over));
    total += best;
  }
  return total;
}

export const unitKey = (ids: string[]) => [...ids].sort().join('|');

export interface LiveChem {
  total: number;
  style: number;
  familiarity: number;
  settled: number;
}

export function lineChemistry(ids: string[], roles: Roles[], defense: boolean, games: Record<string, number>, C: Chem): LiveChem {
  const style = C.styleK * (styleComplement(roles, defense, C) - (defense ? C.styleCenterD : C.styleCenterF));
  const settled = Math.min(1, (games[unitKey(ids)] ?? 0) / C.famGames);
  const at = (x: number) => C.famNew + (C.famMax - C.famNew) * x;
  const familiarity = at(settled) - at(C.famCenter);
  const total = Math.max(-C.cap, Math.min(C.cap, style + familiarity));
  return { total, style, familiarity, settled };
}

/** Rating points a player gains or loses in a special-unit spot (0 = a typical well-placed player). */
export function spotBonus(roles: Roles, role: string, basis: Basis, C: Chem): number {
  const over = C.basis[basis];
  const m = mean(over.map((r) => roles[r]));
  const sd = Math.sqrt(mean(over.map((r) => (roles[r] - m) ** 2)));
  // Specialists gain in their spots and lose outside them; all-rounders are fine anywhere.
  const spread = Math.max(0.3, Math.min(2, sd / C.slotSdRef[basis]));
  const v = C.slotK * (roles[role] - m - C.slotCenter[basis] * spread);
  return Math.max(-C.slotCap, Math.min(C.slotCap, v));
}

/** White (costs him) → green (plays to his strengths), for a rating adjustment in points. */
export function bonusColor(b: number, range = 6): { bg: string; fg: string } {
  const t = Math.max(0, Math.min(1, (b + range) / (2 * range)));
  return {
    bg: `hsl(142 ${Math.round(12 + 58 * t)}% ${Math.round(95 - 50 * t)}%)`,
    fg: t > 0.78 ? '#ffffff' : '#0b1220',
  };
}

export const signed1 = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;
