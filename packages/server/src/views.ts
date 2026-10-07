/**
 * Shapes sent to the browser. Hidden traits (potential, personality,
 * injury-proneness, consistency) never leave the server; scouting will reveal
 * estimates of them in a later phase.
 */
import { age, bodyOf, coachability, coachabilityLabel, computeTraits, isTwoWay, minorSalaryOf, overall, traitList, type League, type Player, type Team } from '@hockey-gm/sim-core';

export function publicPlayer(league: League, p: Player) {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    name: `${p.firstName} ${p.lastName}`,
    pos: p.pos,
    /** Other positions he can play. */
    altPos: p.altPos ?? [],
    shoots: p.shoots,
    // During the summer, show the age the player will be next season.
    age: age(p, league.season + (league.phase === 'offseason' ? 1 : 0)),
    nationality: p.nationality,
    archetype: p.archetype,
    /** Inches and pounds. */
    ...bodyOf(p, league.season + (league.phase === 'offseason' ? 1 : 0)),
    teamId: p.teamId,
    overall: overall(p),
    /** His overall at the end of last season (from his career record), and the change since. */
    ...ovrChange(league, p),
    skater: p.skater ?? null,
    goalie: p.goalie ?? null,
    contract: p.contract,
    /** Two-way deal (an AHL salary while on the farm)? */
    twoWay: isTwoWay(p.contract),
    minorSalary: p.contract && isTwoWay(p.contract) ? minorSalaryOf(p.contract) : null,
    injury: p.injury,
    /** How much he gets out of coaching (a visible trait). */
    coachability: coachability(p),
    coachabilityLabel: coachabilityLabel(coachability(p)),
    /** Rare badges (2K-style), best first. Worked out now for players the sim hasn't reached yet. */
    traits: traitList(p.traitsSeason === undefined ? { ...p, traits: computeTraits(p) } : p),
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
  // Lines can briefly reference departed players during the offseason; skip them.
  const ids = [...t.lines.forwards.flat(), ...t.lines.defense.flat(), t.lines.goalies[0]].filter((id) => league.players[id]?.teamId === t.id);
  if (!ids.length) return 0;
  const sum = ids.reduce((s, id) => s + overall(league.players[id]), 0);
  return Math.round((sum / ids.length) * 10) / 10;
}

/**
 * The players a news story names, in the order they appear, so each name can
 * link to his page. Stories record their players; older trade stories recorded
 * only the first, so the rest are found by name ("Name (POS, OVR)") in the text.
 */
export function storyPlayers(league: League, n: { kind: string; headline: string; playerIds: string[] }): Array<{ id: string; name: string }> {
  const found = new Map<string, { id: string; name: string; at: number }>();
  const add = (id: string) => {
    const p = league.players[id];
    const r = league.retired?.[id];
    const name = p ? `${p.firstName} ${p.lastName}` : r?.name;
    if (!name || found.has(id)) return;
    const at = n.headline.indexOf(name);
    if (at >= 0) found.set(id, { id, name, at });
  };
  for (const id of n.playerIds) add(id);
  if (n.kind === 'trade' && n.playerIds.length <= 1) {
    for (const p of Object.values(league.players)) {
      if (!found.has(p.id) && n.headline.includes(`${p.firstName} ${p.lastName} (${p.pos},`)) add(p.id);
    }
  }
  // (Two players with the same name: the first one recorded keeps it.)
  const byName = new Set<string>();
  return [...found.values()]
    .sort((a, b) => a.at - b.at)
    .filter((x) => (byName.has(x.name) ? false : (byName.add(x.name), true)))
    .map(({ id, name }) => ({ id, name }));
}

/**
 * A player's injuries, newest first: what's on his own record, plus any still
 * in the league's transaction log from before records were kept on the player.
 */
export function injuryHistory(league: League, p: Player) {
  const out = new Map<string, { season: number; day: number; type: string; severity: string; days: number }>();
  for (const t of league.transactions) {
    if (t.type !== 'injury' || t.playerId !== p.id) continue;
    // "First Last: Type (severity, ~N days)"
    const m = /: (.+) \(([a-z-]+), ~(\d+) days?\)$/.exec(t.note);
    if (m) out.set(`${t.season}:${t.day}`, { season: t.season, day: t.day, type: m[1], severity: m[2], days: Number(m[3]) });
  }
  for (const x of p.injuryLog ?? []) out.set(`${x.season}:${x.day}`, { ...x });
  const list = [...out.values()].sort((a, b) => b.season - a.season || b.day - a.day);
  return list.map((x) => ({
    ...x,
    /** Still out with this one. */
    current: !!p.injury && x.season === league.season && p.injury.sinceDay === x.day && p.injury.type === x.type,
  }));
}

export function playerName(league: League, id: string) {
  const p = league.players[id];
  return p ? `${p.firstName} ${p.lastName}` : id;
}

/** Overall now vs at the end of his most recent season on record (null for players with no record yet). */
export function ovrChange(league: League, p: Player): { ovrPrev: number | null; ovrChange: number | null; ovrPrevSeason: number | null } {
  const lines = league.careerStats?.[p.id];
  // (In season, last season's line; in the summer, the season that just ended.)
  const last = lines?.length ? lines.reduce((a, b) => (b.season >= a.season ? b : a)) : null;
  if (!last || last.season < league.season - 1) return { ovrPrev: null, ovrChange: null, ovrPrevSeason: null };
  const now = overall(p);
  return { ovrPrev: last.overall, ovrChange: now - last.overall, ovrPrevSeason: last.season };
}
