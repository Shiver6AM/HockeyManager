import { beforeAll, describe, expect, it } from 'vitest';
import {
  advanceDays,
  autoLines,
  capRoom,
  deadCapFor,
  evaluateForAi,
  executeTrade,
  generateLeague,
  healthyRoster,
  overall,
  presimGame,
  retainedCount,
  simulateGame,
  teamLines,
  upcomingGames,
  validateTrade,
  type League,
  type PlayEvent,
} from '../src/index';

describe('positions, placements and ice time', () => {
  let L: League;
  beforeAll(() => {
    L = generateLeague({ seed: 2301, humans: { HAL: 'me' } });
    advanceDays(L, 2);
  });

  it('gives many skaters a second position, and goalies none', () => {
    const skaters = Object.values(L.players).filter((p) => p.pos !== 'G' && p.teamId);
    const multi = skaters.filter((p) => p.altPos!.length > 0);
    expect(multi.length / skaters.length).toBeGreaterThan(0.25);
    expect(multi.length / skaters.length).toBeLessThan(0.6);
    expect(Object.values(L.players).filter((p) => p.pos === 'G').every((p) => p.altPos!.length === 0)).toBe(true);
    for (const p of multi) expect(p.altPos).not.toContain(p.pos);
  });

  it('builds lines around the manager’s placements', () => {
    const hal = L.teams.HAL;
    const roster = healthyRoster(L, hal);
    const d = roster.filter((p) => p.pos === 'D').sort((a, b) => overall(a) - overall(b));
    const f = roster.filter((p) => p.pos !== 'D' && p.pos !== 'G').sort((a, b) => overall(a) - overall(b));
    const worstD = d[0];
    const worstF = f[0];
    const bestF = f[f.length - 1];
    const wing = f.find((p) => p.pos === 'LW')!;
    hal.linePins = {
      [worstD.id]: { slot: 'top4' },
      [worstF.id]: { slot: 'L2' },
      [bestF.id]: { slot: 'scratch' },
      [wing.id]: { pos: 'C', slot: 'top6' },
    };
    const lines = teamLines(L, hal);
    expect(lines.defense.slice(0, 2).flat()).toContain(worstD.id);
    expect(lines.forwards[1]).toContain(worstF.id);
    expect(lines.forwards.flat()).not.toContain(bestF.id);
    const at = lines.forwards.findIndex((l) => l[1] === wing.id);
    expect(at === 0 || at === 1).toBe(true);
    // AI teams ignore pins; without pins it's the usual lineup.
    delete hal.linePins;
    expect(teamLines(L, hal)).toEqual(autoLines(roster, hal.tactics));
  });

  it('spreads ice time by the team’s plan', () => {
    const home = L.teams.HAL;
    const away = L.teams.QUE;
    home.lines = teamLines(L, home);
    away.lines = teamLines(L, away);
    const toi = (usage: 'roll4' | 'top-heavy') => {
      home.tactics = { ...(home.tactics ?? { forecheck: 'balanced', offense: 'cycle', pp: 'umbrella', pk: 'box' }), fUsage: usage, dUsage: usage === 'roll4' ? 'roll3' : 'top2' };
      let first = 0;
      let fourth = 0;
      for (let s = 0; s < 20; s++) {
        const r = simulateGame(L, home, away, 1000 + s);
        first += home.lines.forwards[0].reduce((x, id) => x + r.box.skaters[id].toi, 0);
        fourth += home.lines.forwards[3].reduce((x, id) => x + r.box.skaters[id].toi, 0);
      }
      return first / fourth;
    };
    expect(toi('top-heavy')).toBeGreaterThan(toi('roll4') + 0.4);
  });
});

describe('salary retention', () => {
  let L: League;
  beforeAll(() => {
    L = generateLeague({ seed: 2302, humans: { HAL: 'me' } });
    advanceDays(L, 2);
  });

  it('keeps part of the salary on the old team’s cap for the rest of the deal', () => {
    const hal = L.teams.HAL;
    const p = hal.roster.map((id) => L.players[id]).filter((x) => x.contract && x.contract.yearsLeft >= 2).sort((a, b) => b.contract!.salary - a.contract!.salary)[0];
    const salary = p.contract!.salary;
    const give = [{ kind: 'player' as const, id: p.id, retain: 0.5 }];
    expect(validateTrade(L, 'HAL', 'QUE', [{ kind: 'player', id: p.id, retain: 0.6 }], [])).toMatch(/at most 50%/);
    // The AI values him more with half his salary paid by someone else.
    const plain = evaluateForAi(L, 'QUE', [{ kind: 'player', id: p.id }], []).ratio;
    const kept = evaluateForAi(L, 'QUE', give, []).ratio;
    expect(kept).toBeGreaterThan(plain);
    const roomBefore = capRoom(L, L.teams.QUE);
    executeTrade(L, 'HAL', 'QUE', give, []);
    expect(p.teamId).toBe('QUE');
    expect(p.contract!.salary).toBe(Math.round(salary / 2 / 1000) * 1000);
    expect(capRoom(L, L.teams.QUE)).toBe(roomBefore - p.contract!.salary);
    expect(deadCapFor(L, hal)).toBeGreaterThanOrEqual(salary - p.contract!.salary);
    expect(retainedCount(L, hal)).toBe(1);
    const last = hal.deadCap!.at(-1)!;
    expect(last.untilSeason - last.fromSeason + 1).toBe(p.contract!.yearsLeft);
  });
});

describe('simcast play-by-play', () => {
  it('records power plays with time left and pulled goalies, without changing the game', () => {
    const L = generateLeague({ seed: 2303, humans: {} });
    advanceDays(L, 3);
    let pp = 0;
    let pulled = 0;
    let over = 0;
    for (const g of upcomingGames(L).slice(0, 8)) {
      const copy = structuredClone(L);
      const { events, result } = presimGame(copy, g.id);
      pp += events.filter((e: PlayEvent) => e.box && (e.box.home.length || e.box.away.length)).length;
      pulled += events.filter((e) => e.pulled).length;
      over += events.filter((e) => e.type === 'penalty-over').length;
      const goals = events.filter((e) => e.type === 'goal');
      expect(goals.length).toBe(result.box.goals.length);
      for (const e of goals.filter((x) => x.strength !== 'EN')) expect(e.other).toBeTruthy();
      for (const e of events) if (e.box) for (const left of [...e.box.home, ...e.box.away]) expect(left).toBeGreaterThan(0);
    }
    expect(pp).toBeGreaterThan(10);
    expect(over).toBeGreaterThan(3);
    expect(pulled).toBeGreaterThan(0);
  });
});
