/**
 * Role skills and team systems.
 *
 * Role skills are how good a player is at a specific job (net front, the half
 * wall on a power play, killing penalties…). They're derived from his ratings,
 * his playing style (a power forward is built for the net front and the
 * forecheck; an offensive defenseman for the point) and a small personal quirk
 * that's stable for his career. They move with his development automatically.
 *
 * Team systems are the coach's choices: how to forecheck, how to attack in the
 * offensive zone, the power-play formation and the penalty-kill strategy. Each
 * system rewards the skills it depends on: the game engine asks how well the
 * players on the ice fit the system and scales shot rates and shot quality.
 * An average fit is neutral, so no system is free.
 */
import { deriveSeed, Rng } from './rng';
import type { Player, SkaterRatings } from './types';

export type Role =
  | 'netFront'
  | 'bumper'
  | 'halfWall'
  | 'oneTimer'
  | 'point'
  | 'forecheck'
  | 'transition'
  | 'pkForward'
  | 'pkDefense'
  | 'shootout';

export const ROLES: Role[] = ['netFront', 'bumper', 'halfWall', 'oneTimer', 'point', 'forecheck', 'transition', 'pkForward', 'pkDefense', 'shootout'];

export const ROLE_LABEL: Record<Role, string> = {
  netFront: 'Net front',
  bumper: 'Bumper / slot',
  halfWall: 'Half wall',
  oneTimer: 'One-timer',
  point: 'Point',
  forecheck: 'Forecheck',
  transition: 'Transition',
  pkForward: 'PK forward',
  pkDefense: 'PK defense',
  shootout: 'Shootout',
};

export const ROLE_HELP: Record<Role, string> = {
  netFront: 'Screens, tips and rebounds in front of the net',
  bumper: 'Quick shots and passes from the middle of the power play',
  halfWall: 'Runs the power play from the half wall: vision and passing',
  oneTimer: 'Hammers one-timers from the flank',
  point: 'Walks the blue line: shots through traffic and puck movement',
  forecheck: 'Pressures defenders and wins pucks back',
  transition: 'Carries the puck up ice and makes plays off the rush',
  pkForward: 'Reads passing lanes and pressures on the penalty kill',
  pkDefense: 'Clears the crease and blocks shots on the penalty kill',
  shootout: 'Beats goalies one-on-one',
};

type K = keyof SkaterRatings;
const WEIGHTS: Record<Role, Partial<Record<K, number>>> = {
  netFront: { checking: 0.4, handling: 0.25, shooting: 0.25, offIQ: 0.1 },
  bumper: { shooting: 0.45, offIQ: 0.3, passing: 0.15, handling: 0.1 },
  halfWall: { passing: 0.45, offIQ: 0.3, handling: 0.25 },
  oneTimer: { shooting: 0.65, offIQ: 0.2, handling: 0.15 },
  point: { passing: 0.35, shooting: 0.3, offIQ: 0.25, skating: 0.1 },
  forecheck: { skating: 0.35, checking: 0.35, endurance: 0.15, defIQ: 0.15 },
  transition: { skating: 0.45, handling: 0.3, passing: 0.25 },
  pkForward: { defIQ: 0.45, skating: 0.3, discipline: 0.1, endurance: 0.15 },
  pkDefense: { defIQ: 0.5, checking: 0.3, endurance: 0.2 },
  shootout: { shooting: 0.5, handling: 0.5 },
};

/** Style bonuses: what each archetype is built for. */
const AFFINITY: Record<string, Partial<Record<Role, number>>> = {
  'Power Forward': { netFront: 7, forecheck: 6, bumper: 2, transition: -3 },
  Grinder: { forecheck: 6, netFront: 4, pkForward: 4, halfWall: -4, oneTimer: -4, shootout: -6 },
  Enforcer: { netFront: 3, forecheck: 4, halfWall: -6, oneTimer: -6, shootout: -8, pkForward: -3 },
  Sniper: { oneTimer: 7, bumper: 5, shootout: 5, forecheck: -3, pkForward: -3 },
  Playmaker: { halfWall: 7, bumper: 2, transition: 2, netFront: -4, forecheck: -2 },
  'Two-Way': { pkForward: 7, forecheck: 3, transition: 1 },
  Speedster: { transition: 7, forecheck: 3, shootout: 3, netFront: -4 },
  Generational: { halfWall: 3, oneTimer: 3, transition: 3, shootout: 5 },
  'Offensive D': { point: 7, transition: 4, pkDefense: -5 },
  'Shutdown D': { pkDefense: 7, point: -5, transition: -3 },
  'Two-Way D': { point: 2, pkDefense: 2, transition: 1 },
};

