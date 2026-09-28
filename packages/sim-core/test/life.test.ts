import { beforeAll, describe, expect, it } from 'vitest';
import {
  advanceDays,
  advanceToEndOfSeason,
  advanceToNextSeason,
  closeBooks,
  coachDevMultiplier,
  expenses,
  generateLeague,
  hallOfFameScore,
  HOF_THRESHOLD,
  hireStaff,
  offseasonStep,
  revenue,
  scoutingError,
  STAFF_ROLES,
  staffSalary,
  trainerInjuryMultiplier,
  type League,
} from '../src/index';

describe('staff', () => {
  const L = generateLeague({ seed: 11 });
  const t = L.teams.HAL;

  it('gives every team a coach, scout and trainer, and fills the job market', () => {
    for (const team of Object.values(L.teams)) for (const r of STAFF_ROLES) expect(team.staff![r].rating).toBeGreaterThanOrEqual(40);
    for (const r of STAFF_ROLES) expect(L.staffPool!.filter((s) => s.role === r).length).toBeGreaterThanOrEqual(8);
  });

  it('pays better staff more and maps ratings to effects in range', () => {
    expect(staffSalary(90)).toBeGreaterThan(staffSalary(60));
    t.staff!.coach.rating = 95;
    t.staff!.scout.rating = 95;
    t.staff!.trainer.rating = 95;
    expect(coachDevMultiplier(L, 'HAL')).toBeCloseTo(1.1);
    expect(scoutingError(L, 'HAL', true)).toBeCloseTo(2);
    expect(trainerInjuryMultiplier(L, 'HAL')).toBeCloseTo(0.8);
    t.staff!.coach.rating = 40;
    expect(coachDevMultiplier(L, 'HAL')).toBeLessThan(0.92);
    expect(coachDevMultiplier(L, null)).toBe(1); // free agents: an average staff is neutral
    t.staff!.trainer.rating = 65;
    expect(trainerInjuryMultiplier(L, 'HAL')).toBe(1);
  });

  it('hires from the pool, returning the old staffer and charging a settlement', () => {
    const old = { ...t.staff!.trainer, yearsLeft: 3 };
    t.staff!.trainer = old;
    const hire = L.staffPool!.find((s) => s.role === 'trainer')!;
    const before = t.finances!.staff;
    const { settlement } = hireStaff(L, t, hire.id);
    expect(settlement).toBe(Math.round(old.salary)); // half of two remaining years
    expect(t.finances!.staff).toBe(before + settlement);
    expect(t.staff!.trainer.id).toBe(hire.id);
    expect(L.staffPool!.some((s) => s.id === old.id)).toBe(true);
    expect(() => hireStaff(L, t, hire.id)).toThrow(/not available/);
  });
});

describe('a season of league life', () => {
  let L: League;
  beforeAll(() => {
    L = generateLeague({ seed: 77, humans: { HAL: 'me' } });
    advanceToEndOfSeason(L);
  });

  it('books 41 home games per team with sane attendance and money', () => {
    for (const t of Object.values(L.teams)) {
      const f = t.finances!;
      expect(f.homeGames).toBe(41);
      expect(f.gp).toBe(82);
      const avg = f.attendance / f.homeGames;
      expect(avg).toBeGreaterThan(8_000);
      expect(avg).toBeLessThanOrEqual(18_000);
      expect(revenue(f)).toBeGreaterThan(100_000_000);
      expect(expenses(f)).toBeGreaterThan(100_000_000);
    }
    const champ = L.teams[L.playoffs!.champion!];
    expect(champ.finances!.playoffGate).toBeGreaterThan(0);
    // Big markets out-earn small ones on average.
    const byMarket = Object.values(L.teams).sort((a, b) => b.market! - a.market!);
    const avgGate = (ts: typeof byMarket) => ts.reduce((s, t) => s + t.finances!.gate, 0) / ts.length;
    expect(avgGate(byMarket.slice(0, 8))).toBeGreaterThan(avgGate(byMarket.slice(-8)));
  });

  it('writes news: game stories, awards and the champion', () => {
    const kinds = new Set(L.news!.map((n) => n.kind));
    for (const k of ['game', 'award', 'playoffs']) expect(kinds).toContain(k);
    expect(L.news!.length).toBeGreaterThan(50);
    const ids = L.news!.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('owners review the season with a goal and confidence', () => {
    for (const t of Object.values(L.teams)) {
      expect(t.owner!.lastReview).toMatch(/Goal (met|missed)/);
      expect(t.owner!.confidence).toBeGreaterThanOrEqual(0);
      expect(t.owner!.confidence).toBeLessThanOrEqual(100);
    }
    expect(L.news!.some((n) => n.kind === 'owner' && n.teamIds.includes('HAL'))).toBe(true);
  });

  it('closes the books at rollover and carries cash forward', () => {
    const f = L.teams.HAL.finances!;
    const profit = revenue(f) - expenses(f);
    const copy = structuredClone(L);
    closeBooks(copy);
    expect(copy.teams.HAL.cash).toBeCloseTo((L.teams.HAL.cash ?? 0) + profit);
    expect(copy.teams.HAL.financeHistory!.at(-1)!.season).toBe(L.season);
    expect(copy.teams.HAL.finances!.homeGames).toBe(0);
  });

  it('runs an absent human through the offseason (assistant GM) into a new season', () => {
    const season = L.season;
    advanceToNextSeason(L);
    expect(L.season).toBe(season + 1);
    expect(L.phase).toBe('regular-season');
    expect(L.teams.HAL.roster.length).toBeGreaterThanOrEqual(20);
    expect(L.teams.HAL.financeHistory).toHaveLength(1);
    expect(L.transactions.some((t) => t.type === 'retirement')).toBe(true);
    advanceDays(L, 5);
    expect(L.teams.HAL.finances!.gp).toBeGreaterThan(0);
  });

  it('scores retired careers for the Hall of Fame', () => {
    const retired = Object.values(L.retired ?? {});
    expect(retired.length).toBeGreaterThan(0);
    for (const r of L.hallOfFame ?? []) expect(hallOfFameScore(L, L.retired![r.playerId])).toBeGreaterThanOrEqual(HOF_THRESHOLD);
    const scrub = retired.reduce((a, b) => (a.peakOverall < b.peakOverall ? a : b));
    expect(hallOfFameScore(L, scrub)).toBeLessThan(HOF_THRESHOLD);
  });
});

describe('news from transactions', () => {
  it('posts trades and big signings once, from the log', () => {
    const L = generateLeague({ seed: 5 });
    advanceToEndOfSeason(L);
    while (L.phase === 'offseason') offseasonStep(L, { force: true });
    const signings = L.news!.filter((n) => n.kind === 'signing');
    expect(signings.length).toBeGreaterThan(0);
    const heads = L.news!.filter((n) => n.kind === 'trade').map((n) => `${n.season}:${n.headline}`);
    expect(new Set(heads).size).toBe(heads.length);
  });
});
