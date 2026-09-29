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

describe('phase 14: start points, fantasy draft, sliders', () => {
  let comm: Awaited<ReturnType<typeof caller>>;
  let bob: Awaited<ReturnType<typeof caller>>;

  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    comm = await register('commish14');
    bob = await register('bob14');
  });
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('a new league starts the week before free agency by default', async () => {
    const { id } = await comm.leagues.create({ name: 'Summer Start' });
    const ov = await comm.leagues.overview({ leagueId: id });
    expect(ov.phase).toBe('offseason');
    expect(ov.offseasonStage).toBe('re-sign');
    expect(ov.freshStart).toBe(true);
    await comm.leagues.claimTeam({ leagueId: id, teamId: 'HAL' });
    const exp = await comm.offseason.expiring({ leagueId: id });
    expect(exp!.players.length).toBeGreaterThan(0);
  });

  it('runs a fantasy draft: start, pick on the clock, auto-pick, then on to the start point', async () => {
    const { id: leagueId } = await comm.leagues.create({ name: 'Fantasy League', fantasy: true, start: 'season' });
    const ov = await comm.leagues.overview({ leagueId });
    await bob.leagues.join({ inviteCode: ov.inviteCode });
    await bob.leagues.claimTeam({ leagueId, teamId: 'KC' });
    let board = await bob.offseason.fantasyBoard({ leagueId });
    expect(board!.started).toBe(false);
    expect(board!.available.length).toBeGreaterThan(700);
    await expect(bob.offseason.proceed({ leagueId })).rejects.toThrow();
    await comm.offseason.proceed({ leagueId });
    board = await bob.offseason.fantasyBoard({ leagueId });
    expect(board!.started).toBe(true);
    expect(board!.onTheClock!.team.id).toBe('KC');
    const legal = board!.available.find((p) => !p.problem)!;
    await bob.offseason.fantasyPick({ leagueId, playerId: legal.id });
    board = await bob.offseason.fantasyBoard({ leagueId });
    expect(board!.me!.roster.map((p) => p.id)).toContain(legal.id);
    // Let the AI finish KC's picks: the draft runs to the end.
    await bob.offseason.setFantasyAuto({ leagueId, enabled: true });
    const after = await bob.leagues.overview({ leagueId });
    expect(after.fantasy).toBeNull();
    expect(after.offseasonStage).toBe('training-camp');
    const kc = await bob.data.team({ leagueId, teamId: 'KC' });
    expect(kc.players.filter((p) => !p.farm).length).toBeGreaterThanOrEqual(20);
    // The commissioner opens the season.
    await comm.sim.advance({ leagueId, target: { to: 'next-season' } });
    const live = await bob.leagues.overview({ leagueId });
    expect(live.phase).toBe('regular-season');
  });

  it('commissioner sliders: readable by everyone, editable by the commissioner, clamped', async () => {
    const { id: leagueId } = await comm.leagues.create({ name: 'Slider League', start: 'season' });
    const ov = await comm.leagues.overview({ leagueId });
    await bob.leagues.join({ inviteCode: ov.inviteCode });
    const s = await bob.leagues.simSettings({ leagueId });
    expect(s.canEdit).toBe(false);
    expect(s.sliders.every((x) => x.value === 1)).toBe(true);
    expect(s.sliders.map((x) => x.key)).toContain('injuryRate');
    await expect(bob.leagues.updateSimSettings({ leagueId, sim: { injuryRate: 2 } })).rejects.toThrow();
    await comm.leagues.updateSimSettings({ leagueId, sim: { injuryRate: 2, scoring: 5 } });
    const after = await comm.leagues.simSettings({ leagueId });
    const v = Object.fromEntries(after.sliders.map((x) => [x.key, x.value]));
    expect(v.injuryRate).toBe(2);
    expect(v.scoring).toBe(1.3);
    expect(v.penalties).toBe(1);
  });
});
