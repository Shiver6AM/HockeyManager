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

describe('phase 24: watchlist, pending free agents, rating changes, trade values', () => {
  let comm: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;

  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    const u = await (await caller()).auth.register({ username: 'commish24', password: 'correct-horse', displayName: 'C24' });
    comm = await caller(u.token);
    ({ id: leagueId } = await comm.leagues.create({ name: 'Watch League', start: 're-sign' }));
    await comm.leagues.claimTeam({ leagueId, teamId: 'HAL' });
  }, 60_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('lists pending free agents around the league during the re-signing window', async () => {
    const fa = await comm.offseason.freeAgents({ leagueId });
    expect(fa.stage).toBe('re-sign');
    expect(fa.pending.length).toBeGreaterThan(50);
    const others = fa.pending.filter((p) => !p.mine);
    expect(others.every((p) => p.team && p.ask.salary > 0 && ['UFA', 'RFA'].includes(p.status))).toBe(true);
    expect(fa.pending.some((p) => p.mine)).toBe(true);
    // Once free agency opens, the list is gone (they're free agents or signed).
    await comm.sim.advance({ leagueId, target: { to: 'free-agency' } });
    expect((await comm.offseason.freeAgents({ leagueId })).pending).toEqual([]);
  }, 60_000);

  it('gives every asset a league-wide trade value', async () => {
    const a = await comm.trades.assets({ leagueId, teamId: 'QUE' });
    const best = [...a.players].sort((x, y) => y.overall - x.overall)[0];
    const worst = [...a.players].sort((x, y) => x.overall - y.overall)[0];
    expect(best.value).toBeGreaterThan(worst.value);
    const firsts = a.picks.filter((p) => p.round === 1);
    const sevenths = a.picks.filter((p) => p.round === 7);
    expect(firsts[0].value).toBeGreaterThan(sevenths[0].value);
  });

  it('keeps a watchlist of undrafted prospects', async () => {
    await comm.sim.advance({ leagueId, target: { to: 'next-season' } });
    const cls = await comm.life.draftClass({ leagueId });
    const p = cls!.players[0];
    expect(p.watched).toBe(false);
    await comm.offseason.setWatch({ leagueId, playerId: p.id, watched: true });
    const again = await comm.life.draftClass({ leagueId });
    expect(again!.players.find((x) => x.id === p.id)!.watched).toBe(true);
    const t = await comm.data.team({ leagueId, teamId: 'HAL' });
    await expect(comm.offseason.setWatch({ leagueId, playerId: t.players[0].id, watched: true })).rejects.toThrow(/undrafted/);
    await comm.offseason.setWatch({ leagueId, playerId: p.id, watched: false });
    expect((await comm.life.draftClass({ leagueId }))!.players.find((x) => x.id === p.id)!.watched).toBe(false);
  }, 120_000);
  it('shows how overalls moved since last season', async () => {
    // (A brand-new league has no history: play a season and open the offseason.)
    await comm.sim.advance({ leagueId, target: { to: 'end-of-season' } });
    await comm.sim.advance({ leagueId, target: { days: 1 } });
    const t = await comm.data.team({ leagueId, teamId: 'HAL' });
    const withChange = t.players.filter((p) => p.ovrChange !== null);
    expect(withChange.length).toBeGreaterThan(15);
    for (const p of withChange) expect(p.overall - p.ovrChange!).toBe(p.ovrPrev);
    expect(withChange.some((p) => p.ovrChange !== 0)).toBe(true);
  }, 180_000);

});
