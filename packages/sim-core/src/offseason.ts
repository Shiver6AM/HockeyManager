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
import { offseasonScouts } from './scouting';
import { assignToFarm, needsWaivers } from './waivers';
import { proSeasons } from './prospects';
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
  defaultTwoWay,
  minorSalaryOf,
} from './contracts';
import { aiValuation, askFromTeam, offerUtility, respondToOffer, type OfferResult } from './negotiation';
import { aiWouldQualify, holdArbitration, openCase, openRfaCase, resolveOfferSheets, settlePending, settleRfaCase } from './rfa';
import { developPlayer, retirementChance } from './development';
import { createDraft, ensureDraftClass, holdLottery, resetDraftClock, runDraft, scoutedPotential, startDraftClock } from './draft';
import { generatePlayer, talentStats } from './generate';
import { autoLines } from './lines';
import { age, overall } from './ratings';
import { deriveSeed, Rng } from './rng';
import { aiRosterMoves, ensureBodies, freeAgents, healthyRoster, isFreeAgent } from './roster';
import { standings } from './league';
import { closeBooks, newFinances, setOwnerGoals } from './finances';
import { fantasyOnClock, finishFantasy, runFantasy } from './start';
import { addNews, considerForHallOfFame, newsFromTransactions } from './news';
import { offseasonSkillsCoaches } from './skills';
import { affiliateLabel, capHit, CONTRACT_MAX, contractCount, FARM_TARGET, farmRoster, nhlRoster, sendDown, trimContracts } from './farm';
import { offseasonStaff } from './staff';
import { buildSchedule } from './schedule';
import type { CareerLine, ContractOffer, FaHoldout, FaResult, League, OffseasonStage, Player, PlayerId, StandingsRow, Team, TeamId } from './types';
import { slider } from './sliders';