/** Forwards rarely play the point well; defensemen rarely play the net front. */
const POSITION_ADJ: Record<'F' | 'D', Partial<Record<Role, number>>> = {
  F: { point: -6, pkDefense: -8 },
  D: { netFront: -8, bumper: -5, oneTimer: -3, halfWall: -3, forecheck: -4, pkForward: -8, shootout: -4 },
};

const quirkCache = new Map<string, number>();
function quirk(playerId: string, role: Role): number {
  const k = `${playerId}:${role}`;
  let q = quirkCache.get(k);
  if (q === undefined) {
    q = new Rng(deriveSeed(7, `role:${k}`)).normal(0, 2.5);
    if (quirkCache.size > 200_000) quirkCache.clear();
    quirkCache.set(k, q);
  }
  return q;
}

/** A skater's skill at a role, on the same 25–99 scale as his ratings. Goalies return 0. */
export function roleSkill(p: Player, role: Role): number {
  return roleSkills(p)[role];
}

const cache = new WeakMap<object, { sig: number; arch: string; roles: Record<Role, number> }>();
const signature = (s: SkaterRatings) =>
  s.skating + 3 * s.shooting + 7 * s.passing + 11 * s.handling + 13 * s.offIQ + 17 * s.defIQ + 19 * s.checking + 23 * s.faceoffs + 29 * s.discipline + 31 * s.endurance;

function computeRole(p: Player, role: Role): number {
  const s = p.skater;
  if (!s) return 0;
  let v = 0;
  for (const [k, w] of Object.entries(WEIGHTS[role]) as Array<[K, number]>) v += s[k] * w;
  v += AFFINITY[p.archetype]?.[role] ?? 0;
  v += POSITION_ADJ[p.pos === 'D' ? 'D' : 'F'][role] ?? 0;
  v += quirk(p.id, role);
  return Math.round(Math.max(25, Math.min(99, v)));
}

/** All role skills for a player (cached until his ratings or style change). */
export function roleSkills(p: Player): Record<Role, number> {
  if (!p.skater) return Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  const sig = signature(p.skater);
  const hit = cache.get(p.skater);
  if (hit && hit.sig === sig && hit.arch === p.archetype) return hit.roles;
  const roles = Object.fromEntries(ROLES.map((r) => [r, computeRole(p, r)])) as Record<Role, number>;
  cache.set(p.skater, { sig, arch: p.archetype, roles });
  return roles;
}

// ---------------------------------------------------------------------------
// Team systems
// ---------------------------------------------------------------------------

export type Forecheck = 'aggressive' | 'balanced' | 'trap';
export type OzStyle = 'cycle' | 'crash' | 'perimeter' | 'rush';
export type PpFormation = 'umbrella' | '1-3-1' | 'overload';
export type PkStrategy = 'box' | 'diamond' | 'aggressive';

export interface Tactics {
  forecheck: Forecheck;
  offense: OzStyle;
  pp: PpFormation;
  pk: PkStrategy;
}

export const DEFAULT_TACTICS: Tactics = { forecheck: 'balanced', offense: 'cycle', pp: 'umbrella', pk: 'box' };

export interface SystemInfo {
  label: string;
  help: string;
  /** Roles the system depends on (for "fit"). */
  roles: Role[];
}

export const FORECHECKS: Record<Forecheck, SystemInfo> = {
  aggressive: { label: 'Aggressive (2-1-2)', help: 'Two forwards hunt the puck deep: more offensive-zone time, but beaten forecheckers give up odd-man rushes.', roles: ['forecheck'] },
  balanced: { label: 'Balanced (1-2-2)', help: 'One forward pressures, two stay above the puck. Solid everywhere, special nowhere.', roles: ['forecheck', 'transition'] },
  trap: { label: 'Neutral-zone trap (1-3-1)', help: 'Clog the neutral zone: fewer chances both ways. Suits disciplined, positional teams.', roles: ['pkForward'] },
};

