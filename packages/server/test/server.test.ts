import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/advance';
import { appRouter } from '../src/app';
import { userFromToken } from '../src/auth';
import { createDb, type Db } from '../src/db';

let db: Db;
let scheduler: Scheduler;

async function caller(token: string | null = null) {
  return appRouter.createCaller({
    db,
    scheduler,
    user: await userFromToken(db, token ?? undefined),
    sessionToken: token,
    setSession: () => {},
  });
}

async function register(username: string) {
  const anon = await caller();
  const u = await anon.auth.register({ username, password: 'correct-horse', displayName: username.toUpperCase() });
  return caller(u.token);
}

describe('multiplayer league flow', () => {
  let comm: Awaited<ReturnType<typeof caller>>;
  let bob: Awaited<ReturnType<typeof caller>>;
  let cat: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;
  let bobBid = false;

  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    comm = await register('commish');
    bob = await register('bob');
    cat = await register('cat');
  });
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('rejects bad logins and duplicate usernames', async () => {
    const anon = await caller();
    await expect(anon.auth.login({ username: 'bob', password: 'nope-nope' })).rejects.toThrow(/Wrong username/);
    await expect(anon.auth.register({ username: 'BOB', password: 'whatever12', displayName: 'x' })).rejects.toThrow(/taken/);
    const ok = await anon.auth.login({ username: 'bob', password: 'correct-horse' });
    expect(ok.token).toBeTruthy();
  });

  it('creates a league and lets others join by invite code', async () => {
    ({ id: leagueId } = await comm.leagues.create({ name: 'Friday Night League' }));
    const ov = await comm.leagues.overview({ leagueId });
    expect(ov.isCommissioner).toBe(true);
    await bob.leagues.join({ inviteCode: ov.inviteCode.toLowerCase() });
    await cat.leagues.join({ inviteCode: ov.inviteCode });
    const again = await comm.leagues.overview({ leagueId });
    expect(again.members).toHaveLength(3);
    const outsider = await register('outsider');
    await expect(outsider.leagues.overview({ leagueId })).rejects.toThrow(/not in this league/);
  });

  it('lets each manager claim one unclaimed team', async () => {
    await bob.leagues.claimTeam({ leagueId, teamId: 'HAL' });
    await expect(cat.leagues.claimTeam({ leagueId, teamId: 'HAL' })).rejects.toThrow(/already has a manager/);
    await cat.leagues.claimTeam({ leagueId, teamId: 'KC' });
    await expect(cat.leagues.claimTeam({ leagueId, teamId: 'QUE' })).rejects.toThrow(/already manage/);
    const teams = await comm.leagues.teams({ leagueId });
    expect(teams.find((t) => t.id === 'HAL')!.manager).toBe('BOB');
    expect(teams.filter((t) => t.controller === 'human')).toHaveLength(2);
  });

  it('only the commissioner can advance, and box scores move to their own table', async () => {
    await expect(bob.sim.advance({ leagueId, target: { days: 1 } })).rejects.toThrow(/Commissioner only/);
    const r = await comm.sim.advance({ leagueId, target: { days: 3 } });
    expect(r.toDay).toBe(3);
    expect(r.games).toBeGreaterThan(0);
    const rows = await db.query<{ n: string }>('select count(*) as n from box_scores where league_id = $1', [leagueId]);
    expect(Number(rows[0].n)).toBe(r.games);
    const state = await db.query<{ has_box: boolean }>(
      `select exists (select 1 from jsonb_array_elements(state->'schedule') g where g->'result'->'box' is not null and g->'result'->'box' != 'null'::jsonb) as has_box
       from leagues where id = $1`,
      [leagueId],
    );
    expect(state[0].has_box).toBe(false);
    const day = await bob.data.day({ leagueId });
    const game = day.games[0];
    const box = await bob.data.boxScore({ leagueId, gameId: game.id });
    expect(box.goals.length).toBe((game.homeScore ?? 0) + (game.awayScore ?? 0) - (game.shootout ? 1 : 0));
    expect(box.home!.skaters!.length).toBeGreaterThanOrEqual(18);
    const log = await bob.sim.log({ leagueId });
    expect(log[0].by).toMatch(/commissioner/);
  });

  it('never sends hidden traits to the browser', async () => {
    const t = await bob.data.team({ leagueId, teamId: 'HAL' });
    expect(t.isMine).toBe(true);
    expect(JSON.stringify(t)).not.toMatch(/potential|injuryProneness|personality/);
  });

  it('validates and saves a human lineup', async () => {
    const suggested = await bob.data.suggestLines({ leagueId });
    const swapped = structuredClone(suggested);
    [swapped.forwards[0], swapped.forwards[3]] = [swapped.forwards[3], swapped.forwards[0]];
    await bob.data.setLines({ leagueId, lines: swapped });
    const t = await bob.data.team({ leagueId, teamId: 'HAL' });
    expect(t.lines.forwards[0]).toEqual(suggested.forwards[3]);

    const bad = structuredClone(swapped);
    bad.defense[0][0] = bad.forwards[0][0];
    await expect(bob.data.setLines({ leagueId, lines: bad })).rejects.toThrow(/more than one lineup spot/);
    const goalieAsSkater = structuredClone(swapped);
    goalieAsSkater.forwards[3][0] = swapped.goalies[1];
    await expect(bob.data.setLines({ leagueId, lines: goalieAsSkater })).rejects.toThrow(/goalie/);
    await expect(cat.data.setLines({ leagueId, lines: swapped })).rejects.toThrow(/not on your roster/);
  });

  it('hands lines to the assistant coach by default, and back to the manager on save', async () => {
    const other = await cat.data.team({ leagueId, teamId: 'KC' });
    expect(other.autoLines).toBe(true);
    // Bob saved lines by hand in the previous test.
    const mine = await bob.data.team({ leagueId, teamId: 'HAL' });
    expect(mine.autoLines).toBe(false);
    await bob.data.setAutoLines({ leagueId, enabled: true });
    expect((await bob.data.team({ leagueId, teamId: 'HAL' })).autoLines).toBe(true);
    expect((await bob.data.team({ leagueId, teamId: 'HAL' })).scratchWarnings).toEqual([]);
  });

  it('advances early once every human manager is ready (scheduled mode)', async () => {
    await expect(
      comm.leagues.updateAdvance({ leagueId, advance: { mode: 'scheduled', cron: 'not a cron', timezone: 'America/Toronto', daysPerTick: 2, advanceEarlyWhenAllReady: true } }),
    ).rejects.toThrow(/Invalid schedule/);
    const res = await comm.leagues.updateAdvance({
      leagueId,
      advance: { mode: 'scheduled', cron: '0 23 * * *', timezone: 'America/Toronto', daysPerTick: 2, advanceEarlyWhenAllReady: true },
    });
    expect(res.nextAdvanceAt).toBeTruthy();
    const before = await comm.leagues.overview({ leagueId });
    expect(before.nextAdvanceAt).toBeTruthy();

    // The commissioner has no team, so only Bob and Cat need to ready up.
    const r1 = await bob.sim.setReady({ leagueId, ready: true });
    expect(r1.advanced).toBeNull();
    const r2 = await cat.sim.setReady({ leagueId, ready: true });
    expect(r2.advanced?.toDay).toBe(before.day + 2);
    const after = await comm.leagues.overview({ leagueId });
    expect(after.day).toBe(before.day + 2);
    expect(after.members.every((m) => !m.ready)).toBe(true);
    expect((await comm.sim.log({ leagueId }))[0].by).toBe('Everyone ready');
  });

  it('a scheduled tick advances the league', async () => {
    // Every second: fire once, then stop.
    await comm.leagues.updateAdvance({
      leagueId,
      advance: { mode: 'scheduled', cron: '* * * * * *', timezone: 'UTC', daysPerTick: 1, advanceEarlyWhenAllReady: false },
    });
    const before = (await comm.leagues.overview({ leagueId })).day;
    await new Promise((r) => setTimeout(r, 2500));
    await comm.leagues.updateAdvance({ leagueId, advance: { mode: 'commissioner' } });
    const after = await comm.leagues.overview({ leagueId });
    expect(after.day).toBeGreaterThan(before);
    expect(after.nextAdvanceAt).toBeNull();
    expect((await comm.sim.log({ leagueId }))[0].by).toBe('Schedule');
  });

  it('plays through the playoffs to a champion', async () => {
    await comm.sim.advance({ leagueId, target: { to: 'end-of-season' } });
    const ov = await bob.leagues.overview({ leagueId });
    expect(ov.phase).toBe('offseason');
    expect(ov.champion).toBeTruthy();
    const po = await bob.data.playoffs({ leagueId });
    expect(po!.rounds).toHaveLength(4);
    const awards = await bob.data.awards({ leagueId });
    expect(awards.current.map((a) => a.award)).toContain('Conn Smythe Trophy');
    const leaders = await bob.data.leaders({ leagueId, playoffs: true });
    expect(leaders.skaters[0].rows.length).toBe(10);
  }, 120_000);

  it('runs an offseason with human decisions, then starts the next season', async () => {
    expect(await bob.offseason.overview({ leagueId })).toBeNull(); // season review
    await comm.sim.advance({ leagueId, target: { days: 1 } }); // open the offseason
    const os = await bob.offseason.overview({ leagueId });
    expect(os!.stage).toBe('draft');
    // Bob ranks a long shot first; when auto-picked for, he gets his list.
    const board = await bob.offseason.draftBoard({ leagueId });
    const longShot = board!.available[board!.available.length - 1];
    await bob.offseason.setDraftList({ leagueId, playerIds: [longShot.id] });
    expect(board!.available[0]).toHaveProperty('grade');
    expect(JSON.stringify(board)).not.toMatch(/potential/);

    // Cat picks when on the clock (if she is), otherwise the commissioner forces the draft through.
    const after = await bob.offseason.overview({ leagueId });
    if (after!.draft.onTheClock?.team.id === 'KC') {
      const b2 = await cat.offseason.draftBoard({ leagueId });
      await cat.offseason.makePick({ leagueId, playerId: b2!.available[0].id });
    }
    await expect(bob.offseason.negotiateFreeAgent({ leagueId, playerId: 'nope', salary: 1_000_000, years: 1 })).rejects.toThrow(/not a free agent/);
    await comm.sim.advance({ leagueId, target: { days: 1 } }); // finish draft
    const picks = (await bob.offseason.draftBoard({ leagueId }))!.picks.filter((p) => p.teamId === 'HAL');
    if (picks[0].overall > 1) expect(picks.map((p) => p.playerId)).toContain(longShot.id);

    // Re-sign: negotiate with Bob's best expiring player (accept his counter if he makes one).
    const exp = await bob.offseason.expiring({ leagueId });
    const keep = exp!.players[0];
    if (keep) {
      let r = await bob.offseason.negotiate({ leagueId, playerId: keep.id, salary: Math.min(15_500_000, Math.round((keep.ask.salary * 1.2) / 25_000) * 25_000), years: keep.ask.years });
      if (r.result === 'counter') r = await bob.offseason.negotiate({ leagueId, playerId: keep.id, ...r.counter });
      expect(r.result).toBe('accept');
      expect((await bob.offseason.expiring({ leagueId }))!.players.find((p) => p.id === keep.id)!.agreed).toBeTruthy();
    }
    await comm.sim.advance({ leagueId, target: { days: 1 } }); // -> free agency
    if (keep) expect((await bob.data.team({ leagueId, teamId: 'HAL' })).players.map((p) => p.id)).toContain(keep.id);

    // Free agency is blind bidding: place a bid, then the round resolves on advance.
    const fa = await bob.offseason.freeAgents({ leagueId });
    expect(fa.bidding).toBe(true);
    expect(fa.canSign).toBe(false);
    // Random leagues leave HAL with different cap room: bid generously on the best player we can afford.
    // Keep ~$2M free for the entry-level deal of the prospect promoted below.
    const budget = fa.capRoom! - 2_000_000;
    const target = fa.players.find((p) => p.ask.salary <= budget);
    await expect(bob.offseason.negotiateFreeAgent({ leagueId, playerId: fa.players[0].id, salary: 1_000_000, years: 1 })).rejects.toThrow(/training camp or during the season/);
    // Every free agent shows his interest in us and his ask from us.
    expect(fa.players[0].deal!.interest.score).toBeGreaterThanOrEqual(0);
    expect(fa.players[0].deal!.estimate).toHaveLength(8);
    expect(JSON.stringify(fa.players[0].deal)).not.toMatch(/effect|greed|loyalty|ambition/);
    if (target) {
      // (Random leagues occasionally leave HAL capped out after re-signing.)
      const bid = Math.floor(Math.min(target.ask.salary * 1.5, budget) / 25_000) * 25_000;
      await bob.offseason.placeBid({ leagueId, playerId: target.id, salary: bid, years: target.ask.years });
      expect((await bob.offseason.freeAgents({ leagueId })).myBids).toHaveLength(1);
      bobBid = true;
    }
    await comm.sim.advance({ leagueId, target: { days: 3 } }); // three bidding rounds
    const faAfter = await bob.offseason.freeAgents({ leagueId });
    expect(faAfter.results.length).toBeGreaterThan(5);
    const team = await bob.data.team({ leagueId, teamId: 'HAL' });

    // Promote a prospect (when there's room for an entry-level deal).
    const prospect = team.prospects[0];
    if (team.salaryCap - team.payroll >= 950_000) {
      await bob.offseason.promote({ leagueId, playerId: prospect.id });
      const player = await bob.data.player({ leagueId, playerId: prospect.id });
      expect(player.player!.contract!.kind).toBe('ELC');
    }

    const before = (await comm.leagues.overview({ leagueId })).season;
    await comm.sim.advance({ leagueId, target: { to: 'next-season' } });
    const ov = await comm.leagues.overview({ leagueId });
    expect(ov.season).toBe(before + 1);
    expect(ov.phase).toBe('regular-season');
    const hal = await bob.data.team({ leagueId, teamId: 'HAL' });
    expect(hal.players.length).toBeLessThanOrEqual(24);
    // Career pages carry last season.
    const vet = hal.players.find((p) => p.age >= 25)!;
    const career = await bob.data.player({ leagueId, playerId: vet.id });
    expect(career.career.some((c) => c.season === before)).toBe(true);
    await comm.sim.advance({ leagueId, target: { days: 3 } });
    expect((await comm.leagues.overview({ leagueId })).day).toBe(3);
  }, 120_000);

  it('negotiates with a free agent in season: he signs when the offer clears his bar', async () => {
    const fa = await bob.offseason.freeAgents({ leagueId });
    expect(fa.canSign).toBe(true);
    if (fa.rosterCount! >= fa.rosterMax) return; // (random leagues: HAL may be full)
    const p = fa.players.find((x) => x.deal!.estimate[x.deal!.ask.years - 1].salary * 1.3 <= fa.capRoom!)!;
    const lowball = await bob.offseason.negotiateFreeAgent({ leagueId, playerId: p.id, salary: 775_000, years: 1 });
    expect(['reject', 'counter', 'accept']).toContain(lowball.result);
    if (lowball.result === 'accept') return;
    const years = p.deal!.ask.years;
    const salary = Math.round((p.deal!.estimate[years - 1].salary * 1.3) / 25_000) * 25_000;
    const r = await bob.offseason.negotiateFreeAgent({ leagueId, playerId: p.id, salary, years });
    expect(r.result).toBe('accept');
    expect((await bob.data.team({ leagueId, teamId: 'HAL' })).players.map((x) => x.id)).toContain(p.id);
  });

  it('keeps managers informed: notifications, news, front office and history', async () => {
    const n = await bob.life.notifications({ leagueId });
    expect(n.unread).toBeGreaterThan(0);
    expect(n.items.some((x) => x.kind === 'advance')).toBe(true);
    if (bobBid) expect(n.items.some((x) => x.kind === 'free-agency')).toBe(true);
    // Other users never see Bob's notices.
    const bobIds = new Set(n.items.map((x) => x.id));
    expect((await cat.life.notifications({ leagueId })).items.some((x) => bobIds.has(x.id))).toBe(false);
    await bob.life.markRead({ leagueId });
    expect((await bob.life.notifications({ leagueId })).unread).toBe(0);

    const news = await bob.life.news({ leagueId });
    expect(news.length).toBeGreaterThan(20);
    expect(news[0].id).toBeGreaterThan(news.at(-1)!.id); // newest first

    const hist = await bob.life.history({ leagueId });
    expect(hist.seasons).toHaveLength(1);
    expect(hist.seasons[0].champion).toBeTruthy();
    expect(hist.leaders.points.length).toBe(10);

    const fo = await bob.life.frontOffice({ leagueId, teamId: 'HAL' });
    expect(fo.isMine).toBe(true);
    expect(fo.history).toHaveLength(1);
    expect(fo.history[0].homeGames).toBe(41);
    expect(fo.owner?.goalLabel).toBeTruthy();

    // Hire a new head coach from the pool.
    const coach = (await bob.life.staffPool({ leagueId })).find((s) => s.role === 'coach')!;
    await expect(cat.life.hireStaff({ leagueId, staffId: 'nobody' })).rejects.toThrow(/not available/);
    await bob.life.hireStaff({ leagueId, staffId: coach.id });
    const fo2 = await bob.life.frontOffice({ leagueId, teamId: 'HAL' });
    expect(fo2.staff.find((s) => s.role === 'coach')!.member!.id).toBe(coach.id);
    expect((await bob.life.staffPool({ leagueId })).some((s) => s.id === coach.id)).toBe(false);
  });
});

