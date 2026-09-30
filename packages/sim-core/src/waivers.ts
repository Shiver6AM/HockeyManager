/**
 * Waivers. During the regular season, a player who isn't waiver-exempt can't
 * simply be sent to the farm: he's placed on waivers for a day first, and any
 * other team may claim him (contract and all). The claiming team with the
 * worst record gets him. If nobody claims him, he clears and reports to the
 * farm team.
 *
 * Exempt (as in the NHL, simplified):
 *  - young players early in their careers (22 and under, or under 80 NHL games,
 *    or under 160 games and 24 or younger);
 *  - anyone recalled in the last 30 days (typically an injury call-up going
 *    back down);
 *  - outside the regular season (camp cuts, the playoffs).
 */
import { capRoom } from './contracts';
import { ACTIVE_MAX, CONTRACT_MAX, nhlRoster, sendDown } from './farm';
import { age, overall } from './ratings';
import { standings } from './league';
import type { League, Player, PlayerId, Team, TeamId } from './types';

export interface WaiverEntry {
  playerId: PlayerId;
  fromTeam: TeamId;
  season: number;
  /** Day he was placed on waivers; he's claimed or clears when the next day is played. */
  day: number;
  /** Managers who've put in a claim. */
  claims: TeamId[];
}

export const RECALL_EXEMPT_DAYS = 30;

