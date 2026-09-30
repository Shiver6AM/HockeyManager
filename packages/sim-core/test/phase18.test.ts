import { beforeAll, describe, expect, it } from 'vitest';
import { advanceDays, currentLeg, generateLeague, minorLeagueOf, scoutPlanWindow, setScoutPlan, advanceToNextSeason, type League, type Player } from '../src/index';

describe('scout schedules', () => {
  let L: League;
  let cls: () => Player[];
  beforeAll(() => {
    L = generateLeague({ seed: 1801, humans: { HAL: 'me' } });
    advanceDays(L, 3);
    cls = () => L.draftClass!.ids.map((id) => L.players[id]);
  });

  it('caps a schedule at the weeks left in the season, and validates each stop', () => {
    const hal = L.teams.HAL;
    const sc = hal.scouts![0];
    const w = scoutPlanWindow(L)!;
    expect(w.weeks).toBeGreaterThan(20);
    expect(() => setScoutPlan(L, hal, sc.id, [{ weeks: w.weeks + 1, assignment: 'sweden' }])).toThrow(/weeks left/);
    expect(() => setScoutPlan(L, hal, sc.id, [{ weeks: 0, assignment: 'sweden' }])).toThrow(/at least a week/);
    expect(() => setScoutPlan(L, hal, sc.id, [{ weeks: 2, assignment: 'players' }])).toThrow(/prospects/);
    expect(() => setScoutPlan(L, hal, sc.id, [{ weeks: 2, assignment: 'mars' as never }])).toThrow(/region/);
  });

  it('runs the stops back to back, then carries on with the last one', () => {
    const hal = L.teams.HAL;
    const sc = hal.scouts![0];
    const ohl = cls().filter((p) => minorLeagueOf(L, p).league === 'OHL').slice(0, 3);
    setScoutPlan(L, hal, sc.id, [
      { weeks: 1, assignment: 'sweden' },
      { weeks: 2, assignment: 'players', targets: { league: 'OHL', ids: ohl.map((p) => p.id) } },
      { weeks: 1, assignment: 'auto' },
    ]);
    expect(sc.assignment).toBe('sweden');
    const pts = () => L.scouting!.HAL.points.sweden ?? 0;
    const before = pts();
    advanceDays(L, 7);
    expect(pts()).toBeGreaterThan(before);
    expect(sc.assignment).toBe('players');
    expect(sc.targets!.ids).toEqual(ohl.map((p) => p.id));
    expect(currentLeg(L, sc)!.index).toBe(1);
    const mid = pts();
    advanceDays(L, 7);
    // Following prospects in Ontario: no more time in Sweden (unless the head scout sends someone else).
    expect(L.scouting!.HAL.playerPoints![ohl[0].id]).toBeGreaterThan(0);
    advanceDays(L, 14);
    expect(sc.assignment).toBe('auto');
    expect(currentLeg(L, sc)!.index).toBe(2);
    expect(mid).toBeGreaterThan(0);
  });

  it('a manual assignment replaces the schedule; a summer schedule is for next season', () => {
    const hal = L.teams.HAL;
    const sc = hal.scouts![1];
    advanceToNextSeason(L);
    // (now in the new season's regular season) — go back to planning from the summer next year
    advanceDays(L, 400);
    expect(L.phase).toBe('offseason');
    const w = scoutPlanWindow(L)!;
    expect(w.nextSeason).toBe(true);
    expect(() => setScoutPlan(L, hal, sc.id, [{ weeks: 2, assignment: 'players', targets: { league: 'OHL', ids: ['x'] } }])).toThrow(/draft class/);
    setScoutPlan(L, hal, sc.id, [
      { weeks: 3, assignment: 'finland' },
      { weeks: 3, assignment: 'russia' },
    ]);
    const season = L.season;
    advanceToNextSeason(L);
    expect(L.season).toBe(season + 1);
    expect(sc.plan?.season).toBe(L.season);
    advanceDays(L, 1);
    expect(sc.assignment).toBe('finland');
    advanceDays(L, 21);
    expect(sc.assignment).toBe('russia');
  }, 120_000);
});
