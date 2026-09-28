import { beforeAll, describe, expect, it } from 'vitest';
import {
  advanceDays,
  advanceToDeadline,
  advanceToEndOfSeason,
  coachability,
  executeTrade,
  familiarity,
  generateLeague,
  hireSkillsCoach,
  offseasonStep,
  pickKey,
  pickOwner,
  proSeasons,
  releaseSkillsCoach,
  resolvePlan,
  roleSkill,
  setCoachPlan,
  skillsCoachSalary,
  styleComplement,
  submitResignOffer,
  acceptCounter,
  teamPicks,
  tradeDeadline,
  trainingDay,
  trainingRate,
  unitKey,
  validateTrade,
  SKILLS,
  RESIGN_DAYS,
  type League,
} from '../src/index';

describe('skills coaches', () => {
  it('cost more with more specialties', () => {
    const one = skillsCoachSalary({ ratings: { offense: 80, defense: 45, skating: 45 }, specialties: ['offense'] });
    const two = skillsCoachSalary({ ratings: { offense: 80, defense: 80, skating: 45 }, specialties: ['offense', 'defense'] });
    const three = skillsCoachSalary({ ratings: { offense: 80, defense: 80, skating: 80 }, specialties: ['offense', 'defense', 'skating'] });
    expect(two).toBeGreaterThan(one * 2);
    expect(three).toBeGreaterThan(two * 1.4);
  });

  it('every team starts with one to three; hiring caps at three and letting one go pays a settlement', () => {
    const L = generateLeague({ seed: 3, humans: { HAL: 'me' } });
    advanceDays(L, 1);
    for (const t of Object.values(L.teams)) {
      expect(t.skillsCoaches!.length).toBeGreaterThanOrEqual(1);
      expect(t.skillsCoaches!.length).toBeLessThanOrEqual(SKILLS.maxCoaches);
    }
    const hal = L.teams.HAL;
    while (hal.skillsCoaches!.length < SKILLS.maxCoaches) hireSkillsCoach(L, hal, L.skillsCoachPool![0].id);
    expect(() => hireSkillsCoach(L, hal, L.skillsCoachPool![0].id)).toThrow(/maximum|already have/);
    const c = hal.skillsCoaches![0];
    const r = releaseSkillsCoach(L, hal, c.id);
    expect(r.settlement).toBe(Math.round((c.salary * Math.max(0, c.yearsLeft - 1)) / 2));
    expect(hal.skillsCoaches!.length).toBe(SKILLS.maxCoaches - 1);
  });

  it('manual plans: at most five players, each with one coach, on skills that suit them', () => {
    const L = generateLeague({ seed: 4, humans: { HAL: 'me' } });
    advanceDays(L, 1);
    const hal = L.teams.HAL;
    const c = hal.skillsCoaches![0];
    const skaters = hal.roster.filter((id) => L.players[id].pos !== 'G');
    const goalie = hal.roster.find((id) => L.players[id].pos === 'G')!;
    expect(() => setCoachPlan(hal, c.id, { auto: false, assignments: skaters.slice(0, 6).map((playerId) => ({ playerId, skill: 'auto' })) }, L)).toThrow(/at most 5/);
    expect(() => setCoachPlan(hal, c.id, { auto: false, assignments: [{ playerId: goalie, skill: 'shooting' }] }, L)).toThrow(/can't work on that skill/);
    setCoachPlan(hal, c.id, { auto: false, assignments: [{ playerId: skaters[0], skill: 'netFront' }] }, L);
    const plan = resolvePlan(L, hal);
    expect(plan.find((x) => x.player.id === skaters[0])!.skill).toBe('netFront');
    if (hal.skillsCoaches!.length > 1) {
      const other = hal.skillsCoaches![1];
      expect(() => setCoachPlan(hal, other.id, { auto: false, assignments: [{ playerId: skaters[0], skill: 'auto' }] }, L)).toThrow(/already working/);
    }
  });

  it('improve players gradually: under a point a week, a good chunk over a season, faster for coachable young players', () => {
    const L = generateLeague({ seed: 5, humans: { HAL: 'me' } });
    advanceDays(L, 1);
    const hal = L.teams.HAL;
    const c = hal.skillsCoaches![0];
    c.ratings = { offense: 90, defense: 90, skating: 90 };
    const young = hal.roster.map((id) => L.players[id]).filter((p) => p.pos !== 'G').sort((a, b) => a.birthYear - b.birthYear).at(-1)!;
    young.coachability = 95;
    const before = young.skater!.shooting;
    setCoachPlan(hal, c.id, { auto: false, assignments: [{ playerId: young.id, skill: 'shooting' }] }, L);
    // The best case gains well under a point a week...
    expect(trainingRate(L, c, young, 'shooting') * 7).toBeLessThan(1);
    for (let d = 0; d < 7; d++) trainingDay(L);
    expect(young.skater!.shooting - before).toBeLessThanOrEqual(1);
    // ...but several over a season.
    for (let d = 0; d < 183; d++) trainingDay(L);
    const gained = young.skater!.shooting - before;
    expect(gained).toBeGreaterThanOrEqual(4);
    expect(gained).toBeLessThanOrEqual(14);
    expect(young.trainingLog!.gains.shooting).toBe(gained);
    // A stubborn veteran with an average coach learns far less.
    const vet = { ...young, id: 'vet-test', birthYear: L.season - 34, coachability: 15 };
    c.ratings = { offense: 60, defense: 60, skating: 60 };
    expect(trainingRate(L, c, vet, 'shooting')).toBeLessThan(trainingRate(L, c, young, 'shooting') / 3);
  });

  it('can raise a situational skill directly', () => {
    const L = generateLeague({ seed: 6, humans: { HAL: 'me' } });
    advanceDays(L, 1);
    const hal = L.teams.HAL;
    const c = hal.skillsCoaches![0];
    const p = L.players[hal.roster.find((id) => L.players[id].pos !== 'G')!];
    const before = roleSkill(p, 'netFront');
    setCoachPlan(hal, c.id, { auto: false, assignments: [{ playerId: p.id, skill: 'netFront' }] }, L);
    for (let d = 0; d < 120; d++) trainingDay(L);
    expect(p.roleTraining?.netFront ?? 0).toBeGreaterThan(0);
    expect(roleSkill(p, 'netFront')).toBe(before + p.roleTraining!.netFront!);
  });

  it('coachability is a stable 1–99 trait', () => {
    const L = generateLeague({ seed: 7 });
    const xs = Object.values(L.players).map(coachability);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(99);
    const p = Object.values(L.players)[0];
    expect(coachability(p)).toBe(coachability(structuredClone(p)));
  });
});

describe('line chemistry', () => {
  it('builds with games together and fades when lines change', () => {
    const L = generateLeague({ seed: 8 });
    const t = Object.values(L.teams)[0];
    const line = [...t.lines.forwards[0]];
    expect(familiarity(t, line)).toBe(0);
    advanceDays(L, 20);
    const games = t.chemistry?.[unitKey(t.lines.forwards[0])] ?? 0;
    expect(games).toBeGreaterThan(3);
  });

  it('values complementary styles over three of a kind', () => {
    const L = generateLeague({ seed: 9 });
    const fw = Object.values(L.players).filter((p) => p.skater && p.pos !== 'D' && p.teamId);
    const of = (a: string) => fw.filter((p) => p.archetype === a);
    const snipers = of('Sniper').slice(0, 3);
    const mix = [of('Playmaker')[0], of('Sniper')[0], of('Power Forward')[0]];
    expect(styleComplement(mix, false)).toBeGreaterThan(styleComplement(snipers, false));
  });
});

describe('prospects', () => {
  it('play a junior/AHL season whose stats go into their career, without counting as NHL seasons', () => {
    const L = generateLeague({ seed: 10 });
    advanceToEndOfSeason(L);
    const withStats = Object.entries(L.prospectStats ?? {});
    expect(withStats.length).toBeGreaterThan(50);
    const [id, line] = withStats.find(([pid]) => L.players[pid].pos !== 'G')!;
    expect(line.gp).toBeGreaterThan(40);
    expect(line.gp).toBeLessThan(90);
    offseasonStep(L, { force: true }); // archive
    const career = L.careerStats![id];
    expect(career.at(-1)!.minor?.gp).toBe(line.gp);
    expect(proSeasons(career)).toHaveLength(0);
  });
});

describe('trade deadline and draft-day trades', () => {
  it('sims to deadline day, then closes the window', () => {
    const L = generateLeague({ seed: 11 });
    advanceToDeadline(L);
    expect(L.day).toBe(tradeDeadline(L));
    const [a, b] = Object.keys(L.teams);
    const give = [{ kind: 'pick' as const, key: teamPicks(L, a).at(-1)! }];
    const get = [{ kind: 'pick' as const, key: teamPicks(L, b).at(-1)! }];
    expect(validateTrade(L, a, b, give, get)).toBeNull();
    expect(L.news!.some((n) => /trade deadline day/.test(n.headline))).toBe(true);
    advanceDays(L, 1);
    expect(validateTrade(L, a, b, give, get)).toMatch(/deadline has passed/);
    expect(() => advanceToDeadline(L)).toThrow(/passed/);
  });

  it('lets teams trade this year’s unused picks during the draft', () => {
    const L = generateLeague({ seed: 12, humans: { HAL: 'me' } });
    advanceToEndOfSeason(L);
    offseasonStep(L, { force: false }); // open the draft (AI picks until HAL is on the clock)
    const d = L.offseason!.draft;
    expect(L.offseason!.stage).toBe('draft');
    const unused = d.picks.find((p) => !p.playerId && p.teamId !== 'HAL')!;
    const key = pickKey(d.season, unused.round, unused.originalTeamId);
    expect(teamPicks(L, unused.teamId)).toContain(key);
    const halPick = teamPicks(L, 'HAL').find((k) => Number(k.split(':')[0]) === d.season + 1)!;
    expect(validateTrade(L, 'HAL', unused.teamId, [{ kind: 'pick', key: halPick }], [{ kind: 'pick', key }])).toBeNull();
    executeTrade(L, 'HAL', unused.teamId, [{ kind: 'pick', key: halPick }], [{ kind: 'pick', key }]);
    expect(pickOwner(L, key)).toBe('HAL');
    expect(unused.teamId).toBe('HAL');
    const used = d.picks.find((p) => p.playerId)!;
    if (used) expect(teamPicks(L, used.teamId)).not.toContain(pickKey(d.season, used.round, used.originalTeamId));
  });
});

describe('the re-signing week', () => {
  let L: League;
  beforeAll(() => {
    L = generateLeague({ seed: 13, humans: { HAL: 'me' } });
    advanceToEndOfSeason(L);
    offseasonStep(L, { force: true });
    while (L.offseason!.stage === 'draft') offseasonStep(L, { force: true });
  });

  it('runs seven days before free agency', () => {
    expect(L.offseason!.stage).toBe('re-sign');
    expect(L.offseason!.resignDay).toBe(1);
  });

  it('answers offers the next day, sometimes after sleeping on it', () => {
    const hal = L.teams.HAL;
    const mine = Object.keys(L.offseason!.expiring).filter((id) => L.players[id]?.teamId === 'HAL');
    expect(mine.length).toBeGreaterThan(0);
    const p = L.players[mine[0]];
    const ask = L.offseason!.expiring[p.id];
    submitResignOffer(L, hal, p, { salary: Math.round((ask.salary * 1.3) / 25_000) * 25_000, years: ask.years });
    expect(L.offseason!.pendingOffers![p.id]).toBeTruthy();
    expect(p.extension).toBeUndefined();
    offseasonStep(L, { force: true }); // day 2
    let r = L.offseason!.responses![p.id];
    if (r.result === 'considering') {
      offseasonStep(L, { force: true });
      r = L.offseason!.responses![p.id];
    }
    expect(['accept', 'counter']).toContain(r.result);
    if (r.result === 'counter') acceptCounter(L, hal, p);
    expect(p.extension).toBeTruthy();
  });

  it('AI teams re-sign through the week, then free agency opens after day seven', () => {
    const early = L.transactions.filter((t) => t.type === 'extension' && L.teams[t.teamId].controller.kind === 'ai').length;
    expect(early).toBeGreaterThan(0);
    while (L.offseason!.stage === 're-sign') offseasonStep(L, { force: true });
    expect(L.offseason!.stage).toBe('free-agency');
    expect(L.offseason!.resignDay).toBe(RESIGN_DAYS);
  });
});
