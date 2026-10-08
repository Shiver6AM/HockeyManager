import { arrangeUnit, SLOT_BASIS } from './chemistry';
import { outOfPosition } from './positions';
import { defensiveDrive, overall, skaterOverall } from './ratings';
import {
  DEFAULT_TACTICS,
  DEFENSE_USAGE,
  FORWARD_USAGE,
  EXTRA_ATTACKER_SLOTS,
  fillSlots,
  FOUR_SLOTS,
  PK3_SLOTS,
  PK_SLOTS,
  PP4_SLOTS,
  PP_FORMATIONS,
  roleSkill,
  type Slot,
  type Tactics,
} from './systems';
import type { LinePin, Lines, PinSlot, Player, PlayerId, Position } from './types';

/** Keep forwards in forward slots and defensemen in defense slots when filling units. */
const positional = (slot: Slot, p: Player) => {
  const isD = p.pos === 'D';
  if (/^PK defense|^Defense/.test(slot.label)) return isD ? 0 : -25;
  if (/^PK forward|^Forward/.test(slot.label)) return isD ? -25 : 0;
  return 0;
};

/**
 * Build a sensible depth chart from a roster. AI teams use this every day;
 * human managers start from it and edit. Special units are filled by role
 * skill for the team's systems (e.g. the power-play formation's slots).
 */
export function autoLines(roster: Player[], tactics: Tactics = DEFAULT_TACTICS, pins?: Record<PlayerId, LinePin>): Lines {
  // AI teams rebuild lines before every game, but the result only depends on
  // who's available, their ratings and the team's systems, so identical inputs
  // reuse the last answer.
  const key =
    JSON.stringify(tactics) +
    (pins && Object.keys(pins).length ? JSON.stringify(pins) : '') +
    '#' +
    roster.map((p) => `${p.id}:${p.pos}${p.altPos?.join('') ?? ''}:${JSON.stringify(p.skater ?? p.goalie)}:${p.roleTraining ? JSON.stringify(p.roleTraining) : ''}`).join('|');
  const hit = linesCache.get(key);
  if (hit) return structuredClone(hit);
  const lines = buildAutoLines(roster, tactics, pins ?? {});
  if (linesCache.size > 400) linesCache.clear();
  linesCache.set(key, structuredClone(lines));
  return lines;
}
const linesCache = new Map<string, Lines>();

/** Can he play this position (his own or one of his others)? */
export const playsPos = (p: Player, pos: Position) => p.pos === pos || !!p.altPos?.includes(pos);

/** Which forward lines (0-3) or defense pairs (0-2) a pin allows. */
const PIN_LINES: Partial<Record<PinSlot, number[]>> = {
  L1: [0], L2: [1], L3: [2], L4: [3], top6: [0, 1], top9: [0, 1, 2], bottom6: [2, 3],
  P1: [0], P2: [1], P3: [2], top4: [0, 1],
};

