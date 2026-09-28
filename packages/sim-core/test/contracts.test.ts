import { describe, expect, it } from 'vitest';
import {
  advanceDays,
  askingContract,
  buyoutTerms,
  capRoom,
  contenderScore,
  deadCapFor,
  generateLeague,
  offerExtension,
  offerUtility,
  overall,
  releasePlayer,
  respondToOffer,
  type League,
  type Player,
} from '../src/index';

function finalYearPlayer(L: League, teamId: string, minOvr = 65): Player {
  const p = L.teams[teamId].roster.map((id) => L.players[id]).find((x) => x.contract?.yearsLeft === 1 && x.pos !== 'G' && overall(x) >= minOvr);
  if (!p) throw new Error('no final-year player');
  return p;
}

describe('contract negotiation', () => {
  it('greedier players value money more', () => {
    const L = generateLeague({ seed: 1 });
    const p = finalYearPlayer(L, 'HAL');
    const team = L.teams.HAL;
    const ask = askingContract(L, p);
    const lowball = { salary: Math.round(ask.salary * 0.8), years: ask.years };
    p.hidden.personality.greed = 0.05;
    const modest = offerUtility(L, p, team, lowball, ask);
    p.hidden.personality.greed = 0.95;
    const greedy = offerUtility(L, p, team, lowball, ask);
    expect(greedy).toBeLessThan(modest);
  });

  it('loyal players give their own team a discount', () => {
    const L = generateLeague({ seed: 2 });
    const p = finalYearPlayer(L, 'QUE');
    const ask = askingContract(L, p);
    p.hidden.personality.loyalty = 1;
    const own = offerUtility(L, p, L.teams.QUE, ask, ask);
    const other = offerUtility(L, p, L.teams[p.teamId === 'KC' ? 'SD' : 'KC'], ask, ask);
    // Other factors (contender, role) differ too, so compare against the loyalty bonus size.
    expect(own - other).toBeGreaterThan(-0.2);
    p.hidden.personality.loyalty = 0;
    expect(offerUtility(L, p, L.teams.QUE, ask, ask)).toBeLessThan(own);
  });

  it('ambitious players prefer contenders at equal money', () => {
    const L = generateLeague({ seed: 3 });
    const ranked = Object.keys(L.teams).sort((a, b) => contenderScore(L, b) - contenderScore(L, a));
    const [best, worst] = [L.teams[ranked[0]], L.teams[ranked[ranked.length - 1]]];
    const p = finalYearPlayer(L, ranked[10]);
    p.hidden.personality.ambition = 1;
    p.hidden.personality.loyalty = 0;
    const ask = askingContract(L, p);
    expect(offerUtility(L, p, best, ask, ask)).toBeGreaterThan(offerUtility(L, p, worst, ask, ask));
  });

  it('counters when close, gets annoyed by lowballs, and stops after three offers', () => {
    const L = generateLeague({ seed: 4 });
    const p = finalYearPlayer(L, 'HAM');
    const team = L.teams.HAM;
    const ask = askingContract(L, p);
    const insult = respondToOffer(L, p, team, { salary: Math.max(775_000, Math.round(ask.salary * 0.4 / 25_000) * 25_000), years: ask.years });
    expect(insult.result).toBe('reject');
    expect(L.negotiations![p.id].annoyance).toBeGreaterThan(0);
    const close = respondToOffer(L, p, team, { salary: Math.round(ask.salary * 0.92 / 25_000) * 25_000, years: ask.years });
    expect(['counter', 'accept']).toContain(close.result);
    if (close.result === 'counter') expect(close.counter.salary).toBeGreaterThan(ask.salary * 0.92);
    respondToOffer(L, p, team, { salary: 775_000, years: 1 });
    expect(respondToOffer(L, p, team, ask).result).toBe('refuse');
  });

  it('an accepted extension replaces the contract when it expires', () => {
    const L = generateLeague({ seed: 5, humans: { HAL: 'me' } });
    const p = finalYearPlayer(L, 'HAL');
    const team = L.teams.HAL;
    const ask = askingContract(L, p);
    const generous = { salary: Math.min(14_500_000, Math.round(ask.salary * 1.3 / 25_000) * 25_000), years: ask.years };
    const r = offerExtension(L, team, p, generous);
    expect(r.result).toBe('accept');
    expect(p.extension).toEqual(generous);
    expect(() => offerExtension(L, team, p, generous)).toThrow(/already agreed/);
  });
});

describe('buyouts', () => {
  it('put two-thirds of the remaining money on the cap over twice the years', () => {
    const L = generateLeague({ seed: 6, humans: { HAL: 'me' } });
    advanceDays(L, 5);
    const team = L.teams.HAL;
    const p = team.roster.map((id) => L.players[id]).find((x) => x.contract && x.contract.yearsLeft >= 2 && L.season - x.birthYear >= 26)!;
    const terms = buyoutTerms(L, p)!;
    expect(terms.seasons).toBe(p.contract!.yearsLeft * 2);
    expect(terms.total).toBeCloseTo((p.contract!.salary * p.contract!.yearsLeft * 2) / 3, -3);
    const roomBefore = capRoom(L, team);
    const salary = p.contract!.salary;
    releasePlayer(L, team, p);
    expect(deadCapFor(L, team)).toBe(terms.perSeason);
    expect(capRoom(L, team)).toBe(roomBefore + salary - terms.perSeason);
    expect(L.transactions.at(-2)!.type).toBe('buyout');
  });
});
