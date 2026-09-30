import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACTIVE_MAX,
  activeRoster,
  advanceDays,
  assignScout,
  BURY_EXEMPT,
  callUp,
  capHit,
  coachesOf,
  CONTRACT_MAX,
  contractCount,
  farmRoster,
  freeAgents,
  generateLeague,
  hireSkillsCoach,
  isDraftClass,
  minorLeagueOf,
  MINOR_LEAGUES,
  nhlRoster,
  playerRegion,
  regionConfidence,
  releaseScout,
  REGIONS,
  scoutConfidence,
  scoutedPotential,
  sendDown,
  setCoachPlan,
  SCOUTING,
  type League,
} from '../src/index';

describe('farm teams', () => {
  let L: League;
  beforeAll(() => {
    L = generateLeague({ seed: 1201, humans: { HAL: 'me' } });
    advanceDays(L, 40);
  });

  it('every team has an AHL affiliate, at most 50 contracts and at most 23 healthy players up top', () => {
    for (const t of Object.values(L.teams)) {
      expect(farmRoster(L, t).length).toBeGreaterThanOrEqual(8);
      expect(contractCount(t)).toBeLessThanOrEqual(CONTRACT_MAX);
      expect(activeRoster(L, t).length).toBeLessThanOrEqual(ACTIVE_MAX);
      expect(t.affiliate).toBeTruthy();
    }
  });

  it('injuries are covered from the farm, not by signing free agents', () => {
    const signed = L.transactions.filter((x) => x.type === 'signing' && x.day > 0 && /emergency/i.test(x.note)).length;
    const callUps = L.transactions.filter((x) => x.type === 'call-up').length;
    expect(callUps).toBeGreaterThan(0);
    expect(signed).toBe(0);
  });

  it('only salary above the bury exemption counts against the cap while in the minors', () => {
    const t = L.teams.HAL;
    const p = nhlRoster(L, t).find((x) => !x.injury && (x.contract?.salary ?? 0) > BURY_EXEMPT + 1_000_000)!;
    expect(capHit(p)).toBe(p.contract!.salary);
    sendDown(L, t, p);
    expect(capHit(p)).toBe(p.contract!.salary - BURY_EXEMPT);
    // Calling him back up needs a healthy roster spot.
    while (activeRoster(L, t).length < ACTIVE_MAX) {
      const f = farmRoster(L, t).find((x) => !x.injury && x.id !== p.id)!;
      callUp(L, t, f);
    }
    expect(() => callUp(L, t, p)).toThrow(/healthy players/);
    sendDown(L, t, nhlRoster(L, t).find((x) => !x.injury && x.pos === p.pos && x.id !== p.id)!);
    callUp(L, t, p);
    expect(p.farm).toBe(false);
  });

  it('prospects and farm players are placed in real development leagues', () => {
    const t = L.teams.HAL;
    const farmer = farmRoster(L, t)[0];
    expect(minorLeagueOf(L, farmer, 'X').league).toBe('AHL');
    const pros = Object.values(L.players).filter((p) => p.prospectOf);
    const leagues = new Set(pros.map((p) => minorLeagueOf(L, p).league));
    expect(leagues.size).toBeGreaterThan(4);
    for (const lg of leagues) {
      expect(MINOR_LEAGUES[lg]).toBeTruthy();
      expect(MINOR_LEAGUES[lg].teams).toContain(pros.find((p) => minorLeagueOf(L, p).league === lg)!.minorTeam!.team);
    }
  });
});

describe('scouting and the draft class', () => {
  let L: League;
  beforeAll(() => {
    L = generateLeague({ seed: 1202, humans: { HAL: 'me' } });
    advanceDays(L, 1);
  });

  it('next summer\'s class plays this season and is not available as free agents', () => {
    expect(L.draftClass?.season).toBe(L.season);
    expect(L.draftClass!.ids.length).toBeGreaterThan(200);
    const fa = new Set(freeAgents(L).map((p) => p.id));
    for (const id of L.draftClass!.ids) {
      expect(isDraftClass(L, L.players[id])).toBe(true);
      expect(fa.has(id)).toBe(false);
    }
  });

  it('confidence grows only where scouts go, faster for skilled scouts who know the region', () => {
    const hal = L.teams.HAL;
    expect(hal.scouts!.length).toBeGreaterThan(0);
    // One scout, parked in the region he knows least.
    while (hal.scouts!.length > 1) releaseScout(L, hal, hal.scouts![1].id);
    const s = hal.scouts![0];
    const worst = REGIONS.map((r) => r.id).sort((a, b) => s.familiarity[a] - s.familiarity[b])[0];
    const others = REGIONS.map((r) => r.id).filter((r) => r !== worst);
    const before = Object.fromEntries(others.map((r) => [r, regionConfidence(L, 'HAL', r)]));
    const w0 = regionConfidence(L, 'HAL', worst);
    assignScout(hal, s.id, worst);
    advanceDays(L, 20);
    expect(regionConfidence(L, 'HAL', worst)).toBeGreaterThan(w0);
    for (const r of others) expect(regionConfidence(L, 'HAL', r)).toBeCloseTo(before[r], 6);
    expect(regionConfidence(L, 'HAL', worst)).toBeLessThan(1);
  });

  it('fog of war: projections for unscouted prospects are much noisier', () => {
    const cls = L.draftClass!.ids.map((id) => L.players[id]);
    const hal = L.teams.HAL;
    const scouted = new Set(REGIONS.map((r) => r.id).filter((r) => regionConfidence(L, 'HAL', r) > 0.1));
    const err = (ps: typeof cls) => Math.sqrt(ps.reduce((s, p) => s + (scoutedPotential(L, 'HAL', p) - p.hidden.potential) ** 2, 0) / ps.length);
    const known = cls.filter((p) => scouted.has(playerRegion(L, p)));
    const unknown = cls.filter((p) => !scouted.has(playerRegion(L, p)) && scoutConfidence(L, 'HAL', p) < SCOUTING.showAt);
    expect(known.length).toBeGreaterThan(5);
    expect(unknown.length).toBeGreaterThan(20);
    expect(err(unknown)).toBeGreaterThan(err(known));
    expect(err(unknown)).toBeGreaterThan(8);
    expect(hal.scouts!.length).toBe(1);
  });
});

describe('goalie coaches', () => {
  it('every team has one; he works only with goalies, up to four', () => {
    const L = generateLeague({ seed: 1203, humans: { HAL: 'me' } });
    advanceDays(L, 1);
    const hal = L.teams.HAL;
    for (const t of Object.values(L.teams)) expect(t.goalieCoach?.kind).toBe('goalie');
    const gc = hal.goalieCoach!;
    expect(coachesOf(hal)).toContain(gc);
    const goalies = hal.roster.map((id) => L.players[id]).filter((p) => p.pos === 'G');
    const skater = hal.roster.map((id) => L.players[id]).find((p) => p.pos !== 'G')!;
    expect(() => setCoachPlan(hal, gc.id, { auto: false, assignments: [{ playerId: skater.id, skill: 'reflexes' as never }] }, L)).toThrow();
    setCoachPlan(hal, gc.id, { auto: false, assignments: goalies.slice(0, 2).map((g) => ({ playerId: g.id, skill: 'reflexes' as never })) }, L);
    expect(hal.goalieCoach!.assignments).toHaveLength(Math.min(2, goalies.length));
    // Hiring another goalie coach replaces him rather than adding a fourth coach.
    const next = L.goalieCoachPool![0];
    hireSkillsCoach(L, hal, next.id);
    expect(hal.goalieCoach!.id).toBe(next.id);
  });
});
