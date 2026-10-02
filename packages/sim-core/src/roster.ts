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
import { activeRoster, balanceRoster, bestOnFarm, callUp as callUpFromFarm, capHit, farmRoster, nhlRoster, sendDown } from './farm';
import { assignToFarm, needsWaivers } from './waivers';
import { capRoom } from './contracts';
import { generatePlayer } from './generate';
import { autoLines, completeLines } from './lines';
import { suggestTactics } from './systems';
import { deriveSeed, Rng } from './rng';
import { overall } from './ratings';
import type { League, Lines, Player, PlayerId, Team } from './types';

export const LEAGUE_MINIMUM = 775_000;
export const ACTIVE_ROSTER_MAX = 23;

const isF = (p: Player) => p.pos === 'C' || p.pos === 'LW' || p.pos === 'RW';

/** Unsigned, not a prospect, not retired, not in a class that hasn't been drafted yet. */
export function isFreeAgent(league: League, p: Player): boolean {
  if (p.teamId !== null || p.prospectOf || p.draftClass !== undefined || p.inFantasyPool || league.retired?.[p.id]) return false;
  const d = league.offseason?.draft;
  if (d && d.current < d.picks.length && d.classIds.includes(p.id)) return false;
  return true;
}

export function freeAgents(league: League): Player[] {
  return Object.values(league.players).filter((p) => isFreeAgent(league, p));
}

/** Healthy players on the NHL roster (not injured, not with the farm team). */
export function healthyRoster(league: League, team: Team): Player[] {
  return activeRoster(league, team);
}

