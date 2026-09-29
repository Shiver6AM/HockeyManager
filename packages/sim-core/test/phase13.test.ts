import { describe, expect, it } from 'vitest';
import { advanceDays, bodyOf, centralScouting, cssEdition, generateLeague, overall } from '../src/index';
import { NAME_POOLS } from '../src/names';

describe('height and weight', () => {
  it('fit the player type, and every player has them', () => {
    const L = generateLeague({ seed: 1301 });
    const by: Record<string, { h: number[]; w: number[] }> = {};
    for (const p of Object.values(L.players)) {
      const b = bodyOf(p, L.season);
      expect(b.height).toBeGreaterThanOrEqual(67);
      expect(b.height).toBeLessThanOrEqual(80);
      expect(b.weight).toBeGreaterThanOrEqual(155);
      expect(b.weight).toBeLessThanOrEqual(260);
      // Stable for the same player.
      expect(bodyOf(p, L.season)).toEqual(b);
      (by[p.archetype] ??= { h: [], w: [] }).h.push(b.height);
      by[p.archetype].w.push(b.weight);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(by.Enforcer.h)).toBeGreaterThan(mean(by.Speedster.h) + 3);
    expect(mean(by.Enforcer.w)).toBeGreaterThan(mean(by.Speedster.w) + 40);
    expect(mean(by['Shutdown D'].w)).toBeGreaterThan(mean(by['Offensive D'].w) + 15);
    expect(mean(by.Butterfly.h)).toBeGreaterThan(mean(by.Athletic.h) + 1.5);
  });
});

describe('name pools', () => {
  it('have hundreds of surnames', () => {
    const total = NAME_POOLS.reduce((s, p) => s + new Set(p.last).size, 0);
    expect(total).toBeGreaterThan(650);
    for (const p of NAME_POOLS) expect(new Set(p.last).size).toBe(p.last.length);
  });
});

describe('Central Scouting', () => {
  it('ranks the whole class into four lists, and the final list is closer to the truth', () => {
    const L = generateLeague({ seed: 1302 });
    advanceDays(L, 1);
    const season = L.draftClass!.season;
    expect(cssEdition(L)).toBe('Preliminary');
    const pre = centralScouting(L, season);
    expect(pre.size).toBe(L.draftClass!.ids.length);
    const lists = new Set([...pre.values()].map((r) => r.list));
    expect(lists).toEqual(new Set(['NA skaters', 'Intl skaters', 'NA goalies', 'Intl goalies']));
    const ranks = [...pre.values()].map((r) => r.rank).sort((a, b) => a - b);
    expect(ranks[0]).toBe(1);
    expect(ranks[ranks.length - 1]).toBe(ranks.length);
    // Error vs. the true order, preliminary vs. final.
    const truth = (id: string) => 0.72 * L.players[id].hidden.potential + 0.28 * overall(L.players[id]) - (L.players[id].pos === 'G' ? 2.5 : 0);
    const trueRank = new Map(
      L.draftClass!.ids
        .slice()
        .sort((a, b) => truth(b) - truth(a))
        .map((id, i) => [id, i + 1]),
    );
    const err = (m: Map<string, { rank: number }>) => {
      const top = [...m.entries()].filter(([id]) => trueRank.get(id)! <= 60);
      return top.reduce((s, [id, r]) => s + Math.abs(r.rank - trueRank.get(id)!), 0) / top.length;
    };
    const L2 = structuredClone(L);
    L2.phase = 'playoffs';
    const fin = centralScouting(L2, season);
    expect(cssEdition(L2)).toBe('Final');
    expect(err(fin)).toBeLessThan(err(pre));
  });
});