const group = (p: Player): 'F' | 'D' | 'G' => (p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F');
const DRESS = { F: 12, D: 6, G: 2 };

/** NHL regular-season games played in his career (before this season), plus this season's. */
function careerGames(league: League, p: Player): number {
  const lines = league.careerStats?.[p.id] ?? [];
  // Veterans who were already pros before the league began have no career record here: estimate.
  const nhlSeasons = lines.filter((c) => c.skater?.gp || c.goalie?.gp).length;
  const before = nhlSeasons === 0 && !p.draft ? Math.max(0, age(p, league.season) - 20) * 50 : 0;
  const past = before + lines.reduce((s, c) => s + (c.skater?.gp ?? 0) + (c.goalie?.gp ?? 0), 0);
  // (In the summer, last season is already in his career record.)
  const now = league.phase === 'offseason' ? 0 : (league.skaterStats[p.id]?.gp ?? 0) + (league.goalieStats[p.id]?.gp ?? 0);
  return past + now;
}

/** Can he go to the farm without waivers? Returns why, if so. */
export function waiverExemption(league: League, p: Player): string | null {
  // Waivers run from training camp through the regular season.
  const camp = league.phase === 'offseason' && league.offseason?.stage === 'training-camp';
  if (league.phase !== 'regular-season' && !camp) return 'outside the regular season';
  const a = age(p, league.season + (camp ? 1 : 0));
  const gp = careerGames(league, p);
  if (a <= 22) return 'age 22 or younger';
  if (gp < 80) return `only ${gp} NHL games`;
  if (gp < 160 && a <= 24) return `${gp} NHL games at ${a}`;
  if (p.recalledOn && p.recalledOn.season === league.season && league.day - p.recalledOn.day <= RECALL_EXEMPT_DAYS) return 'recalled in the last 30 days';
  return null;
}

export const needsWaivers = (league: League, p: Player) => waiverExemption(league, p) === null;

export const onWaivers = (league: League, id: PlayerId) => (league.waivers ?? []).some((w) => w.playerId === id);

/**
 * Send a player to the farm: straight down if he's exempt, otherwise onto
 * waivers (he's off the active roster meanwhile). Returns what happened.
 */
export function assignToFarm(league: League, team: Team, p: Player, why = ''): 'farm' | 'waivers' {
  if (p.teamId !== team.id) throw new Error('Not your player');
  if (p.farm) throw new Error('He is already with the farm team');
  if (p.onWaivers) throw new Error('He is already on waivers');
  if (!needsWaivers(league, p)) {
    sendDown(league, team, p, why);
    return 'farm';
  }
  p.onWaivers = true;
  (league.waivers ??= []).push({ playerId: p.id, fromTeam: team.id, season: league.season, day: league.day, claims: [] });
  league.transactions.push({
    day: league.day,
    season: league.season,
    type: 'waivers',
    teamId: team.id,
    playerId: p.id,
    note: `${p.firstName} ${p.lastName} placed on waivers${why}`,
  });
  return 'waivers';
}

/** A manager claims a player on waivers (resolved when the next day is played). */
export function claimOnWaivers(league: League, team: Team, playerId: PlayerId) {
  const w = (league.waivers ?? []).find((x) => x.playerId === playerId);
  if (!w) throw new Error('He is not on waivers');
  if (w.fromTeam === team.id) throw new Error('You put him on waivers');
  const p = league.players[playerId];
  if (team.roster.length >= CONTRACT_MAX) throw new Error(`You're at the ${CONTRACT_MAX}-contract limit`);
  if ((p.contract?.salary ?? 0) > capRoom(league, team)) throw new Error('Not enough cap room for his contract');
  if (!w.claims.includes(team.id)) w.claims.push(team.id);
}

export function withdrawClaim(league: League, team: Team, playerId: PlayerId) {
  const w = (league.waivers ?? []).find((x) => x.playerId === playerId);
  if (w) w.claims = w.claims.filter((t) => t !== team.id);
}

/** Would an AI team put in a claim? Only for a clear upgrade it can afford. */
function aiWantsClaim(league: League, team: Team, p: Player): boolean {
  if (team.controller.kind !== 'ai' || team.roster.length >= CONTRACT_MAX - 1) return false;
  if ((p.contract?.salary ?? 0) > capRoom(league, team) - 500_000) return false;
  const g = group(p);
  const mine = nhlRoster(league, team)
    .filter((x) => !x.injury && group(x) === g)
    .map(overall)
    .sort((a, b) => b - a);
  const weakestDressed = mine[DRESS[g] - 1] ?? 0;
  const strategy = team.controller.strategy;
  const want = overall(p) >= weakestDressed + (strategy === 'contend' ? 1 : 3);
  // Rebuilding teams want youth, not expensive veterans.
  if (strategy === 'rebuild' && age(p, league.season) >= 30) return false;
  return want;
}

/**
 * Resolve waivers placed before today: the claimant with the worst record gets
 * him; otherwise he clears to the farm. `all` resolves everything (end of the
 * regular season).
 */
export function processWaivers(league: League, all = false) {
  const list = league.waivers ?? [];
  if (!list.length) return;
  // Placed before today's games (by a manager, or during an earlier day): resolved now.
  const due = list.filter((w) => all || w.season !== league.season || w.day <= league.day);
  if (!due.length) return;
  league.waivers = list.filter((w) => !due.includes(w));
  // Priority: lowest points percentage first.
  const table = standings(league);
  const rank = new Map(table.map((r, i) => [r.teamId, r.gp ? r.pts / (2 * r.gp) : 0.5 + i / 1000]));
  const byPriority = Object.values(league.teams).sort((a, b) => (rank.get(a.id) ?? 0.5) - (rank.get(b.id) ?? 0.5));
  const aiClaimed = new Set<TeamId>();
  for (const w of due) {
    const p = league.players[w.playerId];
    const from = league.teams[w.fromTeam];
    if (!p || !from || p.teamId !== from.id) continue;
    p.onWaivers = false;
    let winner: Team | null = null;
    for (const t of byPriority) {
      if (t.id === from.id) continue;
      const human = t.controller.kind === 'human';
      if (human ? !w.claims.includes(t.id) : aiClaimed.has(t.id) || !aiWantsClaim(league, t, p)) continue;
      // Still able to take him on?
      if (t.roster.length >= CONTRACT_MAX || (p.contract?.salary ?? 0) > capRoom(league, t)) continue;
      winner = t;
      break;
    }
    if (winner) {
      from.roster = from.roster.filter((id) => id !== p.id);
      p.teamId = winner.id;
      p.farm = false;
      p.recalledOn = { season: league.season, day: league.day };
      winner.roster.push(p.id);
      if (winner.controller.kind === 'ai') aiClaimed.add(winner.id);
      league.transactions.push({
        day: league.day,
        season: league.season,
        type: 'waiver-claim',
        teamId: winner.id,
        playerId: p.id,
        note: `${p.firstName} ${p.lastName} claimed off waivers from the ${from.city} ${from.name}`,
      });
    } else {
      sendDown(league, from, p, ' (cleared waivers)');
    }
  }
}

/** For the waiver-wire page: what he'd cost you against the cap, and whether your claim would fit. */
export function claimOutlook(league: League, team: Team, p: Player) {
  const salary = p.contract?.salary ?? 0;
  return {
    capHit: salary,
    fitsCap: salary <= capRoom(league, team),
    fitsContracts: team.roster.length < CONTRACT_MAX,
    rosterAfter: nhlRoster(league, team).filter((x) => !x.injury).length + 1,
    overMax: nhlRoster(league, team).filter((x) => !x.injury).length + 1 > ACTIVE_MAX,
  };
}
