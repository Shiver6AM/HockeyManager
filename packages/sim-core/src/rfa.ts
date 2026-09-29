/**
 * Restricted free agents: offer sheets and salary arbitration.
 *
 * When the re-signing window closes, every qualified RFA without a new deal
 * stays with his team on his qualifying offer for now and becomes an "RFA
 * case":
 *
 *  1. Offer sheets (free agency). Any other team can tender an offer sheet.
 *     If he signs one, his team may match it (he stays at those terms) or
 *     let him go and receive draft-pick compensation from the offering team,
 *     scaled by the offer's salary. Humans decide before the next advance;
 *     undecided sheets are settled by the assistant GM, the way an AI team
 *     would.
 *  2. Arbitration (end of free agency). Players worth clearly more than their
 *     qualifying offer file for arbitration; the arbitrator awards a one- or
 *     two-year deal near his market value. In training camp, a team may walk
 *     away from a large award, and the player becomes an unrestricted free agent.
 *  3. Everyone else plays the season on his qualifying offer.
 *
 * His own team can keep negotiating with him the whole time.
 */
import { CONTRACT_MAX } from './farm';
import { proSeasons } from './prospects';
import { askingContract, BASE_CAP, capRoom, LEAGUE_MIN_SALARY, marketValue, qualifyingOffer, SUMMER_ROSTER_MAX } from './contracts';
import { aiValuation, offerUtility } from './negotiation';
import { applyContract } from './offseason';
import { age, overall } from './ratings';
import { deriveSeed, Rng } from './rng';
import { pickKey, pickOwner, playerValue, pickValue, tradeablePickSeasons } from './trades';
import type { ContractOffer, League, Player, PlayerId, RfaCase, Team, TeamId } from './types';

const round25k = (x: number) => Math.round(x / 25_000) * 25_000;
const nm = (p: Player) => `${p.firstName} ${p.lastName}`;
const money = (x: number) => `$${(x / 1e6).toFixed(2)}M`;

function tx(league: League, type: 'offer-sheet' | 'arbitration' | 'qualifying-offer' | 'departure', teamId: TeamId, p: Player, note: string) {
  league.transactions.push({ day: league.day, season: league.season, type, teamId, playerId: p.id, note });
}

/**
 * Compensation by offer-sheet salary, as a share of the cap (NHL-style tiers).
 * Each entry is the rounds owed, using the offering team's own picks.
 */
export const OFFER_SHEET_TIERS: Array<{ upTo: number; rounds: number[] }> = [
  { upTo: 0.016, rounds: [] },
  { upTo: 0.025, rounds: [3] },
  { upTo: 0.05, rounds: [2] },
  { upTo: 0.075, rounds: [1, 3] },
  { upTo: 0.1, rounds: [1, 2, 3] },
  { upTo: 0.125, rounds: [1, 1, 2, 3] },
  { upTo: Infinity, rounds: [1, 1, 1, 1] },
];

/** Awards at or above this can be walked away from (≈ $4.5M at the base cap). */
export const WALK_AWAY_SHARE = 0.043;
export const OFFER_SHEET_MAX_YEARS = 7;

export function compensationRounds(league: League, salary: number): number[] {
  const share = salary / league.settings.salaryCap;
  return OFFER_SHEET_TIERS.find((t) => share < t.upTo)!.rounds;
}

/** Salary thresholds (in dollars) where compensation steps up, for the UI. */
export function compensationTable(league: League) {
  let from = 0;
  return OFFER_SHEET_TIERS.map((t) => {
    const row = { from, to: Number.isFinite(t.upTo) ? round25k(t.upTo * league.settings.salaryCap) : null, rounds: t.rounds };
    from = row.to ?? from;
    return row;
  });
}

/**
 * The offering team's own picks that would be owed, or null if it no longer
 * owns them. First-rounders come from consecutive drafts; others from the next draft.
 */
export function compensationPicks(league: League, teamId: TeamId, salary: number): string[] | null {
  const seasons = tradeablePickSeasons(league);
  const out: string[] = [];
  let firsts = 0;
  for (const round of compensationRounds(league, salary)) {
    const season = round === 1 ? seasons[firsts++] : seasons[0];
    if (season === undefined) return null;
    const key = pickKey(season, round, teamId);
    if (pickOwner(league, key) !== teamId) return null;
    out.push(key);
  }
  return out;
}

/** What an arbitrator would award, before the hearing's noise. */
export function expectedAward(league: League, p: Player): number {
  return Math.max(qualifyingOffer(p, league).salary, round25k(marketValue(p, league.season, league.settings.salaryCap) * 0.95));
}

