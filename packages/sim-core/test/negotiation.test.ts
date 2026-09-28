import { describe, expect, it } from 'vitest';
import {
  advanceDays,
  age,
  askFromTeam,
  askingContract,
  capRoom,
  freeAgents,
  generateLeague,
  hireStaff,
  negotiateFreeAgent,
  offerUtility,
  overall,
  respondToOffer,
  salaryNeeded,
  STAFF_POOL,
  STAFF_ROLES,
  teamInterest,
  termProfile,
  type League,
  type Player,
  type Team,
} from '../src/index';

const L: League = generateLeague({ seed: 31, humans: { HAL: 'me' } });
const teams = Object.values(L.teams);
const byContender = [...teams].sort(
  (a, b) =>
    b.roster.map((id) => overall(L.players[id])).sort((x, y) => y - x).slice(0, 20).reduce((s, x) => s + x, 0) -
    a.roster.map((id) => overall(L.players[id])).sort((x, y) => y - x).slice(0, 20).reduce((s, x) => s + x, 0),
);
const top = byContender[0];
const bottom = byContender.at(-1)!;
const vet = (): Player => Object.values(L.players).find((p) => p.teamId && age(p, L.season) >= 31 && overall(p) >= 72)!;
const kid = (): Player => Object.values(L.players).find((p) => p.teamId && age(p, L.season) <= 22 && overall(p) >= 60)!;
const clone = (p: Player, personality: Player['hidden']['personality']): Player => ({ ...p, hidden: { ...p.hidden, personality } });

describe('interest in a team', () => {
  it('ambitious players prefer contenders, and interest shows its reasons', () => {
    const p = clone(vet(), { greed: 0.5, loyalty: 0, ambition: 1 });
    const hi = teamInterest(L, p, top);
    const lo = teamInterest(L, p, bottom);
    expect(hi.score).toBeGreaterThan(lo.score);
    expect(hi.factors.some((f) => /contender/.test(f.label) && f.effect > 0)).toBe(true);
    expect(lo.factors.some((f) => /rebuilding/.test(f.label) && f.effect < 0)).toBe(true);
    for (const i of [hi, lo]) {
      expect(i.score).toBeGreaterThanOrEqual(0);
      expect(i.score).toBeLessThanOrEqual(100);
    }
  });

  it('loyal players like their own team more than the same player with no loyalty', () => {
    const p = vet();
    const own = L.teams[p.teamId!];
    expect(teamInterest(L, clone(p, { ...p.hidden.personality, loyalty: 1 }), own).score).toBeGreaterThan(
      teamInterest(L, clone(p, { ...p.hidden.personality, loyalty: 0 }), own).score,
    );
  });

  it('interest moves the ask: more interest, lower price', () => {
    const p = clone(vet(), { greed: 0.5, loyalty: 0, ambition: 1 });
    const base = askingContract(L, p);
    const a = askFromTeam(L, p, top, base);
    const b = askFromTeam(L, p, bottom, base);
    expect(a.salary).toBeLessThan(b.salary);
    expect(a.salary).toBeGreaterThanOrEqual(base.salary * 0.78 - 25_000);
    expect(b.salary).toBeLessThanOrEqual(base.salary * 1.25 + 25_000);
  });
});

