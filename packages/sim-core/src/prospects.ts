/**
 * Prospects' seasons away from the NHL.
 *
 * Drafted players who aren't on an NHL roster play in junior (19 and under)
 * or the AHL (20+). Their games aren't simulated shift by shift; each day a
 * prospect has a game, his line is drawn from his ratings against that
 * level's typical player, so a dominant junior scorer looks like one.
 */
import { age, goalieQuality, overall } from './ratings';
import { clamp, deriveSeed, Rng } from './rng';
import type { CareerLine, League, MinorLine, Player } from './types';

/** NHL seasons only (minor-league seasons don't count toward service time or career totals). */
export const proSeasons = (lines: CareerLine[]) => lines.filter((c) => c.skater || c.goalie || c.teamId);

export const MINORS = {
  /** Chance a prospect has a game on a given day of the season (~70 games). */
  gameChance: 0.39,
  /** Typical overall of a player at each level. */
  levelOverall: { Junior: 50, AHL: 58 } as Record<string, number>,
  /** Points per game for a forward at the level's typical overall. */
  basePpg: 0.55,
};

export function minorLeagueFor(p: Player, season: number): 'Junior' | 'AHL' {
  return age(p, season) <= 19 ? 'Junior' : 'AHL';
}

function poisson(rng: Rng, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let prod = rng.next();
  while (prod > L && k < 12) {
    k++;
    prod *= rng.next();
  }
  return k;
}

const empty = (league: string, goalie: boolean): MinorLine =>
  goalie ? { league, gp: 0, g: 0, a: 0, pim: 0, pm: 0, w: 0, l: 0, sa: 0, ga: 0, so: 0 } : { league, gp: 0, g: 0, a: 0, pim: 0, pm: 0 };

/** One day of minor-league games for every prospect (regular season only). */
export function prospectGameDay(league: League) {
  const rng = new Rng(deriveSeed(league.seed, `minors:${league.season}:${league.day}`));
  const stats = (league.prospectStats ??= {});
  for (const t of Object.values(league.teams)) {
    for (const id of t.prospects ?? []) {
      const p = league.players[id];
      if (!p || p.injury) continue;
      if (!rng.chance(MINORS.gameChance)) continue;
      const lvl = minorLeagueFor(p, league.season);
      const line = (stats[id] ??= empty(lvl, p.pos === 'G'));
      line.league = lvl;
      const rel = overall(p) - MINORS.levelOverall[lvl];
      if (p.goalie) {
        if (!rng.chance(0.72)) continue; // backup nights
        line.gp++;
        const sa = Math.round(clamp(rng.normal(30, 5), 15, 48));
        const sv = clamp(0.897 + (goalieQuality(p.goalie) - MINORS.levelOverall[lvl] - 4) * 0.0022 + rng.normal(0, 0.035), 0.8, 1);
        const ga = Math.max(0, Math.round(sa * (1 - sv)));
        line.sa! += sa;
        line.ga! += ga;
        if (ga === 0) line.so!++;
        if (rng.chance(clamp(0.52 + rel * 0.012 - (ga - 2.8) * 0.1, 0.1, 0.9))) line.w!++;
        else line.l!++;
        continue;
      }
      line.gp++;
      const s = p.skater!;
      const ppg = clamp(MINORS.basePpg * Math.exp(rel / 9) * (p.pos === 'D' ? 0.5 : 1), 0.04, 2.4);
      const goalShare = clamp(0.28 + (s.shooting - s.passing) / 100 + (p.pos === 'D' ? -0.1 : 0.08), 0.12, 0.62);
      line.g += poisson(rng, ppg * goalShare);
      line.a += poisson(rng, ppg * (1 - goalShare));
      line.pim += rng.chance(0.18 + s.checking / 400) ? 2 : 0;
      line.pm += Math.round(clamp(rng.normal(rel * 0.02, 1.1), -3, 3));
    }
  }
}
