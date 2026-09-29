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
async function register(username: string) {
  const u = await (await caller()).auth.register({ username, password: 'correct-horse', displayName: username.toUpperCase() });
  return caller(u.token);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('phase 12: background sims, contracts, farm, scouting', () => {
  let comm: Awaited<ReturnType<typeof caller>>;
  let bob: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;

  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    comm = await register('commish12');
    bob = await register('bob12');
    ({ id: leagueId } = await comm.leagues.create({ name: 'Phase Twelve', start: 'season' }));
    const ov = await comm.leagues.overview({ leagueId });
    await bob.leagues.join({ inviteCode: ov.inviteCode });
    await bob.leagues.claimTeam({ leagueId, teamId: 'HAL' });
  });
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('runs a sim in the background, reports progress to everyone, blocks changes and can be cancelled', async () => {
    const r = await comm.sim.advance({ leagueId, target: { days: 150 }, background: true });
    expect(r.running).toBe(true);
    // Everyone in the league sees it.
    let s = await bob.sim.status({ leagueId });
    expect(s?.status).toBe('running');
    expect(s?.startedBy).toBe('COMMISH12');
    // A second sim, or any change to the league, is refused while it runs.
    await expect(comm.sim.advance({ leagueId, target: { days: 1 } })).rejects.toThrow(/sim/i);
    await expect(bob.data.setAutoLines({ leagueId, enabled: true })).rejects.toThrow(/sim/i);
    // Only advancers can cancel.
    await expect(bob.sim.cancel({ leagueId })).rejects.toThrow();
    for (let i = 0; i < 100 && (s?.day ?? 0) < 3; i++) {
      await wait(50);
      s = await bob.sim.status({ leagueId });
    }
    expect(s!.day).toBeGreaterThanOrEqual(1);
    await comm.sim.cancel({ leagueId });
    for (let i = 0; i < 200 && s?.status === 'running'; i++) {
      await wait(50);
      s = await bob.sim.status({ leagueId });
    }
    expect(s?.status).toBe('cancelled');
    // Days already simmed are kept.
    const ov = await bob.leagues.overview({ leagueId });
    expect(ov.day).toBeGreaterThan(0);
    expect(ov.day).toBeLessThan(150);
    // And the league is editable again.
    await bob.data.setAutoLines({ leagueId, enabled: true });
  });

  it('contracts: year-by-year grid, cap outlook and re-sign interest', async () => {
    const c = await bob.data.contracts({ leagueId, teamId: 'HAL' });
    expect(c.isMine).toBe(true);
    expect(c.seasons).toHaveLength(7);
    expect(c.cap).toHaveLength(7);
    expect(c.contractMax).toBe(50);
    expect(c.players.length).toBeGreaterThan(30);
    for (const p of c.players) {
      expect(p.grid).toHaveLength(7);
      // Salary for each season he's signed, then UFA/RFA once, then nothing.
      const firstFree = p.grid.findIndex((g) => g.kind === 'ufa' || g.kind === 'rfa');
      if (firstFree >= 0) expect(p.grid.slice(0, firstFree).every((g) => g.salary !== null)).toBe(true);
    }
    const expiring = c.players.find((p) => p.remaining === 1);
    expect(expiring?.interest).toBeTruthy();
    expect(c.cap[0].committed).toBeGreaterThan(50_000_000);
    // Other teams' books are visible, without the action data.
    const other = await bob.data.contracts({ leagueId, teamId: 'KC' });
    expect(other.isMine).toBe(false);
    expect(other.players.every((p) => p.deal === null)).toBe(true);
  });

  it('farm moves: send down, call up (with a swap when full), and roster limits in the team view', async () => {
    let t = await bob.data.team({ leagueId, teamId: 'HAL' });
    expect(t.contractMax).toBe(50);
    expect(t.activeMax).toBe(23);
    expect(t.players.some((p) => p.farm)).toBe(true);
    expect(t.affiliate).toBeTruthy();
    const up = t.players.filter((p) => !p.farm && !p.injury && p.pos !== 'G').sort((a, b) => a.overall - b.overall)[0];
    await bob.offseason.sendDown({ leagueId, playerId: up.id });
    t = await bob.data.team({ leagueId, teamId: 'HAL' });
    expect(t.players.find((p) => p.id === up.id)!.farm).toBe(true);
    // Fill the NHL roster, then a call-up needs someone to go the other way.
    for (const f of t.players.filter((p) => p.farm && !p.injury && p.id !== up.id && p.pos !== 'G')) {
      if (t.active >= t.activeMax) break;
      await bob.offseason.callUp({ leagueId, playerId: f.id });
      t = await bob.data.team({ leagueId, teamId: 'HAL' });
    }
    expect(t.active).toBe(23);
    await expect(bob.offseason.callUp({ leagueId, playerId: up.id })).rejects.toThrow(/healthy/);
    const down = t.players.find((p) => !p.farm && !p.injury && p.pos === up.pos && p.id !== up.id)!;
    await bob.offseason.callUp({ leagueId, playerId: up.id, sendDownId: down.id });
    t = await bob.data.team({ leagueId, teamId: 'HAL' });
    expect(t.players.find((p) => p.id === up.id)!.farm).toBe(false);
    expect(t.players.find((p) => p.id === down.id)!.farm).toBe(true);
    expect(t.active).toBeLessThanOrEqual(23);
    // Prospects show where they play.
    for (const p of t.prospects) {
      expect(p.league).toBeTruthy();
      expect(p.club).toBeTruthy();
    }
  });

  it('scouting: staff, regions, assignments and a fogged draft class', async () => {
    const s = await bob.life.scouting({ leagueId, teamId: 'HAL' });
    expect(s.isMine).toBe(true);
    expect(s.regions.length).toBeGreaterThanOrEqual(8);
    expect(s.scouts.length).toBeGreaterThan(0);
    const region = s.regions[s.regions.length - 1].id;
    await bob.life.assignScout({ leagueId, scoutId: s.scouts[0].id, region: region as never });
    const after = await bob.life.scouting({ leagueId, teamId: 'HAL' });
    expect(after.scouts[0].region).toBe(region);
    const cls = await bob.life.draftClass({ leagueId });
    expect(cls!.players.length).toBeGreaterThan(200);
    const unscouted = cls!.players.filter((p) => !p.scouted);
    expect(unscouted.length).toBeGreaterThan(0);
    for (const p of unscouted) {
      expect(p.overall).toBeNull();
      expect(p.projection).toBeNull();
    }
    for (const p of cls!.players.filter((x) => x.scouted)) expect(p.projection).toBeTruthy();
    // Free agents never include next summer's draft class.
    const fa = await bob.offseason.freeAgents({ leagueId });
    const ids = new Set(cls!.players.map((p) => p.id));
    expect(fa.players.some((p) => ids.has(p.id))).toBe(false);
  });

  it('overview carries a change stamp (for auto-refresh) and every team; players have height and weight; the class has CSS ranks', async () => {
    const a = await bob.leagues.overview({ leagueId });
    expect(a.teams).toHaveLength(32);
    await comm.sim.advance({ leagueId, target: { days: 1 } });
    const b = await bob.leagues.overview({ leagueId });
    expect(b.version).toBeGreaterThan(a.version);
    const t = await bob.data.team({ leagueId, teamId: 'HAL' });
    for (const p of t.players) {
      expect(p.height).toBeGreaterThan(60);
      expect(p.weight).toBeGreaterThan(140);
    }
    const cls = await bob.life.draftClass({ leagueId });
    expect(['Preliminary', 'Midterm', 'Final']).toContain(cls!.cssEdition);
    expect(cls!.players.every((p) => p.css && p.css.rank >= 1)).toBe(true);
    expect(new Set(cls!.players.map((p) => p.css!.rank)).size).toBe(cls!.players.length);
  });

  it('standings mark the wild-card spots; stats can be browsed all-time', async () => {
    const st = await bob.data.standings({ leagueId });
    const rows = (Array.isArray(st) ? st : (st as { rows: unknown[] }).rows) as Array<{ seed: string | null }>;
    const seeds = rows.map((r) => r.seed).filter(Boolean);
    expect(seeds.filter((x) => x!.startsWith('WC'))).toHaveLength(4);
    const all = await bob.data.leaders({ leagueId, season: 'all' });
    expect(all.allSkaters.length).toBeGreaterThan(300);
    expect(all.seasons).toContain((await bob.leagues.overview({ leagueId })).season);
  });
});