describe('persistence', () => {
  it('keeps leagues across restarts with an on-disk PGlite database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hgm-'));
    try {
      db = await createDb(dir);
      scheduler = new Scheduler(db);
      const a = await register('persist');
      const { id } = await a.leagues.create({ name: 'Durable League' });
      await a.sim.advance({ leagueId: id, target: { days: 2 } });
      await db.close();

      db = await createDb(dir);
      const token = (await db.query<{ token: string }>('select token from sessions limit 1'))[0].token;
      const again = await caller(token);
      const ov = await again.leagues.overview({ leagueId: id });
      expect(ov.day).toBe(2);
      await db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('trades API', () => {
  it('evaluates and executes AI trades, and runs human-to-human proposals', async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    const a = await register('trader_a');
    const b = await register('trader_b');
    const { id: leagueId } = await a.leagues.create({ name: 'Trade League' });
    const { inviteCode } = await a.leagues.overview({ leagueId });
    await b.leagues.join({ inviteCode });
    await a.leagues.claimTeam({ leagueId, teamId: 'HAL' });
    await b.leagues.claimTeam({ leagueId, teamId: 'QUE' });

    const mine = await a.trades.assets({ leagueId, teamId: 'HAL' });
    const kc = await a.trades.assets({ leagueId, teamId: 'KC' });
    // A lopsided ask: their best player for our worst.
    const worst = mine.players.at(-1)!;
    const star = kc.players.find((p) => (p.contract?.salary ?? 0) <= mine.capRoom + (worst.contract?.salary ?? 0))!;
    const lopsided = { leagueId, partner: 'KC', give: [{ kind: 'player' as const, id: worst.id }], get: [{ kind: 'player' as const, id: star.id }] };
    const ev = await a.trades.evaluate(lopsided);
    expect(ev.verdict!.accept).toBe(false);
    expect(JSON.stringify(ev)).not.toMatch(/ratio/);
    const rejected = await a.trades.propose(lopsided);
    expect(rejected.status).toBe('rejected');

    // Ask what they'd want for a depth player, add it, and make the trade.
    // League seeds are random, so try cheap depth players until one has a price we can pay.
    type A = { kind: 'player'; id: string } | { kind: 'pick'; key: string };
    let want: { leagueId: string; partner: string; give: A[]; get: A[] } | null = null;
    let extra: Awaited<ReturnType<typeof a.trades.askAi>> = null;
    let cheap = kc.players[0];
    for (const p of [...kc.players].sort((x, y) => (x.contract?.salary ?? 0) - (y.contract?.salary ?? 0)).slice(0, 8)) {
      want = { leagueId, partner: 'KC', give: [], get: [{ kind: 'player', id: p.id }] };
      extra = await a.trades.askAi(want);
      if (extra) {
        cheap = p;
        break;
      }
    }
    expect(extra).toBeTruthy();
    want = want!;
    for (const x of extra!) want.give.push(x.kind === 'pick' ? { kind: 'pick', key: x.key } : { kind: 'player', id: x.id });
    const done = await a.trades.propose(want);
    expect(done.status).toBe('completed');
    expect((await a.data.team({ leagueId, teamId: 'HAL' })).players.map((p) => p.id)).toContain(cheap.id);

    // Human to human: HAL offers a pick for a QUE depth player; QUE accepts.
    const que = await b.trades.assets({ leagueId, teamId: 'QUE' });
    const pick = (await a.trades.assets({ leagueId, teamId: 'HAL' })).picks.find((p) => p.key.endsWith(':3:HAL'))!;
    const target = [...que.players].sort((x, y) => (x.contract?.salary ?? 0) - (y.contract?.salary ?? 0))[0];
    const prop = await a.trades.propose({ leagueId, partner: 'QUE', give: [{ kind: 'pick', key: pick.key }], get: [{ kind: 'player', id: target.id }] });
    expect(prop.status).toBe('pending');
    const bell = await b.life.notifications({ leagueId });
    expect(bell.items[0]).toMatchObject({ kind: 'trade', link: '/trades', read: false });
    const inbox = await b.trades.list({ leagueId });
    expect(inbox.incoming.map((t) => t.id)).toContain(prop.id);
    await expect(a.trades.respond({ leagueId, tradeId: prop.id, accept: true })).rejects.toThrow(/receiving team/);
    const accepted = await b.trades.respond({ leagueId, tradeId: prop.id, accept: true });
    expect(accepted.status).toBe('completed');
    expect((await b.trades.assets({ leagueId, teamId: 'QUE' })).picks.map((p) => p.key)).toContain(pick.key);
    expect((await a.life.notifications({ leagueId })).items[0].text).toMatch(/accepted your trade/);
    expect((await a.life.news({ leagueId })).some((x) => x.kind === 'trade')).toBe(true);

    // Trade blocks: set mine, see it from the other side, and see fits.
    const halAssets = await a.trades.assets({ leagueId, teamId: 'HAL' });
    expect(halAssets.picks.length).toBeGreaterThanOrEqual(30); // five drafts
    const shopping = halAssets.players.slice(-2).map((p) => p.id);
    await a.trades.setBlock({ leagueId, players: shopping, picks: [], needs: ['D', 'picks'], note: 'Need a top-4 D' });
    const seen = await b.trades.assets({ leagueId, teamId: 'HAL', fitsFor: 'QUE' });
    expect(seen.block.needs).toEqual(['D', 'picks']);
    expect(seen.players.filter((p) => p.onBlock).map((p) => p.id).sort()).toEqual([...shopping].sort());
    const queForHal = await a.trades.assets({ leagueId, teamId: 'QUE', fitsFor: 'HAL' });
    expect(queForHal.picks.every((pk) => pk.fits.includes('picks'))).toBe(true);
    const board = await b.trades.leagueBlock({ leagueId });
    expect(board.teams.find((t) => t.team.id === 'HAL')!.note).toBe('Need a top-4 D');
    expect(board.teams.some((t) => t.team.controller === 'ai' && t.needs.length > 0)).toBe(true);
    await expect(a.trades.setBlock({ leagueId, players: [], picks: [], needs: ['nonsense' as never] })).rejects.toThrow();
    expect(await a.offseason.rfa({ leagueId })).toBeNull(); // no RFA cases in season
    await db.close();
  }, 60_000);
});
