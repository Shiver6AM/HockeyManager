/**
 * Traits: rare badges that make a player better at one specific thing, in the
 * spirit of NBA 2K's badge system. Each comes in four tiers (Bronze, Silver,
 * Gold, Hall of Fame) and nudges one part of the game engine: a Sniper's shots
 * go in more often, a Shot Blocker gets in front of more pucks, a Brick Wall
 * goalie stops a bit more.
 *
 * A player earns a trait when the ratings behind it are elite and he has a
 * knack for it (a hidden affinity fixed at birth, so two players with the same
 * ratings don't always share badges). They're re-checked every summer after
 * development, so a trait can be earned, upgraded or lost as he ages.
 * Most players have none; a star has two or three.
 */
import { hashString } from './rng';
import type { Player } from './types';

export type TraitTier = 1 | 2 | 3 | 4;
export const TIER_NAMES = ['', 'Bronze', 'Silver', 'Gold', 'Hall of Fame'] as const;

export type TraitId =
  | 'sniper'
  | 'playmaker'
  | 'clutch'
  | 'netFront'
  | 'ppSpecialist'
  | 'dangler'
  | 'speedster'
  | 'faceoffAce'
  | 'shotBlocker'
  | 'shutdown'
  | 'pkSpecialist'
  | 'enforcer'
  | 'ironMan'
  | 'leader'
  | 'shootoutArtist'
  | 'brickWall'
  | 'bigGame'
  | 'reboundControl';

export interface TraitDef {
  id: TraitId;
  label: string;
  /** 'skater' or 'goalie'. */
  who: 'skater' | 'goalie';
  kind: 'offense' | 'defense' | 'physical' | 'mental' | 'goaltending';
  /** What it does, for the UI (per tier details follow the same pattern). */
  help: string;
  /** The rating score that qualifies him (0–99 scale). */
  score: (p: Player) => number;
}

const s = (p: Player) => p.skater!;
const g = (p: Player) => p.goalie!;

export const TRAITS: TraitDef[] = [
  { id: 'sniper', label: 'Sniper', who: 'skater', kind: 'offense', help: 'Picks corners: his shots on goal go in more often.', score: (p) => s(p).shooting * 0.8 + s(p).offIQ * 0.2 },
  { id: 'playmaker', label: 'Playmaker', who: 'skater', kind: 'offense', help: 'Sets up teammates: better chances for linemates and more assists.', score: (p) => s(p).passing * 0.7 + s(p).offIQ * 0.3 },
  { id: 'clutch', label: 'Clutch', who: 'skater', kind: 'mental', help: 'Rises to the moment: shoots better late in close games and in overtime.', score: (p) => s(p).shooting * 0.4 + s(p).offIQ * 0.4 + p.hidden.consistency * 20 },
  { id: 'netFront', label: 'Net-Front Presence', who: 'skater', kind: 'offense', help: 'Lives at the crease: first to rebounds and buries more of them.', score: (p) => s(p).checking * 0.4 + s(p).handling * 0.3 + s(p).shooting * 0.3 },
  { id: 'ppSpecialist', label: 'Power-Play Quarterback', who: 'skater', kind: 'offense', help: 'Dangerous with the extra man: bigger boost to shooting and setups on the power play.', score: (p) => s(p).passing * 0.4 + s(p).offIQ * 0.4 + s(p).shooting * 0.2 },
  { id: 'dangler', label: 'Dangler', who: 'skater', kind: 'offense', help: 'Silky hands: fewer of his shots are blocked or miss the net.', score: (p) => s(p).handling * 0.8 + s(p).skating * 0.2 },
  { id: 'speedster', label: 'Speedster', who: 'skater', kind: 'offense', help: 'Breakaway speed: his line generates more chances.', score: (p) => s(p).skating },
  { id: 'faceoffAce', label: 'Faceoff Ace', who: 'skater', kind: 'mental', help: 'Wins the draw more often.', score: (p) => (p.pos === 'C' ? s(p).faceoffs : 0) },
  { id: 'shotBlocker', label: 'Shot Blocker', who: 'skater', kind: 'defense', help: 'Throws himself in front of pucks: more shots blocked when he is out there.', score: (p) => s(p).defIQ * 0.5 + s(p).checking * 0.5 },
  { id: 'shutdown', label: 'Shutdown', who: 'skater', kind: 'defense', help: 'Smothers top lines: his unit allows fewer chances.', score: (p) => s(p).defIQ * 0.8 + s(p).skating * 0.2 },
  { id: 'pkSpecialist', label: 'Penalty Killer', who: 'skater', kind: 'defense', help: 'Reads the power play: much stronger defensively when short-handed.', score: (p) => s(p).defIQ * 0.6 + s(p).skating * 0.2 + s(p).discipline * 0.2 },
  { id: 'enforcer', label: 'Enforcer', who: 'skater', kind: 'physical', help: 'Punishing hitter who answers the bell: more hits, and he is the one who drops the gloves.', score: (p) => s(p).checking },
  { id: 'ironMan', label: 'Iron Man', who: 'skater', kind: 'physical', help: 'Never tires, rarely hurt: tires more slowly and is less likely to be injured.', score: (p) => s(p).endurance * 0.8 + (1 - p.hidden.injuryProneness) * 20 },
  { id: 'leader', label: 'Leader', who: 'skater', kind: 'mental', help: 'Lifts everyone on the ice with him.', score: (p) => s(p).offIQ * 0.35 + s(p).defIQ * 0.35 + p.hidden.consistency * 30 },
  { id: 'shootoutArtist', label: 'Shootout Artist', who: 'skater', kind: 'offense', help: 'Deadly one-on-one: scores more in the shootout.', score: (p) => s(p).handling * 0.5 + s(p).shooting * 0.5 },
  { id: 'brickWall', label: 'Brick Wall', who: 'goalie', kind: 'goaltending', help: 'Simply stops more pucks.', score: (p) => g(p).reflexes * 0.5 + g(p).positioning * 0.5 },
  { id: 'bigGame', label: 'Big-Game Goalie', who: 'goalie', kind: 'goaltending', help: 'Best when it matters most: stops more late in close playoff games.', score: (p) => g(p).mental * 0.7 + p.hidden.consistency * 30 },
  { id: 'reboundControl', label: 'Rebound Control', who: 'goalie', kind: 'goaltending', help: 'Swallows pucks: gives up far fewer rebounds (and shootout goals).', score: (p) => g(p).rebounds * 0.8 + g(p).positioning * 0.2 },
];

