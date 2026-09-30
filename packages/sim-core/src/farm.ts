/**
 * Farm teams (AHL affiliates) and the 23-man roster.
 *
 * Every signed player belongs to his team (`team.roster`), up to 50 contracts.
 * Players assigned to the farm team (`player.farm`) play in the AHL; the rest
 * are the NHL roster. At most 23 healthy players can be on the NHL roster:
 * injured players go on injured reserve and don't count, so when someone gets
 * hurt the team calls up a replacement from the farm, and when he's healthy
 * again the weakest extra player goes back down.
 *
 * Farm salaries mostly don't count against the cap: only the part of a
 * buried contract above $1.15M does (as in the NHL).
 */
import { overall } from './ratings';
import { deriveSeed, Rng } from './rng';
import type { League, Player, Team } from './types';
import { assignToFarm, needsWaivers } from './waivers';

export const CONTRACT_MAX = 50;
export const ACTIVE_MAX = 23;
export const BURY_EXEMPT = 1_150_000;
/** Farm size teams aim for (a working AHL lineup of prospects and depth). */
export const FARM_TARGET = { F: 9, D: 5, G: 2 };

const isF = (p: Player) => p.pos === 'C' || p.pos === 'LW' || p.pos === 'RW';
const group = (p: Player): 'F' | 'D' | 'G' => (p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F');
const MIN_DRESS = { F: 12, D: 6, G: 2 };

export const nhlRoster = (league: League, team: Team): Player[] => team.roster.map((id) => league.players[id]).filter((p) => p && !p.farm && !p.onWaivers);
export const farmRoster = (league: League, team: Team): Player[] => team.roster.map((id) => league.players[id]).filter((p) => p && p.farm);
/** Healthy NHL players (injured players are on injured reserve). */
export const activeRoster = (league: League, team: Team): Player[] => nhlRoster(league, team).filter((p) => !p.injury);
export const contractCount = (team: Team) => team.roster.length;

/** Cap hit that counts: NHL players in full, farm players only above the burying exemption. */
export function capHit(p: Player): number {
  const s = p.contract?.salary ?? 0;
  return p.farm ? Math.max(0, s - BURY_EXEMPT) : s;
}

const AFFILIATE_CITIES = [
  'Moncton', 'Saskatoon', 'Halifax', 'Fort Wayne', 'Hamilton', 'Laval', 'Portland', 'Rochester', 'Syracuse', 'Albany', 'Providence',
  'Hartford', 'Springfield', 'Worcester', 'Lehigh Valley', 'Wilkes-Barre', 'Hershey', 'Charlotte', 'Rockford', 'Milwaukee', 'Grand Rapids',
  'Des Moines', 'Tucson', 'San Antonio', 'Bakersfield', 'Stockton', 'Ontario', 'Abbotsford', 'Manitoba', 'Belleville', 'Toronto', 'Iowa',
  'Cleveland', 'Utica', 'Bridgeport', 'Chicago', 'Texas', 'Henderson', 'Coachella', 'Calgary',
];
const AFFILIATE_NAMES = [
  'Mariners', 'Stallions', 'Foxes', 'Comets', 'Pioneers', 'Rivermen', 'Wolverines', 'Monarchs', 'Barons', 'Ironmen', 'Admirals', 'Voyageurs',
  'Grizzlies', 'Lumberjacks', 'Thunderbirds', 'Chargers', 'Sentinels', 'Rapids', 'Nighthawks', 'Clippers', 'Blizzard', 'Miners', 'Bandits', 'Owls',
];

/** The affiliate's name, stable for the life of the league. */
export function affiliate(league: League, team: Team): { city: string; name: string } {
  if (team.affiliate) return team.affiliate;
  const rng = new Rng(deriveSeed(league.seed, `affiliate:${team.id}`));
  const taken = new Set(Object.values(league.teams).map((t) => t.affiliate?.city).filter(Boolean));
  let city = rng.pick(AFFILIATE_CITIES);
  for (let i = 0; i < 40 && (taken.has(city) || city === team.city); i++) city = rng.pick(AFFILIATE_CITIES);
  team.affiliate = { city, name: rng.pick(AFFILIATE_NAMES) };
  return team.affiliate;
}
export const affiliateLabel = (league: League, team: Team) => {
  const a = affiliate(league, team);
  return `${a.city} ${a.name}`;
};

function tx(league: League, type: League['transactions'][number]['type'], team: Team, p: Player, note: string) {
  league.transactions.push({ day: league.day, season: league.season, type, teamId: team.id, playerId: p.id, note });
}

export function sendDown(league: League, team: Team, p: Player, why = '') {
  if (p.teamId !== team.id) throw new Error('Not your player');
  if (p.farm) throw new Error('He is already with the farm team');
  p.farm = true;
  p.onWaivers = false;
  delete p.injuryCallUp;
  tx(league, 'send-down', team, p, `${p.firstName} ${p.lastName} assigned to ${affiliateLabel(league, team)}${why}`);
}

export function callUp(league: League, team: Team, p: Player, why = '') {
  if (p.teamId !== team.id) throw new Error('Not your player');
  if (!p.farm) throw new Error('He is already on the NHL roster');
  if (!p.injury && activeRoster(league, team).length >= ACTIVE_MAX && !why) {
    throw new Error(`You already have ${ACTIVE_MAX} healthy players. Send someone down first.`);
  }
  p.farm = false;
  p.recalledOn = { season: league.season, day: league.day };
  tx(league, 'call-up', team, p, `${p.firstName} ${p.lastName} called up from ${affiliateLabel(league, team)}${why}`);
}

/** Best healthy farm player at a position, if any. */
export function bestOnFarm(league: League, team: Team, need: 'F' | 'D' | 'G'): Player | null {
  const pool = farmRoster(league, team).filter((p) => !p.injury && group(p) === need);
  return pool.length ? pool.reduce((a, b) => (overall(b) > overall(a) ? b : a)) : null;
}

/**
 * Keep the NHL roster at 23 healthy players or fewer: the weakest extra player
 * (keeping 12 F, 6 D and 2 G) goes down. Returns who was sent down.
 */
export function balanceRoster(league: League, team: Team): Player[] {
  const sent: Player[] = [];
  for (let guard = 0; guard < 20; guard++) {
    const active = activeRoster(league, team);
    if (active.length <= ACTIVE_MAX) break;
    const counts = { F: active.filter(isF).length, D: active.filter((p) => p.pos === 'D').length, G: active.filter((p) => p.pos === 'G').length };
    const excess = (g: 'F' | 'D' | 'G') => counts[g] - MIN_DRESS[g];
    // The weakest extra goes, though teams would rather send down someone who
    // doesn't need waivers than risk losing a similar player for nothing.
    const cost = (p: Player) => overall(p) + (needsWaivers(league, p) ? 1 : 0);
    const candidates = active.filter((p) => excess(group(p)) > 0).sort((a, b) => cost(a) - cost(b));
    const p = candidates[0];
    if (!p) break;
    assignToFarm(league, team, p, team.controller.kind === 'human' ? ' (roster at 23; your assistant GM made room)' : '');
    sent.push(p);
  }
  return sent;
}

/**
 * Regulars back from injury: for lineups the AI or the assistant coach runs,
 * each one sends down the weakest call-up at his position who's worse than he
 * is (keeping enough bodies to dress a lineup).
 */
export function returnInjuryCallUps(league: League, team: Team, back: Player[]): Player[] {
  if (!back.length || (team.controller.kind === 'human' && !team.autoLines)) return [];
  const sent: Player[] = [];
  for (const r of back) {
    const g = group(r);
    const active = activeRoster(league, team);
    if (active.filter((p) => group(p) === g).length <= MIN_DRESS[g]) continue;
    const cover = active
      .filter((p) => p.injuryCallUp && p.id !== r.id && group(p) === g && overall(p) < overall(r))
      .sort((a, b) => overall(a) - overall(b))[0];
    if (!cover) continue;
    assignToFarm(league, team, cover, ` (${r.firstName} ${r.lastName} is back from injury)`);
    sent.push(cover);
  }
  return sent;
}

/** Release the weakest farm players until the team is within the contract limit. */
export function trimContracts(league: League, team: Team, release: (p: Player) => void) {
  while (contractCount(team) > CONTRACT_MAX) {
    const farm = farmRoster(league, team).sort((a, b) => overall(a) - overall(b));
    const p = farm[0] ?? nhlRoster(league, team).sort((a, b) => overall(a) - overall(b))[0];
    if (!p) break;
    release(p);
  }
}
