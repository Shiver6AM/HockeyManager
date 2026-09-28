import { beforeAll, describe, expect, it } from 'vitest';
import {
  advanceToEndOfSeason,
  advanceToNextSeason,
  age,
  capRoom,
  DRAFT_ROUNDS,
  freeAgents,
  generateLeague,
  LOTTERY_MAX_JUMP,
  makePick,
  offseasonStep,
  onTheClock,
  overall,
  promoteProspect,
  ROSTER_MAX,
  placeBid,
  offerExtension,
  standings,
  type League,
} from '../src/index';

describe('offseason with a human manager', () => {
  let L: League;
  const ME = 'HAL';
  let ageBefore: Record<string, number>;
  let myExpiring: string[];

  beforeAll(() => {
    L = generateLeague({ seed: 404, humans: { [ME]: 'me' } });
    advanceToEndOfSeason(L);
    ageBefore = Object.fromEntries(Object.values(L.players).map((p) => [p.id, age(p, L.season)]));
  });

  it('pauses for a season review before anything changes', () => {
    expect(L.phase).toBe('offseason');
    expect(L.offseason).toBeNull();
    const step = offseasonStep(L, { force: false });
    expect(step).toMatchObject({ from: 'review', to: 'draft' });
  });

  it('opens the offseason at the draft with development and retirements done', () => {
    expect(L.phase).toBe('offseason');
    expect(L.offseason!.stage).toBe('draft');
    expect(Object.keys(L.offseason!.development).length).toBeGreaterThan(700);
    const moved = Object.values(L.offseason!.development).filter(([a, b]) => a !== b).length;
    expect(moved).toBeGreaterThan(300);
    expect(Object.keys(L.retired ?? {}).length).toBeGreaterThan(10);
    // Career lines were archived for the season that just ended.
    const lines = Object.values(L.careerStats ?? {}).flat().filter((c) => c.season === L.season);
    expect(lines.length).toBeGreaterThan(700);
  });

  it('builds a 7-round draft; lottery winners jump at most 10 spots', () => {
    const d = L.offseason!.draft;
    expect(d.picks).toHaveLength(32 * DRAFT_ROUNDS);
    for (const [, from, to] of d.lottery) expect(from - to).toBeLessThanOrEqual(LOTTERY_MAX_JUMP);
    // The champion's own pick is last in every round (it may have been traded away).
    expect(d.picks[31].originalTeamId).toBe(L.playoffs!.champion);
    // Non-playoff teams pick before playoff teams.
    const playoff = new Set(L.playoffs!.rounds[0].flatMap((s) => [s.high, s.low]));
    expect(d.picks.slice(0, 16).every((p) => !playoff.has(p.originalTeamId))).toBe(true);
  });

  it('pauses when the human is on the clock and resumes after the pick', () => {
    const pick = onTheClock(L)!;
    expect(pick.teamId).toBe(ME);
    const madeBefore = L.offseason!.draft.current;
    const step = offseasonStep(L, { force: false });
    expect(step.to).toBe('draft');
    expect(L.offseason!.draft.current).toBe(madeBefore); // still waiting on us
    const available = L.offseason!.draft.classIds.filter((id) => !L.offseason!.draft.picks.some((p) => p.playerId === id));
    const choice = available[available.length - 1]; // take a long shot on purpose
    makePick(L, ME, choice);
    expect(L.players[choice].prospectOf).toBe(ME);
    expect(L.teams[ME].prospects).toContain(choice);
    expect(() => makePick(L, ME, available[0])).toThrow(); // not our turn anymore
  });

  it('forcing the step auto-picks for absent humans and finishes the draft', () => {
    while (L.offseason!.stage === 'draft') offseasonStep(L, { force: true });
    const d = L.offseason!.draft;
    const ids = d.picks.map((p) => p.playerId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // Undrafted players are gone.
    const drafted = new Set(ids);
    expect(d.classIds.filter((id) => !drafted.has(id)).every((id) => !L.players[id])).toBe(true);
    expect(L.offseason!.stage).toBe('re-sign');
  });

  it('re-signs through negotiation; qualified RFAs stay on a 1-year deal; everyone else walks', () => {
    myExpiring = Object.keys(L.offseason!.expiring).filter((id) => L.players[id]?.teamId === ME);
    expect(myExpiring.length).toBeGreaterThan(1);
    const team = L.teams[ME];
    const keep = myExpiring[0];
    let offer = { ...L.offseason!.expiring[keep] };
    offer.salary = Math.round((offer.salary * 1.15) / 25_000) * 25_000;
    let r = offerExtension(L, team, L.players[keep], offer);
    if (r.result === 'counter') {
      offer = r.counter;
      r = offerExtension(L, team, L.players[keep], offer);
    }
    expect(r.result).toBe('accept');
    const rfa = myExpiring.slice(1).find((id) => L.players[id].contract?.expiresAs === 'RFA');
    if (rfa) (L.offseason!.qualified ??= {})[rfa] = true;
    for (const id of myExpiring.slice(1)) if (id !== rfa) L.offseason!.resign[id] = false; // explicitly let go
    offseasonStep(L, { force: true });
    expect(L.players[keep].teamId).toBe(ME);
    expect(L.players[keep].contract).toMatchObject({ salary: offer.salary, yearsLeft: offer.years });
    if (rfa) expect(L.players[rfa].contract?.yearsLeft).toBe(1);
    for (const id of myExpiring.slice(1)) {
      if (id !== rfa && L.players[id]) expect(L.players[id].teamId).toBeNull();
    }
    expect(L.offseason!.stage).toBe('free-agency');
  });

  it('lets the human sign a free agent within the cap, then AI teams fill their rosters', () => {
    const team = L.teams[ME];
    // Bid generously on a few mid-market players; rival bids and team fit decide the rest.
    const targets = freeAgents(L)
      .filter((p) => L.offseason!.freeAgentAsks[p.id]?.salary * 1.5 <= capRoom(L, team) / 3)
      .sort((a, b) => overall(b) - overall(a))
      .slice(0, 3);
    for (const t of targets) {
      const ask = L.offseason!.freeAgentAsks[t.id];
      placeBid(L, team, t, { salary: Math.round((ask.salary * 1.5) / 25_000) * 25_000, years: ask.years });
    }
    offseasonStep(L, { force: true }); // round 1
    const won = targets.filter((t) => t.teamId === ME);
    expect(won.length).toBeGreaterThanOrEqual(1);
    for (const t of won) expect(team.roster).toContain(t.id);
    // Every signing went to the offer the player liked best among the ones he got.
    expect(L.offseason!.bids).toEqual({});
    expect(L.offseason!.faLog!.length).toBeGreaterThanOrEqual(5);
    offseasonStep(L, { force: true }); // round 2
    offseasonStep(L, { force: true }); // round 3 + depth fill
    expect(L.offseason!.stage).toBe('training-camp');
    for (const t of Object.values(L.teams)) {
      if (t.controller.kind === 'ai') expect(t.roster.length).toBeGreaterThanOrEqual(20);
    }
  });

  it('camp promotes prospects and cuts to 23; then a new season starts', () => {
    const team = L.teams[ME];
    const prospect = (team.prospects ?? []).map((id) => L.players[id]).sort((a, b) => overall(b) - overall(a))[0];
    promoteProspect(L, team, prospect);
    expect(prospect.contract?.kind).toBe('ELC');
    const season = L.season;
    offseasonStep(L, { force: true });
    expect(L.phase).toBe('regular-season');
    expect(L.season).toBe(season + 1);
    expect(L.day).toBe(0);
    expect(L.schedule).toHaveLength(1312);
    expect(L.schedule.every((g) => !g.result)).toBe(true);
    expect(Object.keys(L.skaterStats)).toHaveLength(0);
    for (const t of Object.values(L.teams)) {
      expect(t.roster.length).toBeLessThanOrEqual(ROSTER_MAX + 1);
      for (const id of [...t.lines.forwards.flat(), ...t.lines.defense.flat(), ...t.lines.goalies]) {
        expect(L.players[id]?.teamId).toBe(t.id);
      }
    }
    // Everyone got a year older.
    for (const [id, a] of Object.entries(ageBefore)) if (L.players[id]) expect(age(L.players[id], L.season)).toBe(a + 1);
    // Retired players were purged.
    for (const id of Object.keys(L.retired ?? {})) expect(L.players[id]).toBeUndefined();
  });

  it('plays the next season normally, with rookies eligible for the Calder', () => {
    advanceToEndOfSeason(L);
    expect(L.history).toHaveLength(2);
    const calder = L.awards['Calder Trophy'];
    expect(calder).toBeTruthy();
    const priorSeasons = (L.careerStats?.[calder.playerId!] ?? []).filter((c) => c.season < L.season && (c.skater?.gp ?? 0) >= 25);
    expect(priorSeasons).toHaveLength(0);
  }, 60_000);
});

describe('multi-season determinism', () => {
  it('stepping through the offseason one stage at a time equals advancing all at once', () => {
    const a = generateLeague({ seed: 5150 });
    const b = generateLeague({ seed: 5150 });
    advanceToEndOfSeason(a);
    advanceToNextSeason(a);
    advanceToEndOfSeason(b);
    while (b.phase === 'offseason') offseasonStep(b, { force: true });
    expect(b.season).toBe(a.season);
    expect(JSON.stringify(standings(b))).toBe(JSON.stringify(standings(a)));
    expect(JSON.stringify(b.teams)).toBe(JSON.stringify(a.teams));
    expect(Object.keys(b.players).sort()).toEqual(Object.keys(a.players).sort());
  }, 60_000);
});
