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

describe('phase 21: traits, waivers, roster moves, two-way deals, trends', () => {
  let me: Awaited<ReturnType<typeof caller>>;
  let bob: Awaited<ReturnType<typeof caller>>;
  let leagueId: string;
  beforeAll(async () => {
    db = await createDb('memory://');
    scheduler = new Scheduler(db);
    const a = await (await caller()).auth.register({ username: 'me21', password: 'correct-horse', displayName: 'ME' });
    const b = await (await caller()).auth.register({ username: 'bob21', password: 'correct-horse', displayName: 'BOB' });
    me = await caller(a.token);
    bob = await caller(b.token);
    ({ id: leagueId } = await me.leagues.create({ name: 'Phase 21', start: 'season' }));
    const ov = await me.leagues.overview({ leagueId });
    await bob.leagues.join({ inviteCode: ov.inviteCode });
    await me.leagues.claimTeam({ leagueId, teamId: 'HAL' });
    await bob.leagues.claimTeam({ leagueId, teamId: 'KC' });
    await me.sim.advance({ leagueId, target: { days: 12 } });
  }, 60_000);
  afterAll(async () => {
    scheduler.stop();
    await db.close();
  });

  it('players carry traits and waiver/contract details', async () => {
    const t = await me.data.team({ leagueId, teamId: 'HAL' });
    const all = (await me.data.leaders({ leagueId })).allSkaters.length;
    expect(all).toBeGreaterThan(0);
    for (const p of t.players) {
      expect(Array.isArray(p.traits)).toBe(true);
      expect(typeof p.twoWay).toBe('boolean');
    }
    expect(t.players.some((p) => p.waiverExempt === null)).toBe(true);
    expect(t.players.some((p) => p.waiverExempt !== null)).toBe(true);
  });

  it('roster moves: a veteran sent down goes on waivers, another manager claims him', async () => {
    const t = await me.data.team({ leagueId, teamId: 'HAL' });
    const vet = t.players.filter((p) => !p.farm && !p.injury && p.waiverExempt === null && p.pos !== 'G').sort((a, b) => a.contract!.salary - b.contract!.salary)[0];
    const up = t.players.find((p) => p.farm && !p.injury && (p.pos === 'G') === (vet.pos === 'G'))!;
    const r = await me.offseason.rosterMoves({ leagueId, down: [vet.id], up: [up.id] });
    expect(r.waivers).toEqual([vet.id]);
    expect(r.up).toEqual([up.id]);
    const w = await bob.offseason.waivers({ leagueId });
    const row = w.players.find((p) => p.id === vet.id)!;
    expect(row.from.id).toBe('HAL');
    expect(row.outlook).toBeTruthy();
    await bob.offseason.claimWaiver({ leagueId, playerId: vet.id, claim: true });
    expect((await bob.offseason.waivers({ leagueId })).players.find((p) => p.id === vet.id)!.claimed).toBe(true);
    await expect(me.offseason.claimWaiver({ leagueId, playerId: vet.id, claim: true })).rejects.toThrow(/you put him/i);
    await me.sim.advance({ leagueId, target: { days: 1 } });
    const player = await me.data.player({ leagueId, playerId: vet.id });
    // Bob's claim wins unless an AI team with a worse record also claimed him.
    expect(player.player!.teamId).not.toBe('HAL');
    const notes = await me.life.notifications({ leagueId });
    expect(notes.items.some((n) => /claimed off waivers/.test(n.text))).toBe(true);
  }, 60_000);

  it('offers can be one-way or two-way', async () => {
    const fa = await me.offseason.freeAgents({ leagueId });
    const p = fa.players.find((x) => x.overall < 62 && x.deal)!;
    const salary = Math.round((p.deal!.estimate[0].salary * 1.3) / 25_000) * 25_000;
    const r = await me.offseason.negotiateFreeAgent({ leagueId, playerId: p.id, salary, years: 1, twoWay: true });
    if (r.result === 'accept') {
      const pl = await me.data.player({ leagueId, playerId: p.id });
      expect(pl.player!.twoWay).toBe(true);
      expect(pl.player!.minorSalary).toBeGreaterThan(0);
    }
  });

  it('team trends: points pace, playoff line and rolling goals', async () => {
    const tr = await me.data.teamTrends({ leagueId, teamId: 'HAL' });
    expect(tr.games.length).toBeGreaterThan(3);
    expect(tr.leagueAvg).toHaveLength(tr.games.length);
    expect(tr.playoffLine).toHaveLength(tr.games.length);
    expect(tr.games.at(-1)!.cum).toBe(tr.games.reduce((s, g) => s + g.pts, 0));
    expect(tr.totalGames).toBe(82);
  });
});
