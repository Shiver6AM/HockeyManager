import { describe, expect, it } from 'vitest';
import { age, coachability, generateLeague, generateScout, initScouts, offseasonScouts, overall, regionAffinity, REGIONS, Rng } from '../src/index';

describe('coachability: mostly coachable; stubbornness is a young star’s, and fades', () => {
  const L = generateLeague({ seed: 4101 } as never);
  const ps = Object.values(L.players).filter((p) => p.teamId);
  const star = (p: (typeof ps)[number]) => overall(p) >= 80 || p.hidden.potential >= 85;

  it('few players are hard to coach, and young stars are over-represented among them', () => {
    const low = ps.filter((p) => coachability(p, L) < 40);
    expect(low.length / ps.length).toBeLessThan(0.1);
    const youngStars = ps.filter((p) => age(p, L.season) <= 23 && star(p));
    const others = ps.filter((p) => age(p, L.season) >= 26);
    const rate = (g: typeof ps) => g.filter((p) => coachability(p, L) < 40).length / g.length;
    expect(rate(youngStars)).toBeGreaterThan(3 * rate(others));
  });

  it('a stubborn young star grows out of it', () => {
    const p = ps.filter((x) => age(x, L.season) <= 21 && star(x)).sort((a, b) => coachability(a, L) - coachability(b, L))[0];
    const now = coachability(p, L);
    const later = coachability(p, { season: L.season + 7 });
    expect(later).toBeGreaterThan(now + 8);
    // Stable: the same player, the same season, the same answer.
    expect(coachability(structuredClone(p), L)).toBe(now);
  });
});

describe('scouts: grouped regional expertise, and a pool that turns over', () => {
  it('some scouts are generalists; a multi-region expert knows neighbouring regions', () => {
    const rng = new Rng(7);
    const ids = REGIONS.map((r) => r.id);
    let none = 0;
    let multi = 0;
    let close = 0;
    for (let i = 0; i < 1000; i++) {
      const s = generateScout(rng, `t${i}`);
      const ex = ids.filter((r) => s.familiarity[r] >= 72);
      if (!ex.length) none++;
      if (ex.length >= 2) {
        multi++;
        if (ex.every((a) => ex.some((b) => b !== a && regionAffinity(a, b) >= 0.4))) close++;
      }
    }
    expect(none).toBeGreaterThan(120);
    expect(none).toBeLessThan(320);
    expect(close / multi).toBeGreaterThan(0.75); // (about 80%: now and then a scout has worked somewhere unrelated)
  });

  it('3 to 5 of the available scouts are replaced each summer', () => {
    const L = generateLeague({ seed: 4102 } as never);
    initScouts(L);
    const before = new Set((L.scoutPool ?? []).map((s) => s.id));
    offseasonScouts(L);
    const after = L.scoutPool ?? [];
    const fresh = after.filter((s) => !before.has(s.id)).length;
    // (Plus any an AI team hired, which are replaced too.)
    expect(fresh).toBeGreaterThanOrEqual(3);
    expect(after.length).toBe(before.size);
  });
});
