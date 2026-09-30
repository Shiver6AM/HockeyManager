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

describe('phase 23: calendar, placements, ice time, retention, simcast box score', () => {
  let comm: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;

  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    const u = await (await caller()).auth.register({ username: 'commish23', password: 'correct-horse', displayName: 'C23' });
    comm = await caller(u.token);
    ({ id: leagueId } = await comm.leagues.create({ name: 'Calendar League', start: 'season' }));
    await comm.leagues.claimTeam({ leagueId, teamId: 'HAL' });
  }, 60_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('shows the season on a calendar with its key dates, and sims to a date', async () => {
    const c = await comm.data.calendar({ leagueId });
    expect(Object.keys(c.days).length).toBeGreaterThan(150);
    const labels = c.milestones.map((m) => m.label);
    expect(labels).toEqual(expect.arrayContaining(['Opening night', 'Trade deadline', 'Playoffs begin']));
    expect(c.milestones.find((m) => m.label === 'Trade deadline')!.day).toBe(c.deadline);
    expect(c.offseason.map((o) => o.label)).toContain('Free agency');
    const mine = Object.entries(c.days).filter(([, gs]) => gs.some((g) => g[1] === 'HAL' || g[2] === 'HAL'));
    expect(mine.length).toBe(82);
    await comm.sim.advance({ leagueId, target: { days: 5 } });
    expect((await comm.leagues.overview({ leagueId })).day).toBe(5);
    const after = await comm.data.calendar({ leagueId });
    expect(after.days[0].every((g) => g[3] !== null)).toBe(true);
  }, 60_000);

  it('saves placements and ice-time plans; the assistant coach builds lines around them', async () => {
    await comm.data.setAutoLines({ leagueId, enabled: true });
    const t = await comm.data.team({ leagueId, teamId: 'HAL' });
    const d = t.players.filter((p) => p.pos === 'D' && !p.farm && !p.injury).sort((a, b) => a.overall - b.overall)[0];
    await expect(comm.data.setLinePins({ leagueId, pins: { [d.id]: { slot: 'L1' } } })).rejects.toThrow(/can't be placed/);
    await comm.data.setLinePins({ leagueId, pins: { [d.id]: { slot: 'P1' } } });
    const t2 = await comm.data.team({ leagueId, teamId: 'HAL' });
    expect(t2.linePins[d.id]).toEqual({ slot: 'P1' });
    expect(t2.lines.defense[0]).toContain(d.id);
    await comm.data.setTactics({ leagueId, tactics: { ...t2.tactics, fUsage: 'roll4', dUsage: 'top4' } });
    const t3 = await comm.data.team({ leagueId, teamId: 'HAL' });
    expect(t3.tactics).toMatchObject({ fUsage: 'roll4', dUsage: 'top4' });
    expect(t3.systems.fUsage.map((o) => o.id)).toContain('top-heavy');
    expect(t3.players.some((p) => p.altPos.length > 0)).toBe(true);
  });

  it('retains salary in a trade: the cap change and what each side carries', async () => {
    const mine = await comm.trades.assets({ leagueId, teamId: 'HAL' });
    const p = mine.players.filter((x) => x.contract && x.contract.yearsLeft >= 2).sort((a, b) => b.contract!.salary - a.contract!.salary)[0];
    const plain = await comm.trades.evaluate({ leagueId, partner: 'QUE', give: [{ kind: 'player', id: p.id }], get: [] });
    const kept = await comm.trades.evaluate({ leagueId, partner: 'QUE', give: [{ kind: 'player', id: p.id, retain: 0.25 }], get: [] });
    expect(kept.theirCapChange).toBeLessThan(plain.theirCapChange);
    expect(kept.retained[0]).toMatchObject({ side: 'me', share: 0.25 });
    expect(kept.retained[0].seasons).toBeGreaterThanOrEqual(2);
  });

  it('simcast: a live box score, power plays and the final box', async () => {
    const g = await comm.simcast.games({ leagueId });
    await comm.simcast.start({ leagueId, gameId: g.games[0].id });
    await comm.simcast.control({ leagueId, action: 'skip-period' });
    const s = await comm.simcast.state({ leagueId });
    expect(s!.box.final).toBe(false);
    expect(s!.box.home.skaters.length).toBe(18);
    const sog = s!.box.home.skaters.reduce((x, p) => x + p.sog, 0) + s!.box.away.skaters.reduce((x, p) => x + p.sog, 0);
    expect(sog).toBe(s!.homeShots + s!.awayShots);
    expect(s!.box.home.goalies.length).toBeGreaterThan(0);
    await comm.simcast.control({ leagueId, action: 'skip-end' });
    const f = await comm.simcast.state({ leagueId });
    expect(f!.box.final).toBe(true);
    const goals = f!.box.home.skaters.reduce((x, p) => x + p.g, 0);
    expect(goals).toBeLessThanOrEqual(f!.homeScore);
    expect(f!.box.home.skaters.every((p) => (p.toi ?? 0) > 0)).toBe(true);
    await comm.simcast.control({ leagueId, action: 'end' });
  });
});
