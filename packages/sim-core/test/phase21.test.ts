import { beforeAll, describe, expect, it } from 'vitest';
import {
  advanceDays,
  assignToFarm,
  capRoom,
  claimOnWaivers,
  computeTraits,
  generateLeague,
  isTwoWay,
  minorSalaryOf,
  needsWaivers,
  nhlRoster,
  offerUtility,
  overall,
  processWaivers,
  returnInjuryCallUps,
  salaryPaid,
  TRAITS,
  waiverExemption,
  type League,
  type Player,
} from '../src/index';

describe('traits', () => {
  let L: League;
  beforeAll(() => {
    L = generateLeague({ seed: 2101, humans: { HAL: 'me' } });
    advanceDays(L, 1);
  });

  it('are rare, capped at three, and belong to the best players', () => {
    const nhl = Object.values(L.players).filter((p) => p.teamId && !p.farm);
    const withT = nhl.filter((p) => p.traits);
    expect(withT.length / nhl.length).toBeGreaterThan(0.1);
    expect(withT.length / nhl.length).toBeLessThan(0.45);
    for (const p of nhl) expect(Object.keys(p.traits ?? {}).length).toBeLessThanOrEqual(p.pos === 'G' ? 2 : 3);
    const avg = (xs: Player[]) => xs.reduce((s, p) => s + overall(p), 0) / xs.length;
    expect(avg(withT)).toBeGreaterThan(avg(nhl.filter((p) => !p.traits)) + 4);
    // Every trait shows up somewhere in a league.
    const seen = new Set(nhl.flatMap((p) => Object.keys(p.traits ?? {})));
    expect(seen.size).toBeGreaterThanOrEqual(TRAITS.length - 4);
  });

  it('follow the ratings: better shooting, better Sniper tier', () => {
    const p = Object.values(L.players).find((x) => x.skater && x.traits?.sniper)!;
    const before = computeTraits(p).sniper ?? 0;
    p.skater!.shooting = 99;
    p.skater!.offIQ = 99;
    expect(computeTraits(p).sniper ?? 0).toBeGreaterThanOrEqual(before);
    p.skater!.shooting = 40;
    p.skater!.offIQ = 40;
    expect(computeTraits(p).sniper).toBeUndefined();
  });
});

describe('contracts, waivers and injury call-ups', () => {
  let L: League;
  beforeAll(() => {
    L = generateLeague({ seed: 2102, humans: { HAL: 'me' } });
    advanceDays(L, 10);
  });

  it('two-way deals pay an AHL salary on the farm; established players dislike them', () => {
    const t = L.teams.HAL;
    const depth = t.roster.map((id) => L.players[id]).find((p) => p.farm && p.contract && isTwoWay(p.contract))!;
    expect(salaryPaid(depth)).toBe(minorSalaryOf(depth.contract!));
    const vet = nhlRoster(L, t).sort((a, b) => overall(b) - overall(a))[0];
    expect(isTwoWay(vet.contract)).toBe(false);
    const offer = { salary: 5_000_000, years: 3 };
    expect(offerUtility(L, vet, t, { ...offer, twoWay: true })).toBeLessThan(offerUtility(L, vet, t, offer) - 0.1);
  });

  it('a veteran sent down goes on waivers; the worst team that wants him gets him, otherwise he clears', () => {
    const hal = L.teams.HAL;
    const vet = nhlRoster(L, hal).filter((p) => !p.injury && needsWaivers(L, p)).sort((a, b) => a.contract!.salary - b.contract!.salary)[0];
    expect(waiverExemption(L, vet)).toBeNull();
    expect(assignToFarm(L, hal, vet)).toBe('waivers');
    expect(vet.onWaivers).toBe(true);
    expect(nhlRoster(L, hal).includes(vet)).toBe(false);
    // Two human claims: priority goes to the team with the worse record.
    const others = Object.values(L.teams)
      .filter((t) => t.id !== 'HAL')
      .sort((a, b) => capRoom(L, b) - capRoom(L, a));
    for (const t of others.slice(0, 2)) t.controller = { kind: 'human', userId: t.id };
    for (const t of others.slice(0, 2)) claimOnWaivers(L, t, vet.id);
    advanceDays(L, 1);
    processWaivers(L);
    expect(vet.onWaivers).toBe(false);
    expect(vet.teamId).not.toBe('HAL');
    expect(L.transactions.some((x) => x.type === 'waiver-claim' && x.playerId === vet.id)).toBe(true);
    // A young player goes straight down.
    const kid = nhlRoster(L, hal).find((p) => !p.injury && !needsWaivers(L, p));
    if (kid) expect(assignToFarm(L, hal, kid)).toBe('farm');
  });

  it('auto-managed lineups send injury call-ups back down when the regular returns', () => {
    const t = L.teams.HAL;
    t.autoLines = true;
    // (A known starting point: no other defenseman hurt, so the cover isn't still needed.)
    for (const p of nhlRoster(L, t)) if (p.pos === 'D') p.injury = null as never;
    const regular = nhlRoster(L, t).filter((p) => p.pos === 'D').sort((a, b) => overall(b) - overall(a))[0];
    const cover = t.roster.map((id) => L.players[id]).filter((p) => p.farm && p.pos === 'D' && overall(p) < overall(regular))[0];
    cover.farm = false;
    cover.injuryCallUp = true;
    cover.recalledOn = { season: L.season, day: L.day };
    const sent = returnInjuryCallUps(L, t, [regular]);
    expect(sent.map((p) => p.id)).toContain(cover.id);
    expect(cover.farm).toBe(true);
    // Managers running their own lines decide for themselves.
    t.autoLines = false;
    cover.farm = false;
    cover.injuryCallUp = true;
    expect(returnInjuryCallUps(L, t, [regular])).toHaveLength(0);
  });
});
