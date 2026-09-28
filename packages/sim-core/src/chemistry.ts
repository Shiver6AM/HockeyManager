/**
 * Line chemistry and slot fit.
 *
 * Two things make a line more than the sum of its ratings:
 * - **Complementary styles.** A forward line wants a playmaker, a finisher and
 *   someone who goes to the net or wins pucks back; three snipers step on each
 *   other's toes. A defense pair wants a puck mover and a stay-at-home partner.
 * - **Familiarity.** Linemates who keep playing together read each other
 *   better. It builds over roughly 15 games and fades when a line is broken up.
 *
 * Slot fit is the same idea on special teams: how well a player suits his
 * spot compared with his own other skills (a sniper on the flank, not in front
 * of the net), so the same five players do better in the right spots.
 *
 * Every effect is a rating adjustment for the players on the ice, centred so
 * that a typical line is neutral and league scoring stays calibrated.
 */
import { roleSkill, roleSkills, type Role, type Slot } from './systems';
import type { Player, PlayerId, Team } from './types';

export const CHEMISTRY = {
  /** Rating points per point of style complementarity above a typical line. */
  styleK: 0.25,
  /** Typical complementarity (sum of best specialist edges), measured on generated rosters. */
  styleCenterF: 19.8,
  styleCenterD: 12.3,
  /** Rating points for a fully familiar line vs a typical one, and for a brand new one. */
  famMax: 1.2,
  famNew: -1.2,
  /** Games together to become fully familiar, and the typical familiarity (neutral). */
  famGames: 15,
  famCenter: 0.6,
  /** Cap on the total chemistry adjustment, in rating points. */
  cap: 3.5,
  /** Rating points per point of slot edge (player's skill at the slot minus his own average). */
  slotK: 0.75,
  slotCap: 6,
  /** Typical edge of a well-placed player, by situation (so good placement is neutral). */
  slotCenter: { pp: 6.4, pk: 4.5, ev: 6.1 },
  /**
   * Typical spread (sd) of a player's skills across a situation's roles. A
   * player's baseline edge scales with his own spread, so specialists gain in
   * their spots and lose outside them, while all-rounders are fine anywhere.
   */
  slotSdRef: { pp: 5.17, pk: 4.83, ev: 5.52 },
};

export const F_JOBS: Role[][] = [['halfWall'], ['oneTimer', 'bumper'], ['netFront', 'forecheck']];
export const D_JOBS: Role[][] = [['point', 'transition'], ['pkDefense']];
export const F_STYLE: Role[] = ['netFront', 'bumper', 'halfWall', 'oneTimer', 'forecheck', 'transition'];
export const D_STYLE: Role[] = ['point', 'transition', 'pkDefense'];

/** A player's skill at a role minus his own average over a set of roles (his relative strength). */
export function roleEdge(p: Player, role: Role, over: Role[]): number {
  let m = 0;
  for (const r of over) m += roleSkill(p, r);
  return roleSkill(p, role) - m / over.length;
}

/**
 * How well a unit's styles complement each other: for each job, the best edge
 * any member has at it. Higher is better; three identical players score low.
 */
export function styleComplement(players: Player[], defense: boolean): number {
  const jobs = defense ? D_JOBS : F_JOBS;
  const over = defense ? D_STYLE : F_STYLE;
  let total = 0;
  for (const job of jobs) {
    let best = -Infinity;
    for (const p of players) for (const r of job) best = Math.max(best, roleEdge(p, r, over));
    total += best;
  }
  return total;
}

export const unitKey = (ids: PlayerId[]) => [...ids].sort().join('|');

/** Familiarity 0 (never together) … 1 (fully familiar). */
export function familiarity(team: Team, ids: PlayerId[]): number {
  const games = team.chemistry?.[unitKey(ids)] ?? 0;
  return Math.min(1, games / CHEMISTRY.famGames);
}

export interface Chemistry {
  /** Total rating adjustment for the unit. */
  total: number;
  style: number;
  familiarity: number;
  /** 0–1 familiarity, for display. */
  fam: number;
}

