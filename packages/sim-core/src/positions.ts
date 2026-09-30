/**
 * Players who can play more than one position: plenty of centers can play the
 * wing, most wingers can switch sides, a few wingers take faceoffs, and the odd
 * defenseman can move up to forward (or a forward drop back).
 */
import { playsPos } from './lines';
import { deriveSeed, Rng } from './rng';
import type { League, Player, Position } from './types';

export function altPositions(league: League, p: Player): Position[] {
  if (p.pos === 'G' || !p.skater) return [];
  const rng = new Rng(deriveSeed(league.seed, `pos:${p.id}`));
  const s = p.skater;
  const out: Position[] = [];
  const add = (x: Position) => !out.includes(x) && x !== p.pos && out.push(x);
  if (p.pos === 'C') {
    if (rng.chance(0.42)) add(rng.chance(0.5) ? 'LW' : 'RW');
    if (rng.chance(0.12)) {
      add('LW');
      add('RW');
    }
  } else if (p.pos === 'LW' || p.pos === 'RW') {
    if (rng.chance(0.5)) add(p.pos === 'LW' ? 'RW' : 'LW');
    if (s.faceoffs >= 66 && rng.chance(0.35)) add('C');
    if (s.defIQ >= 76 && rng.chance(0.05)) add('D');
  } else if (p.pos === 'D') {
    if (s.offIQ >= 76 && rng.chance(0.06)) add(rng.chance(0.5) ? 'LW' : 'RW');
  }
  return out;
}

/** Every position he plays, his main one first ("C/RW"). */
export const positionsLabel = (p: Pick<Player, 'pos' | 'altPos'>) => [p.pos, ...(p.altPos ?? [])].join('/');

/** How much playing a slot costs him (rating points): nothing where he plays, a little on the wrong wing, a lot out of his group. */
export function outOfPosition(p: Player, slot: Position): number {
  if (playsPos(p, slot)) return 0;
  const fwd = (x: Position) => x === 'C' || x === 'LW' || x === 'RW';
  if (fwd(p.pos) !== fwd(slot)) return 4;
  if (slot === 'C') return 1;
  return 0.3;
}