export const OFFSEASON_STAGES: OffseasonStage[] = ['draft', 're-sign', 'free-agency', 'training-camp'];
export const STAGE_LABELS: Record<OffseasonStage, string> = {
  'fantasy-draft': 'Fantasy draft',
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
    const minor = league.prospectStats?.[p.id] ?? null;
    if (!sk && !g && !p.teamId && !minor) continue;
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
    if (minor && minor.gp > 0) {
      line.minor = minor;
      line.orgId = p.prospectOf ?? p.teamId ?? null;
    }
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
  const pro = proSeasons(career).length;
  if (teamId && (overall(p) >= 68 || pro >= 8)) {
    tx(league, 'retirement', teamId, p, `${nm(p)} retires after ${pro} season${pro === 1 ? '' : 's'} (age ${age(p, league.season)})`);
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
    if (league.retired?.[p.id] || p.draftClass !== undefined) continue;
    const s = league.skaterStats[p.id];
    const g = league.goalieStats[p.id];
    const gp = s?.gp ?? g?.gp ?? 0;
    development[p.id] = developPlayer(league, p, { gp, toi: s && s.gp ? s.toi / s.gp / 60 : 0, onRoster: rostered.has(p.id) && !p.farm });
  }

  // Keep league-wide talent anchored (see LeagueSettings.talentAnchor).
  anchorTalent(league);

  // Sleepers who've broken out: late picks nobody saw coming.
  for (const p of Object.values(league.players)) {
    if (!p.hidden.sleeper || p.hidden.sleeper < 0 || !p.draft || p.draft.round < 2 || overall(p) < 70) continue;
    const team = p.teamId ?? p.prospectOf;
    addNews(
      league,
      'milestone',
      `Sleeper alert: ${nm(p)}, a round-${p.draft.round} pick (#${p.draft.overall}) in ${p.draft.season}, has broken out (${overall(p)} OVR at ${age(p, league.season + 1)})`,
      team ? [team] : [],
      [p.id],
    );
    p.hidden.sleeper = -p.hidden.sleeper; // announced once (a negative value masks nothing)
  }

  // Retirements.
  const rng = new Rng(deriveSeed(league.seed, `retire:${league.season}`));
  for (const p of Object.values(league.players)) {
    if (league.retired?.[p.id] || p.draftClass !== undefined) continue;
    const signed = !!p.contract || !!p.prospectOf;
    const contractLeft = p.contract && p.contract.yearsLeft > 1;
    const chance = Math.min(1, retirementChance(p, age(p, league.season) + 1, signed) * (contractLeft ? 0.5 : 1) * slider(league, 'retirement'));
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

  const { state: draft, prospects } = createDraft(league, st, league.season, { lotteryPending: true });
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
  // The lottery is drawn next, then the draft runs on the clock (or is simmed).
}

/**
 * Nudge every rating with the same affine map so the league's top-N talent
 * keeps the mean and spread it had at creation. Overall is a weighted mean of
 * ratings, so this moves every overall by exactly the same map and keeps
 * everyone's relative standing intact.
 */
export function anchorTalent(league: League, strength = 0.6) {
  const set = league.settings;
  if (!set.talentAnchor || !set.talentSpread) return;
  // Older leagues: take today's talent as the per-position anchors from now on.
  if (!set.skaterAnchor || !set.goalieAnchor) {
    set.skaterAnchor = talentStats(league, 'skaters');
    set.goalieAnchor = talentStats(league, 'goalies');
    return;
  }
  const mapper = (which: 'skaters' | 'goalies', target: { mean: number; sd: number }) => {
    const { mean, sd } = talentStats(league, which);
    const newMean = mean + (target.mean - mean) * strength;
    const newSd = sd + (target.sd - sd) * strength;
    const scale = sd > 0 ? newSd / sd : 1;
    return (x: number) => newMean + (x - mean) * scale;
  };
  const skaterMap = mapper('skaters', set.skaterAnchor);
  const goalieMap = mapper('goalies', set.goalieAnchor);
  for (const p of Object.values(league.players)) {
    const map = p.pos === 'G' ? goalieMap : skaterMap;
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
export function offseasonStep(league: League, opts: { force: boolean; now?: number }): StepResult {
  const r = offseasonStepInner(league, opts);
  newsFromTransactions(league);
  return r;
}

function offseasonStepInner(league: League, opts: { force: boolean; now?: number }): StepResult {
  if (league.phase !== 'offseason') throw new Error('Not in the offseason');
  if (!league.offseason) {
    startOffseason(league, standings(league));
    return { from: 'review', to: 'draft', note: 'Players aged and developed; the draft is open' };
  }
  const os = league.offseason;
  const from = os.stage;
  switch (os.stage) {
    case 'fantasy-draft': {
      const made = runFantasy(league, { force: opts.force });
      if (fantasyOnClock(league)) return { from, to: 'fantasy-draft', note: `${made} fantasy picks made; a manager is on the clock` };
      const next = finishFantasy(league);
      return { from, to: next, note: 'The fantasy draft is complete' };
    }
    case 'draft': {
      const d = os.draft;
      // First the lottery (simmed: the result is shown at once).
      if (d.lotteryHeld === false) {
        holdLottery(league);
        return { from, to: 'draft', note: 'The draft lottery has been drawn' };
      }
      const now = opts.now ?? Date.now();
      if (!opts.force && !d.clock && d.current < d.picks.length) {
        // Not simmed: the draft runs on the clock, pick by pick.
        startDraftClock(league, now);
        return { from, to: 'draft', note: 'The draft is under way' };
      }
      // Simmed (or skipping ahead): AI teams pick until a manager is on the clock.
      const made = runDraft(league, { force: opts.force });
      if (d.current < d.picks.length) {
        if (d.clock) resetDraftClock(league, now);
        return { from, to: 'draft', note: `${made} picks made; a manager is on the clock` };
      }
      delete d.clock;
      finishDraft(league);
      answerPendingOffers(league);
      os.stage = 're-sign';
      os.resignDay = 1;
      aiResignDay(league, 1);
      return { from, to: 're-sign', note: `Draft complete. The re-signing week is open (day 1 of ${RESIGN_DAYS}).` };
    }
    case 're-sign': {
      // A week to re-sign your own pending free agents. Offers made today are answered tomorrow.
      const day = os.resignDay ?? RESIGN_DAYS;
      if (day < RESIGN_DAYS) {
        os.resignDay = day + 1;
        answerPendingOffers(league);
        aiResignDay(league, day + 1);
        return { from, to: 're-sign', note: `Re-signing week: day ${day + 1} of ${RESIGN_DAYS}` };
      }
      answerPendingOffers(league, true);
      const n = finishResigning(league);
      os.stage = 'free-agency';
      return { from, to: 'free-agency', note: `${n} players re-signed` };
    }
    case 'free-agency': {
      const day = faDayOf(os);
      // RFA offer sheets are settled every day and decided every few days.
      if (day % 3 === 0) resolveOfferSheets(league, day / 3);
      else settlePending(league);
      const { signed, holdouts } = resolveFreeAgencyDay(league);
      if (day < FA_DAYS) {
        return { from, to: 'free-agency', note: `Free agency day ${day} of ${FA_DAYS}: ${signed.length} signed${holdouts.length ? `, ${holdouts.length} turned down every offer` : ''}` };
      }
      holdArbitration(league);
      const n = aiFreeAgency(league);
      os.stage = 'training-camp';
      return { from, to: 'training-camp', note: `Free agency closes: ${signed.length} signed on the last day; ${n} more depth signings` };
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

export function finishDraft(league: League) {
  // Undrafted players go back to junior and out of the league's world.
  const drafted = new Set(league.offseason!.draft.picks.map((p) => p.playerId));
  for (const id of league.offseason!.draft.classIds) {
    if (drafted.has(id)) continue;
    delete league.players[id];
    delete league.careerStats?.[id];
  }
  league.draftClass = undefined;
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
  const yearsIn = proSeasons(league.careerStats?.[p.id] ?? []).length + 1;
  const twoWay = offer.twoWay ?? defaultTwoWay(p, offer.salary);
  p.contract = {
    salary: offer.salary,
    yearsLeft: offer.years,
    kind: 'standard',
    expiresAs: expiresAsFor(age(p, league.season) + 1 + offer.years, yearsIn + offer.years),
    twoWay,
  };
  if (twoWay) p.contract.minorSalary = minorSalaryOf(p.contract);
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

/** A player's cap hit next season (farm players count only above the burying exemption). */
const nextSeasonHit = (x: Player) => capHit(x.extension ? { ...x, contract: { ...x.contract!, salary: x.extension.salary } } : x);

// ---- The re-signing week: offers are answered the next day ----

export const RESIGN_DAYS = 7;

/** Offers during the draft and the re-signing week are answered the next day. */
export function offersAreDeferred(league: League): boolean {
  const stage = league.offseason?.stage;
  return league.phase === 'offseason' && (stage === 'draft' || stage === 're-sign');
}

/** Make an offer to one of your expiring players; he answers on the next day. */
export function submitResignOffer(league: League, team: Team, p: Player, offer: ContractOffer): { message: string } {
  if (!offersAreDeferred(league)) throw new Error('Offers are answered on the spot right now');
  if (p.teamId !== team.id) throw new Error('Not your player');
  if (!canExtend(league, p)) throw new Error('He is not eligible for a new deal right now');
  if (p.extension) throw new Error('He has already agreed to a new deal');
  if (offer.years < 1 || offer.years > 8) throw new Error('Contracts run 1 to 8 years');
  if (offer.salary < LEAGUE_MIN_SALARY) throw new Error('Offer is below the league minimum');
  checkNextSeasonCap(league, team, p, offer);
  const neg = league.negotiations?.[p.id];
  if (neg && neg.teamId === team.id && neg.season === league.season && neg.attempts >= 3) {
    throw new Error(`${p.lastName}'s camp has stopped taking calls. He'll see what the market says.`);
  }
  const os = league.offseason!;
  (os.pendingOffers ??= {})[p.id] = { teamId: team.id, offer, madeOn: os.resignDay ?? 0 };
  return { message: `Offer sent to ${p.firstName} ${p.lastName}'s agent. Expect an answer tomorrow.` };
}

export function withdrawResignOffer(league: League, team: Team, playerId: PlayerId) {
  const pend = league.offseason?.pendingOffers?.[playerId];
  if (pend?.teamId === team.id) delete league.offseason!.pendingOffers![playerId];
}

/** Accept the counter-offer a player came back with: he proposed it, so it's a deal. */
export function acceptCounter(league: League, team: Team, p: Player) {
  const os = league.offseason;
  const resp = os?.responses?.[p.id];
  if (!resp || resp.teamId !== team.id || resp.result !== 'counter' || !resp.counter) throw new Error('There is no counter-offer to accept');
  if (!canExtend(league, p) || p.extension) throw new Error('He is no longer available on those terms');
  checkNextSeasonCap(league, team, p, resp.counter);
  p.extension = resp.counter;
  tx(league, 'extension', team.id, p, `${nm(p)} agrees to a new deal: ${resp.counter.years} yr × $${(resp.counter.salary / 1e6).toFixed(2)}M`);
  os!.responses![p.id] = { ...resp, result: 'accept', offer: resp.counter, counter: undefined, message: `${p.lastName} accepts: ${resp.counter.years} yr × $${(resp.counter.salary / 1e6).toFixed(2)}M.` };
}

function checkNextSeasonCap(league: League, team: Team, p: Player, offer: ContractOffer) {
  const nextYear = team.roster
    .filter((id) => id !== p.id)
    .map((id) => league.players[id])
    .filter((x) => x.contract && (x.contract.yearsLeft > 1 || x.extension))
    .reduce((s, x) => s + nextSeasonHit(x), 0);
  if (nextYear + offer.salary > league.settings.salaryCap) throw new Error('That deal would put you over next season’s cap');
}

/**
 * The morning after: every player with an offer on the table answers it. Close
 * offers sometimes take an extra day. On the last day everyone answers.
 */
function answerPendingOffers(league: League, lastDay = false) {
  const os = league.offseason!;
  const pending = os.pendingOffers ?? {};
  const day = os.resignDay ?? 0;
  const rng = new Rng(deriveSeed(league.seed, `answers:${league.season}:${day}`));
  for (const id of Object.keys(pending).sort()) {
    const pend = pending[id];
    const p = league.players[id];
    const team = league.teams[pend.teamId];
    if (!p || !team || p.teamId !== team.id || p.extension || !canExtend(league, p)) {
      delete pending[id];
      continue;
    }
    // Close calls: he sleeps on it once in a while (never on the final day).
    const u = offerUtility(league, p, team, pend.offer, os.expiring[p.id]);
    if (!lastDay && !pend.delayed && u >= 0.9 && u < 1.05 && rng.chance(0.3)) {
      pend.delayed = true;
      (os.responses ??= {})[id] = { teamId: team.id, offer: pend.offer, day, result: 'considering', message: `${p.lastName}'s agent says he's thinking it over. Expect an answer tomorrow.` };
      continue;
    }
    delete pending[id];
    let r: OfferResult;
    try {
      r = offerExtension(league, team, p, pend.offer);
    } catch (e) {
      r = { result: 'refuse', message: (e as Error).message };
    }
    (os.responses ??= {})[id] = {
      teamId: team.id,
      offer: pend.offer,
      day,
      result: r.result,
      counter: r.result === 'counter' ? r.counter : undefined,
      message: r.message,
    };
  }
}

/** AI teams work through their own pending free agents during the week, a few each day. */
function aiResignDay(league: League, day: number) {
  const os = league.offseason!;
  const decided = (os.aiDecided ??= {});
  for (const team of Object.values(league.teams)) {
    if (team.controller.kind !== 'ai') continue;
    const mine = Object.keys(os.expiring)
      .map((id) => league.players[id])
      .filter((p) => p && p.teamId === team.id && !p.extension && !decided[p.id]);
    // Spread decisions over the week; the best players are settled first.
    const today = mine
      .sort((a, b) => overall(b) - overall(a))
      .filter((p, i) => day >= RESIGN_DAYS || i % RESIGN_DAYS < day || deriveSeed(league.seed, `aiday:${p.id}`) % RESIGN_DAYS < day);
    for (const p of today) {
      decided[p.id] = true;
      if (p.contract?.expiresAs === 'RFA') continue; // qualifying offers are settled when free agency opens
      const room = capRoom(league, team) + Object.keys(os.expiring).filter((x) => league.players[x]?.teamId === team.id && !league.players[x].extension).reduce((s, x) => s + (league.players[x].contract?.salary ?? 0), 0);
      const deal = aiResign(league, team, p, room);
      if (deal) {
        p.extension = deal;
        tx(league, 'extension', team.id, p, `${nm(p)} re-signs: ${deal.years} yr × $${(deal.salary / 1e6).toFixed(2)}M`);
      }
    }
  }
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
      else if (team.controller.kind === 'ai') deal = os.aiDecided?.[id] && !isRfa ? null : aiResign(league, team, p, room);
      // Human managers who never got to a player: the assistant GM handles him like
      // an AI team would. An explicit "let go" is always respected.
      else if (os.resign[id] === undefined && !os.qualified?.[id] && !negotiated(league, p, teamId)) {
        deal = aiResign(league, team, p, room);
        byAssistant = !!deal;
      }
      if (!deal && isRfa) {
        // Humans qualify explicitly; an undecided manager's assistant GM qualifies like an AI would.
        const undecided = os.resign[id] === undefined && !negotiated(league, p, teamId);
        // Qualifying is cheap: keep the rights to anyone useful, and to young players with upside.
        const upside = age(p, league.season) + 1 <= 24 && scoutedPotential(league, team.id, p) >= 66;
        const aiWould = (aiWantsToResign(league, team, p) || upside || overall(p) >= 64) && aiWouldQualify(league, team, p);
        const qualify = team.controller.kind === 'human' ? os.qualified?.[id] === true || (undecided && aiWould) : aiWould;
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
        tx(league, 'departure', teamId, p, isRfa ? `${nm(p)} is not qualified and becomes an unrestricted free agent` : `${nm(p)} leaves as a free agent`);
      }
    }
  }
  // Depth players looking for work join the pool, then everyone gets an asking price.
  addFillerFreeAgents(league);
  for (const p of freeAgents(league)) os.freeAgentAsks[p.id] = askingContract(league, p);
  os.faDay = 1;
  os.faRound = undefined;
  os.bids = {};
  os.faClock = {};
  os.faHoldouts = {};
  os.faLog = [];
  os.faHoldoutLog = [];
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

/** Free agency lasts this many days; then AI teams fill their holes and camp opens. */
export const FA_DAYS = 10;
/** A free agent listens to offers for this many days (from the first one) before he decides. */
export const FA_LISTEN_DAYS: readonly [number, number] = [3, 5];

/** Today's free agency day (older saves ran in three rounds). */
export function faDayOf(os: NonNullable<League['offseason']>): number {
  if (os.faDay === undefined) os.faDay = ((os.faRound ?? 1) - 1) * 3 + 1;
  return os.faDay;
}

/** Start a free agent's listening period when his first offer arrives. */
function startClock(league: League, p: Player) {
  const os = league.offseason!;
  const clock = (os.faClock ??= {});
  if (clock[p.id] !== undefined) return;
  const n = os.faHoldouts?.[p.id] ?? 0;
  const rng = new Rng(deriveSeed(league.seed, `fa-listen:${league.season}:${p.id}:${n}`));
  clock[p.id] = Math.min(FA_DAYS, faDayOf(os) + rng.int(FA_LISTEN_DAYS[0], FA_LISTEN_DAYS[1]));
}

/** Days until a free agent decides (0 = today), or null if nobody has made him an offer. */
export function faDecidesIn(league: League, playerId: PlayerId): number | null {
  const os = league.offseason;
  const due = os?.faClock?.[playerId];
  if (!os || due === undefined) return null;
  return Math.max(0, due - faDayOf(os));
}

export function signFreeAgent(league: League, team: Team, p: Player, offer = league.offseason?.freeAgentAsks[p.id]) {
  if (!offer) throw new Error('No asking price for that player');
  applyContract(league, p, offer);
  p.teamId = team.id;
  team.roster.push(p.id);
  if (league.offseason) {
    delete league.offseason.freeAgentAsks[p.id];
    delete league.offseason.faClock?.[p.id];
    for (const b of Object.values(league.offseason.bids ?? {})) delete b[p.id];
  }
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
  startClock(league, p);
}

export function withdrawBid(league: League, team: Team, playerId: PlayerId) {
  delete league.offseason?.bids?.[team.id]?.[playerId];
}

const TARGET = { F: 14, D: 8, G: 2 };
const DRESSED = { F: 12, D: 6, G: 1 };

/** Position groups where a team is short of bodies or has a weak link a free agent could replace. */
function aiNeeds(league: League, team: Team): Array<'F' | 'D' | 'G'> {
  const roster = nhlRoster(league, team);
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

function aiBids(league: League, rng: Rng, day: number) {
  const os = league.offseason!;
  for (const team of rng.shuffle(Object.values(league.teams).filter((t) => t.controller.kind === 'ai'))) {
    // Every front office is on the phones on day one, then checks in every few days.
    if (day > 1 && !rng.chance(0.5)) continue;
    if (nhlRoster(league, team).length >= SUMMER_ROSTER_MAX - 2 || contractCount(team) >= CONTRACT_MAX - 1) continue;
    const needs = aiNeeds(league, team);
    if (!needs.length) continue;
    const mine = ((os.bids ??= {})[team.id] ??= {});
    const out = Object.values(mine);
    // Teams under the salary floor overpay to get there (bad teams have to).
    const gap = Math.max(0, league.settings.salaryFloor - payroll(league, team));
    const floorBoost = 1 + Math.min(0.6, (gap / league.settings.salaryCap) * 2.5);
    const maxBids = gap > 0 ? 7 : 5;
    let room = capRoom(league, team) - 1_000_000 * Math.max(0, ROSTER_MAX - nhlRoster(league, team).length - 2) - out.reduce((s, o) => s + o.salary, 0);
    // Spread interest around: each team looks at a weighted random slice of the
    // affordable players it needs, favoring the better ones.
    const candidates = freeAgents(league).filter((p) => !mine[p.id] && needs.includes(group(p)) && (os.freeAgentAsks[p.id]?.salary ?? Infinity) <= room);
    const pool: Player[] = [];
    while (pool.length < 6 && candidates.length) {
      const i = rng.weighted(candidates.map((p) => Math.exp((overall(p) - 65) / 6)));
      pool.push(candidates.splice(i, 1)[0]);
    }
    let made = out.length;
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
      mine[p.id] = offer;
      startClock(league, p);
      room -= offer.salary;
      made++;
    }
  }
}

/**
 * One day of free agency. AI teams make offers, then every free agent whose
 * listening period is up looks at everything on the table (humans' and AI
 * teams' sealed offers alike) and signs the best one if it clears his bar.
 * If nothing does, he turns them all down, lowers his sights and listens again.
 * Offers stand until he decides, so nobody wins by being online first: every
 * manager has at least three days to get an offer in. On the last day everyone
 * with an offer decides. Stars choose first.
 */
export function resolveFreeAgencyDay(league: League): { signed: FaResult[]; holdouts: FaHoldout[] } {
  const os = league.offseason!;
  const day = faDayOf(os);
  const last = day >= FA_DAYS;
  const rng = new Rng(deriveSeed(league.seed, `fa-day:${league.season}:${day}`));
  aiBids(league, rng, day);
  const bids = (os.bids ??= {});
  const clock = (os.faClock ??= {});
  const holdCount = (os.faHoldouts ??= {});
  const signed: FaResult[] = [];
  const holdouts: FaHoldout[] = [];
  const players = freeAgents(league).sort((a, b) => overall(b) - overall(a));
  for (const p of players) {
    const due = clock[p.id];
    if (due === undefined || (due > day && !last)) continue;
    delete clock[p.id];
    const offers = Object.entries(bids)
      .filter(([, b]) => b[p.id])
      .map(([teamId, b]) => ({ team: league.teams[teamId], offer: b[p.id] }));
    if (!offers.length) continue;
    const ask = os.freeAgentAsks[p.id] ?? askingContract(league, p);
    const valid = offers.filter(
      ({ team, offer }) =>
        offer.salary <= capRoom(league, team) &&
        contractCount(team) < CONTRACT_MAX &&
        // An AI team that has filled the hole since doesn't follow through.
        (team.controller.kind !== 'ai' || aiNeeds(league, team).includes(group(p))),
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
    if (!valid.length) {
      // Every team with an offer in has moved on (filled the spot or spent the money): he's back on the market.
      for (const b of Object.values(bids)) delete b[p.id];
      continue;
    }
    const n = holdCount[p.id] ?? 0;
    const bar = Math.max(0.8, 1 - 0.06 * n - 0.004 * (day - 1));
    if (best && bestU >= bar) {
      signFreeAgent(league, best.team, p, best.offer);
      signed.push({ round: day, playerId: p.id, teamId: best.team.id, offer: best.offer, bidders: offers.length });
    } else {
      // Nothing good enough: every offer comes off the table and he waits for better.
      holdouts.push({ day, playerId: p.id, teamIds: offers.map((o) => o.team.id) });
      for (const b of Object.values(bids)) delete b[p.id];
      holdCount[p.id] = n + 1;
      const a = os.freeAgentAsks[p.id];
      if (a) a.salary = Math.max(LEAGUE_MIN_SALARY, Math.round((a.salary * 0.9) / 25_000) * 25_000);
    }
  }
  (os.faLog ??= []).push(...signed);
  (os.faHoldoutLog ??= []).push(...holdouts);
  os.faDay = day + 1;
  // Players nobody is talking to come down a little each day.
  for (const [id, ask] of Object.entries(os.freeAgentAsks)) {
    if (clock[id] !== undefined) continue;
    ask.salary = Math.max(LEAGUE_MIN_SALARY, Math.round((ask.salary * 0.97) / 25_000) * 25_000);
  }
  return { signed, holdouts };
}

/** After the bidding rounds, AI teams fill any remaining holes at asking price. */
function aiFreeAgency(league: League): number {
  const os = league.offseason!;
  const rng = new Rng(deriveSeed(league.seed, `fa:${league.season}`));
  let signed = 0;
  for (let round = 0; round < 4; round++) {
    const teams = rng.shuffle(Object.values(league.teams).filter((t) => t.controller.kind === 'ai'));
    for (const team of teams) {
      const roster = nhlRoster(league, team);
      const short = (['G', 'D', 'F'] as const).find((g) => roster.filter((p) => group(p) === g).length < TARGET[g]);
      // Teams under the salary floor have to spend: take the best upgrade available.
      const need = short ?? (belowFloor(league, team) ? aiNeeds(league, team)[0] : undefined);
      if (!need || roster.length >= ROSTER_MAX + 2 || contractCount(team) >= CONTRACT_MAX) continue;
      const room = capRoom(league, team) - 1_500_000 * Math.max(0, ROSTER_MAX - roster.length - 1);
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
    .reduce((s, x) => s + nextSeasonHit(x), 0);
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
  p.contract = { salary: ELC_SALARY, yearsLeft: 3, kind: 'ELC', expiresAs: 'RFA', twoWay: true, minorSalary: 85_000 };
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
    const nhl = () => nhlRoster(league, team);

    if (!human) {
      // Promote prospects who'd crack the lineup (weakest dressed at their position + 1)...
      for (const p of prospects().sort((a, b) => overall(b) - overall(a))) {
        const peers = nhl().filter((x) => group(x) === group(p)).map(overall).sort((a, b) => b - a);
        const need = p.pos === 'G' ? 2 : p.pos === 'D' ? 6 : 12;
        const bar = peers[need - 1] ?? 0;
        if (age(p, league.season + 1) >= 19 && overall(p) >= bar + 1) promoteProspect(league, team, p);
        // ...and sign older ones with a future to the farm team.
        else if (age(p, league.season + 1) >= 20 && contractCount(team) < CONTRACT_MAX - 2 && scoutedPotential(league, team.id, p) >= 66) {
          signProspectToFarm(league, team, p);
        }
      }
    }
    // Prospects who aged out without a contract become free agents.
    for (const p of prospects()) if (age(p, league.season + 1) >= 23) releasePlayer(league, team, p);
    // Keep at most PROSPECT_MAX prospects (drop the weakest).
    const extra = prospects().sort((a, b) => a.hidden.potential - b.hidden.potential).slice(0, Math.max(0, prospects().length - PROSPECT_MAX));
    for (const p of extra) releasePlayer(league, team, p);

    // Cut the NHL roster to 23: extra players go to the farm team (keeping 12 F, 6 D, 2 G).
    const keepCounts = { F: 12, D: 6, G: 2 };
    while (nhl().length > ROSTER_MAX) {
      const r = nhl();
      const counts = { F: r.filter(isF).length, D: r.filter((p) => p.pos === 'D').length, G: r.filter((p) => p.pos === 'G').length };
      // Teams would rather send down someone who doesn't need waivers.
      const cost = (p: Player) => overall(p) + (needsWaivers(league, p) ? 1 : 0);
      const cut = r.filter((p) => counts[group(p)] > keepCounts[group(p)]).sort((a, b) => cost(a) - cost(b))[0];
      if (!cut) break;
      assignToFarm(league, team, cut);
    }
    // Too many contracts: the weakest farm players are released.
    trimContracts(league, team, (p) => releasePlayer(league, team, p));
    if (!human) {
      fillFarm(league, team);
      aiRosterMoves(league, team);
    }
  }
}

/** AI farm teams sign depth to field a lineup (league-minimum, two-way deals). */
function fillFarm(league: League, team: Team) {
  const farm = farmRoster(league, team);
  for (const g of ['G', 'D', 'F'] as const) {
    let have = farm.filter((p) => group(p) === g).length;
    while (have < FARM_TARGET[g] && contractCount(team) < CONTRACT_MAX - 1) {
      const pool = freeAgents(league).filter((p) => group(p) === g && !p.injury && age(p, league.season + 1) <= 30);
      if (!pool.length) break;
      const p = pool.reduce((a, b) => (overall(b) > overall(a) ? b : a));
      applyContract(league, p, { salary: LEAGUE_MIN_SALARY, years: 1 });
      p.teamId = team.id;
      p.farm = true;
      team.roster.push(p.id);
      if (league.offseason) delete league.offseason.freeAgentAsks[p.id];
      tx(league, 'signing', team.id, p, `Signs ${nm(p)} (${p.pos}, ${overall(p)} OVR) to a two-way deal with ${affiliateLabel(league, team)}`);
      have++;
    }
  }
}

/** Sign an unsigned prospect to his entry-level deal and assign him to the farm team. */
export function signProspectToFarm(league: League, team: Team, p: Player) {
  if (p.prospectOf !== team.id) throw new Error('Not one of your prospects');
  if (contractCount(team) >= CONTRACT_MAX) throw new Error(`You're at the ${CONTRACT_MAX}-contract limit`);
  team.prospects = (team.prospects ?? []).filter((id) => id !== p.id);
  p.prospectOf = undefined;
  p.teamId = team.id;
  p.farm = true;
  p.contract = { salary: ELC_SALARY, yearsLeft: 3, kind: 'ELC', expiresAs: 'RFA', twoWay: true, minorSalary: 85_000 };
  team.roster.push(p.id);
  tx(league, 'promotion', team.id, p, `${nm(p)} signs his entry-level deal and joins ${affiliateLabel(league, team)}`);
}

// ---- New season ----

function startNewSeason(league: League) {
  // Purge retired players and the long tail of unwanted free agents.
  for (const id of Object.keys(league.retired ?? {})) delete league.players[id];
  const fa = freeAgents(league).sort((a, b) => overall(b) - overall(a));
  for (const p of fa.slice(120)) delete league.players[p.id];

  if (league.freshStart) {
    // No season was played before this one: nothing to close.
    for (const t of Object.values(league.teams)) t.finances = newFinances(league.season + 1);
    league.freshStart = undefined;
  } else closeBooks(league);
  offseasonStaff(league);
  offseasonSkillsCoaches(league);
  offseasonScouts(league);
  league.season += 1;
  league.day = 0;
  league.phase = 'regular-season';
  league.playoffs = null;
  league.awards = {};
  league.skaterStats = {};
  league.goalieStats = {};
  league.playoffSkaterStats = {};
  league.playoffGoalieStats = {};
  league.prospectStats = {};
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
    if (team.controller.kind === 'ai' || team.autoLines || !valid) team.lines = autoLines(healthyRoster(league, team), team.tactics);
  }
  league.schedule = buildSchedule(Object.values(league.teams), new Rng(deriveSeed(league.seed, `schedule:${league.season}`)));
  setOwnerGoals(league);
  // Next summer's draft class takes the ice now, so scouts can plan to follow it from opening night.
  ensureDraftClass(league);
  if (league.newsState) league.newsState.streaks = {};
}

