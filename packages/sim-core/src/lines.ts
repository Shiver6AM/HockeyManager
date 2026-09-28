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
import type { Lines, Player, PlayerId } from './types';

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
export function autoLines(roster: Player[], tactics: Tactics = DEFAULT_TACTICS): Lines {
  const byOvr = (a: Player, b: Player) => overall(b) - overall(a);
  const skaters = roster.filter((p) => p.pos !== 'G');
  const forwards = skaters.filter((p) => p.pos !== 'D').sort(byOvr);
  const defense = skaters.filter((p) => p.pos === 'D').sort(byOvr);
  const goalies = roster.filter((p) => p.pos === 'G').sort(byOvr);

  // Fill each slot with a natural-position player first, then best available forward.
  const used = new Set<PlayerId>();
  const take = (pos: 'C' | 'LW' | 'RW'): PlayerId => {
    const natural = forwards.find((p) => p.pos === pos && !used.has(p.id));
    const pick = natural ?? forwards.find((p) => !used.has(p.id));
    if (!pick) throw new Error('Not enough forwards to build lines');
    used.add(pick.id);
    return pick.id;
  };
  const fLines: PlayerId[][] = [];
  for (let i = 0; i < 4; i++) {
    const c = take('C');
    const lw = take('LW');
    const rw = take('RW');
    fLines.push([lw, c, rw]);
  }
  // Extra forwards spill onto defense only if we're short there.
  const dPool = [...defense];
  while (dPool.length < 6) {
    const extra = forwards.find((p) => !used.has(p.id));
    if (!extra) throw new Error('Not enough skaters to build defense pairs');
    used.add(extra.id);
    dPool.push(extra);
  }
  const dPairs = [0, 1, 2].map((i) => [dPool[i * 2].id, dPool[i * 2 + 1].id]);
  if (goalies.length < 2) throw new Error('Need two goalies');
  const base = { forwards: fLines, defense: dPairs, goalies: [goalies[0].id, goalies[1].id], pp: [], pk: [] } as Lines;
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
    out.pk = [pk1, pk2];
  }
  if (rebuild || !(lines.fourOnFour?.length === 2 && lines.fourOnFour.every((u) => ok(u, 4)))) {
    const u1 = fillSlots(FOUR_SLOTS, dressed, positional);
    const u2 = fillSlots(FOUR_SLOTS, dressed.filter((p) => !u1.includes(p.id)), positional);
    out.fourOnFour = [u1, u2];
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
  if (rebuild || !ok(lines.pp4, 4)) out.pp4 = fillSlots(PP4_SLOTS, dressed);
  if (rebuild || !ok(lines.pk3, 3)) out.pk3 = fillSlots(PK3_SLOTS, dressed, positional);
  if (rebuild || !ok(lines.extraAttacker, 6)) out.extraAttacker = fillSlots(EXTRA_ATTACKER_SLOTS, dressed);
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
  let best: Player[] = group;
  let bestScore = -Infinity;
  const permute = (arr: Player[], k: number) => {
    if (k === arr.length) {
      const score = arr.reduce((sum, p, i) => sum + (slots[i] ? roleSkill(p, slots[i].role) : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = [...arr];
      }
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      permute(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  permute([...group], 0);
  return best.map((p) => p.id);
}
