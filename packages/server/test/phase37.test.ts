import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mutateLeague, Scheduler } from '../src/advance';
import { appRouter } from '../src/app';
import { userFromToken } from '../src/auth';
import { createDb, type Db } from '../src/db';
import { readLeague } from '../src/state';

let db: Db;
let scheduler: Scheduler;
async function caller(token: string | null = null) {
  return appRouter.createCaller({ db, scheduler, user: await userFromToken(db, token ?? undefined), sessionToken: token, setSession: () => {} });
}

describe('phase 37: placements when short of players', () => {
  let c: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;
  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    c = await caller((await (await caller()).auth.register({ username: 'pins37', password: 'correct-horse', displayName: 'P' })).token);
    ({ id: leagueId } = await c.leagues.create({ name: 'Pins League', start: 'season' }));
    await c.leagues.claimTeam({ leagueId, teamId: 'HAL' });
    await c.data.setAutoLines({ leagueId, enabled: true });
  }, 60_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('eleven forwards: placements still save and clear, a defenseman moves up', async () => {
    const L = await readLeague(db, leagueId);
    const nhl = L.teams.HAL.roster.map((id) => L.players[id]).filter((p) => !p.farm && !p.injury);
    const fwds = nhl.filter((p) => p.pos !== 'D' && p.pos !== 'G');
    const ds = nhl.filter((p) => p.pos === 'D');
    expect(ds.length).toBeGreaterThanOrEqual(7);
    // Eleven healthy forwards with the big club (the rest sent down).
    await mutateLeague(db, leagueId, (M) => {
      for (const p of fwds.slice(11)) M.players[p.id].farm = true;
    });
    const r = await c.data.setLinePins({ leagueId, pins: { [fwds[0].id]: { slot: 'L1' }, [ds[0].id]: { slot: 'P1' } } });
    expect(r.note).toBeNull();
    let M = await readLeague(db, leagueId);
    expect(M.teams.HAL.lines.forwards[0]).toContain(fwds[0].id);
    expect(M.teams.HAL.lines.forwards.flat().filter((id) => M.players[id].pos === 'D')).toHaveLength(1);
    // Clear one, then all.
    await c.data.setLinePins({ leagueId, pins: { [ds[0].id]: { slot: 'P1' } } });
    expect(Object.keys((await c.data.team({ leagueId, teamId: 'HAL' })).linePins)).toEqual([ds[0].id]);
    await c.data.setLinePins({ leagueId, pins: {} });
    expect((await c.data.team({ leagueId, teamId: 'HAL' })).linePins).toEqual({});
    M = await readLeague(db, leagueId);
    expect(new Set([...M.teams.HAL.lines.forwards.flat(), ...M.teams.HAL.lines.defense.flat()]).size).toBe(18);
    expect((await c.data.suggestLines({ leagueId })).forwards.flat()).toHaveLength(12);
  });

  it('fewer than eighteen skaters: the coach calls someone up when placements change', async () => {
    const L = await readLeague(db, leagueId);
    const nhl = L.teams.HAL.roster.map((id) => L.players[id]).filter((p) => !p.farm && !p.injury && p.pos === 'D');
    await mutateLeague(db, leagueId, (M) => {
      for (const p of nhl.slice(5)) M.players[p.id].farm = true; // 11 F + 5 D
    });
    const r = await c.data.setLinePins({ leagueId, pins: {} });
    expect(r.calledUp.length).toBeGreaterThan(0);
    const M = await readLeague(db, leagueId);
    expect(new Set([...M.teams.HAL.lines.forwards.flat(), ...M.teams.HAL.lines.defense.flat()]).size).toBe(18);
    for (const id of [...M.teams.HAL.lines.forwards.flat(), ...M.teams.HAL.lines.defense.flat()]) expect(M.players[id].farm).toBeFalsy();
  });
});