export function walkAwayThreshold(league: League): number {
  return round25k(WALK_AWAY_SHARE * league.settings.salaryCap);
}

/** Arbitration needs some professional experience: 22+ next season, or three seasons in the league. */
export function arbitrationEligible(league: League, p: Player): boolean {
  return age(p, league.season) + 1 >= 22 || proSeasons(league.careerStats?.[p.id] ?? []).length >= 3;
}

export type QoResponse = 'accept' | 'holdout' | 'arbitration';

/**
 * How a qualified RFA reacts to his qualifying offer: take it if it's about
 * what he's worth, file for arbitration if he's worth clearly more (and
 * eligible), otherwise hold out for a better deal or an offer sheet.
 */
export function qoResponse(league: League, p: Player, qo = qualifyingOffer(p, league)): QoResponse {
  const worth = marketValue(p, league.season, league.settings.salaryCap);
  // Depth players close to their QO just sign it; arbitration is for real raises.
  if (worth <= qo.salary * 1.15 || worth - qo.salary < 250_000) return 'accept';
  if (arbitrationEligible(league, p) && expectedAward(league, p) >= Math.max(qo.salary * 1.3, qo.salary + 750_000)) return 'arbitration';
  return 'holdout';
}

/** Is a qualifying offer worth tendering, from an AI team's (or assistant GM's) point of view? */
export function aiWouldQualify(league: League, team: Team, p: Player): boolean {
  return qualifyingOffer(p, league).salary <= aiValuation(league, team, p) * 1.15;
}

/** Called when re-signing closes, for a qualified RFA without a deal. */
export function openRfaCase(league: League, team: Team, p: Player) {
  const os = league.offseason!;
  const qo = qualifyingOffer(p, league);
  applyContract(league, p, qo); // what he plays on unless something else happens
  const response = qoResponse(league, p, qo);
  if (response === 'accept') {
    (os.rfa ??= {})[p.id] = { teamId: team.id, qualifyingOffer: qo, arbitration: false, status: 'signed' };
    tx(league, 'qualifying-offer', team.id, p, `${nm(p)} accepts his qualifying offer: 1 yr × ${money(qo.salary)}`);
    return;
  }
  const arbitration = response === 'arbitration';
  (os.rfa ??= {})[p.id] = { teamId: team.id, qualifyingOffer: qo, arbitration, status: 'unsigned' };
  tx(
    league,
    'qualifying-offer',
    team.id,
    p,
    arbitration
      ? `${nm(p)} is qualified at ${money(qo.salary)} and files for arbitration; offer sheets are open`
      : `${nm(p)} is qualified at ${money(qo.salary)} but holds out for a better deal; offer sheets are open`,
  );
}

export function openCase(league: League, playerId: PlayerId): RfaCase | null {
  const c = league.offseason?.rfa?.[playerId];
  return c && c.status === 'unsigned' ? c : null;
}

/** His own team reached a deal with him while the case was open. */
export function settleRfaCase(league: League, p: Player) {
  const c = openCase(league, p.id);
  if (c) {
    c.status = 'signed';
    delete c.sheet;
    for (const bySheet of Object.values(league.offseason?.sheets ?? {})) delete bySheet[p.id];
  }
}

// ---------------------------------------------------------------------------
// Offer sheets
// ---------------------------------------------------------------------------

export function tenderOfferSheet(league: League, team: Team, p: Player, offer: ContractOffer) {
  const os = league.offseason;
  if (!os || os.stage !== 'free-agency') throw new Error('Offer sheets can only be tendered during free agency');
  const c = openCase(league, p.id);
  if (!c) throw new Error('He is not an unsigned restricted free agent');
  if (c.teamId === team.id) throw new Error('Negotiate with your own RFA directly');
  if (c.sheet) throw new Error('He has already signed an offer sheet');
  if (offer.years < 1 || offer.years > OFFER_SHEET_MAX_YEARS) throw new Error(`Offer sheets run 1 to ${OFFER_SHEET_MAX_YEARS} years`);
  if (offer.salary <= c.qualifyingOffer.salary) throw new Error('An offer sheet must beat his qualifying offer');
  if (offer.salary > capRoom(league, team)) throw new Error('Not enough cap room for that offer sheet');
  if (team.roster.length >= CONTRACT_MAX) throw new Error(`You're at the ${CONTRACT_MAX}-contract limit.`);
  if (!compensationPicks(league, team.id, offer.salary)) throw new Error('You no longer own the draft picks this offer sheet would cost');
  ((os.sheets ??= {})[team.id] ??= {})[p.id] = offer;
}

export function withdrawOfferSheet(league: League, team: Team, playerId: PlayerId) {
  delete league.offseason?.sheets?.[team.id]?.[playerId];
}

