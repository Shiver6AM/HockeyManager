import { beforeAll, describe, expect, it } from 'vitest';
import {
  advanceToEndOfSeason,
  draftClockDue,
  draftTick,
  generateLeague,
  holdLottery,
  makePick,
  offseasonStep,
  onTheClock,
  pauseDraftClock,
  startDraftClock,
  syncDraftClock,
  type League,
} from '../src/index';
import { NAME_POOLS } from '../src/names';

describe('name pools', () => {
  it('has thousands of surnames, none of them famous NHL names', () => {
    const last = new Set(NAME_POOLS.flatMap((p) => p.last));
    expect(last.size).toBeGreaterThan(5000);
    for (const famous of ['Gretzky', 'Lemieux', 'Crosby', 'Ovechkin', 'Orr', 'Howe', 'Jagr', 'Selanne', 'Lidstrom', 'McDavid']) {
      expect(last.has(famous)).toBe(false);
    }
    // Every pool still has plenty of first names.
    for (const p of NAME_POOLS) expect(p.first.length).toBeGreaterThan(20);
  });
});

describe('draft lottery and the draft clock', () => {
  let L: League;
  const T0 = 1_000_000;
  let AI = '';
  beforeAll(() => {
    L = generateLeague({ seed: 2201, humans: { HAL: 'me', QUE: 'you' } });
    advanceToEndOfSeason(L);
    offseasonStep(L, { force: false }); // -> draft (lottery pending)
    AI = Object.keys(L.teams).find((t) => L.teams[t].controller.kind === 'ai')!;
  });

  it('draws the lottery on request, keeping traded picks with their owners', () => {
    const d = L.offseason!.draft;
    expect(d.lotteryHeld).toBe(false);
    expect(() => startDraftClock(L, T0)).toThrow(/lottery/);
    // Trade a lottery team's first-rounder before the draw: it follows the team, wherever it lands.
    const seed5 = d.picks[4];
    seed5.teamId = 'HAL';
    holdLottery(L, { live: true, now: T0 });
    expect(d.lotteryHeld).toBe(true);
    expect(d.lotteryShow).toBe(T0);
    const moved = d.picks.find((p) => p.round === 1 && p.originalTeamId === seed5.originalTeamId)!;
    expect(moved.teamId).toBe('HAL');
    expect(d.picks.map((p) => p.overall)).toEqual(d.picks.map((_, i) => i + 1));
    for (const [, from, to] of d.lottery) expect(from - to).toBeLessThanOrEqual(10);
    expect(() => holdLottery(L)).toThrow(/already/);
  });

  it('starts the clock after the live draw; AI teams pick between 90 seconds and 3 minutes', () => {
    const d = L.offseason!.draft;
    // Make the first few picks AI-owned for this test.
    for (const p of d.picks.slice(0, 3)) p.teamId = p.originalTeamId === 'HAL' || p.originalTeamId === 'QUE' ? AI : p.originalTeamId;
    startDraftClock(L, T0);
    const c = d.clock!;
    expect(c.deadline - c.perPick).toBeGreaterThan(T0); // waits for the reveal
    const start = c.deadline - c.perPick;
    expect(c.aiAt! - start).toBeGreaterThanOrEqual(90_000);
    expect(c.aiAt! - start).toBeLessThanOrEqual(180_000);
    expect(draftClockDue(L)).toBe(c.aiAt);
    expect(draftTick(L, c.aiAt! - 1)).toBe(0);
    expect(draftTick(L, c.aiAt!)).toBe(1);
    expect(d.current).toBe(1);
    expect(d.clock!.pick).toBe(1);
  });

  it('a pick traded to an AI team while on the clock is made within a minute (the draft does not stall)', () => {
    const d = L.offseason!.draft;
    const now = d.clock!.deadline - d.clock!.perPick + 5_000;
    // Hand the pick on the clock to a manager, then trade it to an AI team.
    d.picks[d.current].teamId = 'HAL';
    syncDraftClock(L, now);
    expect(d.clock!.aiAt).toBeNull();
    d.picks[d.current].teamId = AI;
    syncDraftClock(L, now + 1000);
    expect(d.clock!.teamId).toBe(AI);
    expect(d.clock!.aiAt! - (now + 1000)).toBeLessThanOrEqual(60_000);
    const before = d.current;
    expect(draftTick(L, d.clock!.aiAt!)).toBe(1);
    expect(d.current).toBe(before + 1);
    expect(d.picks[before].playerId).toBeTruthy();
  });

  it("a manager who runs out of time gets his list's top choice; pausing stops the clock", () => {
    const d = L.offseason!.draft;
    d.picks[d.current].teamId = 'HAL';
    const t = d.clock!.deadline - d.clock!.perPick + 1000;
    syncDraftClock(L, t);
    const available = d.classIds.filter((id) => !d.picks.some((p) => p.playerId === id));
    const want = available[available.length - 1];
    (L.offseason!.draftLists ??= {}).HAL = [want];
    pauseDraftClock(L, t, true);
    expect(draftClockDue(L)).toBeNull();
    expect(draftTick(L, t + 10 * 60_000)).toBe(0);
    pauseDraftClock(L, t + 10 * 60_000, false);
    const due = draftClockDue(L)!;
    expect(due).toBeGreaterThan(t + 10 * 60_000);
    expect(draftTick(L, due)).toBe(1);
    expect(L.players[want].prospectOf).toBe('HAL');
  });

  it("a manager's own pick restarts the clock for the next team", () => {
    const d = L.offseason!.draft;
    d.picks[d.current].teamId = 'QUE';
    syncDraftClock(L, T0 + 500_000);
    const available = d.classIds.filter((id) => !d.picks.some((p) => p.playerId === id));
    makePick(L, 'QUE', available[0]);
    syncDraftClock(L, T0 + 510_000);
    expect(d.clock!.pick).toBe(d.current);
    expect(d.clock!.deadline).toBe(T0 + 510_000 + 180_000);
  });

  it('skipping runs AI picks to the next manager; simming finishes the draft', () => {
    const d = L.offseason!.draft;
    offseasonStep(L, { force: false, now: T0 + 600_000 });
    const pick = onTheClock(L)!;
    expect(['HAL', 'QUE']).toContain(pick.teamId);
    expect(d.clock!.pick).toBe(d.current);
    offseasonStep(L, { force: true });
    expect(L.offseason!.stage).toBe('re-sign');
    expect(L.offseason!.draft.clock).toBeUndefined();
  });
});