export const OZ_STYLES: Record<OzStyle, SystemInfo> = {
  cycle: { label: 'Cycle', help: 'Grind it low, work the puck along the boards. Steady pressure; rewards strong, patient puck handlers.', roles: ['forecheck', 'halfWall'] },
  crash: { label: 'Crash the net', help: 'Get pucks and bodies to the net: fewer shots, but more rebounds and tips. Needs net-front players.', roles: ['netFront'] },
  perimeter: { label: 'Shoot from the point', help: 'Volume from the outside: lots of attempts, lower quality, defensemen shoot more. Needs a point shot.', roles: ['point'] },
  rush: { label: 'Rush / transition', help: 'Attack before the defense sets: fewer, better chances. Needs speed and hands.', roles: ['transition'] },
};

export interface Slot {
  label: string;
  role: Role;
  /** How often this spot shoots, relative to 1. */
  shoot: number;
}

export const PP_FORMATIONS: Record<PpFormation, SystemInfo & { slots: Slot[] }> = {
  umbrella: {
    label: 'Umbrella (1-2-2)',
    help: 'A quarterback up top feeding two flanks, two players low. Point shots and one-timers.',
    roles: ['point', 'oneTimer', 'netFront'],
    slots: [
      { label: 'Point', role: 'point', shoot: 1.1 },
      { label: 'Left flank', role: 'oneTimer', shoot: 1.05 },
      { label: 'Right flank', role: 'halfWall', shoot: 0.9 },
      { label: 'Net front', role: 'netFront', shoot: 0.9 },
      { label: 'Low slot', role: 'bumper', shoot: 1.0 },
    ],
  },
  '1-3-1': {
    label: '1-3-1',
    help: 'The modern PP: a playmaker on the half wall, a one-timer on the far flank, a bumper in the middle. Highest quality chances.',
    roles: ['halfWall', 'oneTimer', 'bumper'],
    slots: [
      { label: 'Point', role: 'point', shoot: 0.7 },
      { label: 'Half wall', role: 'halfWall', shoot: 0.8 },
      { label: 'Bumper', role: 'bumper', shoot: 1.05 },
      { label: 'Flank (one-timer)', role: 'oneTimer', shoot: 1.12 },
      { label: 'Net front', role: 'netFront', shoot: 0.9 },
    ],
  },
  overload: {
    label: 'Overload',
    help: 'Flood one side, two defensemen up top, work it low to the net. Rebounds and tips.',
    roles: ['halfWall', 'netFront', 'point'],
    slots: [
      { label: 'Point', role: 'point', shoot: 1.0 },
      { label: 'Weak-side point', role: 'point', shoot: 0.8 },
      { label: 'Half wall', role: 'halfWall', shoot: 0.9 },
      { label: 'Low post', role: 'bumper', shoot: 1.1 },
      { label: 'Net front', role: 'netFront', shoot: 1.1 },
    ],
  },
};

export const PK_STRATEGIES: Record<PkStrategy, SystemInfo> = {
  box: { label: 'Passive box', help: 'Protect the house and block shots: gives up the outside, kills the inside.', roles: ['pkDefense'] },
  diamond: { label: 'Diamond', help: 'One high, one low, two wide: takes away the seams. Best against the 1-3-1.', roles: ['pkForward', 'pkDefense'] },
  aggressive: { label: 'Aggressive pressure', help: 'Chase the puck carrier: fewer shots against and short-handed chances, but open looks when it fails.', roles: ['pkForward'] },
};

