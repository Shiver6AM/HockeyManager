/**
 * Central Scouting: the league's own consensus ranking of the draft class,
 * the same for every team. Like the real thing it publishes three editions
 * (preliminary in the fall, midterm in January, final after the season) and
 * splits prospects into North American and international skaters and goalies.
 * It sees every league, but it isn't perfect: each edition carries some error,
 * less as the season goes on. Your own scouts can beat it where they know a
 * region well.
 */
import { playerRegion } from './scouting';
import { overall } from './ratings';
import { deriveSeed, Rng } from './rng';
import type { League, Player, PlayerId } from './types';

export type CssList = 'NA skaters' | 'Intl skaters' | 'NA goalies' | 'Intl goalies';
export type CssEdition = 'Preliminary' | 'Midterm' | 'Final';

export interface CssRank {
  /** Consensus rank across the whole class. */
  rank: number;
  list: CssList;
  /** Rank within his list. */
  listRank: number;
}

const NA_REGIONS = new Set(['west', 'ontario', 'quebec', 'usa']);
/** Error (potential points) in each edition. */
const EDITION_SD: Record<CssEdition, number> = { Preliminary: 6, Midterm: 4.5, Final: 3.2 };

export function cssEdition(league: League): CssEdition {
  if (league.phase !== 'regular-season') return 'Final';
  const last = league.schedule.reduce((m, g) => Math.max(m, g.day), 0) || 180;
  return league.day >= last * 0.45 ? 'Midterm' : 'Preliminary';
}

const cache = new WeakMap<League, { key: string; ranks: Map<PlayerId, CssRank> }>();

/** Central Scouting's rankings of this season's draft class (players who are still draft-eligible). */
export function centralScouting(league: League, draftSeason: number): Map<PlayerId, CssRank> {
  const edition = cssEdition(league);
  const cls = Object.values(league.players).filter((p) => p.draftClass === draftSeason && !p.teamId && !p.prospectOf);
  const key = `${draftSeason}:${edition}:${cls.length}`;
  const hit = cache.get(league);
  if (hit && hit.key === key) return hit.ranks;

  const score = (p: Player) => {
    const rng = new Rng(deriveSeed(league.seed, `css:${draftSeason}:${edition}:${p.id}`));
    // Mostly the ceiling, partly what he is now; goalies are a bigger gamble.
    return 0.72 * p.hidden.potential + 0.28 * overall(p) + rng.normal(0, EDITION_SD[edition]) - (p.pos === 'G' ? 2.5 : 0);
  };
  const scored = cls.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s);
  const ranks = new Map<PlayerId, CssRank>();
  const counts: Record<string, number> = {};
  scored.forEach(({ p }, i) => {
    const na = NA_REGIONS.has(playerRegion(league, p));
    const list: CssList = `${na ? 'NA' : 'Intl'} ${p.pos === 'G' ? 'goalies' : 'skaters'}`;
    counts[list] = (counts[list] ?? 0) + 1;
    ranks.set(p.id, { rank: i + 1, list, listRank: counts[list] });
  });
  cache.set(league, { key, ranks });
  return ranks;
}
