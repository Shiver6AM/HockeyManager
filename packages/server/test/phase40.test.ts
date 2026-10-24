import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mutateLeague, Scheduler } from '../src/advance';
import { appRouter, buildApp } from '../src/app';
import { userFromToken } from '../src/auth';
import { createDb, type Db } from '../src/db';
import { forgetLeague, readBoxScore, readLeague } from '../src/state';

let db: Db;
let scheduler: Scheduler;
/** Bytes this server sent to the database in query parameters (what counts as its outbound traffic). */
let sent = 0;
const sqlLog: string[] = [];
async function caller(token: string | null = null) {
  return appRouter.createCaller({ db, scheduler, user: await userFromToken(db, token ?? undefined), sessionToken: token, setSession: () => {} });
}
const size = (p: unknown[] = []) => p.reduce<number>((n, v) => n + (Buffer.isBuffer(v) ? v.length : typeof v === 'string' ? Buffer.byteLength(v) : 8), 0);

describe('phase 40: less traffic out of the game server', () => {
  let c: Awaited<ReturnType<typeof caller>>;
  let token: string;
  let leagueId: string;
  beforeAll(async () => {
    db = await createDb('memory://');
    const q0 = db.query.bind(db);
    const tx0 = db.tx.bind(db);
    const note = (sql: string, p?: unknown[]) => {
      sent += Buffer.byteLength(sql) + size(p);
      sqlLog.push(sql);
    };
    db.query = (async (sql: string, p?: unknown[]) => (note(sql, p), q0(sql, p))) as Db['query'];
    db.tx = ((fn: (q: { query: Db['query'] }) => Promise<unknown>) =>
      tx0((q) => fn({ query: (async (sql: string, p?: unknown[]) => (note(sql, p), q.query(sql, p))) as Db['query'] }))) as Db['tx'];
    scheduler = new Scheduler(db);
    token = (await (await caller()).auth.register({ username: 'bw40', password: 'correct-horse', displayName: 'B' })).token;
    c = await caller(token);
    ({ id: leagueId } = await c.leagues.create({ name: 'Bandwidth League', start: 'season' }));
    await c.leagues.claimTeam({ leagueId, teamId: 'HAL' });
  }, 60_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('box scores are stored compressed, and still read back', async () => {
    await c.sim.advance({ leagueId, target: { days: 3 } });
    const rows = await db.query<{ game_id: number; box: unknown; z: number }>('select game_id, box, length(box_z) as z from box_scores where league_id = $1', [leagueId]);
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      expect(r.box).toBeNull();
      expect(Number(r.z)).toBeGreaterThan(200);
      expect(Number(r.z)).toBeLessThan(2500); // (about 6.5 KB as JSON)
    }
    const g = await c.data.boxScore({ leagueId, gameId: rows[0].game_id });
    expect(g.home?.shots).toBeGreaterThan(5);
    expect(g.home?.skaters?.length).toBeGreaterThan(10);
    // Older rows with JSON still read.
    const json = (await readBoxScore(db, leagueId, (await readLeague(db, leagueId)).season, rows[1].game_id))!;
    await db.query('update box_scores set box = $1, box_z = null where league_id = $2 and game_id = $3', [JSON.stringify(json), leagueId, rows[1].game_id]);
    expect((await c.data.boxScore({ leagueId, gameId: rows[1].game_id })).home?.shots).toBe(json.home.shots);
  });

  it('the archive is written only when it changes; a no-op change writes nothing', async () => {
    // A change to the archive (a career line): written.
    sqlLog.length = 0;
    await mutateLeague(db, leagueId, (M) => {
      (M.careerStats ??= {})['test-player'] = [];
    });
    expect(sqlLog.some((s) => /update leagues set .*archive_z/.test(s))).toBe(true);
    // An everyday change: only the day-to-day part goes out.
    sqlLog.length = 0;
    await mutateLeague(db, leagueId, (M) => void (M.name = 'Bandwidth League II'));
    expect(sqlLog.filter((s) => /update leagues set/.test(s))).toHaveLength(1);
    expect(sqlLog.some((s) => /archive_z/.test(s))).toBe(false);
    // Nothing changed: no write at all.
    sqlLog.length = 0;
    await mutateLeague(db, leagueId, () => undefined);
    expect(sqlLog.filter((s) => /update leagues set/.test(s))).toHaveLength(0);
    // Read back from the database alone (as after a restart): the archive is merged back in.
    forgetLeague(leagueId);
    const R = await readLeague(db, leagueId);
    expect(R.name).toBe('Bandwidth League II');
    expect(R.careerStats?.['test-player']).toEqual([]);
    // A league saved before the archive was split off (everything in state_z, no archive_z) still loads.
    await db.query('update leagues set archive_z = null where id = $1', [leagueId]);
    forgetLeague(leagueId);
    const old = await readLeague(db, leagueId);
    expect(old.name).toBe('Bandwidth League II');
    // …and its next save writes the archive.
    sqlLog.length = 0;
    await mutateLeague(db, leagueId, (M) => void (M.name = 'Bandwidth League III'));
    expect(sqlLog.some((s) => /update leagues set .*archive_z/.test(s))).toBe(true);
  });

  it('a day of play writes far less than the whole league each time', async () => {
    sent = 0;
    const L = await readLeague(db, leagueId);
    const whole = Buffer.byteLength(JSON.stringify(L));
    await c.sim.advance({ leagueId, target: { days: 1 } });
    // (One save of the compressed document, plus the day's compressed box scores and notices.)
    expect(sent).toBeLessThan(whole / 4);
  });

  it('API responses are compressed; the live-updates stream is not; hashed assets are cached for good', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'web-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>x</title>' + ' '.repeat(2000));
    writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.log(1);'.repeat(500));
    const { app } = await buildApp({ db, scheduler, webDist: dist });
    const cookie = `hgm_session=${token}`;
    const res = await app.inject({
      method: 'GET',
      url: `/trpc/data.team?input=${encodeURIComponent(JSON.stringify({ leagueId, teamId: 'HAL' }))}`,
      headers: { 'accept-encoding': 'br, gzip', cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    const raw = brotliDecompressSync(res.rawPayload).toString('utf8');
    expect(JSON.parse(raw).result.data.team.id).toBe('HAL');
    expect(res.rawPayload.length).toBeLessThan(Buffer.byteLength(raw) / 4);
    const js = await app.inject({ method: 'GET', url: '/assets/app-abc123.js', headers: { 'accept-encoding': 'gzip' } });
    expect(js.headers['cache-control']).toMatch(/immutable/);
    expect(js.headers['content-encoding']).toBe('gzip');
    const page = await app.inject({ method: 'GET', url: '/league/x', headers: { 'accept-encoding': 'gzip' } });
    expect(page.headers['cache-control']).toBe('no-cache');
    await app.close();
  });
});