/** Slots of the 4-man penalty kill and the 3-man kill, and the 4-on-3 power play. */
export const PK_SLOTS: Slot[] = [
  { label: 'PK forward', role: 'pkForward', shoot: 1 },
  { label: 'PK forward', role: 'pkForward', shoot: 1 },
  { label: 'PK defense', role: 'pkDefense', shoot: 1 },
  { label: 'PK defense', role: 'pkDefense', shoot: 1 },
];
export const PK3_SLOTS: Slot[] = [
  { label: 'PK forward', role: 'pkForward', shoot: 1 },
  { label: 'PK defense', role: 'pkDefense', shoot: 1 },
  { label: 'PK defense', role: 'pkDefense', shoot: 1 },
];
export const PP4_SLOTS: Slot[] = [
  { label: 'Half wall', role: 'halfWall', shoot: 0.9 },
  { label: 'Flank (one-timer)', role: 'oneTimer', shoot: 1.08 },
  { label: 'Net front / bumper', role: 'bumper', shoot: 1.1 },
  { label: 'Point', role: 'point', shoot: 0.9 },
];
export const THREE_SLOTS: Slot[] = [
  { label: 'Forward', role: 'transition', shoot: 1 },
  { label: 'Forward', role: 'transition', shoot: 1 },
  { label: 'Defense', role: 'transition', shoot: 0.8 },
];
export const FOUR_SLOTS: Slot[] = [
  { label: 'Forward', role: 'transition', shoot: 1 },
  { label: 'Forward', role: 'transition', shoot: 1 },
  { label: 'Defense', role: 'point', shoot: 0.8 },
  { label: 'Defense', role: 'point', shoot: 0.8 },
];
export const EXTRA_ATTACKER_SLOTS: Slot[] = [
  { label: 'Net front', role: 'netFront', shoot: 1 },
  { label: 'Half wall', role: 'halfWall', shoot: 1 },
  { label: 'Flank', role: 'oneTimer', shoot: 1.2 },
  { label: 'Bumper', role: 'bumper', shoot: 1.1 },
  { label: 'Point', role: 'point', shoot: 0.9 },
  { label: 'Point', role: 'point', shoot: 0.9 },
];

/**
 * Multipliers the engine applies for the unit on the ice. `fit` is the unit's
 * average skill at the roles its system uses, on the ratings scale; 70 is a
 * league-average unit and neutral.
 */
export interface SystemEffect {
  /** Own shot-attempt rate. */
  att: number;
  /** Own shooting percentage. */
  shq: number;
  /** Own rebound chance. */
  rebound: number;
  /** Weight on defensemen as shooters. */
  dShare: number;
  /** Opponent's attempt rate. */
  oppAtt: number;
  /** Opponent's shooting percentage. */
  oppShq: number;
}

export const NEUTRAL: SystemEffect = { att: 1, shq: 1, rebound: 1, dShare: 1, oppAtt: 1, oppShq: 1 };

/** Fit relative to a typical unit for that situation, in tens of rating points (-1.5 … +1.5). */
const fBase = (fit: number, center: number) => Math.max(-1.5, Math.min(1.5, (fit - center) / 10));
/**
 * Typical fit of the units that play each situation, measured across generated
 * leagues (top players play special teams, so those units fit better). A unit
 * at these values is neutral.
 */
export const FIT_CENTER = { ev: 73.5, pp: 82.5, pk: 80 };

/** Even strength: forecheck × offensive-zone style, given the on-ice unit's skill averages. */
export function evenStrengthEffect(t: Tactics, avg: (r: Role) => number): SystemEffect {
  const e = { ...NEUTRAL };
  const f = (x: number) => fBase(x, FIT_CENTER.ev);
  const fc = f(avg('forecheck'));
  if (t.forecheck === 'aggressive') {
    e.att *= 1.02 + 0.015 * fc;
    e.oppShq *= 1.02 - 0.012 * fc; // beaten forecheckers leave odd-man rushes
  } else if (t.forecheck === 'trap') {
    const disc = f(avg('pkForward'));
    e.att *= 0.975;
    e.oppAtt *= 0.975 - 0.012 * disc;
  } else {
    e.att *= 1 + 0.008 * fc;
  }
  if (t.offense === 'cycle') {
    const x = f((avg('forecheck') + avg('halfWall')) / 2);
    e.att *= 1 + 0.012 * x;
    e.shq *= 1 + 0.008 * x;
  } else if (t.offense === 'crash') {
    const x = f(avg('netFront'));
    e.att *= 0.975;
    e.rebound *= 1.1 + 0.06 * x;
    e.shq *= 1.0 + 0.015 * x;
  } else if (t.offense === 'perimeter') {
    const x = f(avg('point'));
    e.att *= 1.05 + 0.012 * x;
    e.shq *= 0.975 + 0.015 * x;
    e.dShare *= 1.2;
  } else {
    const x = f(avg('transition'));
    e.att *= 0.975 + 0.008 * x;
    e.shq *= 1.02 + 0.02 * x;
  }
  return e;
}