/** Chemistry of a forward line or defense pair. */
export function unitChemistry(team: Team, players: Player[], defense: boolean): Chemistry {
  const C = CHEMISTRY;
  const center = defense ? C.styleCenterD : C.styleCenterF;
  const style = C.styleK * (styleComplement(players, defense) - center);
  const fam = familiarity(team, players.map((p) => p.id));
  // Linear from famNew (0 games) to famMax (fully familiar), then shifted so typical familiarity is neutral.
  const at = (x: number) => C.famNew + (C.famMax - C.famNew) * x;
  const famAdj = at(fam) - at(C.famCenter);
  const total = Math.max(-C.cap, Math.min(C.cap, style + famAdj));
  return { total, style, familiarity: famAdj, fam };
}

/**
 * After a game: every forward line and pair that dressed together gains a game
 * of familiarity; combinations that didn't play fade.
 */
export function recordChemistry(team: Team) {
  const chem = (team.chemistry ??= {});
  const used = new Set([...team.lines.forwards, ...team.lines.defense].map(unitKey));
  for (const k of used) chem[k] = Math.min(CHEMISTRY.famGames * 2, (chem[k] ?? 0) + 1);
  for (const k of Object.keys(chem)) {
    if (used.has(k)) continue;
    chem[k] -= 2;
    if (chem[k] <= 0) delete chem[k];
  }
}

/** Roles a slot competes against when judging a player's fit for it. */
export const SLOT_BASIS: Record<'pp' | 'pk' | 'ev', Role[]> = {
  pp: ['point', 'halfWall', 'oneTimer', 'bumper', 'netFront'],
  pk: ['pkForward', 'pkDefense'],
  ev: ['netFront', 'bumper', 'halfWall', 'oneTimer', 'point', 'transition'],
};

/**
 * Rating adjustment for a player in a special-teams slot: his edge at the
 * slot's role over his own average at that situation's roles, minus the edge a
 * well-placed player typically has (so good placement is neutral and poor
 * placement costs).
 */
export function slotBonus(p: Player, slot: Slot, situation: keyof typeof SLOT_BASIS): number {
  return slotBonusOf(roleSkills(p), slot, situation);
}

/** The same, from a precomputed role-skill table (the game engine's hot path). */
export function slotBonusOf(roles: Record<Role, number>, slot: Slot, situation: keyof typeof SLOT_BASIS): number {
  const C = CHEMISTRY;
  const basis = SLOT_BASIS[situation];
  let m = 0;
  for (const r of basis) m += roles[r];
  m /= basis.length;
  let v2 = 0;
  for (const r of basis) v2 += (roles[r] - m) ** 2;
  const spread = Math.max(0.3, Math.min(2, Math.sqrt(v2 / basis.length) / C.slotSdRef[situation]));
  const v = C.slotK * (roles[slot.role] - m - C.slotCenter[situation] * spread);
  return Math.max(-C.slotCap, Math.min(C.slotCap, v));
}

/**
 * Arrange a unit's players across its spots so each plays to his strengths
 * (the sum of slot edges is highest). Tries every arrangement (units are 3–6).
 */
export function arrangeUnit(players: Player[], slots: Slot[], basis: Role[]): Player[] {
  const n = players.length;
  // Score of each player in each spot, computed once.
  const score = players.map((p) => {
    const roles = roleSkills(p);
    let m = 0;
    for (const r of basis) m += roles[r];
    m /= basis.length;
    return slots.map((sl) => (sl ? roles[sl.role] - m + 0.01 * roles[sl.role] : 0));
  });
  const idx = players.map((_, i) => i);
  let best = [...idx];
  let bestScore = -Infinity;
  const permute = (k: number, acc: number) => {
    if (k === n) {
      if (acc > bestScore) {
        bestScore = acc;
        best = [...idx];
      }
      return;
    }
    for (let i = k; i < n; i++) {
      [idx[k], idx[i]] = [idx[i], idx[k]];
      permute(k + 1, acc + (k < slots.length ? score[idx[k]][k] : 0));
      [idx[k], idx[i]] = [idx[i], idx[k]];
    }
  };
  permute(0, 0);
  return best.map((i) => players[i]);
}
