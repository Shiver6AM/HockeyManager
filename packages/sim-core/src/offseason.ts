/**
 * The summer between seasons.
 *
 *   playoffs end
 *     → season review   final stats stay as they were until the league moves on
 *     → (first step) career stats archived, players develop/age, retirements,
 *       expiring contracts listed, draft class + lottery
 *     → draft          humans pick when on the clock
 *     → re-sign        humans decide on their expiring players
 *     → free agency    humans sign free agents; AI teams fill their rosters
 *     → training camp  promote prospects, cut down to 23
 *     → new season     schedule, stats reset, cap grows
 *
 * `offseasonStep` moves one stage forward. It never waits on a human when
 * `force` is set (commissioner button, schedule tick), so a league can't stall.
 * Every random choice is seeded from the league seed, so results depend only on
 * the seed and on what the human managers decided.
 */
import {
  askingContract,
  buyoutTerms,
  payroll,
  capRoom,
  capSeason,
  ELC_SALARY,
  expiresAsFor,
  LEAGUE_MIN_SALARY,
  PROSPECT_MAX,
  ROSTER_MAX,
  SUMMER_ROSTER_MAX,
} from './contracts';
import { aiValuation, askFromTeam, offerUtility, respondToOffer, type OfferResult } from './negotiation';
import { holdArbitration, openCase, openRfaCase, resolveOfferSheets, settleRfaCase } from './rfa';
import { developPlayer, retirementChance } from './development';
import { createDraft, runDraft } from './draft';
import { generatePlayer, talentStats } from './generate';
import { autoLines } from './lines';
import { age, overall } from './ratings';
import { deriveSeed, Rng } from './rng';
import { ensureBodies, freeAgents, healthyRoster, isFreeAgent } from './roster';
import { standings } from './league';
import { closeBooks, setOwnerGoals } from './finances';
import { considerForHallOfFame, newsFromTransactions } from './news';
import { offseasonStaff } from './staff';
import { buildSchedule } from './schedule';
import type { CareerLine, ContractOffer, FaResult, League, OffseasonStage, Player, PlayerId, StandingsRow, Team, TeamId } from './types';

export const OFFSEASON_STAGES: OffseasonStage[] = ['draft', 're-sign', 'free-agency', 'training-camp'];
export const STAGE_LABELS: Record<OffseasonStage, string> = {
  draft: 'Entry draft',
  're-sign': 'Re-sign players',
  'free-agency': 'Free agency',
  'training-camp': 'Training camp',
};
const CAP_GROWTH = 1.025;