/** Power play: how well each slot is filled, weighted by the formation. */
export function powerPlayEffect(formation: PpFormation, slotFit: number): SystemEffect {
  const x = fBase(slotFit, FIT_CENTER.pp);
  const e = { ...NEUTRAL };
  if (formation === 'umbrella') {
    e.att *= 1.02 + 0.015 * x;
    e.shq *= 0.985 + 0.015 * x;
    e.dShare *= 1.15;
  } else if (formation === '1-3-1') {
    e.att *= 0.985 + 0.012 * x;
    e.shq *= 1.02 + 0.02 * x;
  } else {
    e.att *= 1 + 0.012 * x;
    e.shq *= 0.99 + 0.015 * x;
    e.rebound *= 1.12;
  }
  return e;
}

/** Penalty kill: strategy × personnel, with a small bonus when it counters the opponent's formation. */
export function penaltyKillEffect(strategy: PkStrategy, fit: number, vs: PpFormation): SystemEffect {
  const x = fBase(fit, FIT_CENTER.pk);
  const e = { ...NEUTRAL };
  if (strategy === 'box') {
    e.oppAtt *= 1.015 - 0.012 * x;
    e.oppShq *= 0.98 - 0.012 * x;
  } else if (strategy === 'diamond') {
    e.oppAtt *= 1 - 0.012 * x;
    e.oppShq *= 1 - 0.012 * x;
  } else {
    e.oppAtt *= 0.96 - 0.015 * x;
    e.oppShq *= 1.04 - 0.012 * x;
    e.att *= 1.3; // short-handed chances
  }
  const counters: Record<PkStrategy, PpFormation> = { box: 'umbrella', diamond: '1-3-1', aggressive: 'overload' };
  if (counters[strategy] === vs) e.oppShq *= 0.98;
  return e;
}

export function combine(a: SystemEffect, b: SystemEffect): SystemEffect {
  return { att: a.att * b.att, shq: a.shq * b.shq, rebound: a.rebound * b.rebound, dShare: a.dShare * b.dShare, oppAtt: a.oppAtt * b.oppAtt, oppShq: a.oppShq * b.oppShq };
}

// ---------------------------------------------------------------------------
// Picking systems and filling slots
// ---------------------------------------------------------------------------

/** Average role skill of the best `n` players at a role. */
function topAvg(players: Player[], role: Role, n: number): number {
  const xs = players.map((p) => roleSkill(p, role)).sort((a, b) => b - a).slice(0, n);
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 60;
}

/** Fill slots greedily, most selective slot first, from a pool of players (each used once). */
export function fillSlots(slots: Slot[], pool: Player[], prefer?: (slot: Slot, p: Player) => number): string[] {
  const out: string[] = new Array(slots.length);
  const used = new Set<string>();
  const order = slots.map((s, i) => ({ s, i })).sort((a, b) => {
    const spread = (x: Slot) => {
      const v = pool.map((p) => roleSkill(p, x.role)).sort((m, n) => n - m);
      return (v[0] ?? 0) - (v[Math.min(v.length - 1, 3)] ?? 0);
    };
    return spread(b.s) - spread(a.s);
  });
  for (const { s, i } of order) {
    let best: Player | null = null;
    let bestV = -Infinity;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      const v = roleSkill(p, s.role) + (prefer ? prefer(s, p) : 0);
      if (v > bestV) {
        bestV = v;
        best = p;
      }
    }
    if (best) {
      used.add(best.id);
      out[i] = best.id;
    }
  }
  return out;
}

/** Average skill of a unit in its slots. */
export function unitFit(slots: Slot[], players: Array<Player | undefined>): number {
  let s = 0;
  let n = 0;
  slots.forEach((slot, i) => {
    const p = players[i];
    if (!p) return;
    s += roleSkill(p, slot.role);
    n++;
  });
  return n ? s / n : 60;
}

/**
 * The coach's pick for a roster: the power-play formation its best players fit,
 * the offensive style it's built for, and a forecheck and PK that suit it.
 */
