/** Stock every team's farm team (new leagues, and older saves on first use). */
import { affiliate, FARM_TARGET } from './farm';
import { generatePlayer } from './generate';
import { LEAGUE_MIN_SALARY } from './contracts';
import { deriveSeed, Rng } from './rng';
import type { League, Position } from './types';

export function initFarm(league: League) {
  const rng = new Rng(deriveSeed(league.seed, `farm-init:${league.season}`));
  let n = 0;
  for (const team of Object.values(league.teams)) {
    affiliate(league, team);
    if (team.farmStocked) continue;
    team.farmStocked = true;
    const want: Array<[Position[], number]> = [
      [['C', 'LW', 'RW'], FARM_TARGET.F],
      [['D'], FARM_TARGET.D],
      [['G'], FARM_TARGET.G],
    ];
    for (const [positions, count] of want) {
      for (let i = 0; i < count; i++) {
        const pos = rng.pick(positions);
        const a = rng.int(20, 29);
        // AHL regulars: a few points below NHL depth players, younger ones with some upside.
        const p = generatePlayer(rng, pos, pos === 'G' ? rng.normal(64, 3) : rng.normal(58, 3.5), league.season, a);
        p.id = `farm${league.season}-${team.id}-${n++}`;
        p.teamId = team.id;
        p.farm = true;
        const years = a <= 23 ? rng.int(1, 3) : rng.int(1, 2);
        p.contract = { salary: LEAGUE_MIN_SALARY, yearsLeft: years, kind: a <= 22 ? 'ELC' : 'standard', expiresAs: a + years >= 27 ? 'UFA' : 'RFA' };
        league.players[p.id] = p;
        team.roster.push(p.id);
      }
    }
  }
}
