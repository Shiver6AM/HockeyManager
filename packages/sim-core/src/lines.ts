import { defensiveDrive, offensiveDrive, overall } from './ratings';
import type { Lines, Player, PlayerId } from './types';

/**
 * Build a sensible depth chart from a roster. AI teams use this every day;
 * human managers start from it and edit.
 */
export function autoLines(roster: Player[]): Lines {
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
  const dressed = new Set<PlayerId>([...fLines.flat(), ...dPairs.flat()]);
  const dressedF = forwards.filter((p) => dressed.has(p.id));
  const dressedD = dPool.slice(0, 6);

  const offScore = (p: Player) => offensiveDrive(p.skater!) + 0.5 * p.skater!.shooting;
  const defScore = (p: Player) => defensiveDrive(p.skater!);
  const fOff = [...dressedF].sort((a, b) => offScore(b) - offScore(a));
  const dOff = [...dressedD].sort((a, b) => offScore(b) - offScore(a));
  const fDef = [...dressedF].sort((a, b) => defScore(b) - defScore(a));
  const dDef = [...dressedD].sort((a, b) => defScore(b) - defScore(a));

  const pp = [
    [...fOff.slice(0, 4), dOff[0]].map((p) => p.id),
    [...fOff.slice(4, 7), dOff[1], dOff[2]].map((p) => p.id),
  ];
  const pk = [
    [fDef[0], fDef[1], dDef[0], dDef[1]].map((p) => p.id),
    [fDef[2], fDef[3], dDef[2], dDef[3]].map((p) => p.id),
  ];

  if (goalies.length < 2) throw new Error('Need two goalies');
  return {
    forwards: fLines,
    defense: dPairs,
    goalies: [goalies[0].id, goalies[1].id],
    pp,
    pk,
  };
}
