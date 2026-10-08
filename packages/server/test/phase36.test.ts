import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/advance';
import { appRouter } from '../src/app';
import { userFromToken } from '../src/auth';
import { createDb, type Db } from '../src/db';
import { readLeague } from '../src/state';
import { GRADES } from '../src/tradesearch';

let db: Db;
let scheduler: Scheduler;
async function caller(token: string | null = null) {
  return appRouter.createCaller({ db, scheduler, user: await userFromToken(db, token ?? undefined), sessionToken: token, setSession: () => {} });
}

describe('phase 36: searching the league for a trade target', () => {
  let c: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;
  const search = (q: Record<string, unknown>) => c.trades.search({ leagueId, ...q } as never);
  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    c = await caller((await (await caller()).auth.register({ username: 'srch36', password: 'correct-horse', displayName: 'S' })).token);
    ({ id: leagueId } = await c.leagues.create({ name: 'Search League', start: 'season' }));
    await c.leagues.claimTeam({ leagueId, teamId: 'HAL' });
    await c.sim.advance({ leagueId, target: { days: 20 } });
  }, 240_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('covers every other team, never mine, sorted by value with a row limit', async () => {
    const r = await search({});
    expect(r.total).toBeGreaterThan(900);
    expect(r.players).toHaveLength(100);
    expect(r.players.some((p) => p.teamId === 'HAL')).toBe(false);
    for (let i = 1; i < r.players.length; i++) expect(r.players[i - 1].value).toBeGreaterThanOrEqual(r.players[i].value);
    expect(r.players.every((p) => p.where !== 'prospect')).toBe(true);
    const cat = await c.trades.searchCatalog({ leagueId });
    expect(cat.types.length).toBeGreaterThan(5);
    expect(cat.traits.length).toBeGreaterThan(5);
  });

  it('filters on position, age, overall, potential, contract and term', async () => {
    const r = await search({ pos: ['D'], age: { max: 25 }, overall: { min: 70 }, aav: { max: 5 }, term: { min: 2 }, limit: 300 });
    expect(r.total).toBeGreaterThan(0);
    for (const p of r.players) {
      expect(p.pos).toBe('D');
      expect(p.age).toBeLessThanOrEqual(25);
      expect(p.overall).toBeGreaterThanOrEqual(70);
      expect(p.contract!.salary).toBeLessThanOrEqual(5e6);
      expect(p.contract!.yearsLeft).toBeGreaterThanOrEqual(2);
    }
    const b = GRADES.indexOf('B');
    const pot = await search({ potential: { min: b }, limit: 300 });
    expect(pot.players.every((p) => GRADES.indexOf(p.potential.grade as (typeof GRADES)[number]) >= b)).toBe(true);
    const ufa = await search({ expiresAs: 'UFA', term: { max: 1 }, limit: 300 });
    expect(ufa.players.every((p) => p.contract?.expiresAs === 'UFA' && p.contract.yearsLeft === 1)).toBe(true);
    const alt = await search({ pos: ['C'], altPos: true, limit: 300 });
    const only = await search({ pos: ['C'], limit: 300 });
    expect(alt.total).toBeGreaterThan(only.total);
  });

  it('filters and sorts on season stats and ratings', async () => {
    const r = await search({ stats: { p: { min: 8 } }, sort: 's.p', dir: 'desc', limit: 300 });
    expect(r.total).toBeGreaterThan(5);
    for (const p of r.players) expect(p.stats && 'p' in p.stats && p.stats.p).toBeGreaterThanOrEqual(8);
    const pts = r.players.map((p) => (p.stats as { p: number }).p);
    expect([...pts].sort((a, b) => b - a)).toEqual(pts);
    const g = await search({ pos: ['G'], stats: { svPct: { min: 0.9 }, gp: { min: 3 } }, limit: 300 });
    for (const p of g.players) {
      expect(p.pos).toBe('G');
      expect((p.stats as { svPct: number }).svPct).toBeGreaterThanOrEqual(0.9);
    }
    const fast = await search({ ratings: { skating: { min: 85 } }, limit: 300 });
    expect(fast.total).toBeGreaterThan(0);
    expect(fast.players.every((p) => p.ratings.skating >= 85 && p.pos !== 'G')).toBe(true);
    // Last season's stats don't exist in a league's first season.
    expect((await search({ statSeason: 'last', stats: { gp: { min: 1 } } })).total).toBe(0);
  });

  it('filters on teams, their direction, the block, traits, prospects and my cap space', async () => {
    const L = await readLeague(db, leagueId);
    const two = Object.keys(L.teams).filter((t) => t !== 'HAL').slice(0, 2);
    const r = await search({ teams: [...two, 'HAL'], limit: 300 });
    expect(new Set(r.players.map((p) => p.teamId))).toEqual(new Set(two));
    const reb = await search({ strategy: ['rebuild'], limit: 300 });
    expect(reb.players.every((p) => p.strategy === 'rebuild')).toBe(true);
    const block = await search({ onBlock: true, limit: 300 });
    expect(block.players.every((p) => p.onBlock)).toBe(true);
    const trait = (await c.trades.searchCatalog({ leagueId })).traits[0].id;
    const tr = await search({ traits: [trait], limit: 300 });
    expect(tr.players.every((p) => p.traits.some((t) => t.id === trait))).toBe(true);
    const pros = await search({ where: ['prospect'], limit: 300 });
    expect(pros.total).toBeGreaterThan(0);
    expect(pros.players.every((p) => p.where === 'prospect')).toBe(true);
    const cheap = await search({ affordable: true, limit: 300 });
    expect(cheap.capRoom).not.toBeNull();
    expect(cheap.players.every((p) => (p.contract?.salary ?? 0) <= cheap.capRoom!)).toBe(true);
  });
});
