/**
 * Game-day roster management: keeps every team able to dress a legal lineup
 * of 12 F, 6 D and 2 G despite injuries.
 *
 *  - AI teams re-optimize their lines every game day (injured players out,
 *    returning players back in).
 *  - Human teams keep their lines. Only injured players are swapped out, for
 *    the best healthy scratch at the same position. Managers decide when a
 *    returning player goes back in, unless they've handed lines to the
 *    assistant coach (`team.autoLines`), who re-optimizes before every game.
 *  - If a team can't dress a full lineup, it makes an emergency call-up from
 *    the free-agent pool on a one-year league-minimum deal. AI teams send
 *    call-ups back down once they have more than 23 healthy players again.
 */
import { generatePlayer } from './generate';
import { autoLines } from './lines';
import { deriveSeed, Rng } from './rng';
import { overall } from './ratings';
import type { League, Lines, Player, PlayerId, Team } from './types';

export const LEAGUE_MINIMUM = 775_000;
export const ACTIVE_ROSTER_MAX = 23;

const isF = (p: Player) => p.pos === 'C' || p.pos === 'LW' || p.pos === 'RW';

export function healthyRoster(league: League, team: Team): Player[] {
  return team.roster.map((id) => league.players[id]).filter((p) => !p.injury);
}

function callUp(league: League, team: Team, need: 'F' | 'D' | 'G'): void {
  const pool = Object.values(league.players).filter(
    (p) => p.teamId === null && !p.injury && (need === 'F' ? isF(p) : p.pos === need),
  );
  let best: Player;
  if (pool.length) {
    best = pool.reduce((a, b) => (overall(b) > overall(a) ? b : a));
  } else {
    // Free agency is tapped out: promote a replacement-level minor-leaguer.
    const n = league.transactions.filter((t) => t.type === 'call-up').length;
    const rng = new Rng(deriveSeed(league.seed, `minors:${league.season}:${league.day}:${team.id}:${n}`));
    const pos = need === 'F' ? rng.pick(['C', 'LW', 'RW'] as const) : need;
    best = generatePlayer(rng, pos, rng.normal(57, 3), league.season);
    best.id = `m${league.season}-${league.day}-${team.id}-${n}`;
    league.players[best.id] = best;
  }
  best.teamId = team.id;
  best.contract = { salary: LEAGUE_MINIMUM, yearsLeft: 1, kind: 'standard', expiresAs: 'UFA' };
  team.roster.push(best.id);
  league.transactions.push({
    day: league.day,
    season: league.season,
    type: 'call-up',
    teamId: team.id,
    playerId: best.id,
    note: `Emergency call-up: ${best.firstName} ${best.lastName} (${best.pos}, ${overall(best)} OVR), 1 yr / league minimum`,
  });
}

function ensureBodies(league: League, team: Team) {
  for (let guard = 0; guard < 10; guard++) {
    const h = healthyRoster(league, team);
    const f = h.filter(isF).length;
    const d = h.filter((p) => p.pos === 'D').length;
    const g = h.filter((p) => p.pos === 'G').length;
    if (g < 2) callUp(league, team, 'G');
    else if (d < 6) callUp(league, team, 'D');
    else if (f < 12) callUp(league, team, 'F');
    else return;
  }
  throw new Error(`${team.id} could not dress a legal lineup`);
}

/** Swap injured players out of a human-set lineup without reshuffling anything else. */
function repairLines(league: League, team: Team, lines: Lines): Lines | null {
  const healthy = new Set(healthyRoster(league, team).map((p) => p.id));
  const dressed = new Set<PlayerId>([...lines.forwards.flat(), ...lines.defense.flat(), ...lines.goalies]);
  const scratches = [...healthy].filter((id) => !dressed.has(id)).map((id) => league.players[id]);
  scratches.sort((a, b) => overall(b) - overall(a));
  const replacements = new Map<PlayerId, PlayerId>();

  const replace = (id: PlayerId): PlayerId | null => {
    if (healthy.has(id)) return id;
    if (replacements.has(id)) return replacements.get(id)!;
    const out = league.players[id];
    const want = (p: Player) => (out.pos === 'G' ? p.pos === 'G' : out.pos === 'D' ? p.pos === 'D' : isF(p));
    const idx = scratches.findIndex(want) >= 0 ? scratches.findIndex(want) : scratches.findIndex((p) => p.pos !== 'G' && out.pos !== 'G');
    if (idx < 0) return null;
    const sub = scratches.splice(idx, 1)[0];
    replacements.set(id, sub.id);
    return sub.id;
  };
  const mapAll = (arr: PlayerId[][]) => arr.map((u) => u.map(replace));
  const next = {
    forwards: mapAll(lines.forwards),
    defense: mapAll(lines.defense),
    goalies: lines.goalies.map(replace),
    pp: mapAll(lines.pp),
    pk: mapAll(lines.pk),
  };
  const all = [...next.forwards.flat(), ...next.defense.flat(), ...next.goalies, ...next.pp.flat(), ...next.pk.flat()];
  if (all.some((x) => x === null)) return null;
  return next as Lines;
}

function linesValid(league: League, team: Team, lines: Lines): boolean {
  const onTeam = new Set(team.roster);
  const ids = [...lines.forwards.flat(), ...lines.defense.flat(), ...lines.goalies, ...lines.pp.flat(), ...lines.pk.flat()];
  return ids.every((id) => onTeam.has(id) && !league.players[id].injury);
}

/** AI teams return emergency call-ups to the free-agent pool when they're no longer needed. */
function sendDownCallUps(league: League, team: Team) {
  const calledUp = new Set(
    league.transactions.filter((t) => t.type === 'call-up' && t.teamId === team.id).map((t) => t.playerId),
  );
  const h = healthyRoster(league, team);
  let healthy = h.length;
  const count = (pos: (p: Player) => boolean) => h.filter(pos).length;
  const left = { F: count(isF), D: count((p) => p.pos === 'D'), G: count((p) => p.pos === 'G') };
  const minimum = { F: 12, D: 6, G: 2 };
  const candidates = h.filter((p) => calledUp.has(p.id)).sort((a, b) => overall(a) - overall(b));
  let released = false;
  for (const p of candidates) {
    if (healthy <= ACTIVE_ROSTER_MAX) break;
    const k = isF(p) ? 'F' : (p.pos as 'D' | 'G');
    if (left[k] <= minimum[k]) continue;
    left[k]--;
    released = true;
    p.teamId = null;
    p.contract = null;
    team.roster = team.roster.filter((id) => id !== p.id);
    healthy--;
    league.transactions.push({
      day: league.day, season: league.season, type: 'send-down', teamId: team.id, playerId: p.id,
      note: `${p.firstName} ${p.lastName} returned to the free-agent pool`,
    });
  }
  if (released) team.lines = autoLines(healthyRoster(league, team));
}

/** Call before simulating a team's game. */
export function prepareTeamForGame(league: League, team: Team) {
  ensureBodies(league, team);
  if (team.controller.kind === 'ai') {
    team.lines = autoLines(healthyRoster(league, team));
    sendDownCallUps(league, team);
    return;
  }
  if (team.autoLines) {
    team.lines = autoLines(healthyRoster(league, team));
    return;
  }
  if (linesValid(league, team, team.lines)) return;
  team.lines = repairLines(league, team, team.lines) ?? autoLines(healthyRoster(league, team));
}
