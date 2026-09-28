import { overall } from './ratings';
import { healthyRoster } from './roster';
import type { League, Player, Team } from './types';

export interface ScratchWarning {
  scratched: Player;
  /** The weakest dressed player at the same position group. */
  dressedInstead: Player;
}

/**
 * Healthy scratches who are clearly better (by 5+ overall) than someone
 * dressed at the same position group. Used to nudge human managers.
 */
export function betterScratches(league: League, team: Team, margin = 5): ScratchWarning[] {
  const group = (p: Player) => (p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F');
  const dressed = new Set([...team.lines.forwards.flat(), ...team.lines.defense.flat(), ...team.lines.goalies]);
  const healthy = healthyRoster(league, team);
  const out: ScratchWarning[] = [];
  const used = new Set<string>();
  const scratches = healthy.filter((p) => !dressed.has(p.id)).sort((a, b) => overall(b) - overall(a));
  for (const s of scratches) {
    const weakest = healthy
      .filter((p) => dressed.has(p.id) && group(p) === group(s) && !used.has(p.id))
      .sort((a, b) => overall(a) - overall(b))[0];
    if (weakest && overall(s) - overall(weakest) >= margin) {
      out.push({ scratched: s, dressedInstead: weakest });
      used.add(weakest.id);
    }
  }
  return out;
}