/** Would an AI team (or the assistant GM) match? */
export function aiWouldMatch(league: League, team: Team, p: Player, offer: ContractOffer): boolean {
  const room = capRoom(league, team) + (p.contract?.salary ?? 0);
  if (offer.salary > room) return false;
  const strategy = team.controller.kind === 'ai' ? team.controller.strategy : 'balanced';
  const a = age(p, league.season) + 1;
  const worth = aiValuation(league, team, p) * (strategy === 'rebuild' && a <= 24 ? 1.35 : 1.2);
  return offer.salary <= worth;
}

export function decideOfferSheet(league: League, team: Team, playerId: PlayerId, match: boolean) {
  const c = openCase(league, playerId);
  if (!c || c.teamId !== team.id || !c.sheet) throw new Error('No offer sheet is waiting on your decision');
  const p = league.players[playerId];
  if (match && c.sheet.offer.salary > capRoom(league, team) + (p.contract?.salary ?? 0)) throw new Error('Not enough cap room to match');
  c.sheet.decision = match ? 'match' : 'decline';
}

function executeSheet(league: League, p: Player, c: RfaCase, match: boolean) {
  const sheet = c.sheet!;
  const orig = league.teams[c.teamId];
  const from = league.teams[sheet.fromTeam];
  const picks = compensationPicks(league, from.id, sheet.offer.salary);
  // The offering team must still be able to complete it; otherwise the sheet is void.
  const valid = !!picks && sheet.offer.salary <= capRoom(league, from) && from.roster.length < CONTRACT_MAX;
  if (!valid && !match) {
    delete c.sheet;
    return;
  }
  const terms = `${sheet.offer.years} yr × ${money(sheet.offer.salary)}`;
  if (match) {
    applyContract(league, p, sheet.offer);
    c.status = 'signed';
    tx(league, 'offer-sheet', orig.id, p, `${orig.city} match ${from.city}'s offer sheet for ${nm(p)}: ${terms}`);
    return;
  }
  orig.roster = orig.roster.filter((id) => id !== p.id);
  from.roster.push(p.id);
  p.teamId = from.id;
  applyContract(league, p, sheet.offer);
  for (const key of picks!) (league.pickOwners ??= {})[key] = orig.id;
  c.status = 'departed';
  delete league.negotiations?.[p.id];
  const comp = picks!.length ? `${orig.city} receive ${picks!.length} pick${picks!.length > 1 ? 's' : ''} as compensation` : 'no compensation owed';
  tx(league, 'offer-sheet', from.id, p, `${from.city} sign ${nm(p)} to an offer sheet (${terms}); ${orig.city} decline to match, ${comp}`);
}

/** Settle sheets from the previous round whose decision was pending. */
function settlePending(league: League) {
  for (const [id, c] of Object.entries(league.offseason?.rfa ?? {})) {
    if (c.status !== 'unsigned' || !c.sheet) continue;
    const p = league.players[id];
    const team = league.teams[c.teamId];
    const match = c.sheet.decision ? c.sheet.decision === 'match' : aiWouldMatch(league, team, p, c.sheet.offer);
    executeSheet(league, p, c, match);
  }
}

/** AI teams occasionally chase a good young RFA with an offer sheet. Rare, as in the NHL. */
function aiOfferSheets(league: League, rng: Rng) {
  const os = league.offseason!;
  const already = (league.transactions ?? []).filter((t) => t.season === league.season && t.type === 'offer-sheet').length;
  if (already >= 2) return;
  const targets = Object.entries(os.rfa ?? {})
    .filter(([id, c]) => c.status === 'unsigned' && !c.sheet && league.players[id])
    .map(([id, c]) => ({ p: league.players[id], c }))
    .filter(({ p }) => overall(p) >= 72 && age(p, league.season) + 1 <= 26);
  if (!targets.length) return;
  for (const team of rng.shuffle(Object.values(league.teams).filter((t) => t.controller.kind === 'ai' && t.controller.strategy !== 'rebuild'))) {
    if (!rng.chance(0.08)) continue;
    const { p, c } = rng.pick(targets);
    if (c.teamId === team.id) continue;
    const salary = round25k(aiValuation(league, team, p) * 1.12);
    const picks = compensationPicks(league, team.id, salary);
    if (!picks || salary > capRoom(league, team) - 3_000_000) continue;
    // Worth it only if he's worth more to us than the picks we'd give up.
    const cost = picks.reduce((s, k) => s + pickValue(league, team, k), 0);
    if (playerValue(league, team, p) < cost * 1.1) continue;
    ((os.sheets ??= {})[team.id] ??= {})[p.id] = { salary, years: rng.int(3, 5) };
    return;
  }
}