function callUp(league: League, team: Team, need: 'F' | 'D' | 'G'): void {
  // The farm team first.
  const farmer = bestOnFarm(league, team, need);
  if (farmer) {
    callUpFromFarm(league, team, farmer, ' to cover for injuries');
    farmer.injuryCallUp = true;
    return;
  }
  const pool = Object.values(league.players).filter(
    (p) => isFreeAgent(league, p) && !p.injury && (need === 'F' ? isF(p) : p.pos === need),
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
  best.injuryCallUp = true;
  best.recalledOn = { season: league.season, day: league.day };
  best.contract = { salary: LEAGUE_MINIMUM, yearsLeft: 1, kind: 'standard', expiresAs: league.season - best.birthYear + 1 >= 27 ? 'UFA' : 'RFA', twoWay: true, minorSalary: 100_000 };
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

export function ensureBodies(league: League, team: Team) {
  for (let guard = 0; guard < 30; guard++) {
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
  const mapOpt = (u?: PlayerId[]) => (u ? u.map(replace) : undefined);
  const next = {
    forwards: mapAll(lines.forwards),
    defense: mapAll(lines.defense),
    goalies: lines.goalies.map(replace),
    pp: mapAll(lines.pp),
    pk: mapAll(lines.pk),
    // Special units keep their shape; the replacement steps into the same spot.
    fourOnFour: lines.fourOnFour ? mapAll(lines.fourOnFour) : undefined,
    threeOnThree: lines.threeOnThree ? mapAll(lines.threeOnThree) : undefined,
    pp4: mapOpt(lines.pp4),
    pk3: mapOpt(lines.pk3),
    extraAttacker: mapOpt(lines.extraAttacker),
    shootout: mapOpt(lines.shootout),
  };
  const all = [...next.forwards.flat(), ...next.defense.flat(), ...next.goalies, ...next.pp.flat(), ...next.pk.flat()];
  if (all.some((x) => x === null)) return null;
  // A special unit that couldn't be repaired is dropped and rebuilt by completeLines.
  for (const k of ['pp4', 'pk3', 'extraAttacker', 'shootout'] as const) if (next[k]?.some((x) => x === null)) next[k] = undefined;
  for (const k of ['fourOnFour', 'threeOnThree'] as const) if (next[k]?.some((u) => u.some((x) => x === null))) next[k] = undefined;
  return next as Lines;
}

function linesValid(league: League, team: Team, lines: Lines): boolean {
  const onTeam = new Set(healthyRoster(league, team).map((p) => p.id));
  const ids = [...lines.forwards.flat(), ...lines.defense.flat(), ...lines.goalies, ...lines.pp.flat(), ...lines.pk.flat()];
  return ids.every((id) => onTeam.has(id) && !league.players[id].injury);
}

/** Old behavior (kept for reference): emergency call-ups used to go back to the free-agent pool. */
export function sendDownCallUps(league: League, team: Team) {
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
  if (released) team.lines = teamLines(league, team);
}

/** The assistant coach's lines for a team: best players up, systems filled, and the manager's placements honored. */
export function teamLines(league: League, team: Team): Lines {
  const pins = team.controller.kind === 'human' ? team.linePins : undefined;
  const healthy = healthyRoster(league, team);
  try {
    return autoLines(healthy, team.tactics, pins);
  } catch (e) {
    // Short of healthy bodies between games (an injured goalie, say; call-ups come on game day):
    // fill only the positions that are short with the injured players there. They're swapped
    // out when the game is played.
    const grp = (p: Player): 'F' | 'D' | 'G' => (p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F');
    const hurt = nhlRoster(league, team)
      .filter((p) => p.injury && !p.onWaivers)
      .sort((a, b) => overall(b) - overall(a));
    const roster = [...healthy];
    for (const [g, need] of [['F', 12], ['D', 6], ['G', 2]] as const) {
      let short = need - healthy.filter((p) => grp(p) === g).length;
      for (const p of hurt) if (grp(p) === g && short-- > 0) roster.push(p);
    }
    if (roster.length === healthy.length) throw e;
    return autoLines(roster, team.tactics, pins);
  }
}

/** Call before simulating a team's game. */
export function prepareTeamForGame(league: League, team: Team) {
  ensureBodies(league, team);
  // Back to 23 healthy: when injured players return, the extra bodies go to the farm.
  const sent = balanceRoster(league, team);
  if (team.controller.kind === 'ai') {
    // The AI coach revisits its systems every few weeks as the roster changes.
    if (!team.tactics || league.day % 20 === 0) team.tactics = suggestTactics(healthyRoster(league, team).filter((p) => p.pos !== 'G'));
    team.lines = teamLines(league, team);
    return;
  }
  void sent;
  if (team.autoLines) {
    team.lines = teamLines(league, team);
    return;
  }
  if (!linesValid(league, team, team.lines)) team.lines = repairLines(league, team, team.lines) ?? teamLines(league, team);
  // Special units that are missing (older saves) or list someone not dressed are refilled.
  team.lines = completeLines(team.lines, healthyRoster(league, team), team.tactics);
}

/**
 * AI front offices promote farm players who've outgrown the AHL: while the best
 * healthy farm player at a position is clearly better than the weakest healthy
 * NHL player there, they swap (if the cap allows). Run at training camp and
 * weekly during the season, so talent doesn't get stuck in the minors.
 */
export function aiRosterMoves(league: League, team: Team, margin = 2) {
  if (team.controller.kind !== 'ai') return;
  const grp = (p: Player): 'F' | 'D' | 'G' => (p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F');
  for (let guard = 0; guard < 8; guard++) {
    let swapped = false;
    for (const g of ['F', 'D', 'G'] as const) {
      const up = farmRoster(league, team)
        .filter((p) => !p.injury && grp(p) === g)
        .sort((a, b) => overall(b) - overall(a))[0];
      const down = nhlRoster(league, team)
        .filter((p) => !p.injury && grp(p) === g)
        .sort((a, b) => overall(a) - overall(b))[0];
      if (!up || !down || overall(up) < overall(down) + margin) continue;
      // Risking a veteran on waivers takes a clearer upgrade.
      const waive = needsWaivers(league, down);
      if (waive && overall(up) < overall(down) + margin) continue;
      if (waive) {
        // Can he be afforded with the veteran's full salary still on the books until he clears?
        if (capRoom(league, team) - ((up.contract?.salary ?? 0) - capHit(up)) < 0) continue;
        assignToFarm(league, team, down);
        // (A swap: he takes the waived player's place, so the 23-man check doesn't apply.)
        callUpFromFarm(league, team, up, ' (roster move)');
        league.transactions.pop();
      } else {
        sendDown(league, team, down);
        up.farm = false;
        if (capRoom(league, team) < 0) {
          // Can't afford him up top: undo.
          up.farm = true;
          down.farm = false;
          league.transactions.pop();
          continue;
        }
        up.recalledOn = { season: league.season, day: league.day };
      }
      league.transactions.push({ day: league.day, season: league.season, type: 'call-up', teamId: team.id, playerId: up.id, note: `${up.firstName} ${up.lastName} earns a call-up (${down.firstName} ${down.lastName} goes down)` });
      swapped = true;
    }
    if (!swapped) break;
  }
}