export const TRAIT_BY_ID = Object.fromEntries(TRAITS.map((t) => [t.id, t])) as Record<TraitId, TraitDef>;

/** Score needed for each tier (after his affinity for the trait). Goalie ratings run lower. */
const TIER_AT = { skater: [85, 89.5, 93, 96.5], goalie: [81, 85, 88.5, 92] };
/** Most traits one player can carry: his best few. */
const MAX_TRAITS = { skater: 3, goalie: 2 };

/** A player's hidden knack for a trait: fixed at birth, about ±5 points. */
function affinity(p: Player, id: TraitId): number {
  const h = hashString(`${p.id}:${id}`);
  // Sum of two uniforms: a triangular spread, most players near zero.
  const u = ((h & 0xffff) / 0xffff + ((h >>> 16) & 0xffff) / 0xffff) / 2;
  return (u - 0.5) * 16;
}

/** Work out which traits a player has from his current ratings. */
export function computeTraits(p: Player): Partial<Record<TraitId, TraitTier>> {
  const goalie = p.pos === 'G';
  const who = goalie ? 'goalie' : 'skater';
  const at = TIER_AT[who];
  const earned: Array<{ id: TraitId; tier: TraitTier; margin: number }> = [];
  for (const t of TRAITS) {
    if (t.who !== who) continue;
    if (goalie ? !p.goalie : !p.skater) continue;
    const v = t.score(p) + affinity(p, t.id);
    let tier = 0;
    for (let i = 0; i < at.length; i++) if (v >= at[i]) tier = i + 1;
    if (tier) earned.push({ id: t.id, tier: tier as TraitTier, margin: v - at[0] });
  }
  // His signature skills only: the ones he's furthest above the bar in.
  earned.sort((a, b) => b.margin - a.margin);
  return Object.fromEntries(earned.slice(0, MAX_TRAITS[who]).map((e) => [e.id, e.tier]));
}

/** Refresh a player's traits (at creation, and each summer after development). */
export function refreshTraits(p: Player) {
  const t = computeTraits(p);
  if (Object.keys(t).length) p.traits = t;
  else delete p.traits;
}

/** Tier of a trait (0 if he doesn't have it). */
export function tierOf(p: Player, id: TraitId): number {
  return p.traits?.[id] ?? 0;
}

/** For the UI: a player's traits, best first. */
export function traitList(p: Player): Array<{ id: TraitId; label: string; tier: TraitTier; tierName: string; kind: TraitDef['kind']; help: string }> {
  return Object.entries(p.traits ?? {})
    .map(([id, tier]) => ({ id: id as TraitId, label: TRAIT_BY_ID[id as TraitId].label, tier: tier as TraitTier, tierName: TIER_NAMES[tier as TraitTier], kind: TRAIT_BY_ID[id as TraitId].kind, help: TRAIT_BY_ID[id as TraitId].help }))
    .sort((a, b) => b.tier - a.tier || a.label.localeCompare(b.label));
}