/** The cheapest way to give each row its own column (rows ≤ columns): the column for each row. Hungarian method. */
export function assign(cost: number[][]): number[] {
  const n = cost.length;
  const m = cost[0]?.length ?? 0;
  if (n > m) throw new Error('More slots than players');
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0); // p[j]: row (1-based) holding column j
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const done = new Array(m + 1).fill(false);
    do {
      done[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (done[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (done[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1;
  return out;
}

/** What the coach thinks he brings in a slot: his rating there, less what playing out of position costs him in a game. */
export function slotValue(p: Player, pos: Position): number {
  if (p.pos === pos) return skaterOverall(p.skater!, pos);
  const cross = isFwd(p.pos) === isFwd(pos) ? 0 : playsPos(p, pos) ? CROSS_GROUP / 2 : CROSS_GROUP;
  return skaterOverall(p.skater!, pos) - outOfPosition(p, pos) - OFF_MAIN - cross;
}
/** Coaches lean toward a player's main position: moving him (even to a spot he plays) has to be worth it. */
const OFF_MAIN = 1;
const isFwd = (pos: Position) => pos === 'C' || pos === 'LW' || pos === 'RW';
/**
 * Coaches move a forward back to defense (or a defenseman up) only when they must:
 * beyond what it costs him in a game, it takes him out of his routine and the team's.
 * (Half as much for the rare player listed at both.)
 */
const CROSS_GROUP = 8;

/** Big costs that steer the assignment away from what the manager ruled out (they still give way if nothing else works). */
const PIN_BREAK = 1e5;
const SCRATCH = 1e3;

function buildAutoLines(roster: Player[], tactics: Tactics, pins: Record<PlayerId, LinePin>): Lines {
  const byOvr = (a: Player, b: Player) => overall(b) - overall(a) || a.id.localeCompare(b.id);
  const skaters = roster.filter((p) => p.pos !== 'G').sort(byOvr);
  const goalies = roster.filter((p) => p.pos === 'G').sort(byOvr);
  if (skaters.length < 18) throw new Error(`Not enough skaters to dress a lineup (${skaters.length} of 18)`);

  // Eighteen slots: four lines of LW-C-RW, then three pairs. Each is worth his share of the ice time,
  // so the best players go where they play the most and an out-of-position fit costs most up top.
  const fShare = FORWARD_USAGE[tactics.fUsage ?? 'balanced'].share;
  const dShare = DEFENSE_USAGE[tactics.dUsage ?? 'balanced'].share;
  const slots: Array<{ pos: Position; line: number; d: boolean; w: number }> = [];
  for (let i = 0; i < 4; i++) for (const pos of ['LW', 'C', 'RW'] as const) slots.push({ pos, line: i, d: false, w: fShare[i] });
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) slots.push({ pos: 'D', line: i, d: true, w: dShare[i] });

  const cost = slots.map((slot) =>
    skaters.map((p) => {
      const pin = pins[p.id];
      let c = -slot.w * slotValue(p, slot.pos);
      if (pin?.slot === 'scratch') c += SCRATCH;
      else if (pin?.slot) {
        const lines = PIN_LINES[pin.slot];
        const dPin = /^P|top4/.test(pin.slot);
        if (lines && (dPin !== slot.d || !lines.includes(slot.line))) c += PIN_BREAK;
      }
      if (pin?.pos && pin.pos !== slot.pos) c += PIN_BREAK;
      return c;
    }),
  );
  // Everyone else sits; sitting someone the manager placed on a line breaks his placement too.
  for (let k = slots.length; k < skaters.length; k++) {
    cost.push(skaters.map((p) => (pins[p.id]?.slot && pins[p.id].slot !== 'scratch' ? PIN_BREAK : 0)));
  }
  const pickFor = assign(cost);
  const at = (i: number) => skaters[pickFor[i]].id;
  const fLines: PlayerId[][] = [0, 1, 2, 3].map((i) => [at(i * 3), at(i * 3 + 1), at(i * 3 + 2)]);
  const dPairs: PlayerId[][] = [0, 1, 2].map((i) => [at(12 + i * 2), at(12 + i * 2 + 1)]);
  if (goalies.length < 2) throw new Error('Need two goalies');
  const g1 = goalies.find((g) => pins[g.id]?.slot === 'G1') ?? goalies.find((g) => pins[g.id]?.slot !== 'G2') ?? goalies[0];
  const g2 = goalies.find((g) => g !== g1)!;
  const base = { forwards: fLines, defense: dPairs, goalies: [g1.id, g2.id], pp: [], pk: [] } as Lines;
  return completeLines(base, roster, tactics, true);
}

/**
 * Fill in special units: all of them when `rebuild`, otherwise only the ones
 * missing or referencing players who aren't dressed (older saves, roster moves).
 */
export function completeLines(lines: Lines, roster: Player[], tactics: Tactics = DEFAULT_TACTICS, rebuild = false): Lines {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const dressedIds = [...lines.forwards.flat(), ...lines.defense.flat()];
  const dressed = dressedIds.map((id) => byId.get(id)).filter((p): p is Player => !!p);
  const dressedSet = new Set(dressedIds);
  const ok = (unit: PlayerId[] | undefined, n: number) => !!unit && unit.length === n && new Set(unit).size === n && unit.every((id) => dressedSet.has(id));
  const out: Lines = { ...lines };
  const arrange = (ids: PlayerId[], slots: Slot[], basis: keyof typeof SLOT_BASIS) =>
    arrangeUnit(ids.map((id) => byId.get(id)!).filter(Boolean), slots, SLOT_BASIS[basis]).map((p) => p.id);

  const ppSlots = PP_FORMATIONS[tactics.pp].slots;
  if (rebuild || !(lines.pp?.length === 2 && ok(lines.pp[0], 5) && ok(lines.pp[1], 5))) {
    const pp1 = powerPlayUnit(ppSlots, dressed);
    const pp2 = powerPlayUnit(ppSlots, dressed.filter((p) => !pp1.includes(p.id)));
    out.pp = [pp1, pp2];
  }
  // Coaches spread the load: first-unit power-play players kill penalties only if clearly the best option.
  const pp1 = new Set(out.pp?.[0] ?? []);
  const spread = (slot: Slot, p: Player) => positional(slot, p) - (pp1.has(p.id) ? 6 : 0);
  if (rebuild || !(lines.pk?.length === 2 && ok(lines.pk[0], 4) && ok(lines.pk[1], 4))) {
    const pk1 = fillSlots(PK_SLOTS, dressed, spread);
    const pk2 = fillSlots(PK_SLOTS, dressed.filter((p) => !pk1.includes(p.id)), spread);
    out.pk = [arrange(pk1, PK_SLOTS, 'pk'), arrange(pk2, PK_SLOTS, 'pk')];
  }
  if (rebuild || !(lines.fourOnFour?.length === 2 && lines.fourOnFour.every((u) => ok(u, 4)))) {
    const u1 = fillSlots(FOUR_SLOTS, dressed, positional);
    const u2 = fillSlots(FOUR_SLOTS, dressed.filter((p) => !u1.includes(p.id)), positional);
    out.fourOnFour = [arrange(u1, FOUR_SLOTS, 'ev'), arrange(u2, FOUR_SLOTS, 'ev')];
  }
  if (rebuild || !(lines.threeOnThree?.length === 3 && lines.threeOnThree.every((u) => ok(u, 3)))) {
    // Deal the best 3-on-3 players across units so each has one threat.
    const byT = (xs: Player[]) => [...xs].sort((a, b) => roleSkill(b, 'transition') - roleSkill(a, 'transition'));
    const fw = byT(dressed.filter((p) => p.pos !== 'D'));
    const dm = byT(dressed.filter((p) => p.pos === 'D'));
    const pickD = (i: number) => (dm[i] ?? fw[6 + i]).id;
    out.threeOnThree = [
      [fw[0].id, fw[5].id, pickD(0)],
      [fw[1].id, fw[4].id, pickD(1)],
      [fw[2].id, fw[3].id, pickD(2)],
    ];
  }
  if (rebuild || !ok(lines.pp4, 4)) out.pp4 = arrange(fillSlots(PP4_SLOTS, dressed), PP4_SLOTS, 'pp');
  if (rebuild || !ok(lines.pk3, 3)) out.pk3 = arrange(fillSlots(PK3_SLOTS, dressed, positional), PK3_SLOTS, 'pk');
  if (rebuild || !ok(lines.extraAttacker, 6)) out.extraAttacker = arrange(fillSlots(EXTRA_ATTACKER_SLOTS, dressed), EXTRA_ATTACKER_SLOTS, 'ev');
  if (rebuild || !ok(lines.shootout, 5)) {
    out.shootout = [...dressed].sort((a, b) => roleSkill(b, 'shootout') - roleSkill(a, 'shootout')).slice(0, 5).map((p) => p.id);
  }
  return out;
}

/** Defensive-minded helper kept for callers that rank defensive players. */
export const defScore = (p: Player) => defensiveDrive(p.skater!);

/** Offensive talent, for choosing who plays the power play. */
const offense = (p: Player) => p.skater!.shooting * 0.35 + p.skater!.offIQ * 0.35 + p.skater!.passing * 0.2 + p.skater!.handling * 0.1;

/**
 * A power-play unit: pick the most dangerous players for the formation (as
 * many defensemen as it has point spots), then put each in the slot he suits
 * best by trying every arrangement.
 */
export function powerPlayUnit(slots: Slot[], pool: Player[]): PlayerId[] {
  const points = slots.filter((s) => s.role === 'point').length;
  const byOff = (xs: Player[]) => [...xs].sort((a, b) => offense(b) - offense(a));
  const D = byOff(pool.filter((p) => p.pos === 'D')).slice(0, points);
  const F = byOff(pool.filter((p) => p.pos !== 'D' && !D.includes(p))).slice(0, slots.length - D.length);
  const group = [...F, ...D];
  while (group.length < slots.length) {
    const extra = byOff(pool).find((p) => !group.includes(p));
    if (!extra) break;
    group.push(extra);
  }
  return arrangeUnit(group, slots, SLOT_BASIS.pp).map((p) => p.id);
}
