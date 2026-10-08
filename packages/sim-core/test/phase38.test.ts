import { beforeAll, describe, expect, it } from 'vitest';
import { advanceDays, generateLeague, posGroup, roleWeights, seasonPerformance, type League } from '../src/index';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
function corr(x: number[], y: number[]) {
  const mx = mean(x), my = mean(y);
  const c = mean(x.map((v, i) => (v - mx) * (y[i] - my)));
  return c / Math.sqrt(mean(x.map((v) => (v - mx) ** 2)) * mean(y.map((v) => (v - my) ** 2)));
}

describe('season assessment by position, minutes and player type', () => {
  let L: League;
  beforeAll(() => {
    L = generateLeague({ seed: 3801 } as never);
    while (L.phase === 'regular-season') advanceDays(L, 10);
  }, 180_000);

  it('weights follow the player type, and centers are judged on faceoffs too', () => {
    const w = (pos: string, archetype: string) => roleWeights({ pos, archetype } as never);
    expect(w('LW', 'Sniper').goals).toBeGreaterThan(w('LW', 'Playmaker').goals!);
    expect(w('RW', 'Playmaker').assists).toBeGreaterThan(w('RW', 'Sniper').assists!);
    expect(w('D', 'Shutdown D').defense).toBeGreaterThan(w('D', 'Offensive D').defense!);
    expect(w('D', 'Offensive D').scoring).toBeGreaterThan(w('D', 'Shutdown D').scoring!);
    expect(w('LW', 'Enforcer').physical).toBeGreaterThan(w('LW', 'Speedster').physical ?? 0);
    expect(w('C', 'Two-Way').faceoffs).toBeGreaterThan(0);
    expect(w('LW', 'Two-Way').faceoffs).toBeUndefined();
    for (const [pos, a] of [['C', 'Sniper'], ['D', 'Two-Way D'], ['RW', 'Grinder']] as const) {
      expect(Object.values(w(pos, a)).reduce((s, v) => s + v!, 0)).toBeCloseTo(1, 6);
    }
  });

  it('shows what each verdict was made of, adding up to his whole season', () => {
    const perf = seasonPerformance(L);
    const ids = Object.keys(perf).filter((id) => L.players[id].pos !== 'G');
    expect(ids.length).toBeGreaterThan(400);
    for (const id of ids) {
      const parts = perf[id].parts;
      expect(parts.length).toBeGreaterThanOrEqual(3);
      expect(parts.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 1);
    }
    const centers = ids.filter((id) => L.players[id].pos === 'C' && L.skaterStats[id].fow + L.skaterStats[id].fol >= 300);
    expect(centers.length).toBeGreaterThan(20);
    for (const id of centers) expect(perf[id].parts.some((x) => x.key === 'faceoffs')).toBe(true);
    const g = Object.keys(perf).find((id) => L.players[id].pos === 'G')!;
    expect(perf[g].parts.map((x) => x.key)).toEqual(['saves']);
  });

  it('is judged within each position, with minutes accounted for', () => {
    const perf = seasonPerformance(L);
    const ids = Object.keys(perf).filter((id) => L.players[id].pos !== 'G');
    for (const g of ['C', 'W', 'D'] as const) {
      const zs = ids.filter((id) => posGroup(L.players[id]) === g).map((id) => perf[id].z);
      expect(zs.length).toBeGreaterThan(40);
      expect(Math.abs(mean(zs))).toBeLessThan(0.05);
      // Playing big minutes doesn't by itself make a good season, or a poor one.
      const grp = ids.filter((id) => posGroup(L.players[id]) === g);
      const toi = grp.map((id) => L.skaterStats[id].toi / L.skaterStats[id].gp);
      const scoring = grp.map((id) => perf[id].parts.find((x) => x.key === 'scoring')!.z);
      expect(Math.abs(corr(toi, scoring))).toBeLessThan(0.1);
    }
  });

  it('a shutdown defenseman’s season follows his defense, a sniper’s his goals', () => {
    const perf = seasonPerformance(L);
    const part = (id: string, k: string) => perf[id].parts.find((x) => x.key === k)?.z ?? 0;
    const shut = Object.keys(perf).filter((id) => L.players[id].archetype === 'Shutdown D');
    expect(shut.length).toBeGreaterThan(10);
    const zS = shut.map((id) => perf[id].z);
    expect(corr(shut.map((id) => part(id, 'defense')), zS)).toBeGreaterThan(corr(shut.map((id) => part(id, 'scoring')), zS));
    const snipers = Object.keys(perf).filter((id) => L.players[id].archetype === 'Sniper');
    const zN = snipers.map((id) => perf[id].z);
    expect(corr(snipers.map((id) => part(id, 'goals')), zN)).toBeGreaterThan(corr(snipers.map((id) => part(id, 'defense')), zN));
  });
});
