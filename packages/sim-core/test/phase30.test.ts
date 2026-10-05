import { describe, expect, it } from 'vitest';
import { createLeague, fantasyAvailable, fantasyOnClock, fantasyPick, fantasyPickProblem, fantasyValue, runFantasy, withMemo, type League, type Player } from '../src/index';

const grp = (p: Player) => (p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F');
const count = (L: League, teamId: string) => {
  const c = { F: 0, D: 0, G: 0 };
  for (const id of L.teams[teamId].roster) c[grp(L.players[id])]++;
  return c;
};

/** A fantasy league in which every team has a manager. */
function allManagers(seed: number): League {
  const L = createLeague({ seed, name: 'Fantasy 32', advance: { mode: 'commissioner' }, start: 'season', fantasy: true } as never);
  for (const t of Object.values(L.teams)) t.controller = { kind: 'human', userId: t.id } as never;
  runFantasy(L, { force: false }); // started; a manager is on the clock
  return L;
}

/** The best player by the team's own value that the rules allow, as the draft board lists them. */
function bestAllowed(L: League, teamId: string): Player | undefined {
  return withMemo(() =>
    fantasyAvailable(L)
      .map((p) => ({ p, v: fantasyValue(L, teamId, p) }))
      .sort((a, b) => b.v - a.v)
      .find(({ p }) => !fantasyPickProblem(L, teamId, p))?.p,
  );
}

describe('a fantasy draft with a manager on all 32 teams', () => {
  it('never leaves a manager without a pick, and every team can dress a lineup at the end', () => {
    for (const seed of [301, 302]) {
      const L = allManagers(seed);
      expect(Object.keys(L.teams)).toHaveLength(32);
      // The pool is exactly as big as the draft: nothing is left over to cover for hoarding.
      expect(fantasyAvailable(L)).toHaveLength(L.fantasy!.picks.length);
      let made = 0;
      for (let pick = fantasyOnClock(L); pick; pick = fantasyOnClock(L)) {
        // Everyone takes the best player he's allowed (no thought for goalies until the rules insist).
        const p = bestAllowed(L, pick.teamId);
        expect(p, `pick ${pick.overall}: ${pick.teamId} has nobody he can take`).toBeTruthy();
        fantasyPick(L, pick.teamId, p!.id);
        made++;
      }
      expect(made).toBe(L.fantasy!.picks.length);
      expect(fantasyAvailable(L)).toHaveLength(0);
      for (const t of Object.values(L.teams)) {
        const c = count(L, t.id);
        expect(c.G, `${t.id} goalies`).toBeGreaterThanOrEqual(2);
        expect(c.D, `${t.id} defensemen`).toBeGreaterThanOrEqual(6);
        expect(c.F, `${t.id} forwards`).toBeGreaterThanOrEqual(12);
      }
    }
  }, 240_000);

  it('a spare goalie is refused while other teams still need the ones left', () => {
    const L = allManagers(303);
    const first = fantasyOnClock(L)!.teamId;
    const goalies = () => fantasyAvailable(L).filter((p) => p.pos === 'G');
    const skater = () => fantasyAvailable(L).find((p) => p.pos !== 'G')!;
    // The first team takes a goalie each time it comes up; everyone else takes a skater.
    let mine = 0;
    while (mine < 2) {
      const pick = fantasyOnClock(L)!;
      if (pick.teamId === first) {
        expect(fantasyPickProblem(L, first, goalies()[0])).toBeNull();
        fantasyPick(L, first, goalies()[0].id);
        mine++;
      } else fantasyPick(L, pick.teamId, skater().id);
    }
    while (fantasyOnClock(L)!.teamId !== first) fantasyPick(L, fantasyOnClock(L)!.teamId, skater().id);
    // 62 goalies left, and the other 31 teams need all 62 of them.
    expect(goalies()).toHaveLength(62);
    expect(fantasyPickProblem(L, first, goalies()[0])).toMatch(/goalies left are needed by teams that don't have 2 yet/);
    expect(() => fantasyPick(L, first, goalies()[0].id)).toThrow(/needed by teams/);
    expect(fantasyPickProblem(L, first, skater())).toBeNull();
  });

  it('the rules give way when they would leave a manager nobody to pick', () => {
    const L = allManagers(304);
    const pick = fantasyOnClock(L)!;
    // No cap room at all: by the rules, every player "would leave you without cap room".
    L.settings.salaryCap = 1;
    const anyone = fantasyAvailable(L)[0];
    expect(fantasyPickProblem(L, pick.teamId, anyone)).toBeNull();
    fantasyPick(L, pick.teamId, anyone.id);
    expect(L.teams[pick.teamId].roster).toContain(anyone.id);
    // Automatic picks keep going too.
    for (const t of Object.values(L.teams)) L.fantasy!.auto[t.id] = true;
    runFantasy(L, { force: false });
    expect(fantasyOnClock(L)).toBeNull();
  }, 60_000);
});
