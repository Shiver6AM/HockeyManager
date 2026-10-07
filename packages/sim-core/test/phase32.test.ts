import { afterEach, describe, expect, it } from 'vitest';
import { advanceDays, age, DEV_TUNING, generateLeague, lastDay, offseasonStep, overall, type League, type Player } from '../src/index';

const SHARE = DEV_TUNING.inSeasonShare;
afterEach(() => {
  DEV_TUNING.inSeasonShare = SHARE;
});

const playing = (L: League) => Object.values(L.players).filter((p) => !L.retired?.[p.id] && p.draftClass === undefined);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const snapshot = (L: League) => new Map(playing(L).map((p) => [p.id, { ovr: overall(p), age: age(p, L.season), pot: p.hidden.potential, pos: p.pos }]));
function playSeason(L: League) {
  while (L.phase !== 'offseason') advanceDays(L, 30);
}

describe('players develop during the season', () => {
  it('young players improve and veterans slip a little at a time, in step with the calendar', () => {
    const L = generateLeague({ seed: 3201 } as never);
    const start = snapshot(L);
    const days = lastDay(L) + 1;
    const young = [...start].filter(([, s]) => s.age <= 21 && s.pot - s.ovr >= 10).map(([id]) => id);
    const old = [...start].filter(([, s]) => s.age >= 33 && s.pos !== 'G').map(([id]) => id);
    expect(young.length).toBeGreaterThan(40);
    expect(old.length).toBeGreaterThan(20);
    const gain = (ids: string[]) => mean(ids.map((id) => L.players[id].devSeason?.applied ?? 0));

    advanceDays(L, Math.floor(days / 2));
    const youngHalf = gain(young);
    const oldHalf = gain(old);
    expect(youngHalf).toBeGreaterThan(0.5);
    expect(oldHalf).toBeLessThan(-0.2);
    // Ratings stay whole numbers, and what has arrived is what the ratings show.
    for (const id of young) {
      const p = L.players[id];
      for (const v of Object.values((p.skater ?? p.goalie) as unknown as Record<string, number>)) expect(Number.isInteger(v)).toBe(true);
      expect(p.devSeason!.season).toBe(L.season);
      expect(Math.abs(p.devSeason!.carry)).toBeLessThan(1);
    }

    while (L.phase === 'regular-season') advanceDays(L, 1);
    // By the end of the regular season about twice as much has arrived as at the halfway mark.
    expect(gain(young) / youngHalf).toBeGreaterThan(1.7);
    expect(gain(young) / youngHalf).toBeLessThan(2.3);
    expect(gain(old) / oldHalf).toBeGreaterThan(1.6);
    expect(gain(old) / oldHalf).toBeLessThan(2.4);
    // Nobody outgrows his potential on the way.
    for (const p of playing(L)) if (p.devSeason && p.devSeason.applied > 0) expect(p.devSeason.start + p.devSeason.applied).toBeLessThanOrEqual(p.hidden.potential + 0.5);
    // Mid-career skaters with nothing to gain or lose aren't tracked at all.
    const flat = playing(L).filter((p) => p.pos !== 'G' && age(p, L.season) === 28 && !p.devSeason);
    expect(flat.length).toBeGreaterThan(10);
  }, 120_000);

  it('a year still adds up to what it did when everything happened in the summer', () => {
    const run = (share: number) => {
      DEV_TUNING.inSeasonShare = share;
      const L = generateLeague({ seed: 3202 } as never);
      const start = snapshot(L);
      playSeason(L);
      offseasonStep(L, { force: true }); // the summer: development, aging
      const change = (pick: (s: { age: number; pot: number; ovr: number; pos: string }) => boolean) =>
        mean([...start].filter(([id, s]) => pick(s) && L.players[id] && !L.retired?.[id]).map(([id, s]) => overall(L.players[id]) - s.ovr));
      // (No season's tracking is left behind.)
      expect(playing(L).some((p) => p.devSeason)).toBe(false);
      return { young: change((s) => s.age <= 22 && s.pot - s.ovr >= 6), old: change((s) => s.age >= 32) };
    };
    const summerOnly = run(0);
    const split = run(SHARE);
    expect(summerOnly.young).toBeGreaterThan(1.5);
    expect(summerOnly.old).toBeLessThan(-0.8);
    expect(Math.abs(split.young - summerOnly.young)).toBeLessThan(0.35);
    expect(Math.abs(split.old - summerOnly.old)).toBeLessThan(0.35);
  }, 240_000);

  it('with the in-season share off, nothing changes during the season', () => {
    DEV_TUNING.inSeasonShare = 0;
    const L = generateLeague({ seed: 3203 } as never);
    advanceDays(L, 40);
    expect(playing(L).some((p) => p.devSeason)).toBe(false);
  }, 60_000);

  it('a league already under way picks it up from where it is', () => {
    DEV_TUNING.inSeasonShare = 0;
    const L = generateLeague({ seed: 3204 } as never);
    const days = lastDay(L) + 1;
    const half = Math.floor(days / 2);
    advanceDays(L, half); // (as the game was before: no development so far this season)
    DEV_TUNING.inSeasonShare = SHARE;
    const young = playing(L).filter((p) => age(p, L.season) <= 21 && p.hidden.potential - overall(p) >= 10);
    const before = new Map(young.map((p) => [p.id, overall(p)]));
    while (L.phase === 'regular-season') advanceDays(L, 1);
    const got = mean(young.map((p) => p.devSeason?.applied ?? 0));
    // Only the rest of the season's share arrives (about half of it); the summer makes up the difference.
    const full = generateLeague({ seed: 3204 } as never);
    while (full.phase === 'regular-season') advanceDays(full, 1);
    const whole = mean(young.map((p) => full.players[p.id].devSeason?.applied ?? 0));
    expect(got).toBeGreaterThan(0.25);
    expect(got / whole).toBeGreaterThan(0.35);
    expect(got / whole).toBeLessThan(0.65);
    expect(mean(young.map((p) => overall(p) - before.get(p.id)!))).toBeGreaterThan(0.25);
  }, 240_000);

  it('simming day by day or all at once develops everyone identically', () => {
    const a = generateLeague({ seed: 3205 } as never);
    const b = generateLeague({ seed: 3205 } as never);
    advanceDays(a, 30);
    for (let i = 0; i < 30; i++) advanceDays(b, 1);
    const view = (L: League) => JSON.stringify(playing(L).map((p: Player) => [p.id, p.skater ?? p.goalie, p.devSeason]));
    expect(view(a)).toBe(view(b));
    expect(playing(a).filter((p) => p.devSeason && p.devSeason.applied !== 0).length).toBeGreaterThan(100);
  }, 60_000);
});
