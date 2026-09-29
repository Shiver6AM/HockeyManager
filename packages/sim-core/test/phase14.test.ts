import { describe, expect, it } from 'vitest';
import {
  advanceDays,
  advanceToNextSeason,
  capRoom,
  cleanSliders,
  createLeague,
  fantasyAvailable,
  fantasyOnClock,
  fantasyPick,
  fantasyPickProblem,
  freeAgents,
  generateLeague,
  offseasonStep,
  overall,
  runFantasy,
} from '../src/index';

describe('new-league start points', () => {
  it('defaults to the week before free agency: draft done, re-signing day 1, no decisions made', () => {
    const L = createLeague({ seed: 1401, humans: { HAL: 'me' } });
    expect(L.phase).toBe('offseason');
    expect(L.offseason!.stage).toBe('re-sign');
    expect(L.offseason!.resignDay).toBe(1);
    expect(L.offseason!.draft.current).toBe(L.offseason!.draft.picks.length);
    expect(Object.keys(L.offseason!.aiDecided ?? {})).toHaveLength(0);
    expect(Object.keys(L.offseason!.expiring).length).toBeGreaterThan(50);
    // The weakest roster picked first (before the lottery could move it up to two spots).
    expect(L.offseason!.draft.picks[0].playerId).toBeTruthy();
    advanceToNextSeason(L);
    expect(L.phase).toBe('regular-season');
    expect(L.season).toBe(2026);
    // No empty "season" booked before the first one.
    for (const t of Object.values(L.teams)) expect(t.financeHistory ?? []).toHaveLength(0);
    advanceDays(L, 5);
    expect(L.schedule.some((g) => g.result)).toBe(true);
  });

  it('can start at the entry draft, with a junior season behind the class and scouts that watched it', () => {
    const L = createLeague({ seed: 1402, start: 'draft' });
    expect(L.offseason!.stage).toBe('draft');
    expect(L.offseason!.draft.current).toBe(0);
    const cls = L.offseason!.draft.classIds.map((id) => L.players[id]);
    expect(cls.filter((p) => L.prospectStats?.[p.id]?.gp).length).toBeGreaterThan(cls.length / 2);
    expect(Object.keys(L.scouting ?? {}).length).toBe(32);
  });

  it('can start on opening night', () => {
    const L = createLeague({ seed: 1403, start: 'season' });
    expect(L.phase).toBe('regular-season');
    expect(L.day).toBe(0);
    expect(L.season).toBe(2026);
  });
});

describe('fantasy draft', () => {
  it('redistributes every player into legal, cap-compliant rosters, then moves on', () => {
    const L = createLeague({ seed: 1404, humans: { HAL: 'me' }, fantasy: true, start: 're-sign' });
    expect(L.offseason!.stage).toBe('fantasy-draft');
    const poolSize = L.fantasy!.pool.length;
    expect(poolSize).toBeGreaterThan(700);
    for (const t of Object.values(L.teams)) expect(t.roster).toHaveLength(0);
    // Players waiting in the pool aren't free agents.
    const pool = new Set(L.fantasy!.pool);
    expect(freeAgents(L).some((p) => pool.has(p.id))).toBe(false);
    expect(() => fantasyPick(L, 'HAL', L.fantasy!.pool[0])).toThrow(/started/);
    // AI picks until the human is on the clock.
    runFantasy(L, { force: false });
    expect(fantasyOnClock(L)!.teamId).toBe('HAL');
    const goalie = fantasyAvailable(L).filter((p) => p.pos === 'G' && !fantasyPickProblem(L, 'HAL', p)).sort((a, b) => overall(b) - overall(a))[0];
    fantasyPick(L, 'HAL', goalie.id);
    expect(L.players[goalie.id].teamId).toBe('HAL');
    expect(() => fantasyPick(L, 'HAL', fantasyAvailable(L)[0].id)).toThrow(/clock/);
    // The commissioner sims the rest (the human is picked for).
    while (L.offseason!.stage === 'fantasy-draft') offseasonStep(L, { force: true });
    expect(L.offseason!.stage).toBe('re-sign');
    expect(L.fantasy!.done).toBe(true);
    for (const t of Object.values(L.teams)) {
      const nhl = t.roster.map((id) => L.players[id]).filter((p) => !p.farm);
      const g = (k: string) => nhl.filter((p) => (k === 'G' ? p.pos === 'G' : k === 'D' ? p.pos === 'D' : p.pos !== 'G' && p.pos !== 'D')).length;
      expect(g('F')).toBeGreaterThanOrEqual(12);
      expect(g('D')).toBeGreaterThanOrEqual(6);
      expect(g('G')).toBeGreaterThanOrEqual(2);
      expect(capRoom(L, t)).toBeGreaterThan(-2_000_000);
      expect(t.lines.forwards).toHaveLength(4);
    }
    // Everyone in the pool ended up on a team or in free agency (without a contract).
    const pooled = L.fantasy!.pool.map((id) => L.players[id]).filter(Boolean);
    expect(pooled.every((p) => !p.inFantasyPool && (p.teamId ? !!p.contract : !p.contract))).toBe(true);
    expect(pooled.filter((p) => p.teamId).length).toBeGreaterThan(700);
    advanceToNextSeason(L);
    advanceDays(L, 3);
    expect(L.phase).toBe('regular-season');
  });
});

describe('commissioner sliders', () => {
  it('clamp to their ranges, and change the game when set', () => {
    expect(cleanSliders({ injuryRate: 9, scoring: 0.1, bogus: 2, penalties: 1 })).toEqual({ injuryRate: 3, scoring: 0.7 });
    const base = generateLeague({ seed: 1405 });
    const quiet = generateLeague({ seed: 1405 });
    quiet.settings.sim = { injuryRate: 0, fights: 0 };
    const a = advanceDays(base, 25).games;
    const b = advanceDays(quiet, 25).games;
    expect(a.reduce((s, g) => s + g.result!.box.injuries.length, 0)).toBeGreaterThan(5);
    expect(b.reduce((s, g) => s + g.result!.box.injuries.length, 0)).toBe(0);
    expect(b.reduce((s, g) => s + g.result!.box.penalties.filter((p) => p.infraction === 'Fighting').length, 0)).toBe(0);
  });

  it('at their defaults leave the simulation exactly as it was', () => {
    const a = generateLeague({ seed: 1406 });
    const b = generateLeague({ seed: 1406 });
    b.settings.sim = cleanSliders({ scoring: 1, injuryRate: 1 });
    advanceDays(a, 10);
    advanceDays(b, 10);
    const scores = (L: typeof a) => L.schedule.filter((g) => g.result).map((g) => `${g.result!.homeScore}-${g.result!.awayScore}`);
    expect(scores(b)).toEqual(scores(a));
  });
});
