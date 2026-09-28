/**
 * The production database path: node-postgres talking to a Postgres server
 * over TCP (Supabase in production). A PGlite socket server stands in for the
 * real one, so the same driver, SQL, transactions and migrations run.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/advance';
import { appRouter } from '../src/app';
import { userFromToken } from '../src/auth';
import { createDb, pgConfig, type Db } from '../src/db';

describe('pgConfig (hosted Postgres connection settings)', () => {
  it('uses TLS for remote hosts like Supabase, without breaking on its pooler certificate', () => {
    const c = pgConfig('postgresql://postgres.abcd:secret@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require', {});
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
    expect(c.connectionString).not.toMatch(/sslmode/);
    expect(c.max).toBe(5);
  });
  it('verifies the certificate when a CA is provided, and skips TLS locally', () => {
    expect(pgConfig('postgres://u:p@db.example.com/postgres', { DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nabc' }).ssl).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nabc',
      rejectUnauthorized: true,
    });
    expect(pgConfig('postgres://u:p@localhost:5432/postgres', {}).ssl).toBe(false);
    expect(pgConfig('postgres://u:p@db.example.com/postgres?sslmode=disable', {}).ssl).toBe(false);
    expect(pgConfig('postgres://u:p@db.example.com/postgres', { PG_POOL_MAX: '3' }).max).toBe(3);
  });
});

describe('node-postgres driver end to end', () => {
  let lite: PGlite;
  let server: PGLiteSocketServer;
  let db: Db;
  let scheduler: Scheduler;
  const port = 55432 + Math.floor(Math.random() * 1000);

  beforeAll(async () => {
    lite = await PGlite.create();
    server = new PGLiteSocketServer({ db: lite, port, host: '127.0.0.1', maxConnections: 4 });
    await server.start();
    process.env.PG_POOL_MAX = '1'; // the stand-in server shares one session across connections
    db = await createDb(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
    scheduler = new Scheduler(db);
  });
  afterAll(async () => {
    scheduler?.stop();
    await db?.close();
    await server?.stop();
    await lite?.close();
    delete process.env.PG_POOL_MAX;
  });

  const caller = async (token: string | null = null) =>
    appRouter.createCaller({ db, scheduler, user: await userFromToken(db, token ?? undefined), sessionToken: token, setSession: () => {} });

  it('runs migrations, with row-level security on every table', async () => {
    expect(db.kind).toBe('postgres');
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
    // Re-running is a no-op.
    const again = await createDb(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
    await again.close();
  });

  it('plays a league: accounts, a league, advances, lines and a trade', async () => {
    const anon = await caller();
    const a = await caller((await anon.auth.register({ username: 'pg_alice', password: 'correct-horse', displayName: 'Alice' })).token);
    const b = await caller((await anon.auth.register({ username: 'pg_bob', password: 'correct-horse', displayName: 'Bob' })).token);
    const { id: leagueId } = await a.leagues.create({ name: 'Postgres League' });
    await b.leagues.join({ inviteCode: (await a.leagues.overview({ leagueId })).inviteCode });
    await a.leagues.claimTeam({ leagueId, teamId: 'HAL' });
    await b.leagues.claimTeam({ leagueId, teamId: 'QUE' });
    const r = await a.sim.advance({ leagueId, target: { days: 5 } });
    expect(r.toDay).toBe(5);
    const day = await b.data.day({ leagueId });
    expect(day.games.length).toBeGreaterThan(0);
    const box = await b.data.boxScore({ leagueId, gameId: day.games[0].id }); // read back from the box_scores table
    expect(box).toBeTruthy();
    // Concurrent writes serialize through the league lock and transactions.
    const [x, y] = await Promise.all([a.sim.advance({ leagueId, target: { days: 1 } }), b.life.notifications({ leagueId })]);
    expect(x.toDay).toBe(6);
    expect(y.items.length).toBeGreaterThan(0);
    await a.data.setLines({ leagueId, lines: await a.data.suggestLines({ leagueId }) });
    const pick = (await a.trades.assets({ leagueId, teamId: 'HAL' })).picks.find((p) => p.key.includes(':3:'))!;
    const target = (await b.trades.assets({ leagueId, teamId: 'QUE' })).players.at(-1)!;
    const prop = await a.trades.propose({ leagueId, partner: 'QUE', give: [{ kind: 'pick', key: pick.key }], get: [{ kind: 'player', id: target.id }] });
    expect((await b.trades.respond({ leagueId, tradeId: prop.id, accept: true })).status).toBe('completed');

    // A scheduled tick missed while the server was down runs once at startup.
    await db.query(
      `update leagues set advance = $1, next_advance_at = now() - interval '2 hours' where id = $2`,
      [JSON.stringify({ mode: 'scheduled', cron: '0 0 1 1 *', timezone: 'UTC', daysPerTick: 2 }), leagueId],
    );
    const before = (await a.leagues.overview({ leagueId })).day;
    const restarted = new Scheduler(db);
    await restarted.start();
    restarted.stop();
    expect((await a.leagues.overview({ leagueId })).day).toBe(before + 2);
    const next = (await db.query<{ next_advance_at: Date }>('select next_advance_at from leagues where id = $1', [leagueId]))[0].next_advance_at;
    expect(new Date(next).getTime()).toBeGreaterThan(Date.now()); // rescheduled, not caught up again
  }, 60_000);
});
