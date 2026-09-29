import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/advance';
import { appRouter } from '../src/app';
import { userFromToken } from '../src/auth';
import { createDb, type Db } from '../src/db';

let db: Db;
let scheduler: Scheduler;

async function caller(token: string | null = null) {
  return appRouter.createCaller({ db, scheduler, user: await userFromToken(db, token ?? undefined), sessionToken: token, setSession: () => {} });
}

describe('phase 16: records, past seasons, prospect and undrafted scorers', () => {
  let comm: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;
  let first: number;

  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    const u = await (await caller()).auth.register({ username: 'commish16', password: 'correct-horse', displayName: 'C16' });
    comm = await caller(u.token);
    ({ id: leagueId } = await comm.leagues.create({ name: 'Records League', start: 'season' }));
    first = (await comm.leagues.overview({ leagueId })).season;
    await comm.sim.advance({ leagueId, target: { days: 20 } });
  }, 60_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('top 100 prospect and undrafted scorers this season, with league and club', async () => {
    const pr = await comm.data.minorLeaders({ leagueId, scope: 'prospects' });
    expect(pr.skaters.length).toBe(100);
    const ov = await comm.leagues.overview({ leagueId });
    for (const r of pr.skaters) {
      expect(r.draft).toBeTruthy();
      expect(r.orgId).toBeTruthy();
      expect(r.league).toBeTruthy();
    }
    expect(pr.skaters[0].p).toBeGreaterThanOrEqual(pr.skaters[99].p);
    const un = await comm.data.minorLeaders({ leagueId, scope: 'undrafted' });
    expect(un.skaters.length).toBe(100);
    for (const r of un.skaters) {
      expect(r.draft).toBeNull();
      expect(r.orgId).toBeNull();
    }
    // No overlap, and nobody in either list is in the NHL.
    const nhl = new Set((await comm.data.leaders({ leagueId })).allSkaters.map((r) => r.id));
    expect(pr.skaters.some((r) => un.skaters.find((x) => x.id === r.id))).toBe(false);
    expect([...pr.skaters, ...un.skaters].some((r) => nhl.has(r.id))).toBe(false);
    expect(ov.season).toBe(first);
  });

  it('franchise records and each team’s all-time leading scorer', async () => {
    const rec = await comm.data.franchiseRecords({ leagueId, teamId: 'HAL' });
    expect(rec.skaters.length).toBeGreaterThan(15);
    expect(rec.skaters[0].t.p).toBeGreaterThanOrEqual(rec.skaters[1].t.p);
    expect(rec.goalies.length).toBeGreaterThan(0);
    expect(rec.bestSeasons.length).toBe(10);
    const tops = await comm.data.franchiseTopScorers({ leagueId });
    expect(Object.keys(tops)).toHaveLength(32);
    expect(tops.HAL!.p).toBe(rec.skaters[0].t.p);
  });

  it('after a season rolls over: past seasons show the team he played for, records carry over, prospects by season', async () => {
    const before = await comm.data.franchiseRecords({ leagueId, teamId: 'HAL' });
    await comm.sim.advance({ leagueId, target: { to: 'next-season' } });
    await comm.sim.advance({ leagueId, target: { days: 5 } });
    const ov = await comm.leagues.overview({ leagueId });
    expect(ov.season).toBe(first + 1);
    const cur = await comm.data.leaders({ leagueId });
    expect(cur.seasons).toContain(first);
    const past = await comm.data.leaders({ leagueId, season: first });
    expect(past.allSkaters.length).toBeGreaterThan(500);
    expect(Math.max(...past.allSkaters.map((r) => r.gp))).toBeGreaterThanOrEqual(80);
    const all = await comm.data.leaders({ leagueId, season: 'all' });
    const top = all.allSkaters.sort((a, b) => b.p - a.p)[0];
    expect(top.p).toBeGreaterThanOrEqual(past.allSkaters.sort((a, b) => b.p - a.p)[0].p);
    // Franchise totals only grow.
    const after = await comm.data.franchiseRecords({ leagueId, teamId: 'HAL' });
    expect(after.skaters[0].t.p).toBeGreaterThan(before.skaters[0].t.p);
    // Last season's prospect and undrafted scorers come from career records.
    const pr = await comm.data.minorLeaders({ leagueId, scope: 'prospects', season: first });
    expect(pr.skaters.length).toBe(100);
    expect(pr.skaters[0].gp).toBeGreaterThan(30);
    const un = await comm.data.minorLeaders({ leagueId, scope: 'undrafted', season: first });
    expect(un.skaters.length).toBeGreaterThan(50);
  }, 120_000);
});