const isF = (p: Player) => p.pos === 'C' || p.pos === 'LW' || p.pos === 'RW';
const group = (p: Player) => (p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F');

function tx(league: League, type: League['transactions'][number]['type'], teamId: TeamId, p: Player, note: string) {
  league.transactions.push({ day: league.day, season: league.season, type, teamId, playerId: p.id, note });
}
const nm = (p: Player) => `${p.firstName} ${p.lastName}`;

// ---------------------------------------------------------------------------
// End of season
// ---------------------------------------------------------------------------

function archiveCareer(league: League) {
  const careers = (league.careerStats ??= {});
  for (const p of Object.values(league.players)) {
    const sk = league.skaterStats[p.id] ?? null;
    const g = league.goalieStats[p.id] ?? null;
    const psk = league.playoffSkaterStats[p.id] ?? null;
    const pg = league.playoffGoalieStats[p.id] ?? null;
    if (!sk && !g && !p.teamId) continue;
    const line: CareerLine = {
      season: league.season,
      teamId: p.teamId,
      age: age(p, league.season),
      overall: overall(p),
      skater: sk,
      goalie: g,
      playoffSkater: psk,
      playoffGoalie: pg,
    };
    (careers[p.id] ??= []).push(line);
  }
}

function retire(league: League, p: Player) {
  const teamId = p.teamId ?? p.prospectOf ?? null;
  if (teamId) {
    const t = league.teams[teamId];
    t.roster = t.roster.filter((id) => id !== p.id);
    t.prospects = (t.prospects ?? []).filter((id) => id !== p.id);
  }
  const career = league.careerStats?.[p.id] ?? [];
  delete league.careerStats?.[p.id];
  const gp = career.reduce((s, c) => s + (c.skater?.gp ?? 0) + (c.goalie?.gp ?? 0), 0);
  if (gp < 20 && overall(p) < 70) {
    // Never really made it: drop him entirely to keep the save small.
    delete league.players[p.id];
    p.teamId = null;
    p.prospectOf = undefined;
    return;
  }
  const record = ((league.retired ??= {})[p.id] = {
    id: p.id,
    name: nm(p),
    pos: p.pos,
    birthYear: p.birthYear,
    retiredAfter: league.season,
    lastTeamId: teamId,
    peakOverall: Math.max(overall(p), ...career.map((c) => c.overall)),
    career,
  });;
  considerForHallOfFame(league, record);
  if (teamId && (overall(p) >= 68 || career.length >= 8)) {
    tx(league, 'retirement', teamId, p, `${nm(p)} retires after ${career.length} season${career.length === 1 ? '' : 's'} (age ${age(p, league.season)})`);
  }
  p.teamId = null;
  p.prospectOf = undefined;
  p.contract = null;
}

/** Called when the final ends. Runs the automatic end-of-season work and opens the draft. */
export function startOffseason(league: League, st: StandingsRow[]) {
  archiveCareer(league);

  // AI front offices re-think their direction based on how the season went.
  const byPts = [...st].sort((a, b) => b.pts - a.pts).map((r) => r.teamId);
  byPts.forEach((id, i) => {
    const t = league.teams[id];
    if (t.controller.kind !== 'ai') return;
    t.controller.strategy = i < 10 ? 'contend' : i >= byPts.length - 8 ? 'rebuild' : 'balanced';
  });

  // Development & aging for everyone still playing.
  const development: Record<PlayerId, [number, number]> = {};
  const rostered = new Set(Object.values(league.teams).flatMap((t) => t.roster));
  for (const p of Object.values(league.players)) {
    if (league.retired?.[p.id]) continue;
    const s = league.skaterStats[p.id];
    const g = league.goalieStats[p.id];
    const gp = s?.gp ?? g?.gp ?? 0;
    development[p.id] = developPlayer(league, p, { gp, toi: s && s.gp ? s.toi / s.gp / 60 : 0, onRoster: rostered.has(p.id) });
  }

  // Keep league-wide talent anchored (see LeagueSettings.talentAnchor).
  anchorTalent(league);

  // Retirements.
  const rng = new Rng(deriveSeed(league.seed, `retire:${league.season}`));
  for (const p of Object.values(league.players)) {
    if (league.retired?.[p.id]) continue;
    const signed = !!p.contract || !!p.prospectOf;
    const contractLeft = p.contract && p.contract.yearsLeft > 1;
    const chance = retirementChance(p, age(p, league.season) + 1, signed) * (contractLeft ? 0.5 : 1);
    if (rng.chance(chance)) retire(league, p);
  }

  // Contracts ending this summer and what those players will ask for.
  const expiring: Record<PlayerId, { salary: number; years: number }> = {};
  for (const t of Object.values(league.teams)) {
    for (const id of t.roster) {
      const p = league.players[id];
      if (p.contract && p.contract.yearsLeft <= 1) expiring[id] = askingContract(league, p);
    }
  }

  const { state: draft, prospects } = createDraft(league, st, league.season);
  for (const p of prospects) league.players[p.id] = p;

  league.negotiations = {};
  league.offseason = {
    season: league.season,
    stage: 'draft',
    draft,
    expiring,
    resign: {},
    freeAgentAsks: {},
    development,
  };
  league.phase = 'offseason';
  runDraft(league, { force: false });
}

/**
 * Nudge every rating with the same affine map so the league's top-N talent
 * keeps the mean and spread it had at creation. Overall is a weighted mean of
 * ratings, so this moves every overall by exactly the same map and keeps
 * everyone's relative standing intact.
 */
export function anchorTalent(league: League, strength = 0.6) {
  const { talentAnchor: anchorMean, talentSpread: anchorSd } = league.settings;
  if (!anchorMean || !anchorSd) return;
  const { mean, sd } = talentStats(league);
  const newMean = mean + (anchorMean - mean) * strength;
  const newSd = sd + (anchorSd - sd) * strength;
  const scale = newSd / sd;
  const map = (x: number) => newMean + (x - mean) * scale;
  for (const p of Object.values(league.players)) {
    const r = (p.skater ?? p.goalie) as unknown as Record<string, number>;
    for (const k in r) if (k !== 'discipline') r[k] = Math.round(Math.min(99, Math.max(20, map(r[k]))));
    p.hidden.potential = Math.round(Math.min(99, Math.max(overall(p), map(p.hidden.potential))));
  }
}

// ---------------------------------------------------------------------------
// Stage transitions
// ---------------------------------------------------------------------------

export interface StepResult {
  from: OffseasonStage | 'review';
  to: OffseasonStage | 'regular-season';
  note: string;
}

/**
 * Advance the offseason. In the draft, one step makes picks until a human is
 * on the clock; with `force` it auto-picks for humans and finishes the draft.
 */
export function offseasonStep(league: League, opts: { force: boolean }): StepResult {
  const r = offseasonStepInner(league, opts);
  newsFromTransactions(league);
  return r;
}

function offseasonStepInner(league: League, opts: { force: boolean }): StepResult {
  if (league.phase !== 'offseason') throw new Error('Not in the offseason');
  if (!league.offseason) {
    startOffseason(league, standings(league));
    return { from: 'review', to: 'draft', note: 'Players aged and developed; the draft is open' };
  }
  const os = league.offseason;
  const from = os.stage;
  switch (os.stage) {
    case 'draft': {
      const made = runDraft(league, { force: opts.force });
      if (os.draft.current < os.draft.picks.length) return { from, to: 'draft', note: `${made} picks made; a manager is on the clock` };
      finishDraft(league);
      os.stage = 're-sign';
      return { from, to: 're-sign', note: 'Draft complete' };
    }
    case 're-sign': {
      const n = finishResigning(league);
      os.stage = 'free-agency';
      return { from, to: 'free-agency', note: `${n} players re-signed` };
    }
    case 'free-agency': {
      const round = os.faRound ?? 1;
      resolveOfferSheets(league, round);
      const results = resolveFreeAgencyRound(league);
      if ((os.faRound ?? 1) <= FA_ROUNDS) {
        return { from, to: 'free-agency', note: `Bidding round ${round}: ${results.length} players signed` };
      }
      holdArbitration(league);
      const n = aiFreeAgency(league);
      os.stage = 'training-camp';
      return { from, to: 'training-camp', note: `Final round: ${results.length} signed; ${n} more depth signings` };
    }
    case 'training-camp': {
      trainingCamp(league);
      startNewSeason(league);
      return { from, to: 'regular-season', note: `The ${league.season}-${String(league.season + 1).slice(2)} season begins` };
    }
  }
}

/** Run every remaining offseason stage (forcing human decisions to defaults). */
export function advanceToNextSeason(league: League): StepResult[] {
  const out: StepResult[] = [];
  while (league.phase === 'offseason') out.push(offseasonStep(league, { force: true }));
  return out;
}

function finishDraft(league: League) {
  // Undrafted players go back to junior and out of the league's world.
  const drafted = new Set(league.offseason!.draft.picks.map((p) => p.playerId));
  for (const id of league.offseason!.draft.classIds) if (!drafted.has(id)) delete league.players[id];
}

// ---- Re-signing ----

function aiWantsToResign(league: League, team: Team, p: Player): boolean {
  const ovr = overall(p);
  const a = age(p, league.season) + 1;
  const strategy = team.controller.kind === 'ai' ? team.controller.strategy : 'balanced';
  if (strategy === 'rebuild' && a >= 31 && ovr < 78) return false;
  if (strategy === 'contend' && ovr >= 68) return true;
  if (ovr >= 70) return true;
  if (a <= 24 && p.hidden.potential >= 70) return true;
  // Otherwise keep him if he's better than the weakest dressed player at his position.
  const peers = team.roster.map((id) => league.players[id]).filter((x) => x.id !== p.id && group(x) === group(p));
  const need = p.pos === 'G' ? 2 : p.pos === 'D' ? 6 : 12;
  const sorted = peers.map(overall).sort((x, y) => y - x);
  return sorted.length < need || ovr >= (sorted[need - 1] ?? 0) + 2;
}

/** Apply an agreed contract (re-signing, extension, qualifying offer or signing). */
export function applyContract(league: League, p: Player, offer: ContractOffer) {
  const yearsIn = (league.careerStats?.[p.id]?.length ?? 0) + 1;
  p.contract = {
    salary: offer.salary,
    yearsLeft: offer.years,
    kind: 'standard',
    expiresAs: expiresAsFor(age(p, league.season) + 1 + offer.years, yearsIn + offer.years),
  };
  delete p.extension;
}

/** How an AI team handles one of its expiring players. Returns the deal, or null to let him walk. */
function aiResign(league: League, team: Team, p: Player, room: number): ContractOffer | null {
  if (!aiWantsToResign(league, team, p)) return null;
  const ask = league.offseason!.expiring[p.id];
  const mine = askFromTeam(league, p, team, ask);
  const budget = Math.min(aiValuation(league, team, p) * 1.1, room);
  // Open at the lower of value and his ask from us, then take one counter if it's affordable.
  const first = { salary: Math.min(mine.salary, aiValuation(league, team, p)), years: mine.years };
  if (first.salary > room) return null;
  const r = respondToOffer(league, p, team, first, { ask });
  if (r.result === 'accept') return first;
  if (r.result === 'counter' && r.counter.salary <= budget) {
    const second = respondToOffer(league, p, team, r.counter, { ask });
    if (second.result === 'accept') return r.counter;
  }
  return null;
}

function negotiated(league: League, p: Player, teamId: TeamId): boolean {
  const n = league.negotiations?.[p.id];
  return !!n && n.teamId === teamId && n.attempts > 0;
}

function finishResigning(league: League): number {
  const os = league.offseason!;
  const byTeam = new Map<TeamId, PlayerId[]>();
  for (const id of Object.keys(os.expiring)) {
    const p = league.players[id];
    if (!p?.teamId) continue; // retired or gone
    byTeam.set(p.teamId, [...(byTeam.get(p.teamId) ?? []), id]);
  }
  // Non-expiring contracts tick down a year now.
  for (const t of Object.values(league.teams)) {
    for (const id of t.roster) {
      const c = league.players[id].contract;
      if (c && !os.expiring[id]) c.yearsLeft = Math.max(1, c.yearsLeft - 1);
    }
  }
  let resigned = 0;
  for (const [teamId, ids] of byTeam) {
    const team = league.teams[teamId];
    // Remove all expiring cap hits first, then add back the ones kept, best first.
    let room = capRoom(league, team) + ids.reduce((s, id) => s + (league.players[id].contract?.salary ?? 0), 0);
    ids.sort((a, b) => overall(league.players[b]) - overall(league.players[a]));
    for (const id of ids) {
      const p = league.players[id];
      const isRfa = p.contract?.expiresAs === 'RFA';
      let deal: ContractOffer | null = null;
      let byAssistant = false;
      if (p.extension) deal = p.extension; // agreed during the season or this summer
      else if (team.controller.kind === 'ai') deal = aiResign(league, team, p, room);
      // Human managers who never got to a player: the assistant GM handles him like
      // an AI team would. An explicit "let go" is always respected.
      else if (os.resign[id] === undefined && !os.qualified?.[id] && !negotiated(league, p, teamId)) {
        deal = aiResign(league, team, p, room);
        byAssistant = !!deal;
      }
      if (!deal && isRfa) {
        // Humans qualify explicitly; an undecided manager's assistant GM qualifies like an AI would.
        const undecided = os.resign[id] === undefined && !negotiated(league, p, teamId);
        const qualify =
          team.controller.kind === 'human' ? os.qualified?.[id] === true || (undecided && aiWantsToResign(league, team, p)) : aiWantsToResign(league, team, p);
        if (qualify) {
          // He stays on his qualifying offer for now; offer sheets and arbitration follow.
          openRfaCase(league, team, p);
          room -= p.contract!.salary;
          continue;
        }
      }
      if (deal) {
        applyContract(league, p, deal);
        room -= deal.salary;
        resigned++;
        tx(league, 're-sign', teamId, p, `${nm(p)} re-signs: ${deal.years} yr × $${(deal.salary / 1e6).toFixed(2)}M${byAssistant ? ' (assistant GM; no decision was made)' : ''}`);
      } else {
        team.roster = team.roster.filter((x) => x !== id);
        p.teamId = null;
        p.contract = null;
        tx(league, 'departure', teamId, p, `${nm(p)} leaves as a free agent`);
      }
    }
  }
  // Depth players looking for work join the pool, then everyone gets an asking price.
  addFillerFreeAgents(league);
  for (const p of freeAgents(league)) os.freeAgentAsks[p.id] = askingContract(league, p);
  os.faRound = 1;
  os.bids = {};
  os.faLog = [];
  return resigned;
}

function addFillerFreeAgents(league: League) {
  const rng = new Rng(deriveSeed(league.seed, `fa-filler:${league.season}`));
  const have = freeAgents(league);
  const counts = { F: have.filter(isF).length, D: have.filter((p) => p.pos === 'D').length, G: have.filter((p) => p.pos === 'G').length };
  const want = { F: 45, D: 25, G: 10 };
  let n = 0;
  for (const [g, target] of Object.entries(want) as Array<['F' | 'D' | 'G', number]>) {
    for (let i = counts[g]; i < target; i++) {
      const pos = g === 'F' ? rng.pick(['C', 'LW', 'RW'] as const) : g;
      // Journeyman goalies are a little better than journeyman skaters: every team needs two.
      const p = generatePlayer(rng, pos, pos === 'G' ? rng.normal(64, 3) : rng.normal(59, 3.5), league.season + 1, rng.int(23, 31));
      p.id = `f${league.season}-${n++}`;
      p.contract = null;
      p.teamId = null;
      league.players[p.id] = p;
    }
  }
}

// ---- Free agency ----

export const FA_ROUNDS = 3;

export function signFreeAgent(league: League, team: Team, p: Player, offer = league.offseason?.freeAgentAsks[p.id]) {
  if (!offer) throw new Error('No asking price for that player');
  applyContract(league, p, offer);
  p.teamId = team.id;
  team.roster.push(p.id);
  if (league.offseason) delete league.offseason.freeAgentAsks[p.id];
  tx(league, 'signing', team.id, p, `Signs ${nm(p)} (${p.pos}, ${overall(p)} OVR): ${offer.years} yr × $${(offer.salary / 1e6).toFixed(2)}M`);
}

/** A human (or AI) team's sealed bid for this round. Replaces any earlier bid on the same player. */
export function placeBid(league: League, team: Team, p: Player, offer: ContractOffer) {
  const os = league.offseason;
  if (!os || os.stage !== 'free-agency') throw new Error('Bids are only taken during free agency');
  if (!isFreeAgent(league, p)) throw new Error('That player is not a free agent');
  if (offer.years < 1 || offer.years > 8) throw new Error('Contracts run 1 to 8 years');
  if (offer.salary < LEAGUE_MIN_SALARY) throw new Error('Offer is below the league minimum');
  if (offer.salary > capRoom(league, team)) throw new Error('Not enough cap room for that offer');
  ((os.bids ??= {})[team.id] ??= {})[p.id] = offer;
}

export function withdrawBid(league: League, team: Team, playerId: PlayerId) {
  delete league.offseason?.bids?.[team.id]?.[playerId];
}

const TARGET = { F: 14, D: 8, G: 2 };
const DRESSED = { F: 12, D: 6, G: 1 };

/** Position groups where a team is short of bodies or has a weak link a free agent could replace. */
function aiNeeds(league: League, team: Team): Array<'F' | 'D' | 'G'> {
  const roster = team.roster.map((id) => league.players[id]);
  const pool = freeAgents(league);
  return (['G', 'D', 'F'] as const).filter((g) => {
    const mine = roster.filter((p) => group(p) === g).map(overall).sort((a, b) => b - a);
    if (mine.length < TARGET[g]) return true;
    const weakest = mine[DRESSED[g] - 1] ?? 0;
    return pool.some((p) => group(p) === g && overall(p) >= weakest + 4);
  });
}

function belowFloor(league: League, team: Team): boolean {
  return payroll(league, team) < league.settings.salaryFloor;
}

function aiBids(league: League, rng: Rng) {
  const os = league.offseason!;
  for (const team of rng.shuffle(Object.values(league.teams).filter((t) => t.controller.kind === 'ai'))) {
    if (team.roster.length >= SUMMER_ROSTER_MAX - 2) continue;
    const needs = aiNeeds(league, team);
    if (!needs.length) continue;
    // Teams under the salary floor overpay to get there (bad teams have to).
    const gap = Math.max(0, league.settings.salaryFloor - payroll(league, team));
    const floorBoost = 1 + Math.min(0.6, (gap / league.settings.salaryCap) * 2.5);
    const maxBids = gap > 0 ? 5 : 3;
    let room = capRoom(league, team) - 1_000_000 * Math.max(0, ROSTER_MAX - team.roster.length - 2);
    // Spread interest around: each team looks at a weighted random slice of the
    // affordable players it needs, favoring the better ones.
    const candidates = freeAgents(league).filter((p) => needs.includes(group(p)) && (os.freeAgentAsks[p.id]?.salary ?? Infinity) <= room);
    const pool: Player[] = [];
    while (pool.length < 6 && candidates.length) {
      const i = rng.weighted(candidates.map((p) => Math.exp((overall(p) - 65) / 6)));
      pool.push(candidates.splice(i, 1)[0]);
    }
    let made = 0;
    for (const p of pool) {
      if (made >= maxBids) break;
      const base = os.freeAgentAsks[p.id];
      if (!base) continue;
      const ask = askFromTeam(league, p, team, base);
      // Teams bid around his ask from them, up to what they think he's worth (a bit more for a real need).
      const value = aiValuation(league, team, p) * 1.1 * floorBoost;
      const salary = Math.min(value, Math.max(ask.salary * rng.normal(1.03, 0.06) * floorBoost, LEAGUE_MIN_SALARY));
      const offer = { salary: Math.round(salary / 25_000) * 25_000, years: ask.years };
      if (offer.salary > room || offer.salary < LEAGUE_MIN_SALARY) continue;
      ((os.bids ??= {})[team.id] ??= {})[p.id] = offer;
      room -= offer.salary;
      made++;
    }
  }
}

/**
 * Resolve one blind-bidding round. Every free agent looks at all the offers
 * he got (humans' and AI teams') and signs with the best one if it clears his
 * bar, which drops a little each round. Stars choose first.
 */
export function resolveFreeAgencyRound(league: League): FaResult[] {
  const os = league.offseason!;
  const round = os.faRound ?? 1;
  const rng = new Rng(deriveSeed(league.seed, `fa-round:${league.season}:${round}`));
  aiBids(league, rng);
  const bids = os.bids ?? {};
  const results: FaResult[] = [];
  const players = freeAgents(league).sort((a, b) => overall(b) - overall(a));
  for (const p of players) {
    const offers = Object.entries(bids)
      .filter(([, b]) => b[p.id])
      .map(([teamId, b]) => ({ team: league.teams[teamId], offer: b[p.id] }));
    if (!offers.length) continue;
    const ask = os.freeAgentAsks[p.id] ?? askingContract(league, p);
    const valid = offers.filter(
      ({ team, offer }) => offer.salary <= capRoom(league, team) && team.roster.length < SUMMER_ROSTER_MAX,
    );
    let best: (typeof valid)[number] | null = null;
    let bestU = -Infinity;
    for (const o of valid) {
      const u = offerUtility(league, p, o.team, o.offer, ask) + rng.next() * 1e-6;
      if (u > bestU) {
        bestU = u;
        best = o;
      }
    }
    const bar = 1 - (round - 1) * 0.06;
    if (best && bestU >= bar) {
      signFreeAgent(league, best.team, p, best.offer);
      const r = { round, playerId: p.id, teamId: best.team.id, offer: best.offer, bidders: offers.length };
      results.push(r);
    }
  }
  (os.faLog ??= []).push(...results);
  os.bids = {};
  os.faRound = round + 1;
  // Unsigned players come down a bit.
  for (const ask of Object.values(os.freeAgentAsks)) {
    ask.salary = Math.max(LEAGUE_MIN_SALARY, Math.round((ask.salary * 0.88) / 25_000) * 25_000);
  }
  return results;
}

/** After the bidding rounds, AI teams fill any remaining holes at asking price. */
function aiFreeAgency(league: League): number {
  const os = league.offseason!;
  const rng = new Rng(deriveSeed(league.seed, `fa:${league.season}`));
  let signed = 0;
  for (let round = 0; round < 4; round++) {
    const teams = rng.shuffle(Object.values(league.teams).filter((t) => t.controller.kind === 'ai'));
    for (const team of teams) {
      const roster = team.roster.map((id) => league.players[id]);
      const short = (['G', 'D', 'F'] as const).find((g) => roster.filter((p) => group(p) === g).length < TARGET[g]);
      // Teams under the salary floor have to spend: take the best upgrade available.
      const need = short ?? (belowFloor(league, team) ? aiNeeds(league, team)[0] : undefined);
      if (!need || team.roster.length >= ROSTER_MAX + 2) continue;
      const room = capRoom(league, team) - 1_500_000 * Math.max(0, ROSTER_MAX - team.roster.length - 1);
      const strategy = team.controller.kind === 'ai' ? team.controller.strategy : 'balanced';
      const weakest = roster.filter((p) => group(p) === need).map(overall).sort((a, b) => b - a)[DRESSED[need] - 1] ?? 0;
      const pool = freeAgents(league).filter(
        (p) => group(p) === need && (os.freeAgentAsks[p.id]?.salary ?? Infinity) <= room && (short || overall(p) > weakest),
      );
      if (!pool.length) continue;
      const value = (p: Player) => {
        const a = age(p, league.season) + 1;
        return overall(p) + (strategy === 'rebuild' ? Math.max(0, 27 - a) * 0.4 : 0) - (strategy === 'rebuild' && a >= 31 ? 3 : 0);
      };
      const best = pool.reduce((a, b) => (value(b) > value(a) ? b : a));
      signFreeAgent(league, team, best);
      signed++;
    }
    for (const ask of Object.values(os.freeAgentAsks)) {
      ask.salary = Math.max(LEAGUE_MIN_SALARY, Math.round((ask.salary * 0.8) / 25_000) * 25_000);
      ask.years = Math.min(ask.years, 2);
    }
  }
  return signed;
}

// ---- Extensions (in season or during the summer) ----

/** Players who can be extended now: in the final year of their deal, or expiring this summer. */
export function canExtend(league: League, p: Player): boolean {
  if (!p.contract || !p.teamId) return false;
  if (league.phase === 'offseason') {
    const stage = league.offseason?.stage;
    if (stage === 'free-agency' && openCase(league, p.id)?.teamId === p.teamId) return true; // RFA still unsigned
    return !!league.offseason?.expiring[p.id] && (stage === 'draft' || stage === 're-sign' || !league.offseason);
  }
  return p.contract.yearsLeft === 1;
}

/** Negotiate an extension/re-signing. On acceptance the deal is stored on the player. */
export function offerExtension(league: League, team: Team, p: Player, offer: ContractOffer): OfferResult {
  if (p.teamId !== team.id) throw new Error('Not your player');
  if (!canExtend(league, p)) throw new Error('He is not eligible for an extension right now');
  if (p.extension) throw new Error('He has already agreed to a new deal');
  // Committed money next season, not counting this player's current deal.
  const nextYear = team.roster
    .filter((id) => id !== p.id)
    .map((id) => league.players[id])
    .filter((x) => x.contract && (x.contract.yearsLeft > 1 || x.extension))
    .reduce((s, x) => s + (x.extension?.salary ?? x.contract!.salary), 0);
  const rfaCase = openCase(league, p.id);
  if (rfaCase) {
    // Unsigned RFA during free agency: his qualifying offer is already on the books.
    if (offer.salary > capRoom(league, team) + p.contract!.salary) throw new Error('Not enough cap room for that deal');
  } else if (nextYear + offer.salary > league.settings.salaryCap) throw new Error('That deal would put you over next season’s cap');
  const ask = league.offseason?.expiring[p.id] ?? askingContract(league, p);
  const r = respondToOffer(league, p, team, offer, { ask });
  if (r.result === 'accept' && rfaCase) {
    applyContract(league, p, offer);
    settleRfaCase(league, p);
    tx(league, 're-sign', team.id, p, `${nm(p)} re-signs: ${offer.years} yr × $${(offer.salary / 1e6).toFixed(2)}M`);
  } else if (r.result === 'accept') {
    p.extension = offer;
    tx(league, 'extension', team.id, p, `${nm(p)} agrees to a new deal: ${offer.years} yr × $${(offer.salary / 1e6).toFixed(2)}M`);
  }
  return r;
}

/**
 * Negotiate with an unsigned free agent in training camp or during the season
 * (after the bidding rounds). `base` is his current asking price. On acceptance
 * he signs immediately; the caller checks cap room and roster size first.
 */
export function negotiateFreeAgent(league: League, team: Team, p: Player, offer: ContractOffer, base: ContractOffer): OfferResult {
  if (!isFreeAgent(league, p)) throw new Error('That player is not a free agent');
  if (league.phase === 'offseason' && league.offseason?.stage !== 'training-camp') throw new Error('Free agents can be signed directly in training camp or during the season');
  if (offer.salary > capRoom(league, team)) throw new Error('Not enough cap room for that offer');
  // Leftover free agents are running out of options, so they're a bit easier to sign.
  const r = respondToOffer(league, p, team, offer, { ask: base, faRound: 2 });
  if (r.result === 'accept') signFreeAgent(league, team, p, offer);
  return r;
}

// ---- Prospects & camp ----

export function promoteProspect(league: League, team: Team, p: Player) {
  if (p.prospectOf !== team.id) throw new Error('Not one of your prospects');
  team.prospects = (team.prospects ?? []).filter((id) => id !== p.id);
  p.prospectOf = undefined;
  p.teamId = team.id;
  p.contract = { salary: ELC_SALARY, yearsLeft: 3, kind: 'ELC', expiresAs: 'RFA' };
  team.roster.push(p.id);
  tx(league, 'promotion', team.id, p, `${nm(p)} (${p.pos}, ${overall(p)} OVR, age ${age(p, league.season + (league.phase === 'offseason' ? 1 : 0))}) signs his entry-level deal and joins the roster`);
}

/** Send a young player on an entry-level deal back to the prospect pool. */
export function demoteToProspects(league: League, team: Team, p: Player) {
  if (p.teamId !== team.id) throw new Error('Not on your roster');
  if (p.contract?.kind !== 'ELC' && age(p, league.season) > 22) throw new Error('Only young players on entry-level deals can be sent down');
  team.roster = team.roster.filter((id) => id !== p.id);
  (team.prospects ??= []).push(p.id);
  p.teamId = null;
  p.prospectOf = team.id;
  p.contract = null;
  tx(league, 'send-down', team.id, p, `${nm(p)} sent down to develop`);
}

export function releasePlayer(league: League, team: Team, p: Player) {
  const onRoster = p.teamId === team.id;
  const isProspect = p.prospectOf === team.id;
  if (!onRoster && !isProspect) throw new Error('Not your player');
  const buyout = onRoster ? buyoutTerms(league, p) : null;
  if (buyout && buyout.perSeason > 0) {
    const from = capSeason(league);
    (team.deadCap ??= []).push({ playerName: nm(p), amount: buyout.perSeason, fromSeason: from, untilSeason: from + buyout.seasons - 1 });
    tx(league, 'buyout', team.id, p, `${nm(p)} bought out: $${(buyout.perSeason / 1e6).toFixed(2)}M dead cap for ${buyout.seasons} seasons`);
  }
  delete p.extension;
  team.roster = team.roster.filter((id) => id !== p.id);
  team.prospects = (team.prospects ?? []).filter((id) => id !== p.id);
  p.teamId = null;
  p.prospectOf = undefined;
  p.contract = null;
  if (league.offseason) league.offseason.freeAgentAsks[p.id] = askingContract(league, p);
  tx(league, 'release', team.id, p, `${nm(p)} released`);
}

function trainingCamp(league: League) {
  for (const team of Object.values(league.teams)) {
    const human = team.controller.kind === 'human';
    const prospects = () => (team.prospects ?? []).map((id) => league.players[id]).filter(Boolean);
    const roster = () => team.roster.map((id) => league.players[id]);

    if (!human) {
      // Promote prospects who'd crack the lineup (weakest dressed at their position + 1).
      for (const p of prospects().sort((a, b) => overall(b) - overall(a))) {
        const peers = roster().filter((x) => group(x) === group(p)).map(overall).sort((a, b) => b - a);
        const need = p.pos === 'G' ? 2 : p.pos === 'D' ? 6 : 12;
        const bar = peers[need - 1] ?? 0;
        if (age(p, league.season + 1) >= 19 && overall(p) >= bar + 1) promoteProspect(league, team, p);
      }
    }
    // Prospects who aged out without a contract become free agents.
    for (const p of prospects()) if (age(p, league.season + 1) >= 23) releasePlayer(league, team, p);
    // Keep at most PROSPECT_MAX prospects (drop the weakest).
    const extra = prospects().sort((a, b) => a.hidden.potential - b.hidden.potential).slice(0, Math.max(0, prospects().length - PROSPECT_MAX));
    for (const p of extra) releasePlayer(league, team, p);

    // Cut down to the roster limit: young ELC players go down, everyone else is released.
    const keepCounts = { F: 12, D: 6, G: 2 };
    while (team.roster.length > ROSTER_MAX) {
      const r = roster();
      const counts = { F: r.filter(isF).length, D: r.filter((p) => p.pos === 'D').length, G: r.filter((p) => p.pos === 'G').length };
      const cuttable = r.filter((p) => counts[group(p)] > keepCounts[group(p)]).sort((a, b) => overall(a) - overall(b));
      const cut = cuttable[0];
      if (!cut) break;
      if (cut.contract?.kind === 'ELC' && age(cut, league.season + 1) <= 22) demoteToProspects(league, team, cut);
      else releasePlayer(league, team, cut);
    }
  }
}

// ---- New season ----

function startNewSeason(league: League) {
  // Purge retired players and the long tail of unwanted free agents.
  for (const id of Object.keys(league.retired ?? {})) delete league.players[id];
  const fa = freeAgents(league).sort((a, b) => overall(b) - overall(a));
  for (const p of fa.slice(120)) delete league.players[p.id];

  closeBooks(league);
  offseasonStaff(league);
  league.season += 1;
  league.day = 0;
  league.phase = 'regular-season';
  league.playoffs = null;
  league.awards = {};
  league.skaterStats = {};
  league.goalieStats = {};
  league.playoffSkaterStats = {};
  league.playoffGoalieStats = {};
  league.offseason = null;
  for (const t of Object.values(league.teams)) if (t.deadCap) t.deadCap = t.deadCap.filter((d) => d.untilSeason >= league.season);
  league.negotiations = {};
  league.settings.salaryCap = Math.round((league.settings.salaryCap * CAP_GROWTH) / 100_000) * 100_000;
  league.settings.salaryFloor = Math.round((league.settings.salaryFloor * CAP_GROWTH) / 100_000) * 100_000;
  if (league.transactions.length > 1500) league.transactions = league.transactions.slice(-1500);

  // A summer heals most injuries.
  for (const p of Object.values(league.players)) {
    if (!p.injury) continue;
    p.injury.daysLeft -= 110;
    if (p.injury.daysLeft <= 0) p.injury = null;
  }

  for (const team of Object.values(league.teams)) {
    ensureBodies(league, team);
    const valid = [...team.lines.forwards.flat(), ...team.lines.defense.flat(), ...team.lines.goalies].every(
      (id) => league.players[id]?.teamId === team.id,
    );
    if (team.controller.kind === 'ai' || team.autoLines || !valid) team.lines = autoLines(healthyRoster(league, team));
  }
  league.schedule = buildSchedule(Object.values(league.teams), new Rng(deriveSeed(league.seed, `schedule:${league.season}`)));
  setOwnerGoals(league);
  if (league.newsState) league.newsState.streaks = {};
}

