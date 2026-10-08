import { describe, expect, it } from 'vitest';
import { advanceDays, assignScout, generateLeague, regionConfidence, regionScoutReads, REGIONS, scoutCeiling, scoutRate, scoutRead } from '../src/index';

describe('scouting coverage: one scout sees only so much', () => {
  it('a good scout gets a region he knows to about 60% in a season; a second one is needed for high confidence', () => {
    const season = 223; // scouting days, opening night to the end of the playoffs
    const rate = (skill: number, fam: number) => (0.6 + skill / 100) * (0.45 + fam / 100);
    const good = scoutRead(80, rate(80, 85) * season);
    expect(good).toBeGreaterThan(0.55);
    expect(good).toBeLessThan(0.68);
    // However long he stays.
    expect(scoutRead(80, 1e6)).toBeCloseTo(scoutCeiling(80), 6);
    expect(scoutCeiling(95)).toBeLessThanOrEqual(0.8);
    // Two of them: high confidence.
    expect(1 - (1 - good) ** 2).toBeGreaterThan(0.8);
    // A weak scout in a region he doesn't know learns much less.
    expect(scoutRead(50, rate(50, 30) * season)).toBeLessThan(0.35);
  });

  it('reads of the same region combine, each catching some of what the others miss', () => {
    const L = generateLeague({ seed: 3901 } as never);
    advanceDays(L, 1); // (scouts are hired as the season starts)
    const t = L.teams.HAL;
    const [a, b] = t.scouts!;
    const r = REGIONS[1].id;
    for (const s of t.scouts!) assignScout(t, s.id, REGIONS[7].id);
    assignScout(t, a.id, r);
    advanceDays(L, 40);
    const one = regionConfidence(L, 'HAL', r);
    expect(regionScoutReads(L, 'HAL', r).map((x) => x.scoutId)).toEqual([a.id]);
    assignScout(t, b.id, r);
    advanceDays(L, 40);
    const reads = regionScoutReads(L, 'HAL', r);
    expect(reads).toHaveLength(2);
    const both = regionConfidence(L, 'HAL', r);
    expect(both).toBeCloseTo(1 - reads.reduce((m, x) => m * (1 - x.read), 1), 6);
    expect(both).toBeGreaterThan(Math.max(...reads.map((x) => x.read)));
    expect(both).toBeGreaterThan(one);
    expect(scoutRate(t, a, r)).toBeGreaterThan(0);
  });
});
