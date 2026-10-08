import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mutateLeague, Scheduler } from '../src/advance';
import { appRouter, buildApp } from '../src/app';
import { userFromToken } from '../src/auth';
import { createDb, type Db } from '../src/db';
import { subscribe, watching, type LeagueEvent } from '../src/events';

let db: Db;
let scheduler: Scheduler;
let stateFetches = 0;

async function caller(token: string | null = null) {
  return appRouter.createCaller({ db, scheduler, user: await userFromToken(db, token ?? undefined), sessionToken: token, setSession: () => {} });
}

describe('phase 28: live updates, lighter simcast, faster pages', () => {
  let comm: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;
  let token: string;

  beforeAll(async () => {
    db = await createDb('memory://');
    const q0 = db.query.bind(db);
    const tx0 = db.tx.bind(db);
    const count = (sql: string) => {
      if (/select\s+state/i.test(sql)) stateFetches++;
    };
    db.query = (async (sql: string, p?: unknown[]) => {
      count(sql);
      return q0(sql, p);
    }) as Db['query'];
    db.tx = ((fn: (q: { query: Db['query'] }) => Promise<unknown>) =>
      tx0((q) =>
        fn({
          query: (async (sql: string, p?: unknown[]) => {
            count(sql);
            return q.query(sql, p);
          }) as Db['query'],
        }),
      )) as Db['tx'];
    scheduler = new Scheduler(db);
    const u = await (await caller()).auth.register({ username: 'commish28', password: 'correct-horse', displayName: 'C28' });
    token = u.token;
    comm = await caller(u.token);
    ({ id: leagueId } = await comm.leagues.create({ name: 'Live League', start: 'season' }));
    await comm.leagues.claimTeam({ leagueId, teamId: 'HAL' });
  }, 60_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('tells listeners when the league changes and how a sim is going', async () => {
    const got: LeagueEvent[] = [];
    const stop = subscribe(leagueId, (e) => got.push(e));
    await comm.sim.setReady({ leagueId, ready: true });
    expect(got.filter((e) => e.type === 'changed').length).toBeGreaterThanOrEqual(1);
    got.length = 0;
    await comm.sim.advance({ leagueId, target: { days: 4 } });
    const sims = got.filter((e): e is Extract<LeagueEvent, { type: 'sim' }> => e.type === 'sim').map((e) => e.job as { status: string; day: number });
    expect(sims[0].status).toBe('running');
    expect(sims.at(-1)).toMatchObject({ status: 'done', day: 4 });
    expect(got.at(-1)!.type).toBe('changed');
    // A failed change says nothing.
    got.length = 0;
    await expect(comm.offseason.setWatch({ leagueId, playerId: 'nobody', watched: true })).rejects.toThrow();
    expect(got).toEqual([]);
    stop();
    expect(watching(leagueId)).toBe(0);
  }, 60_000);

  it('streams those messages to a signed-in member over HTTP', async () => {
    const { app } = await buildApp({ db, scheduler });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}/api/leagues/${leagueId}/events`;
    expect((await fetch(url)).status).toBe(401);
    const outsider = await (await caller()).auth.register({ username: 'outsider28', password: 'correct-horse', displayName: 'O28' });
    expect((await fetch(url, { headers: { authorization: `Bearer ${outsider.token}` } })).status).toBe(403);
    const ctl = new AbortController();
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const until = async (re: RegExp) => {
      for (let i = 0; i < 50 && !re.test(text); i++) text += dec.decode((await reader.read()).value);
      return re.test(text);
    };
    expect(await until(/"type":"hello"/)).toBe(true);
    expect(watching(leagueId)).toBe(1);
    await comm.sim.setReady({ leagueId, ready: false });
    expect(await until(/"type":"changed"/)).toBe(true);
    ctl.abort();
    await new Promise((r) => setTimeout(r, 100));
    expect(watching(leagueId)).toBe(0);
    await app.close();
  }, 30_000);

  it('a read that lands while a save is still open is answered from memory', async () => {
    await comm.leagues.overview({ leagueId });
    stateFetches = 0;
    let during: number | null = null;
    await mutateLeague(db, leagueId, async (L) => {
      L.teams.HAL.watchlist = [];
      // (Fire a read now; it completes while this change's transaction is being saved.)
      void comm.leagues.overview({ leagueId }).then((o) => (during = o.day));
    });
    await new Promise((r) => setTimeout(r, 50));
    expect((await comm.leagues.overview({ leagueId })).day).toBe(4);
    expect(during === null || during === 4).toBe(true);
    expect(stateFetches).toBe(0);
  });

  it('the simcast sends only the plays a browser does not have yet', async () => {
    const g = await comm.simcast.games({ leagueId });
    await comm.simcast.start({ leagueId, gameId: g.games[0].id });
    const first = await comm.simcast.state({ leagueId });
    expect(first!.from).toBe(0);
    expect(first!.box).toBeTruthy();
    await comm.simcast.control({ leagueId, action: 'skip-period' });
    const all = await comm.simcast.state({ leagueId });
    const delta = await comm.simcast.state({ leagueId, sid: all!.sid, after: first!.total });
    expect(delta!.from).toBe(first!.total);
    expect(delta!.plays.length).toBe(all!.total - first!.total);
    expect(delta!.plays).toEqual(all!.plays.slice(first!.total));
    // Nothing new: no plays, no box score.
    await comm.simcast.control({ leagueId, action: 'pause' });
    const idle = await comm.simcast.state({ leagueId, sid: all!.sid, after: all!.total });
    expect(idle!.plays).toEqual([]);
    expect(idle!.box).toBeNull();
    expect(JSON.stringify(idle).length).toBeLessThan(2500);
    // A browser holding another simcast's plays starts over.
    const stale = await comm.simcast.state({ leagueId, sid: 'some-earlier-game', after: 40 });
    expect(stale!.from).toBe(0);
    expect(stale!.plays.length).toBe(all!.total);
    await comm.simcast.control({ leagueId, action: 'skip-end' });
    const fin = await comm.simcast.state({ leagueId, sid: all!.sid, after: all!.total });
    expect(fin!.done).toBe(true);
    expect(fin!.box!.final).toBe(true);
    await comm.simcast.control({ leagueId, action: 'end' });
  });

  it('short-handed between games: the suggested lineup can be saved; an injured player is refused when someone healthy could play', async () => {
    const t = await comm.data.team({ leagueId, teamId: 'HAL' });
    const nhl = t.players.filter((p) => !p.farm);
    const goalie = nhl.find((p) => p.pos === 'G')!;
    const fwd = nhl.filter((p) => p.pos !== 'G' && p.pos !== 'D').sort((a, b) => b.overall - a.overall)[0];
    await mutateLeague(db, leagueId, (L) => {
      L.teams.HAL.autoLines = false;
      // (A known starting point: nobody else hurt, and two goalies up with the big club.)
      for (const p of nhl) L.players[p.id].injury = null as never;
      for (const g of nhl.filter((p) => p.pos === 'G').slice(2)) L.players[g.id].farm = true;
      for (const id of [goalie.id, fwd.id]) L.players[id].injury = { type: 'Lower-body', severity: 'short-term', daysLeft: 9 } as never;
    });
    // Only one healthy goalie: the suggestion keeps the injured one in net (a call-up replaces him on game day),
    // but not the injured forward, since healthy forwards are available.
    const lines = await comm.data.suggestLines({ leagueId });
    expect(lines.goalies).toContain(goalie.id);
    expect(lines.forwards.flat()).not.toContain(fwd.id);
    await comm.data.setLines({ leagueId, lines });
    const withHurtForward = structuredClone(lines);
    withHurtForward.forwards[3][0] = fwd.id;
    await expect(comm.data.setLines({ leagueId, lines: withHurtForward })).rejects.toThrow(/is injured \(.* is healthy/);
    await mutateLeague(db, leagueId, (L) => {
      for (const id of [goalie.id, fwd.id]) L.players[id].injury = null as never;
      L.teams.HAL.autoLines = true;
    });
  });

  it('free agency and trade pages answer quickly, with the same content', async () => {
    await comm.sim.advance({ leagueId, target: { to: 'end-of-season' } });
    await comm.sim.advance({ leagueId, target: { to: 'free-agency' } });
    const t0 = performance.now();
    const fa = await comm.offseason.freeAgents({ leagueId });
    const ms = performance.now() - t0;
    expect(fa.players.length).toBeGreaterThan(100);
    expect(fa.players.filter((p) => p.deal).length).toBeGreaterThan(100);
    // (It took about a second before; leave plenty of room for a slow test machine.)
    expect(ms).toBeLessThan(600);
    const theirs = await comm.trades.assets({ leagueId, teamId: 'QUE' });
    const star = [...theirs.players].sort((a, b) => b.value - a.value)[0];
    const t1 = performance.now();
    const ask = await comm.trades.askAi({ leagueId, partner: 'QUE', give: [], get: [{ kind: 'player', id: star.id }] });
    expect(performance.now() - t1).toBeLessThan(600);
    expect(ask === null || ask.length > 0).toBe(true);
  }, 120_000);
});
