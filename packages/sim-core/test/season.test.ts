import { beforeAll, describe, expect, it } from 'vitest';
import {
  advanceDays,
  advanceToEndOfSeason,
  advanceToPlayoffs,
  betterScratches,
  generateLeague,
  overall,
  prepareTeamForGame,
  standings,
  type League,
} from '../src/index';

describe('full season with playoffs', () => {
  let L: League;
  beforeAll(() => {
    L = generateLeague({ seed: 2026 });
    advanceToEndOfSeason(L);
  });

  it('ends in the offseason with a champion and history entry', () => {
    expect(L.phase).toBe('offseason');
    expect(L.playoffs?.champion).toBeTruthy();
    expect(L.history).toHaveLength(1);
    expect(L.history[0].champion).toBe(L.playoffs!.champion);
  });

  it('seeds 16 teams: top 3 per division plus 2 wild cards per conference', () => {
    const r1 = L.playoffs!.rounds[0];
    expect(r1).toHaveLength(8);
    const teams = new Set(r1.flatMap((s) => [s.high, s.low]));
    expect(teams.size).toBe(16);
    const st = standings(L);
    for (const div of new Set(Object.values(L.teams).map((t) => t.division))) {
      const top3 = st.filter((r) => L.teams[r.teamId].division === div).slice(0, 3);
      for (const r of top3) expect(teams.has(r.teamId)).toBe(true);
    }
    for (const conf of ['East', 'West']) {
      expect([...teams].filter((t) => L.teams[t].conference === conf)).toHaveLength(8);
    }
  });

  it('plays 4 rounds of best-of-seven with a correct bracket', () => {
    const rounds = L.playoffs!.rounds;
    expect(rounds.map((r) => r.length)).toEqual([8, 4, 2, 1]);
    for (const round of rounds) {
      for (const s of round) {
        expect(Math.max(s.highWins, s.lowWins)).toBe(4);
        expect(Math.min(s.highWins, s.lowWins)).toBeLessThan(4);
        expect(s.games.length).toBe(s.highWins + s.lowWins);
        // 2-2-1-1-1: higher seed hosts games 1, 2, 5, 7.
        s.games.forEach((g, i) => expect(g.home === s.high).toBe([0, 1, 4, 6].includes(i)));
      }
    }
    // The final is East champion vs West champion.
    const final = rounds[3][0];
    const confs = [final.high, final.low].map((t) => L.teams[t].conference).sort();
    expect(confs).toEqual(['East', 'West']);
  });

  it('never ends a playoff game in a shootout', () => {
    for (const round of L.playoffs!.rounds)
      for (const s of round) for (const g of s.games) expect(g.result!.shootout).toBe(false);
  });

  it('keeps playoff stats separate from regular-season stats', () => {
    const regGp = Math.max(...Object.values(L.skaterStats).map((s) => s.gp));
    expect(regGp).toBeLessThanOrEqual(82);
    const poGp = Math.max(...Object.values(L.playoffSkaterStats).map((s) => s.gp));
    expect(poGp).toBeGreaterThanOrEqual(16);
    expect(poGp).toBeLessThanOrEqual(28);
  });

  it('hands out the major awards', () => {
    for (const a of [
      "Presidents' Trophy", 'Art Ross Trophy', 'Rocket Richard Trophy', 'Hart Trophy',
      'Vezina Trophy', 'Norris Trophy', 'Selke Trophy', 'Calder Trophy', 'Conn Smythe Trophy',
    ]) {
      expect(L.awards[a], a).toBeTruthy();
    }
    expect(L.players[L.awards['Norris Trophy'].playerId!].pos).toBe('D');
    expect(L.players[L.awards['Vezina Trophy'].playerId!].pos).toBe('G');
  });

  it('starts every league with generational talent', () => {
    const gens = Object.values(L.players).filter((p) => p.archetype === 'Generational');
    expect(gens).toHaveLength(2);
    for (const p of gens) expect(overall(p)).toBeGreaterThanOrEqual(88);
  });
});

