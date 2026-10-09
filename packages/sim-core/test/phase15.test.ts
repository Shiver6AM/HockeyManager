import { beforeAll, describe, expect, it } from 'vitest';
import {
  advanceDays,
  assignScout,
  assignScoutTargets,
  centralScouting,
  cssEdition,
  cssUpdate,
  generateLeague,
  minorLeagueOf,
  scoutConfidence,
  scoutedPotential,
  type League,
  type Player,
} from '../src/index';

describe('sleepers, targeted scouting and live Central Scouting', () => {
  let L: League;
  let cls: () => Player[];
  beforeAll(() => {
    L = generateLeague({ seed: 1501, humans: { HAL: 'me' } });
    advanceDays(L, 1);
    cls = () => L.draftClass!.ids.map((id) => L.players[id]);
  });

  it('every class hides a few sleepers that scouts and Central Scouting underrate', () => {
    const sleepers = cls().filter((p) => (p.hidden.sleeper ?? 0) > 0);
    expect(sleepers.length).toBeGreaterThanOrEqual(3);
    expect(sleepers.length).toBeLessThanOrEqual(7);
    for (const p of sleepers) {
      expect(p.pos).not.toBe('G');
      expect(p.hidden.potential).toBeGreaterThanOrEqual(74);
      // Even a well-informed read misses most of it.
      expect(scoutedPotential(L, 'HAL', p)).toBeLessThan(p.hidden.potential - 5);
    }
    const css = centralScouting(L, L.draftClass!.season);
    const avgSleeper = sleepers.reduce((s, p) => s + css.get(p.id)!.rank, 0) / sleepers.length;
    expect(avgSleeper).toBeGreaterThan(40); // not first-round material on paper
  });

  it('a scout can follow up to 10 prospects in one league, and learns about them fast', () => {
    const hal = L.teams.HAL;
    const sc = hal.scouts![0];
    const ohl = cls().filter((p) => minorLeagueOf(L, p).league === 'OHL');
    const whl = cls().find((p) => minorLeagueOf(L, p).league === 'WHL')!;
    expect(() => assignScoutTargets(L, hal, sc.id, 'OHL', ohl.slice(0, 11).map((p) => p.id))).toThrow(/at most 10/);
    expect(() => assignScoutTargets(L, hal, sc.id, 'OHL', [ohl[0].id, whl.id])).toThrow(/OHL/);
    // Everyone else off the road, so only the targeted scouting counts.
    for (const s of hal.scouts!.slice(1)) assignScout(hal, s.id, 'finland');
    assignScoutTargets(L, hal, sc.id, 'OHL', ohl.slice(0, 3).map((p) => p.id));
    const before = ohl.slice(0, 4).map((p) => scoutConfidence(L, 'HAL', p));
    advanceDays(L, 15);
    const after = ohl.slice(0, 4).map((p) => scoutConfidence(L, 'HAL', p));
    for (let i = 0; i < 3; i++) expect(after[i]).toBeGreaterThan(before[i] + 0.2); // (about what a region gets from a scout in two months)
    expect(after[3]).toBeCloseTo(before[3], 5); // not followed, and nobody's covering Ontario
  });

  it('Central Scouting publishes a new list every two weeks, with movement since the last one', () => {
    expect(cssEdition(L)).not.toBe('Preliminary');
    const u = cssUpdate(L);
    expect(u.final).toBe(false);
    expect(u.index).toBeGreaterThan(0);
    const now = centralScouting(L, L.draftClass!.season);
    const moved = [...now.values()].filter((r) => r.prevRank !== null && r.prevRank !== r.rank);
    expect(moved.length).toBeGreaterThan(10);
    const before = new Map([...now].map(([id, r]) => [id, r.rank]));
    advanceDays(L, 14 - (L.day % 14)); // to the next update
    const next = centralScouting(L, L.draftClass!.season);
    expect(cssUpdate(L).index).toBe(u.index + 1);
    // Last list's ranks are this list's "previous" ranks.
    for (const [id, r] of next) expect(r.prevRank).toBe(before.get(id));
  });
});
