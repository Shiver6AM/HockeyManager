import type { Rng } from './rng';
import type { ScheduledGame, Team, TeamId } from './types';

interface Matchup {
  home: TeamId;
  away: TeamId;
}

/**
 * NHL-style 82-game schedule for 32 teams in 4 divisions of 8:
 *  - Division: 5 opponents x4 + 2 opponents x3 = 26
 *  - Same conference, other division: 8 x3 = 24
 *  - Other conference: 16 x2 = 32
 * Every team gets exactly 41 home and 41 away games.
 */
export function buildMatchups(teams: Team[], rng: Rng): Matchup[] {
  const games: Matchup[] = [];
  const push = (home: TeamId, away: TeamId, n = 1) => {
    for (let i = 0; i < n; i++) games.push({ home, away });
  };

  const divisions = new Map<string, Team[]>();
  for (const t of teams) {
    const key = `${t.conference}|${t.division}`;
    if (!divisions.has(key)) divisions.set(key, []);
    divisions.get(key)!.push(t);
  }
  for (const [, div] of divisions) {
    if (div.length !== 8) throw new Error('Schedule builder expects divisions of 8 teams');
  }

  // Division games. A random 8-cycle picks each team's two 3-game opponents.
  for (const [, div] of divisions) {
    const cycle = rng.shuffle([...div]);
    const threeGame = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const a = cycle[i];
      const b = cycle[(i + 1) % 8];
      push(a.id, b.id, 2);
      push(b.id, a.id, 1);
      threeGame.add([a.id, b.id].sort().join('-'));
    }
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        const a = div[i];
        const b = div[j];
        if (threeGame.has([a.id, b.id].sort().join('-'))) continue;
        push(a.id, b.id, 2);
        push(b.id, a.id, 2);
      }
    }
  }

  // Cross-division games.
  const divList = [...divisions.values()];
  for (let x = 0; x < divList.length; x++) {
    for (let y = x + 1; y < divList.length; y++) {
      const A = divList[x];
      const B = divList[y];
      const sameConf = A[0].conference === B[0].conference;
      for (let a = 0; a < 8; a++) {
        for (let b = 0; b < 8; b++) {
          if (sameConf) {
            const aHostsTwice = (a + b) % 2 === 0;
            push(A[a].id, B[b].id, aHostsTwice ? 2 : 1);
            push(B[b].id, A[a].id, aHostsTwice ? 1 : 2);
          } else {
            push(A[a].id, B[b].id, 1);
            push(B[b].id, A[a].id, 1);
          }
        }
      }
    }
  }
  return games;
}

/** Spread matchups over calendar days, avoiding too many back-to-backs. */
export function buildSchedule(teams: Team[], rng: Rng): ScheduledGame[] {
  let remaining = rng.shuffle(buildMatchups(teams, rng));
  const left = new Map<TeamId, number>();
  for (const g of remaining) {
    left.set(g.home, (left.get(g.home) ?? 0) + 1);
    left.set(g.away, (left.get(g.away) ?? 0) + 1);
  }

  const scheduled: ScheduledGame[] = [];
  let playedYesterday = new Set<TeamId>();
  let day = 0;
  while (remaining.length > 0) {
    const target = rng.int(4, 12);
    const today = new Set<TeamId>();
    const keys = remaining.map((g) => ({
      g,
      k: (left.get(g.home) ?? 0) + (left.get(g.away) ?? 0) + rng.next() * 6,
    }));
    keys.sort((a, b) => b.k - a.k);
    const used = new Set<Matchup>();
    for (const { g } of keys) {
      if (today.size >= target * 2) break;
      if (today.has(g.home) || today.has(g.away)) continue;
      const b2b = playedYesterday.has(g.home) || playedYesterday.has(g.away);
      if (b2b && rng.chance(0.85)) continue;
      today.add(g.home);
      today.add(g.away);
      used.add(g);
      left.set(g.home, left.get(g.home)! - 1);
      left.set(g.away, left.get(g.away)! - 1);
      scheduled.push({ id: scheduled.length, day, home: g.home, away: g.away, result: null });
    }
    remaining = remaining.filter((g) => !used.has(g));
    playedYesterday = today;
    day++;
  }
  return scheduled;
}