describe('injuries', () => {
  it('happen, heal, and never leave an injured player in a lineup', () => {
    const L = generateLeague({ seed: 77, humans: { HAL: 'u1', KC: 'u2' } });
    let sawInjury = false;
    for (let d = 0; d < 120; d++) {
      advanceDays(L, 1);
      for (const g of L.schedule.filter((x) => x.day === L.day - 1)) {
        for (const tid of [g.home, g.away]) {
          const box = g.result!.box;
          // Nobody who started the day injured got into this game.
          for (const pid of Object.keys(box.skaters)) {
            const inj = L.players[pid].injury;
            if (inj) expect(inj.sinceDay).toBe(L.day - 1);
          }
          void tid;
        }
      }
      if (Object.values(L.players).some((p) => p.injury)) sawInjury = true;
    }
    expect(sawInjury).toBe(true);
    const returns = L.transactions.filter((t) => t.type === 'return');
    expect(returns.length).toBeGreaterThan(0);
  });

  it('human lineups only swap out the injured player', () => {
    const L = generateLeague({ seed: 5, humans: { HAL: 'u1' } });
    const team = L.teams.HAL;
    const before = JSON.parse(JSON.stringify(team.lines));
    const victim = team.lines.forwards[0][1];
    L.players[victim].injury = { type: 'Lower-body', severity: 'short-term', daysLeft: 10, sinceDay: 0 };
    prepareTeamForGame(L, team);
    expect(team.lines.forwards[0][1]).not.toBe(victim);
    // Everything else stays where the manager put it.
    expect(team.lines.forwards[0][0]).toBe(before.forwards[0][0]);
    expect(team.lines.forwards[0][2]).toBe(before.forwards[0][2]);
    expect(team.lines.defense).toEqual(before.defense);
    expect(team.lines.goalies).toEqual(before.goalies);
  });

  it('the assistant coach puts returning players back in; a hands-on manager gets a warning instead', () => {
    const L = generateLeague({ seed: 12, humans: { HAL: 'u1', KC: 'u2' } });
    for (const [id, auto] of [['HAL', true], ['KC', false]] as const) {
      const team = L.teams[id];
      team.autoLines = auto;
      const star = team.lines.forwards[0][1];
      L.players[star].injury = { type: 'Upper-body', severity: 'short-term', daysLeft: 5, sinceDay: 0 };
      prepareTeamForGame(L, team);
      expect(team.lines.forwards.flat()).not.toContain(star);
      L.players[star].injury = null; // healed
      prepareTeamForGame(L, team);
      const dressed = team.lines.forwards.flat().includes(star);
      expect(dressed).toBe(auto);
      if (!auto) expect(betterScratches(L, team).map((w) => w.scratched.id)).toContain(star);
    }
  });

  it('makes emergency call-ups when a team runs out of healthy bodies', () => {
    const L = generateLeague({ seed: 6 });
    const team = L.teams.QUE;
    const goalies = team.roster.filter((id) => L.players[id].pos === 'G');
    for (const g of goalies) L.players[g].injury = { type: 'Knee', severity: 'long-term', daysLeft: 50, sinceDay: 0 };
    prepareTeamForGame(L, team);
    const healthyG = team.roster.filter((id) => L.players[id].pos === 'G' && !L.players[id].injury);
    expect(healthyG.length).toBe(2);
    expect(L.transactions.filter((t) => t.type === 'call-up' && t.teamId === 'QUE')).toHaveLength(2);
  });
});

describe('determinism holds through playoffs', () => {
  it('odd-sized chunks and one big advance produce the same champion and stats', () => {
    const a = generateLeague({ seed: 31 });
    const b = generateLeague({ seed: 31 });
    advanceToEndOfSeason(a);
    advanceToPlayoffs(b);
    while (b.phase !== 'offseason') advanceDays(b, 3);
    expect(b.playoffs!.champion).toBe(a.playoffs!.champion);
    expect(JSON.stringify(b.playoffSkaterStats)).toBe(JSON.stringify(a.playoffSkaterStats));
    expect(JSON.stringify(b.awards)).toBe(JSON.stringify(a.awards));
    expect(JSON.stringify(b.transactions)).toBe(JSON.stringify(a.transactions));
  });
});
