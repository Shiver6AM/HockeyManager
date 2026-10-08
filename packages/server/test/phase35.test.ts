import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mutateLeague, Scheduler } from '../src/advance';
import { appRouter } from '../src/app';
import { userFromToken } from '../src/auth';
import { createDb, type Db } from '../src/db';
import { readLeague } from '../src/state';

let db: Db;
let scheduler: Scheduler;
async function caller(token: string | null = null) {
  return appRouter.createCaller({ db, scheduler, user: await userFromToken(db, token ?? undefined), sessionToken: token, setSession: () => {} });
}

describe('phase 35: power play, penalty kill and other team stats', () => {
  let c: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;
  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    c = await caller((await (await caller()).auth.register({ username: 'pp35', password: 'correct-horse', displayName: 'P' })).token);
    ({ id: leagueId } = await c.leagues.create({ name: 'Special Teams League', start: 'season' }));
    await c.leagues.claimTeam({ leagueId, teamId: 'HAL' });
    await c.sim.advance({ leagueId, target: { days: 20 } });
  }, 240_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('keeps each game’s team totals after the box score moves out, and refills them from box scores when missing', async () => {
    const L = await readLeague(db, leagueId);
    const played = L.schedule.filter((g) => g.result);
    expect(played.length).toBeGreaterThan(50);
    for (const g of played) {
      expect(g.result!.box).toBeNull();
      expect(g.result!.teams).toBeTruthy();
    }
    const before = Object.fromEntries(played.map((g) => [g.id, structuredClone(g.result!.teams)]));
    // An older league: games played before team totals existed.
    await mutateLeague(db, leagueId, (M) => {
      for (const g of M.schedule) if (g.result) delete g.result.teams;
    });
    const s = await c.data.teamStats({ leagueId });
    expect(s.coverage).toEqual({ games: played.length, played: played.length });
    const after = await readLeague(db, leagueId);
    for (const g of after.schedule.filter((x) => x.result)) expect(g.result!.teams).toEqual(before[g.id]);
  }, 60_000);

  it('adds up: league-wide power-play goals equal goals allowed shorthanded, ranks run 1..N', async () => {
    const s = await c.data.teamStats({ leagueId });
    expect(s.teams).toHaveLength(32);
    const sum = (k: 'ppg' | 'ppga' | 'ppo' | 'tsh' | 'sf' | 'sa' | 'gf' | 'ga') => s.teams.reduce((a, t) => a + t[k], 0);
    expect(sum('ppg')).toBe(sum('ppga'));
    expect(sum('ppo')).toBe(sum('tsh'));
    expect(sum('sf')).toBe(sum('sa'));
    expect(sum('gf')).toBe(sum('ga'));
    expect(sum('ppo')).toBeGreaterThan(100);
    expect(s.teams.map((t) => t.ppRank).sort((a, b) => a! - b!)[0]).toBe(1);
    const best = s.teams.find((t) => t.ppRank === 1)!;
    expect(s.teams.every((t) => t.ppPct === null || t.ppPct <= best.ppPct!)).toBe(true);
    const pkBest = s.teams.find((t) => t.pkRank === 1)!;
    expect(s.teams.every((t) => t.pkPct === null || t.pkPct <= pkBest.pkPct!)).toBe(true);
    for (const t of s.teams) {
      expect(t.ppg).toBeLessThanOrEqual(t.ppo);
      if (t.ppo) expect(t.ppPct).toBeCloseTo(t.ppg / t.ppo, 6);
      if (t.tsh) expect(t.pkPct).toBeCloseTo(1 - t.ppga / t.tsh, 6);
    }
  });

  it('team trends carry power-play and penalty-kill form and the season line', async () => {
    const tr = await c.data.teamTrends({ leagueId, teamId: 'HAL' });
    expect(tr.ppRolling).toHaveLength(tr.games.length);
    expect(tr.pkRolling).toHaveLength(tr.games.length);
    expect(tr.games.every((g) => g.special)).toBe(true);
    expect(tr.special.ppo).toBe(tr.games.reduce((a, g) => a + g.special!.ppo, 0));
    expect(tr.special.ppga).toBe(tr.games.reduce((a, g) => a + g.special!.ppga, 0));
    expect(tr.special.teams).toBe(32);
    expect(tr.special.leaguePp).toBeGreaterThan(5);
    expect(tr.special.leaguePk).toBeGreaterThan(60);
    const last = tr.ppRolling.at(-1);
    if (last !== null) expect(last).toBeGreaterThanOrEqual(0);
  });
});
