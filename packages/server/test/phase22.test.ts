import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mutateLeague, Scheduler } from '../src/advance';
import { appRouter } from '../src/app';
import { userFromToken } from '../src/auth';
import { createDb, type Db } from '../src/db';

let db: Db;
let scheduler: Scheduler;

async function caller(token: string | null = null) {
  return appRouter.createCaller({ db, scheduler, user: await userFromToken(db, token ?? undefined), sessionToken: token, setSession: () => {} });
}

describe('phase 22: the draft clock, trade partners, stage labels', () => {
  let comm: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;

  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    const u = await (await caller()).auth.register({ username: 'commish22', password: 'correct-horse', displayName: 'C22' });
    comm = await caller(u.token);
    ({ id: leagueId } = await comm.leagues.create({ name: 'Clock League', start: 'draft' }));
  }, 60_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('a new league at the draft waits in pre-draft until the commissioner starts the clock', async () => {
    const ov = await comm.leagues.overview({ leagueId });
    expect(ov.stageLabel).toBe('Pre-draft');
    const os = await comm.offseason.overview({ leagueId });
    expect(os!.draft.lotteryHeld).toBe(true);
    expect(os!.draft.started).toBe(false);
    await expect(comm.offseason.holdLottery({ leagueId, live: true })).rejects.toThrow(/already/);
  });

  it('runs the clock on the server: a pick is made when it comes due', async () => {
    await comm.offseason.draftControl({ leagueId, action: 'start' });
    const os = await comm.offseason.overview({ leagueId });
    expect(os!.draft.clock).toBeTruthy();
    expect(os!.draft.current).toBe(0);
    // Wind the clock forward: the pick is due now.
    await mutateLeague(db, leagueId, (L) => {
      const c = L.offseason!.draft.clock!;
      c.deadline = Date.now() - 1;
      if (c.aiAt) c.aiAt = Date.now() - 1;
    });
    await new Promise((r) => setTimeout(r, 2500));
    const after = await comm.offseason.overview({ leagueId });
    expect(after!.draft.current).toBe(1);
    expect(after!.draft.clock!.deadline).toBeGreaterThan(Date.now() + 170_000);
    await comm.offseason.draftControl({ leagueId, action: 'finish' });
    expect((await comm.leagues.overview({ leagueId })).stageLabel).toMatch(/^Re-signing window · day 1 of/);
  }, 30_000);

  it('lists trade partners in standings order with records and goals', async () => {
    const p = await comm.trades.partners({ leagueId });
    expect(p.length).toBe(32);
    expect(p.map((x) => x.rank)).toEqual(p.map((_, i) => i + 1));
    for (const x of p) expect(x.goal).toBeTruthy();
  });

  it('simcasts a game: the league waits, others can join, and the day uses the same result', async () => {
    const { id: lid } = await comm.leagues.create({ name: 'Simcast League', start: 'season' });
    const u2 = await (await caller()).auth.register({ username: 'viewer22', password: 'correct-horse', displayName: 'Viewer' });
    const viewer = await caller(u2.token);
    const invite = (await comm.leagues.overview({ leagueId: lid })).inviteCode;
    await viewer.leagues.join({ inviteCode: invite });
    const g = await comm.simcast.games({ leagueId: lid });
    expect(g.games.length).toBeGreaterThan(1);
    const game = g.games[0];
    await comm.simcast.start({ leagueId: lid, gameId: game.id });
    await expect(viewer.simcast.start({ leagueId: lid, gameId: g.games[1].id })).rejects.toThrow(/already/);
    // The league can't sim meanwhile, and the header offers a way in.
    await expect(comm.sim.advance({ leagueId: lid, target: { days: 1 } })).rejects.toThrow(/simcast/);
    const ov = await viewer.leagues.overview({ leagueId: lid });
    expect(ov.simcast).toMatchObject({ gameId: game.id, live: true, host: 'C22' });
    const st = await viewer.simcast.state({ leagueId: lid });
    expect(st!.canControl).toBe(false);
    expect(st!.plays[0].type).toBe('period-start');
    await expect(viewer.simcast.control({ leagueId: lid, action: 'skip-end' })).rejects.toThrow(/started it/);
    // Skip a period: the first period's plays are all shown.
    await comm.simcast.control({ leagueId: lid, action: 'skip-period' });
    const p1 = await comm.simcast.state({ leagueId: lid });
    expect(p1!.plays.at(-1)!.type).toBe('period-end');
    expect(p1!.intermission).toBe(true);
    expect(p1!.viewers).toEqual(expect.arrayContaining(['C22', 'Viewer']));
    expect(p1!.plays.filter((p) => p.x != null).length).toBeGreaterThan(10);
    await comm.simcast.control({ leagueId: lid, action: 'speed', speed: 10 });
    await comm.simcast.control({ leagueId: lid, action: 'skip-end' });
    const fin = await comm.simcast.state({ leagueId: lid });
    expect(fin!.done).toBe(true);
    // Over: the league can sim, and the game ends as it did in the simcast.
    await comm.sim.advance({ leagueId: lid, target: { days: 1 } });
    const scores = await comm.data.day({ leagueId: lid, day: g.day });
    const played = scores.games.find((x) => x.id === game.id)!;
    expect([played.homeScore, played.awayScore]).toEqual([fin!.homeScore, fin!.awayScore]);
  }, 60_000);
});
