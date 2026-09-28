import { describe, expect, it } from 'vitest';
import { advanceDays, advanceToPlayoffs as advanceToEnd, generateLeague, lastDay, simulateGame, standings, gameSeed } from '../src/index';

describe('schedule', () => {
  const L = generateLeague({ seed: 42 });

  it('gives every team 82 games, 41 home and 41 away', () => {
    for (const id of Object.keys(L.teams)) {
      const home = L.schedule.filter((g) => g.home === id).length;
      const away = L.schedule.filter((g) => g.away === id).length;
      expect(home).toBe(41);
      expect(away).toBe(41);
    }
    expect(L.schedule.length).toBe(1312);
  });

  it('never schedules a team twice on the same day', () => {
    const seen = new Set<string>();
    for (const g of L.schedule) {
      for (const t of [g.home, g.away]) {
        const key = `${g.day}:${t}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('fits in a realistic season length', () => {
    expect(lastDay(L)).toBeGreaterThan(150);
    expect(lastDay(L)).toBeLessThan(230);
  });
});

describe('determinism (both advance modes produce the same league)', () => {
  it('advancing day-by-day equals advancing all at once', () => {
    const a = generateLeague({ seed: 7 });
    const b = generateLeague({ seed: 7 });
    advanceToEnd(a);
    while (b.phase === 'regular-season') advanceDays(b, 1);
    expect(JSON.stringify(standings(a))).toBe(JSON.stringify(standings(b)));
    expect(JSON.stringify(a.skaterStats)).toBe(JSON.stringify(b.skaterStats));
  });

  it('uneven chunks (e.g. 3 days, then a week, then the rest) match too', () => {
    const a = generateLeague({ seed: 11 });
    const b = generateLeague({ seed: 11 });
    advanceDays(a, 40);
    advanceDays(b, 3);
    advanceDays(b, 7);
    advanceDays(b, 30);
    expect(a.day).toBe(b.day);
    expect(JSON.stringify(a.goalieStats)).toBe(JSON.stringify(b.goalieStats));
  });

  it('the same game replayed with its seed gives the same result', () => {
    const L = generateLeague({ seed: 5 });
    const g = L.schedule[0];
    const r1 = simulateGame(L, L.teams[g.home], L.teams[g.away], gameSeed(L, g.id));
    const r2 = simulateGame(L, L.teams[g.home], L.teams[g.away], gameSeed(L, g.id));
    expect(r1).toEqual(r2);
  });

  it('human vs AI control only matters through lineup decisions', () => {
    // Identical lineups on opening night -> identical results. After that,
    // humans keep their own lines (e.g. when a player returns from injury),
    // so outcomes are allowed to diverge.
    const a = generateLeague({ seed: 9 });
    const b = generateLeague({ seed: 9, humans: { HAL: 'user-1', KC: 'user-2' } });
    expect(b.teams.HAL.controller).toEqual({ kind: 'human', userId: 'user-1' });
    advanceDays(a, 1);
    advanceDays(b, 1);
    expect(JSON.stringify(standings(a))).toBe(JSON.stringify(standings(b)));
  });
});

describe('box scores are internally consistent', () => {
  const L = generateLeague({ seed: 3 });
  advanceDays(L, 30);
  const played = L.schedule.filter((g) => g.result);

  it('goal events add up to the final score', () => {
    for (const g of played) {
      const r = g.result!;
      const hg = r.box.goals.filter((x) => x.teamId === g.home).length;
      const ag = r.box.goals.filter((x) => x.teamId === g.away).length;
      const soBonusHome = r.shootout && r.homeScore > r.awayScore ? 1 : 0;
      const soBonusAway = r.shootout && r.awayScore > r.homeScore ? 1 : 0;
      expect(hg + soBonusHome).toBe(r.homeScore);
      expect(ag + soBonusAway).toBe(r.awayScore);
      expect(r.homeScore).not.toBe(r.awayScore);
    }
  });

  it('every game has exactly one W and one L/OTL', () => {
    for (const g of played) {
      const d = Object.values(g.result!.box.goalies).map((x) => x.decision).filter(Boolean).sort();
      expect(d.length).toBe(2);
      expect(d).toContain('W');
    }
  });

  it('goalie goals-against plus empty-net goals equal goals allowed', () => {
    for (const g of played) {
      const b = g.result!.box;
      const ga = Object.values(b.goalies).reduce((s, x) => s + x.ga, 0);
      const en = b.goals.filter((x) => x.strength === 'EN').length;
      expect(ga + en).toBe(b.goals.length);
    }
  });

  it('standings points equal 2*wins + OT losses and GP is balanced', () => {
    const st = standings(L);
    for (const r of st) expect(r.pts).toBe(2 * r.w + r.otl);
    const totalW = st.reduce((s, r) => s + r.w, 0);
    expect(totalW).toBe(played.length);
  });
});
