import { arrangeUnit, SLOT_BASIS } from './chemistry';
import { defensiveDrive, overall } from './ratings';
import {
  DEFAULT_TACTICS,
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

function buildAutoLines(roster: Player[], tactics: Tactics, pins: Record<PlayerId, LinePin>): Lines {
  const byOvr = (a: Player, b: Player) => overall(b) - overall(a);
  const skaters = roster.filter((p) => p.pos !== 'G');
  const isD = (p: Player) => p.pos === 'D';
  // Healthy scratches the manager asked for sit out, unless they're needed to dress 12 forwards and 6 defensemen.
  const scratched = (p: Player) => pins[p.id]?.slot === 'scratch';
  const avail = (list: Player[], need: number) => {
    const playing = list.filter((p) => !scratched(p));
    return playing.length >= need ? playing : [...playing, ...list.filter(scratched)].slice(0, Math.max(need, playing.length));
  };
  const forwards = avail(skaters.filter((p) => !isD(p)), 12).sort(byOvr);
  const defense = avail(skaters.filter(isD), 6).sort(byOvr);
  const goalies = roster.filter((p) => p.pos === 'G').sort(byOvr);

  const used = new Set<PlayerId>();
  const allowed = (p: Player, line: number) => {
    const lines = PIN_LINES[pins[p.id]?.slot as PinSlot];
    return !lines || lines.includes(line);
  };
  /** Pinned to this line or a group that ends here: he has to go in now. */
  const due = (p: Player, line: number) => {
    const lines = PIN_LINES[pins[p.id]?.slot as PinSlot];
    return !!lines && Math.max(...lines) === line;
  };
  const fitsPos = (p: Player, pos: 'C' | 'LW' | 'RW') => {
    const want = pins[p.id]?.pos;
    return want ? want === pos : playsPos(p, pos);
  };
  const pick = (pool: Player[], line: number, ok: (p: Player) => boolean) => {
    const free = pool.filter((p) => !used.has(p.id) && allowed(p, line));
    return free.find((p) => due(p, line) && ok(p)) ?? free.find(ok);
  };
  const take = (pos: 'C' | 'LW' | 'RW', line: number): PlayerId => {
    // His own position first, then players who can also play it.
    // (Someone who can also play there beats a clearly better player out of position only when it's close.)
    const best = pick(forwards, line, (x) => !pins[x.id]?.pos || pins[x.id].pos === pos);
    const alt = pick(forwards, line, (x) => fitsPos(x, pos));
    const p =
      pick(forwards, line, (x) => (pins[x.id]?.pos ? pins[x.id].pos === pos : x.pos === pos)) ??
      (alt && (!best || overall(alt) >= overall(best) - 3 || pins[alt.id]?.pos === pos) ? alt : undefined) ??
      // Nobody who plays there: a forward whose pin doesn't name another spot, then anyone.
      pick(forwards, line, (x) => !pins[x.id]?.pos) ??
      pick(forwards, line, () => true) ??
      forwards.find((x) => !used.has(x.id));
    if (!p) throw new Error('Not enough forwards to build lines');
    used.add(p.id);
    return p.id;
  };
  const fLines: PlayerId[][] = [];
  for (let i = 0; i < 4; i++) {
    // Centers first (the scarcest), then the wings.
    const c = take('C', i);
    const lw = take('LW', i);
    const rw = take('RW', i);
    fLines.push([lw, c, rw]);
  }
  // Extra forwards spill onto defense only if we're short there (ones who can play D first).
  const dPool = [...defense];
  const spare = forwards.filter((p) => !used.has(p.id)).sort((a, b) => Number(playsPos(b, 'D')) - Number(playsPos(a, 'D')));
  while (dPool.length < 6) {
    const extra = spare.shift();
    if (!extra) throw new Error('Not enough skaters to build defense pairs');
    dPool.push(extra); // (marked as used when he's put in a pair, below)
  }
  const dPairs: PlayerId[][] = [];
  for (let i = 0; i < 3; i++) {
    const pair: PlayerId[] = [];
    for (let k = 0; k < 2; k++) {
      const p = pick(dPool, i, () => true) ?? dPool.find((x) => !used.has(x.id))!;
      used.add(p.id);
      pair.push(p.id);
    }
    dPairs.push(pair);
  }
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
