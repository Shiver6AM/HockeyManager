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

describe('phase 42: watching undrafted players from the stats page', () => {
  let c: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;
  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    c = await caller((await (await caller()).auth.register({ username: 'watch42', password: 'correct-horse', displayName: 'W' })).token);
    ({ id: leagueId } = await c.leagues.create({ name: 'Watch League', start: 'season' }));
    await c.leagues.claimTeam({ leagueId, teamId: 'HAL' });
    await c.sim.advance({ leagueId, target: { days: 12 } });
  }, 120_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('undrafted leaders can be starred onto the watchlist; drafted prospects can’t', async () => {
    const before = await c.data.minorLeaders({ leagueId, scope: 'undrafted' });
    expect(before.skaters.length).toBeGreaterThan(20);
    expect(before.skaters.every((r) => r.watchable && !r.watched)).toBe(true);
    expect(before.watchCount).toBe(0);
    const top = before.skaters[0];
    await c.offseason.setWatch({ leagueId, playerId: top.id, watched: true });
    const after = await c.data.minorLeaders({ leagueId, scope: 'undrafted' });
    expect(after.skaters.find((r) => r.id === top.id)?.watched).toBe(true);
    expect(after.watchCount).toBe(1);
    // He's on the same watchlist the draft class uses.
    const cls = await c.life.draftClass({ leagueId });
    expect(cls.players.find((p) => p.id === top.id)?.watched).toBe(true);
    await c.offseason.setWatch({ leagueId, playerId: top.id, watched: false });
    expect((await c.data.minorLeaders({ leagueId, scope: 'undrafted' })).watchCount).toBe(0);
    const pros = await c.data.minorLeaders({ leagueId, scope: 'prospects' });
    expect(pros.skaters.every((r) => !r.watchable)).toBe(true);
  });
});