describe('money versus term', () => {
  it('an offer at his ask from that team is exactly acceptable', () => {
    const p = vet();
    const t = L.teams[p.teamId!];
    const base = askingContract(L, p);
    expect(offerUtility(L, p, t, askFromTeam(L, p, t, base), base)).toBeCloseTo(1, 5);
  });

  it('veterans want security: short deals cost more, and they take less per year for extra years', () => {
    const p = vet();
    const t = L.teams[p.teamId!];
    const want = askFromTeam(L, p, t).years;
    const tp = termProfile(L, p);
    expect(tp.longEffect).toBeLessThan(0);
    expect(tp.shortPenalty).toBeGreaterThan(0.03);
    if (want > 1) expect(salaryNeeded(L, p, t, want - 1, 1)).toBeGreaterThan(salaryNeeded(L, p, t, want, 1));
    if (want <= 6) expect(salaryNeeded(L, p, t, want + 2, 1)).toBeLessThan(salaryNeeded(L, p, t, want, 1));
    // The discount for security stops after a few extra years.
    if (want === 1) expect(salaryNeeded(L, p, t, 8, 1)).toBe(salaryNeeded(L, p, t, 4, 1));
  });

  it('young players don’t want to be locked in', () => {
    const p = kid();
    const tp = termProfile(L, p);
    expect(tp.longEffect).toBeGreaterThan(0);
    const t = L.teams[p.teamId!];
    const want = askFromTeam(L, p, t).years;
    expect(salaryNeeded(L, p, t, Math.min(8, want + 3), 1)).toBeGreaterThan(salaryNeeded(L, p, t, want, 1));
  });

  it('greedy players weigh money more heavily', () => {
    const p = vet();
    expect(termProfile(L, clone(p, { ...p.hidden.personality, greed: 1 })).moneyWeight).toBeGreaterThan(
      termProfile(L, clone(p, { ...p.hidden.personality, greed: 0 })).moneyWeight,
    );
  });

  it('counters come back at a price that he then accepts', () => {
    const G = generateLeague({ seed: 32 });
    const p = Object.values(G.players).find((x) => x.teamId && overall(x) >= 75)!;
    const t = G.teams[p.teamId!];
    const base = askingContract(G, p);
    const ask = askFromTeam(G, p, t, base);
    const r = respondToOffer(G, p, t, { salary: Math.round((ask.salary * 0.9) / 25_000) * 25_000, years: ask.years }, { ask: base });
    expect(r.result).toBe('counter');
    if (r.result !== 'counter') return;
    expect(respondToOffer(G, p, t, r.counter, { ask: base }).result).toBe('accept');
  });
});

describe('free agents after the bidding', () => {
  it('in season, a free agent is negotiated with and signs on acceptance', () => {
    const G = generateLeague({ seed: 33, humans: { HAL: 'me' } });
    advanceDays(G, 2);
    const t: Team = G.teams.HAL;
    const p = freeAgents(G).sort((a, b) => overall(b) - overall(a))[0];
    const base = { salary: Math.max(775_000, Math.round((askingContract(G, p).salary * 0.6) / 25_000) * 25_000), years: 1 };
    expect(() => negotiateFreeAgent(G, t, p, { salary: capRoom(G, t) + 1_000_000, years: 1 }, base)).toThrow(/cap room/);
    const need = salaryNeeded(G, p, t, askFromTeam(G, p, t, base).years, 0.9, base);
    const r = negotiateFreeAgent(G, t, p, { salary: need, years: askFromTeam(G, p, t, base).years }, base);
    expect(r.result).toBe('accept');
    expect(p.teamId).toBe('HAL');
    expect(t.roster).toContain(p.id);
  });
});

describe('staff job market', () => {
  it('always has a full slate with strong candidates, and stays stocked after hires', () => {
    const G = generateLeague({ seed: 34 });
    const check = () => {
      for (const role of STAFF_ROLES) {
        const pool = G.staffPool!.filter((s) => s.role === role);
        expect(pool.length).toBeGreaterThanOrEqual(STAFF_POOL.perRole);
        expect(pool.filter((s) => s.rating >= STAFF_POOL.strongMin).length).toBeGreaterThanOrEqual(STAFF_POOL.strong);
      }
    };
    check();
    for (let i = 0; i < 5; i++) {
      const best = G.staffPool!.filter((s) => s.role === 'coach').sort((a, b) => b.rating - a.rating)[0];
      hireStaff(G, Object.values(G.teams)[i], best.id);
    }
    check();
    const ids = [...G.staffPool!.map((s) => s.id), ...Object.values(G.teams).flatMap((t) => STAFF_ROLES.map((r) => t.staff![r].id))];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
