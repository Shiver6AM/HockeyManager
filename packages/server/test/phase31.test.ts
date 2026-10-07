import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isSimming, Scheduler } from '../src/advance';
import { appRouter } from '../src/app';
import { userFromToken } from '../src/auth';
import { createDb, type Db } from '../src/db';
import { subscribe, watching, type LeagueEvent } from '../src/events';

let db: Db;
let scheduler: Scheduler;

async function caller(token: string | null = null) {
  return appRouter.createCaller({ db, scheduler, user: await userFromToken(db, token ?? undefined), sessionToken: token, setSession: () => {} });
}
type C = Awaited<ReturnType<typeof caller>>;
const count = async (table: string, leagueId: string) => Number((await db.query<{ n: string }>(`select count(*) as n from ${table} where league_id = $1`, [leagueId]))[0].n);

describe('phase 31: the commissioner can delete a league', () => {
  let comm: C, co: C, bob: C;
  let leagueId: string;
  let otherId: string;

  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    const reg = async (name: string) => caller((await (await caller()).auth.register({ username: name, password: 'correct-horse', displayName: name })).token);
    comm = await reg('commish31');
    co = await reg('co31');
    bob = await reg('bob31');
    ({ id: leagueId } = await comm.leagues.create({ name: 'Doomed  League', start: 'season' }));
    ({ id: otherId } = await comm.leagues.create({ name: 'Keeper League', start: 'season' }));
    const ov = await comm.leagues.overview({ leagueId });
    await comm.leagues.claimTeam({ leagueId, teamId: 'HAL' });
    for (const [c, team] of [[co, 'QUE'], [bob, 'MON']] as const) {
      await c.leagues.join({ inviteCode: ov.inviteCode! });
      await c.leagues.claimTeam({ leagueId, teamId: team });
    }
    await bob.leagues.join({ inviteCode: (await comm.leagues.overview({ leagueId: otherId })).inviteCode! });
    const coId = ov.members.length ? (await comm.leagues.overview({ leagueId })).members.find((m) => m.displayName === 'co31')!.userId : '';
    await comm.leagues.setCoCommissioner({ leagueId, userId: coId, value: true });
    // Some history: games (box scores), an advance log, notifications, a schedule.
    await comm.sim.advance({ leagueId, target: { days: 3 } });
    await comm.leagues.updateAdvance({ leagueId, advance: { mode: 'scheduled', cron: '0 23 * * *', timezone: 'UTC', daysPerTick: 1, advanceEarlyWhenAllReady: false } });
  }, 120_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('only the commissioner can, and only by typing the league name', async () => {
    await expect(bob.leagues.delete({ leagueId, confirmName: 'Doomed League' })).rejects.toThrow(/Commissioner only/);
    await expect(co.leagues.delete({ leagueId, confirmName: 'Doomed League' })).rejects.toThrow(/Commissioner only/);
    await expect(comm.leagues.delete({ leagueId, confirmName: '' })).rejects.toThrow(/Type the league's name/);
    await expect(comm.leagues.delete({ leagueId, confirmName: 'Keeper League' })).rejects.toThrow(/Type the league's name/);
    expect((await comm.leagues.mine()).map((l) => l.id)).toContain(leagueId);
  });

  it('is refused while the league is simming', async () => {
    const started = await comm.sim.advance({ leagueId, target: { days: 40 }, background: true });
    expect(isSimming(leagueId)).toBe(true);
    await expect(comm.leagues.delete({ leagueId, confirmName: 'Doomed League' })).rejects.toThrow(/simming/);
    await comm.sim.cancel({ leagueId });
    for (let i = 0; i < 400 && isSimming(leagueId); i++) await new Promise((r) => setTimeout(r, 25));
    expect(isSimming(leagueId)).toBe(false);
    expect(started).toBeTruthy();
    expect((await bob.leagues.overview({ leagueId })).name).toBe('Doomed  League');
  }, 60_000);

  it('deletes the league and everything under it, for every member, and leaves other leagues alone', async () => {
    for (const t of ['league_members', 'box_scores', 'advance_log', 'notifications']) expect(await count(t, leagueId), t).toBeGreaterThan(0);
    expect(scheduler.nextRun(leagueId)).toBeTruthy();
    const got: LeagueEvent[] = [];
    const stop = subscribe(leagueId, (e) => got.push(e));

    // (Case and spacing don't have to match exactly.)
    const r = await comm.leagues.delete({ leagueId, confirmName: '  doomed league ' });
    expect(r).toEqual({ ok: true, name: 'Doomed  League' });

    expect(got.some((e) => e.type === 'deleted')).toBe(true);
    stop();
    expect(watching(leagueId)).toBe(0);
    expect(await db.query('select 1 from leagues where id = $1', [leagueId])).toHaveLength(0);
    for (const t of ['league_members', 'box_scores', 'advance_log', 'notifications']) expect(await count(t, leagueId), t).toBe(0);
    expect(scheduler.nextRun(leagueId)).toBeNull();
    for (const c of [comm, co, bob]) {
      expect((await c.leagues.mine()).map((l) => l.id)).not.toContain(leagueId);
      await expect(c.leagues.overview({ leagueId })).rejects.toThrow(/not in this league/);
      await expect(c.data.standings({ leagueId })).rejects.toThrow(/not in this league/);
    }
    await expect(comm.leagues.delete({ leagueId, confirmName: 'Doomed League' })).rejects.toThrow(/not in this league/);
    await expect(comm.sim.advance({ leagueId, target: { days: 1 } })).rejects.toThrow(/not in this league/);

    // The other league is untouched and still plays.
    expect((await comm.leagues.mine()).map((l) => l.id)).toContain(otherId);
    expect((await bob.leagues.mine()).map((l) => l.id)).toContain(otherId);
    const before = (await comm.leagues.overview({ leagueId: otherId })).day;
    await comm.sim.advance({ leagueId: otherId, target: { days: 1 } });
    expect((await bob.leagues.overview({ leagueId: otherId })).day).toBe(before + 1);
    // And the users are all still there.
    expect((await bob.auth.me())?.displayName).toBe('bob31');
  }, 60_000);
});