export function suggestTactics(skaters: Player[]): Tactics {
  const fwd = skaters.filter((p) => p.pos !== 'D');
  const best = (xs: Array<[string, number]>) => xs.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  // Power-play formation follows the roster's standout asset: an elite point man
  // (umbrella), net-front strength (overload), otherwise flank shooters and a
  // playmaker (1-3-1). Thresholds are set so a league spreads across all three.
  const fwdTop = (r: Role, n: number) => topAvg(fwd, r, n);
  const flanks = (fwdTop('oneTimer', 2) + fwdTop('halfWall', 2)) / 2;
  const pointGap = topAvg(skaters.filter((p) => p.pos === 'D'), 'point', 2) - flanks;
  const netGap = fwdTop('netFront', 2) - flanks;
  const pp: PpFormation = pointGap >= 0 && pointGap >= netGap ? 'umbrella' : netGap >= 1 ? 'overload' : '1-3-1';
  const offense = best([
    ['cycle', (topAvg(fwd, 'forecheck', 9) + topAvg(fwd, 'halfWall', 9)) / 2 + 0.5],
    ['crash', topAvg(fwd, 'netFront', 9)],
    ['perimeter', topAvg(skaters.filter((p) => p.pos === 'D'), 'point', 6) - 1],
    ['rush', topAvg(fwd, 'transition', 9)],
  ]) as OzStyle;
  // Thresholds sit around league-typical values so teams spread across systems.
  // Forecheck follows what the forwards do best: hunt pucks, skate, or play positionally.
  const fc = topAvg(fwd, 'forecheck', 9);
  const tr = topAvg(fwd, 'transition', 9);
  const disc = topAvg(fwd, 'pkForward', 9);
  const forecheck: Forecheck = fc >= Math.max(tr, disc) + 1 ? 'aggressive' : disc >= Math.max(tr, fc) ? 'trap' : 'balanced';
  const pkF = topAvg(fwd, 'pkForward', 4);
  const pkD = topAvg(skaters.filter((p) => p.pos === 'D'), 'pkDefense', 4);
  const pk: PkStrategy = pkF >= pkD + 5 ? 'aggressive' : pkD >= pkF + 1 ? 'box' : 'diamond';
  return { forecheck, offense, pp, pk };
}

/** Fit (0–100 scale) of a roster's best players for each system choice, for the tactics screen. */
export function systemFits(skaters: Player[], t: Tactics) {
  const fwd = skaters.filter((p) => p.pos !== 'D');
  const def = skaters.filter((p) => p.pos === 'D');
  const pick = (r: Role, pool: Player[], n: number) => Math.round(topAvg(pool, r, n));
  return {
    forecheck: Object.fromEntries(
      (Object.keys(FORECHECKS) as Forecheck[]).map((k) => [k, Math.round(FORECHECKS[k].roles.reduce((s, r) => s + pick(r, fwd, 9), 0) / FORECHECKS[k].roles.length)]),
    ) as Record<Forecheck, number>,
    offense: Object.fromEntries(
      (Object.keys(OZ_STYLES) as OzStyle[]).map((k) => [k, Math.round(OZ_STYLES[k].roles.reduce((s, r) => s + pick(r, r === 'point' ? def : fwd, r === 'point' ? 6 : 9), 0) / OZ_STYLES[k].roles.length)]),
    ) as Record<OzStyle, number>,
    pp: Object.fromEntries(
      (Object.keys(PP_FORMATIONS) as PpFormation[]).map((k) => {
        const slots = PP_FORMATIONS[k].slots;
        const byId = new Map(skaters.map((p) => [p.id, p]));
        return [k, Math.round(unitFit(slots, fillSlots(slots, skaters).map((id) => byId.get(id))))];
      }),
    ) as Record<PpFormation, number>,
    pk: Object.fromEntries(
      (Object.keys(PK_STRATEGIES) as PkStrategy[]).map((k) => [k, Math.round(PK_STRATEGIES[k].roles.reduce((s, r) => s + pick(r, r === 'pkDefense' ? def : fwd, 4), 0) / PK_STRATEGIES[k].roles.length)]),
    ) as Record<PkStrategy, number>,
    current: t,
  };
}
