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

describe('open offers on the contracts screen', () => {
  let me: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;
  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    const u = await (await caller()).auth.register({ username: 'offers20', password: 'correct-horse', displayName: 'O20' });
    me = await caller(u.token);
    ({ id: leagueId } = await me.leagues.create({ name: 'Offer League' })); // re-signing week
    await me.leagues.claimTeam({ leagueId, teamId: 'HAL' });
  }, 60_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('a re-signing offer shows in the table, on his card and in the cap outlook', async () => {
    const before = await me.data.contracts({ leagueId, teamId: 'HAL' });
    const target = before.players.find((p) => p.canExtend && p.deal && p.remaining === 0)!;
    expect(target).toBeTruthy();
    const years = Math.min(3, target.deal!.ask.years);
    const salary = Math.round(target.deal!.estimate[years - 1].salary / 25_000) * 25_000;
    const r = await me.offseason.negotiate({ leagueId, playerId: target.id, salary, years });
    expect(r.result).toBe('pending');
    const after = await me.data.contracts({ leagueId, teamId: 'HAL' });
    const row = after.players.find((p) => p.id === target.id)!;
    expect(row.myOffer).toMatchObject({ offer: { salary, years }, status: 'Answers tomorrow' });
    expect(row.grid.slice(0, years).every((g) => g.kind === 'offer' && g.salary === salary)).toBe(true);
    for (let i = 0; i < 7; i++) {
      expect(after.cap[i].offered).toBe(i < years ? salary : 0);
      // Offers don't count as committed until accepted.
      expect(after.cap[i].committed).toBe(before.cap[i].committed);
      expect(after.cap[i].spaceIfAccepted).toBe(after.cap[i].space - after.cap[i].offered);
    }
    expect(after.offers).toHaveLength(1);
    const card = await me.data.player({ leagueId, playerId: target.id });
    expect(card.myOffer).toMatchObject({ kind: 're-sign', offer: { salary, years } });
  });

  it('free-agent offers count too, from next season', async () => {
    await me.sim.advance({ leagueId, target: { to: 'free-agency' } });
    const fa = await me.offseason.freeAgents({ leagueId });
    const t = fa.players.find((p) => p.ask.salary <= fa.capRoom! / 2)!;
    await me.offseason.placeBid({ leagueId, playerId: t.id, salary: t.ask.salary, years: 2 });
    const c = await me.data.contracts({ leagueId, teamId: 'HAL' });
    const o = c.offers.find((x) => x.playerId === t.id)!;
    expect(o).toMatchObject({ kind: 'free-agent', startIndex: 0 });
    expect(o.status).toMatch(/Decides in [345] days/);
    expect(c.cap[0].offered).toBeGreaterThanOrEqual(t.ask.salary);
    expect(c.cap[2].offered).toBe(c.offers.filter((x) => x.startIndex + x.offer.years > 2).reduce((s, x) => s + x.offer.salary, 0));
    expect((await me.data.player({ leagueId, playerId: t.id })).myOffer?.kind).toBe('free-agent');
  }, 60_000);
});
