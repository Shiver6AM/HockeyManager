import { beforeAll, describe, expect, it } from 'vitest';
import { advanceDays, age, generateLeague, offseasonStep, overall, PERFORMANCE, seasonPerformance, type League } from '../src/index';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
function corr(x: number[], y: number[]) {
  const mx = mean(x), my = mean(y);
  const c = mean(x.map((v, i) => (v - mx) * (y[i] - my)));
  return c / Math.sqrt(mean(x.map((v) => (v - mx) ** 2)) * mean(y.map((v) => (v - my) ** 2)));
}

describe('season performance feeds development', () => {
  let L: League; // a league at the end of its regular season and playoffs
  beforeAll(() => {
    L = generateLeague({ seed: 3401 } as never);
    while (L.phase !== 'offseason') advanceDays(L, 10);
  }, 120_000);

  it('judges every regular against what his rating predicts: zero on average, at every rating level', () => {
    const perf = seasonPerformance(L);
    const ids = Object.keys(perf);
    expect(ids.length).toBeGreaterThan(500);
    // Only players who played enough.
    for (const id of ids) {
      const s = L.skaterStats[id];
      const g = L.goalieStats[id];
      if (s && L.players[id].pos !== 'G') expect(s.gp).toBeGreaterThanOrEqual(PERFORMANCE.minGames.skater);
      else expect(g.gp).toBeGreaterThanOrEqual(PERFORMANCE.minGames.goalie);
    }
    const sk = ids.filter((id) => L.players[id].pos !== 'G');
    const bonus = sk.map((id) => perf[id].bonus);
    expect(Math.abs(mean(bonus))).toBeLessThan(0.05);
    expect(Math.max(...bonus)).toBeLessThanOrEqual(PERFORMANCE.cap * PERFORMANCE.pointsPerSd + 1e-9);
    expect(Math.min(...bonus)).toBeGreaterThanOrEqual(-PERFORMANCE.cap * PERFORMANCE.pointsPerSd - 1e-9);
    // Being good doesn't earn it and being bad doesn't cost it: it's about the season, not the rating.
    expect(Math.abs(corr(sk.map((id) => overall(L.players[id])), bonus))).toBeLessThan(0.06);
    const stars = sk.filter((id) => overall(L.players[id]) >= 82).map((id) => perf[id].bonus);
    const depth = sk.filter((id) => overall(L.players[id]) <= 66).map((id) => perf[id].bonus);
    expect(Math.abs(mean(stars))).toBeLessThan(0.15);
    expect(Math.abs(mean(depth))).toBeLessThan(0.1);
    // …and among players of the same rating, the ones who scored more are the ones it rewards.
    const fwd = sk.filter((id) => L.players[id].pos !== 'D' && overall(L.players[id]) >= 72 && overall(L.players[id]) <= 76);
    const rate = (id: string) => (L.skaterStats[id].g + L.skaterStats[id].a) / L.skaterStats[id].toi;
    expect(corr(fwd.map(rate), fwd.map((id) => perf[id].z))).toBeGreaterThan(0.6);
    // Labels follow the number.
    for (const id of ids) expect(/above/i.test(perf[id].label)).toBe(perf[id].z >= 0.5);
    // Same league, same answer.
    expect(seasonPerformance(structuredClone(L))).toEqual(perf);
  });

  it('a strong season softens a veteran’s decline and a poor one deepens it, by exactly the difference in their bonus', () => {
    const base = seasonPerformance(L);
    // A 30-something regular with an ordinary season.
    const id = Object.keys(base).find((x) => {
      const p = L.players[x];
      return p.pos !== 'G' && p.pos !== 'D' && age(p, L.season) >= 31 && age(p, L.season) <= 33 && Math.abs(base[x].z) < 0.3 && L.skaterStats[x].gp >= 70;
    })!;
    expect(id).toBeTruthy();
    const summer = (scale: number) => {
      const M = structuredClone(L);
      const s = M.skaterStats[id];
      s.g = Math.round(s.g * scale);
      s.a = Math.round(s.a * scale);
      s.pm = Math.round(s.pm + (scale - 1) * 30);
      const perf = seasonPerformance(M)[id];
      const before = overall(M.players[id]);
      offseasonStep(M, { force: true });
      return { perf, change: overall(M.players[id]) - before, recorded: M.offseason!.performance![id] };
    };
    const great = summer(1.8);
    const awful = summer(0.4);
    expect(great.perf.z).toBeGreaterThan(1.5);
    expect(awful.perf.z).toBeLessThan(-1.5);
    expect(great.perf.label).toMatch(/above/);
    expect(awful.perf.label).toMatch(/below/);
    expect(great.perf.bonus - awful.perf.bonus).toBeGreaterThan(2);
    // Everything else about his summer is identical, so the gap in the result is the gap in the bonus (give or take rounding).
    expect(great.change - awful.change).toBeGreaterThanOrEqual(2);
    expect(Math.abs(great.change - awful.change - (great.perf.bonus - awful.perf.bonus))).toBeLessThanOrEqual(1.5);
    expect(great.recorded).toEqual([great.perf.z, great.perf.bonus]);
  }, 120_000);

  it('counts a shortened season for less, and not at all below the minimum', () => {
    const M = structuredClone(L);
    const perf = seasonPerformance(M);
    const id = Object.keys(perf).find((x) => M.players[x].pos !== 'G' && M.skaterStats[x].gp >= 75 && perf[x].z > 1)!;
    const full = perf[id];
    const cut = (gp: number) => {
      const N = structuredClone(L);
      const s = N.skaterStats[id];
      const k = gp / s.gp;
      for (const key of ['g', 'a', 'pm', 'toi', 'ppg', 'ppa'] as const) s[key] = Math.round(s[key] * k);
      s.gp = gp;
      return seasonPerformance(N)[id];
    };
    const half = cut(30);
    expect(half).toBeTruthy();
    expect(half.bonus).toBeLessThan(full.bonus);
    expect(half.bonus).toBeGreaterThan(0);
    expect(cut(PERFORMANCE.minGames.skater - 1)).toBeUndefined();
    // Farm players and prospects aren't judged.
    const farm = Object.values(L.players).find((p) => p.farm && !L.skaterStats[p.id] && !L.goalieStats[p.id])!;
    expect(perf[farm.id]).toBeUndefined();
  });

  it('can be turned off or up with the commissioner slider', () => {
    const off = structuredClone(L);
    off.settings.sim = { ...off.settings.sim, performance: 0 };
    expect(Object.values(seasonPerformance(off)).every((x) => x.bonus === 0)).toBe(true);
    const twice = structuredClone(L);
    twice.settings.sim = { ...twice.settings.sim, performance: 2 };
    const a = seasonPerformance(L);
    const b = seasonPerformance(twice);
    const id = Object.keys(a).find((x) => Math.abs(a[x].bonus) > 0.5)!;
    expect(b[id].bonus).toBeCloseTo(a[id].bonus * 2, 1);
    expect(b[id].z).toBe(a[id].z);
  });
});