/**
 * One free-agency round for RFAs: settle last round's pending sheets, then
 * each RFA with tenders signs the best one that clears his bar. AI teams
 * decide on the spot; human teams decide before the next advance.
 */
export function resolveOfferSheets(league: League, round: number): void {
  const os = league.offseason!;
  settlePending(league);
  aiOfferSheets(league, new Rng(deriveSeed(league.seed, `offer-sheets:${league.season}:${round}`)));
  const sheets = os.sheets ?? {};
  for (const [id, c] of Object.entries(os.rfa ?? {})) {
    if (c.status !== 'unsigned' || c.sheet) continue;
    const p = league.players[id];
    const base = askingContract(league, p);
    let best: { team: Team; offer: ContractOffer; u: number } | null = null;
    for (const [teamId, bySheet] of Object.entries(sheets)) {
      const offer = bySheet[id];
      if (!offer) continue;
      const team = league.teams[teamId];
      if (!compensationPicks(league, teamId, offer.salary) || offer.salary > capRoom(league, team)) continue;
      const u = offerUtility(league, p, team, offer, base);
      if (!best || u > best.u) best = { team, offer, u };
    }
    // RFAs have little leverage: a sheet that's close to his ask gets signed.
    if (!best || best.u < 0.92 - (round - 1) * 0.04) continue;
    const compensation = compensationPicks(league, best.team.id, best.offer.salary)!;
    c.sheet = { fromTeam: best.team.id, offer: best.offer, compensation, round };
    const orig = league.teams[c.teamId];
    if (orig.controller.kind === 'ai') executeSheet(league, p, c, aiWouldMatch(league, orig, p, best.offer));
  }
  os.sheets = {};
}

/**
 * End of free agency: settle any pending sheets, then hold arbitration
 * hearings. AI teams walk away from awards they think are too rich.
 */
export function holdArbitration(league: League): void {
  const os = league.offseason!;
  settlePending(league);
  const rng = new Rng(deriveSeed(league.seed, `arbitration:${league.season}`));
  for (const [id, c] of Object.entries(os.rfa ?? {})) {
    if (c.status !== 'unsigned') continue;
    const p = league.players[id];
    const team = league.teams[c.teamId];
    if (!c.arbitration) {
      c.status = 'signed';
      tx(league, 'qualifying-offer', team.id, p, `${nm(p)} signs his qualifying offer: 1 yr × ${money(c.qualifyingOffer.salary)}`);
      continue;
    }
    const salary = Math.max(c.qualifyingOffer.salary, Math.max(LEAGUE_MIN_SALARY, round25k(expectedAward(league, p) * rng.normal(1, 0.05))));
    const award = { salary: Math.min(salary, 16_000_000 * (league.settings.salaryCap / BASE_CAP)), years: rng.chance(0.4) ? 2 : 1 };
    c.award = award;
    c.status = 'awarded';
    applyContract(league, p, award);
    tx(league, 'arbitration', team.id, p, `Arbitrator awards ${nm(p)} ${award.years} yr × ${money(award.salary)}`);
    if (team.controller.kind === 'ai' && award.salary >= walkAwayThreshold(league) && award.salary > aiValuation(league, team, p) * 1.3) {
      walkAway(league, team, p);
    }
  }
}

function walkAway(league: League, team: Team, p: Player) {
  const c = league.offseason!.rfa![p.id];
  team.roster = team.roster.filter((id) => id !== p.id);
  const dressed = [...team.lines.forwards.flat(), ...team.lines.defense.flat(), ...team.lines.goalies];
  if (dressed.includes(p.id)) team.autoLines = true;
  p.teamId = null;
  p.contract = null;
  c.status = 'walked';
  league.offseason!.freeAgentAsks[p.id] = askingContract(league, p);
  tx(league, 'departure', team.id, p, `${team.city} walk away from ${nm(p)}'s arbitration award; he becomes an unrestricted free agent`);
}

/** Training camp: a team may walk away from an award at or above the threshold. */
export function walkAwayFromAward(league: League, team: Team, playerId: PlayerId) {
  const os = league.offseason;
  const c = os?.rfa?.[playerId];
  if (!os || os.stage !== 'training-camp') throw new Error('Awards can be declined during training camp');
  if (!c || c.teamId !== team.id || c.status !== 'awarded' || !c.award) throw new Error('No arbitration award to walk away from');
  if (c.award.salary < walkAwayThreshold(league)) throw new Error(`Only awards of ${money(walkAwayThreshold(league))} or more can be declined`);
  walkAway(league, team, league.players[playerId]);
}
