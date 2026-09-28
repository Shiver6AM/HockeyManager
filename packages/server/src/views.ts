/**
 * Shapes sent to the browser. Hidden traits (potential, personality,
 * injury-proneness, consistency) never leave the server; scouting will reveal
 * estimates of them in a later phase.
 */
import { age, overall, type League, type Player, type Team } from '@hockey-gm/sim-core';

export function publicPlayer(league: League, p: Player) {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    name: `${p.firstName} ${p.lastName}`,
    pos: p.pos,
    shoots: p.shoots,
    age: age(p, league.season),
    nationality: p.nationality,
    archetype: p.archetype,
    teamId: p.teamId,
    overall: overall(p),
    skater: p.skater ?? null,
    goalie: p.goalie ?? null,
    contract: p.contract,
    injury: p.injury,
  };
}
export type PublicPlayer = ReturnType<typeof publicPlayer>;

export function teamInfo(t: Team) {
  return {
    id: t.id,
    city: t.city,
    name: t.name,
    abbr: t.abbr,
    colors: t.colors,
    conference: t.conference,
    division: t.division,
    controller: t.controller.kind,
  };
}
export type TeamInfo = ReturnType<typeof teamInfo>;

/** Average overall of the dressed lineup — a quick "team strength" number. */
export function teamRating(league: League, t: Team): number {
  const ids = [...t.lines.forwards.flat(), ...t.lines.defense.flat(), t.lines.goalies[0]];
  const sum = ids.reduce((s, id) => s + overall(league.players[id]), 0);
  return Math.round((sum / ids.length) * 10) / 10;
}

export function playerName(league: League, id: string) {
  const p = league.players[id];
  return p ? `${p.firstName} ${p.lastName}` : id;
}
