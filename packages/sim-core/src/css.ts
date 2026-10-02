/**
 * Central Scouting: the league's own consensus ranking of the draft class,
 * the same for every team, split into North American and international skaters
 * and goalies.
 *
 * The rankings are live: a preliminary list in the fall, an update every two
 * weeks through the regular season, and a final list after it. Each update
 * reflects what the prospects are doing on the ice this season, and the
 * guesswork shrinks as the season goes on. Opinions drift rather than jump (a
 * prospect Central Scouting overrates in October tends to stay a little
 * overrated for a while). It sees every league but isn't perfect, and like
 * everyone it misses most of what a sleeper can become.
 */
import { memo } from './memo';
import { apparentPotential } from './draft';
import { playerRegion } from './scouting';
import { overall } from './ratings';
import { deriveSeed, Rng } from './rng';
import type { League, Player, PlayerId } from './types';

export type CssList = 'NA skaters' | 'Intl skaters' | 'NA goalies' | 'Intl goalies';

export interface CssRank {
  /** Consensus rank across the whole class. */
  rank: number;
  list: CssList;
  /** Rank within his list. */
  listRank: number;
  /** His overall rank in the previous update (null for the first list). */
  prevRank: number | null;
}

export interface CssUpdate {
  /** 0 = preliminary; one more every two weeks of the regular season. */
  index: number;
  final: boolean;
  /** "Preliminary", "Update 4", "Final". */
  label: string;
  /** Regular-season day it was published (null for the final list). */
  day: number | null;
  /** 0 … 1: how far through the season (the rankings' guesswork shrinks with it). */
  progress: number;
}

const NA_REGIONS = new Set(['west', 'ontario', 'quebec', 'usa']);
const EVERY = 14;

function lastDay(league: League) {
  return league.schedule.reduce((m, g) => Math.max(m, g.day), 0) || 180;
}

export function cssUpdate(league: League): CssUpdate {
  const last = lastDay(league);
  const lastIndex = Math.floor(last / EVERY);
  if (league.phase !== 'regular-season') return { index: lastIndex + 1, final: true, label: 'Final', day: null, progress: 1 };
  const index = Math.floor(league.day / EVERY);
  return { index, final: false, label: index === 0 ? 'Preliminary' : `Update ${index}`, day: index * EVERY, progress: Math.min(1, (index * EVERY) / last) };
}

/** The label of the list that's out now ("Preliminary", "Update 4", "Final"). */
export function cssEdition(league: League): string {
  return cssUpdate(league).label;
}

const cache = new WeakMap<League, { key: string; ranks: Map<PlayerId, CssRank> }>();

/** Central Scouting's current rankings of a draft class (players still draft-eligible). */
export function centralScouting(league: League, draftSeason: number): Map<PlayerId, CssRank> {
  // (Asked once per prospect when a page lists the class: see memo.ts.)
  return memo(`css:${draftSeason}`, () => centralScoutingNow(league, draftSeason));
}

function centralScoutingNow(league: League, draftSeason: number): Map<PlayerId, CssRank> {
  const u = cssUpdate(league);
  const cls = Object.values(league.players).filter((p) => p.draftClass === draftSeason && !p.teamId && !p.prospectOf);
  const pub = league.css?.season === draftSeason && league.css.index === u.index ? league.css : null;
  const key = `${draftSeason}:${u.index}:${cls.length}:${pub ? 'p' : 'c'}`;
  const hit = cache.get(league);
  if (hit && hit.key === key) return hit.ranks;

  // The published list when there is one (published as the season goes);
  // otherwise work it out now (older saves, new leagues).
  let order: Player[];
  let prevOf: (p: Player) => number | null;
  if (pub) {
    order = cls.filter((p) => pub.ranks[p.id] !== undefined).sort((a, b) => pub.ranks[a.id] - pub.ranks[b.id]);
    prevOf = (p) => pub.prev?.[p.id] ?? null;
  } else {
    order = rankAt(league, draftSeason, cls, u.index, u.progress);
    prevOf = () => null;
  }
  const ranks = new Map<PlayerId, CssRank>();
  const counts: Record<string, number> = {};
  order.forEach((p, i) => {
    const na = NA_REGIONS.has(playerRegion(league, p));
    const list: CssList = `${na ? 'NA' : 'Intl'} ${p.pos === 'G' ? 'goalies' : 'skaters'}`;
    counts[list] = (counts[list] ?? 0) + 1;
    ranks.set(p.id, { rank: pub ? pub.ranks[p.id] : i + 1, list, listRank: counts[list], prevRank: prevOf(p) });
  });
  cache.set(league, { key, ranks });
  return ranks;
}

/**
 * Publish Central Scouting's list when a new update is due (called every sim
 * day; a no-op between updates). Keeps the previous list for movement.
 */
export function publishCss(league: League) {
  const cls = league.draftClass;
  if (!cls) return;
  const u = cssUpdate(league);
  const cur = league.css?.season === cls.season ? league.css : undefined;
  if (cur && cur.index === u.index) return;
  const players = cls.ids.map((id) => league.players[id]).filter((p) => p && p.draftClass === cls.season && !p.teamId && !p.prospectOf);
  const order = rankAt(league, cls.season, players, u.index, u.progress);
  league.css = {
    season: cls.season,
    index: u.index,
    ranks: Object.fromEntries(order.map((p, i) => [p.id, i + 1])),
    prev: cur?.ranks,
  };
}

/** The class in Central Scouting's order at a given update. */
function rankAt(league: League, draftSeason: number, cls: Player[], index: number, progress: number): Player[] {
  const sd = 6.5 - 3.5 * progress;
  const perf = production(league, cls);
  const score = (p: Player) => {
    // Opinion noise that drifts from update to update rather than jumping.
    const rng = new Rng(deriveSeed(league.seed, `css:${draftSeason}:${p.id}`));
    let z = rng.normal(0, 1);
    for (let k = 1; k <= index; k++) z = 0.9 * z + 0.436 * rng.normal(0, 1);
    return 0.72 * apparentPotential(league, p) + 0.28 * overall(p) + 1.5 * progress * (perf.get(p.id) ?? 0) + sd * z - (p.pos === 'G' ? 2.5 : 0);
  };
  return cls
    .map((p) => ({ p, s: score(p) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
}

/** How each prospect is producing this season, in standard deviations within his league (skaters: points per game; goalies: save %). */
function production(league: League, cls: Player[]): Map<PlayerId, number> {
  const out = new Map<PlayerId, number>();
  const groups = new Map<string, Array<{ id: PlayerId; v: number }>>();
  for (const p of cls) {
    const s = league.prospectStats?.[p.id];
    if (!s || s.gp < 5) continue;
    const v = p.pos === 'G' ? (s.sa ? 1 - (s.ga ?? 0) / s.sa : 0) * 100 : (s.g + s.a) / s.gp;
    const k = `${s.league}:${p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F'}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push({ id: p.id, v });
  }
  for (const xs of groups.values()) {
    if (xs.length < 3) continue;
    const mean = xs.reduce((a, x) => a + x.v, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, x) => a + (x.v - mean) ** 2, 0) / xs.length) || 1;
    for (const x of xs) out.set(x.id, Math.max(-2, Math.min(2, (x.v - mean) / sd)));
  }
  return out;
}
