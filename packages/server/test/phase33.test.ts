import { executeTrade, newsFromTransactions, overall, SCOUTING, type TradeAsset } from '@hockey-gm/sim-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mutateLeague, Scheduler } from '../src/advance';
import { appRouter, buildApp } from '../src/app';
import { userFromToken } from '../src/auth';
import { createDb, type Db } from '../src/db';
import { readLeague } from '../src/state';

let db: Db;
let scheduler: Scheduler;

async function caller(token: string | null = null) {
  return appRouter.createCaller({ db, scheduler, user: await userFromToken(db, token ?? undefined), sessionToken: token, setSession: () => {} });
}
type C = Awaited<ReturnType<typeof caller>>;

describe('phase 33: linked players in trades, injury history, eight scouts', () => {
  let ann: C, bob: C;
  let leagueId: string;

  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    const reg = async (name: string) => caller((await (await caller()).auth.register({ username: name, password: 'correct-horse', displayName: name })).token);
    ann = await reg('ann33');
    bob = await reg('bob33');
    ({ id: leagueId } = await ann.leagues.create({ name: 'Links League', start: 'season' }));
    await ann.leagues.claimTeam({ leagueId, teamId: 'HAL' });
    await bob.leagues.join({ inviteCode: (await ann.leagues.overview({ leagueId })).inviteCode! });
    await bob.leagues.claimTeam({ leagueId, teamId: 'QUE' });
  }, 60_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  /** Two depth players from each side: a four-player trade that fits under the cap either way. */
  async function fourPlayerDeal() {
    const L = await readLeague(db, leagueId);
    const depth = (teamId: string) =>
      L.teams[teamId].roster
        .map((id) => L.players[id])
        .filter((p) => !p.farm && p.pos !== 'G' && !p.injury)
        .sort((a, b) => overall(a) - overall(b))
        .slice(2, 4);
    const give = depth('HAL').map((p) => ({ kind: 'player', id: p.id }) as TradeAsset);
    const get = depth('QUE').map((p) => ({ kind: 'player', id: p.id }) as TradeAsset);
    const name = (a: TradeAsset) => `${L.players[(a as { id: string }).id].firstName} ${L.players[(a as { id: string }).id].lastName}`;
    return { give, get, names: [...give, ...get].map(name), ids: [...give, ...get].map((a) => (a as { id: string }).id) };
  }

  it('a trade notification names every player, and each one comes back as a link target', async () => {
    const deal = await fourPlayerDeal();
    const t = await ann.trades.propose({ leagueId, partner: 'QUE', give: deal.give, get: deal.get });
    expect(t.status).toBe('pending');
    const n = (await bob.life.notifications({ leagueId })).items.find((x) => x.kind === 'trade')!;
    expect(n.text).toMatch(/^Halifax sent you a trade proposal: you get /);
    for (const name of deal.names) expect(n.text).toContain(name);
    expect(n.players.map((p) => p.id).sort()).toEqual([...deal.ids].sort());
    for (const p of n.players) expect(n.text).toContain(p.name);
    expect(n.link).toBe('/trades');

    // Bob accepts: Ann is told, with the same four players linked, from her side of the deal.
    const done = await bob.trades.respond({ leagueId, tradeId: t.id, accept: true });
    expect(done.status).toBe('completed');
    const back = (await ann.life.notifications({ leagueId })).items.find((x) => x.kind === 'trade')!;
    expect(back.text).toMatch(/^Quebec accepted your trade proposal: you get /);
    expect(back.players).toHaveLength(4);
    // (Other notices carry no players and still work.)
    await ann.sim.advance({ leagueId, target: { days: 4 } });
    const plain = (await ann.life.notifications({ leagueId })).items.filter((x) => x.kind !== 'trade');
    expect(plain.length).toBeGreaterThan(0);
    for (const x of plain) expect(x.players).toEqual([]);
  }, 60_000);

  it('the trade story in the news links all four players and both teams', async () => {
    const news = await ann.life.news({ leagueId, limit: 50 });
    // (AI teams may have traded since: find ours.)
    const story = news.find((n) => n.kind === 'trade' && n.teams.some((t) => t.id === 'HAL') && n.teams.some((t) => t.id === 'QUE'))!;
    expect(story).toBeTruthy();
    expect(story.playerIds).toHaveLength(4);
    expect(story.players).toHaveLength(4);
    for (const p of story.players) expect(story.headline).toContain(`${p.name} (`);
    // In the order they appear in the headline.
    const at = story.players.map((p) => story.headline.indexOf(p.name));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(story.teams.map((t) => t.id).sort()).toEqual(['HAL', 'QUE']);
    // A one-player story still links its player.
    const single = news.find((n) => n.kind !== 'trade' && n.playerIds.length === 1);
    if (single) expect(single.players.map((p) => p.id)).toEqual(single.playerIds);
  });

  it('older trade stories, which recorded only the first player, still link everyone by name', async () => {
    const deal = await fourPlayerDeal();
    await mutateLeague(db, leagueId, (L) => {
      executeTrade(L, 'HAL', 'QUE', deal.give, deal.get);
      // As stories were written before: one player id, one team.
      const tx = L.transactions.filter((t) => t.type === 'trade').slice(-2);
      for (const t of tx) {
        delete t.playerIds;
        delete t.teamIds;
      }
      newsFromTransactions(L);
    });
    const story = (await ann.life.news({ leagueId, limit: 50 })).find((n) => n.kind === 'trade')!;
    expect(story.playerIds).toHaveLength(1);
    expect(story.players.map((p) => p.id).sort()).toEqual([...deal.ids].sort());
  });

  it("a player's page lists his injuries, newest first, including ones from before records were kept on the player", async () => {
    // Sim until two different Halifax players have been hurt.
    let hurt: string[] = [];
    for (let i = 0; i < 40 && hurt.length < 2; i++) {
      await ann.sim.advance({ leagueId, target: { days: 5 } });
      const L = await readLeague(db, leagueId);
      hurt = Object.values(L.players).filter((p) => p.injuryLog?.length && (p.teamId === 'HAL' || p.teamId === 'QUE')).map((p) => p.id);
    }
    expect(hurt.length).toBeGreaterThanOrEqual(2);
    const L = await readLeague(db, leagueId);
    const p = L.players[hurt[0]];
    const d = await ann.data.player({ leagueId, playerId: p.id });
    expect(d.injuries).toHaveLength(p.injuryLog!.length);
    expect(d.injuries[0]).toMatchObject({ season: L.season, type: p.injuryLog!.at(-1)!.type, severity: p.injuryLog!.at(-1)!.severity, days: p.injuryLog!.at(-1)!.days });
    expect(d.injuries[0].current).toBe(!!p.injury && p.injury.sinceDay === p.injuryLog!.at(-1)!.day);
    expect(d.injuriesSince).toBeTruthy();
    for (let i = 1; i < d.injuries.length; i++) expect(d.injuries[i - 1].day).toBeGreaterThanOrEqual(d.injuries[i].day);

    // A league from before this change: nothing on the player, but the transaction log still has it.
    const other = hurt[1];
    const before = (await ann.data.player({ leagueId, playerId: other })).injuries;
    await mutateLeague(db, leagueId, (M) => {
      delete M.players[other].injuryLog;
    });
    const fromLog = (await ann.data.player({ leagueId, playerId: other })).injuries;
    expect(fromLog.map(({ season, day, type, severity, days }) => ({ season, day, type, severity, days }))).toEqual(
      before.map(({ season, day, type, severity, days }) => ({ season, day, type, severity, days })),
    );
    // Someone who has never been hurt has an empty list.
    const healthy = Object.values(L.players).find((x) => x.teamId === 'HAL' && !x.injuryLog && !L.transactions.some((t) => t.type === 'injury' && t.playerId === x.id))!;
    expect((await ann.data.player({ leagueId, playerId: healthy.id })).injuries).toEqual([]);
  }, 240_000);

  it("a page's batched request with many queries is served, not turned away for its length", async () => {
    const { app } = await buildApp({ db, scheduler });
    const names = ['sim.status', 'life.notifications', 'trades.status', 'leagues.teams', 'trades.partners', 'trades.assets', 'trades.assets', 'trades.list', 'leagues.overview', 'data.standings'];
    expect(names.join(',').length).toBeGreaterThan(100);
    const input = Object.fromEntries(names.map((n, i) => [i, n === 'trades.assets' ? { leagueId, teamId: 'HAL' } : { leagueId }]));
    const res = await app.inject({ method: 'GET', url: `/trpc/${names.join(',')}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}` });
    // (Not signed in here, so every query answers "unauthorized"; the point is that the request was routed.)
    expect(res.statusCode).not.toBe(414);
    expect(JSON.parse(res.body)).toHaveLength(names.length);
    await app.close();
  });

  it('a team can employ eight scouts, and not a ninth', async () => {
    expect(SCOUTING.maxScouts).toBe(8);
    let s = await ann.life.scouting({ leagueId, teamId: 'HAL' });
    expect(s.maxScouts).toBe(8);
    while (s.scouts.length < 8) {
      await ann.life.hireScout({ leagueId, scoutId: s.pool.at(-1)!.id }); // (the cheapest available)
      s = await ann.life.scouting({ leagueId, teamId: 'HAL' });
    }
    expect(s.scouts).toHaveLength(8);
    expect(s.pool.length).toBeGreaterThan(0);
    await expect(ann.life.hireScout({ leagueId, scoutId: s.pool[0].id })).rejects.toThrow(/already have 8 scouts/);
  }, 60_000);
});
