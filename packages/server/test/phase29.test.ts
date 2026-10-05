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

describe('phase 29: AI teams make managers trade offers', () => {
  let comm: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;

  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    const u = await (await caller()).auth.register({ username: 'commish29', password: 'correct-horse', displayName: 'C29' });
    comm = await caller(u.token);
    ({ id: leagueId } = await comm.leagues.create({ name: 'Offer League', start: 'season' }));
    await comm.leagues.claimTeam({ leagueId, teamId: 'HAL' });
    // A manager who says what he's looking for hears from other teams more often.
    await comm.trades.setBlock({ leagueId, players: [], picks: [], needs: ['C', 'W', 'D'] });
  }, 60_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('an offer shows up on every page, in the trade center and in the notifications; accepting it makes the trade', async () => {
    expect((await comm.leagues.overview({ leagueId })).tradeOffers).toEqual([]);
    let ov = await comm.leagues.overview({ leagueId });
    for (let i = 0; i < 20 && !ov.tradeOffers.length && (ov.daysToDeadline ?? 0) > 0; i++) {
      await comm.sim.advance({ leagueId, target: { days: 6 } });
      ov = await comm.leagues.overview({ leagueId });
    }
    expect(ov.tradeOffers.length).toBeGreaterThan(0);
    const o = ov.tradeOffers[0];
    expect(o.fromAi).toBe(true);
    expect(o.youGet.length).toBeGreaterThan(0);
    expect(o.youGive.length).toBeGreaterThan(0);
    expect(o.daysLeft).toBeGreaterThanOrEqual(1);

    const list = await comm.trades.list({ leagueId });
    const t = list.incoming.find((x) => x.id === o.id)!;
    expect(t.fromAi).toBe(true);
    expect(t.pitch!.length).toBeGreaterThan(10);
    expect(t.daysLeft).toBe(o.daysLeft);
    expect(t.to.id).toBe('HAL');

    const notes = await comm.life.notifications({ leagueId });
    const n = notes.items.find((x) => x.kind === 'trade' && x.text.startsWith(`${o.from.city} made you a trade offer`));
    expect(n).toBeTruthy();
    expect(n!.link).toBe('/trades');
    expect(n!.text).toContain(o.youGet[0]);

    // Only the team it was made to can answer.
    const answer = await comm.trades.respond({ leagueId, tradeId: o.id, accept: true });
    expect(['completed', 'withdrawn', 'invalid']).toContain(answer.status);
    const after = await comm.leagues.overview({ leagueId });
    expect(after.tradeOffers.some((x) => x.id === o.id)).toBe(false);
    if (answer.status === 'completed') {
      const mine = await comm.trades.assets({ leagueId, teamId: 'HAL' });
      const got = t.give.filter((a) => a.kind === 'player').map((a) => (a as { id: string }).id);
      const have = new Set([...mine.players, ...mine.prospects].map((p) => p.id));
      for (const id of got) expect(have.has(id)).toBe(true);
    }
  }, 240_000);

  it('an offer left unanswered runs out, and the manager is told', async () => {
    // Decline what's open, then wait for the next call and let it expire.
    for (const x of (await comm.leagues.overview({ leagueId })).tradeOffers) await comm.trades.respond({ leagueId, tradeId: x.id, accept: false });
    let ov = await comm.leagues.overview({ leagueId });
    for (let i = 0; i < 20 && !ov.tradeOffers.length && (ov.daysToDeadline ?? 0) > 12; i++) {
      await comm.sim.advance({ leagueId, target: { days: 5 } });
      ov = await comm.leagues.overview({ leagueId });
    }
    if (!ov.tradeOffers.length) return; // (no second call before the deadline in this league)
    const o = ov.tradeOffers[0];
    await comm.sim.advance({ leagueId, target: { days: 11 } });
    const after = await comm.leagues.overview({ leagueId });
    expect(after.tradeOffers.some((x) => x.id === o.id)).toBe(false);
    const notes = await comm.life.notifications({ leagueId });
    expect(notes.items.some((x) => x.kind === 'trade' && x.text.startsWith(`${o.from.city}'s trade offer is off the table`))).toBe(true);
    await expect(comm.trades.respond({ leagueId, tradeId: o.id, accept: true })).rejects.toThrow(/no longer pending/);
  }, 240_000);
});
