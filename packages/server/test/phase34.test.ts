import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/advance';
import { appRouter } from '../src/app';
import { userFromToken } from '../src/auth';
import { createDb, type Db } from '../src/db';
import { readLeague } from '../src/state';

let db: Db;
let scheduler: Scheduler;
async function caller(token: string | null = null) {
  return appRouter.createCaller({ db, scheduler, user: await userFromToken(db, token ?? undefined), sessionToken: token, setSession: () => {} });
}

describe('phase 34: season performance on the player page and in the summer report', () => {
  let c: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;
  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    c = await caller((await (await caller()).auth.register({ username: 'perf34', password: 'correct-horse', displayName: 'P' })).token);
    ({ id: leagueId } = await c.leagues.create({ name: 'Performance League', start: 'season' }));
    await c.leagues.claimTeam({ leagueId, teamId: 'HAL' });
  }, 60_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('shows how a regular is doing once he has played enough, and nothing before', async () => {
    const L0 = await readLeague(db, leagueId);
    const early = L0.teams.HAL.lines.forwards[0][1];
    await c.sim.advance({ leagueId, target: { days: 10 } });
    expect((await c.data.player({ leagueId, playerId: early })).performance).toBeNull();
    await c.sim.advance({ leagueId, target: { days: 60 } });
    // (The skater who has played the most: a regular can get hurt, and this one surely played enough.)
    const L1 = await readLeague(db, leagueId);
    const id = L1.teams.HAL.roster.filter((x) => L1.skaterStats[x]).sort((a, b) => L1.skaterStats[b].gp - L1.skaterStats[a].gp)[0];
    expect(L1.skaterStats[id].gp).toBeGreaterThanOrEqual(25);
    const d = await c.data.player({ leagueId, playerId: id });
    expect(d.performance).toBeTruthy();
    expect(d.performance!.final).toBe(false);
    expect(d.performance!.effect).toBe(1);
    expect(typeof d.performance!.z).toBe('number');
    expect(d.performance!.label).toMatch(/expect/);
  }, 240_000);

  it('after the season, the summer report says whose season helped or hurt them, and the player page keeps the verdict', async () => {
    await c.sim.advance({ leagueId, target: { to: 'end-of-season' } });
    await c.sim.advance({ leagueId, target: { days: 1 } }); // into the offseason: development
    const os = (await c.offseason.overview({ leagueId }))!;
    const rows = [...os.risers, ...os.fallers];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.season)).toBe(true);
    const judged = rows.find((r) => r.season)!;
    expect(judged.season!.label).toMatch(/expect/);
    const d = await c.data.player({ leagueId, playerId: judged.id });
    expect(d.performance).toMatchObject({ final: true, bonus: judged.season!.bonus });
  }, 300_000);
});
