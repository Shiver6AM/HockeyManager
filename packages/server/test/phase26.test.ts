import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mutateLeague, Scheduler } from '../src/advance';
import { appRouter } from '../src/app';
import { userFromToken } from '../src/auth';
import { createDb, type Db } from '../src/db';

let db: Db;
let scheduler: Scheduler;
/** Bytes of query results coming back from the database, and how often the whole document was fetched. */
let pulled = 0;
let stateFetches = 0;

async function caller(token: string | null = null) {
  return appRouter.createCaller({ db, scheduler, user: await userFromToken(db, token ?? undefined), sessionToken: token, setSession: () => {} });
}

describe('phase 26: the league document stays in memory between requests', () => {
  let comm: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;

  beforeAll(async () => {
    db = await createDb('memory://');
    const count = (sql: string, rows: unknown) => {
      pulled += Buffer.byteLength(JSON.stringify(rows));
      if (/select\s+state/i.test(sql)) stateFetches++;
    };
    const q0 = db.query.bind(db);
    const tx0 = db.tx.bind(db);
    db.query = (async (sql: string, p?: unknown[]) => {
      const r = await q0(sql, p);
      count(sql, r);
      return r;
    }) as Db['query'];
    db.tx = ((fn: (q: { query: Db['query'] }) => Promise<unknown>) =>
      tx0((q) =>
        fn({
          query: (async (sql: string, p?: unknown[]) => {
            const r = await q.query(sql, p);
            count(sql, r);
            return r;
          }) as Db['query'],
        }),
      )) as Db['tx'];
    scheduler = new Scheduler(db);
    const u = await (await caller()).auth.register({ username: 'commish26', password: 'correct-horse', displayName: 'C26' });
    comm = await caller(u.token);
    ({ id: leagueId } = await comm.leagues.create({ name: 'Lean League', start: 'season' }));
    await comm.leagues.claimTeam({ leagueId, teamId: 'HAL' });
  }, 60_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('small changes and browsing do not download the document again', async () => {
    await comm.data.team({ leagueId, teamId: 'HAL' }); // (in memory from here on)
    pulled = 0;
    stateFetches = 0;
    const cls = await comm.life.draftClass({ leagueId });
    for (let i = 0; i < 10; i++) await comm.offseason.setWatch({ leagueId, playerId: cls!.players[i].id, watched: true });
    for (let i = 0; i < 20; i++) await comm.data.team({ leagueId, teamId: 'HAL' });
    expect(stateFetches).toBe(0);
    expect(pulled).toBeLessThan(50_000);
    // The changes were saved and are what the next read sees.
    const after = await comm.life.draftClass({ leagueId });
    expect(after!.players.filter((p) => p.watched).length).toBe(10);
  });

  it('a sim and the changes after it still start from the right document', async () => {
    await comm.sim.advance({ leagueId, target: { days: 3 } });
    stateFetches = 0;
    await mutateLeague(db, leagueId, (L) => {
      expect(L.day).toBe(3);
      L.teams.HAL.watchlist = [];
    });
    expect((await comm.life.draftClass({ leagueId }))!.players.some((p) => p.watched)).toBe(false);
    expect(stateFetches).toBe(0);
  }, 60_000);

  it('a change that fails leaves the saved league untouched', async () => {
    await expect(
      mutateLeague(db, leagueId, (L) => {
        L.day = 999;
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect((await comm.leagues.overview({ leagueId })).day).toBe(3);
    await mutateLeague(db, leagueId, (L) => expect(L.day).toBe(3));
  });

  it('picks up a version written from elsewhere (and only then fetches)', async () => {
    await db.query(`update leagues set state = jsonb_set(state, '{day}', '7'), version = version + 1 where id = $1`, [leagueId]);
    stateFetches = 0;
    expect((await comm.leagues.overview({ leagueId })).day).toBe(7);
    expect(stateFetches).toBe(1);
    await mutateLeague(db, leagueId, (L) => expect(L.day).toBe(7));
    expect(stateFetches).toBe(1);
  });
});
