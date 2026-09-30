/**
 * Contract negotiation.
 *
 * A player judges an offer by its "utility": money (weighted by greed), term
 * versus what he wants, whether the team can win (weighted by ambition), the
 * role he'd have, and loyalty to his current team. He accepts at or above his
 * threshold, counters when he's close, and gets annoyed by lowballs. After
 * three offers in one window he stops negotiating. Humans and AI teams go
 * through the same function, and it is deterministic, so every offer is
 * judged the same way no matter who makes it.
 */
import { askingContract, BASE_CAP, LEAGUE_MIN_SALARY, MAX_SALARY, marketValue } from './contracts';
import { age, overall } from './ratings';
import { deriveSeed, Rng } from './rng';
import type { ContractOffer, League, NegotiationState, Player, Team, TeamId } from './types';

export const NEGOTIATION = {
  maxAttempts: 3,
  counterWindow: 0.2,
  lowballPenalty: 0.03,
  /** Free agents lower their bar a little each bidding round. */
  faRoundDrop: 0.05,
};

export type OfferResult =
  | { result: 'accept'; message: string }
  | { result: 'counter'; counter: ContractOffer; message: string; attemptsLeft: number }
  | { result: 'reject'; message: string; attemptsLeft: number }
  | { result: 'refuse'; message: string };

const round25k = (x: number) => Math.round(x / 25_000) * 25_000;
const group = (p: Player) => (p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F');

/** Coarse, player-facing read on what matters to him (agents talk). */
export function priorities(p: Player): string[] {
  const { greed, loyalty, ambition } = p.hidden.personality;
  const out: string[] = [];
  if (greed > 0.66) out.push('Wants to get paid');
  if (ambition > 0.66) out.push('Wants to win now');
  if (loyalty > 0.66) out.push('Loyal to his team');
  if (greed < 0.25) out.push('Money isn’t everything');
  if (!out.length) out.push('Open to offers');
  return out;
}

/** 0 (worst) … 1 (best): where a team's current top-end talent ranks in the league. */
export function contenderScore(league: League, teamId: TeamId): number {
  const strength = (t: Team) => {
    const ovrs = t.roster.map((id) => league.players[id]).filter(Boolean).map(overall).sort((a, b) => b - a).slice(0, 20);
    return ovrs.reduce((s, x) => s + x, 0) / Math.max(1, ovrs.length);
  };
  const all = Object.values(league.teams).map((t) => [t.id, strength(t)] as const).sort((a, b) => b[1] - a[1]);
  const rank = all.findIndex(([id]) => id === teamId);
  return 1 - rank / Math.max(1, all.length - 1);
}

/** Would he be a top player at his position on that team? Positive = bigger role. */
function roleScore(league: League, team: Team, p: Player): number {
  const peers = team.roster.map((id) => league.players[id]).filter((x) => x && x.id !== p.id && group(x) === group(p));
  const better = peers.filter((x) => overall(x) > overall(p)).length;
  const [top, mid] = group(p) === 'G' ? [0, 1] : group(p) === 'D' ? [3, 5] : [5, 8];
  if (better <= top) return 0.05;
  if (better <= mid) return 0;
  return -0.06;
}

// ---------------------------------------------------------------------------
// Interest, asks and how a player weighs money against term
// ---------------------------------------------------------------------------

/**
 * How much he values long-term security, 0 … 1. Not stored on the player: it's
 * derived from his id so it is stable for his whole career and old saves work.
 */
export function securityTrait(league: League, p: Player): number {
  return new Rng(deriveSeed(league.seed, `security:${p.id}`)).next();
}

export interface TermProfile {
  /** Utility per 1.0 of salary ratio (how much money moves him). */
  moneyWeight: number;
  /** Utility lost per year shorter than he wants. */
  shortPenalty: number;
  /**
   * Utility per year longer than he wants: positive = he dislikes being locked
   * in; negative = extra security he'd trade salary for (counts up to 3 years).
   */
  longEffect: number;
  /** Coarse, player-facing summary. */
  label: string;
}

export const MAX_SECURITY_YEARS = 3;

export function termProfile(league: League, p: Player): TermProfile {
  const a = age(p, league.season) + 1;
  const sec = securityTrait(league, p);
  const moneyWeight = 0.7 + 0.6 * p.hidden.personality.greed;
  const base = a >= 33 ? 0.09 : a >= 30 ? 0.07 : a >= 27 ? 0.045 : 0.035;
  const shortPenalty = base * (0.6 + 0.8 * sec);
  // Veterans trade salary for years; mid-career players depend on how much they
  // value security; young players don't want to be locked in cheap.
  const longEffect = a >= 30 ? -shortPenalty * 0.5 : a >= 27 ? (0.5 - sec) * 0.05 : 0.04 * (1.4 - sec);
  const label =
    longEffect < -0.02
      ? 'Will take less for more years'
      : longEffect > 0.03
        ? 'Wants a short deal'
        : sec > 0.7
          ? 'Values security'
          : moneyWeight > 1.1
            ? 'Money over term'
            : 'Flexible on term';
  return { moneyWeight, shortPenalty, longEffect, label };
}

export interface InterestFactor {
  label: string;
  /** Utility: + makes him more interested (and cheaper), − less. */
  effect: number;
}

export interface Interest {
  /** 0 … 100. */
  score: number;
  label: 'Very interested' | 'Interested' | 'Open' | 'Lukewarm' | 'Not interested';
  /** Sum of factor effects (utility units, ~0.1 = 10% of salary). */
  utility: number;
  factors: InterestFactor[];
}

/** How interested a player is in signing with a team, and why. */
export function teamInterest(league: League, p: Player, team: Team): Interest {
  const { greed, loyalty, ambition } = p.hidden.personality;
  const a = age(p, league.season) + 1;
  const factors: InterestFactor[] = [];
  const add = (label: string, effect: number) => {
    if (Math.abs(effect) >= 0.01) factors.push({ label, effect: Math.round(effect * 1000) / 1000 });
  };
  const c = contenderScore(league, team.id);
  add(c >= 0.7 ? 'Wants to win: you’re a contender' : c <= 0.3 ? 'Wants to win: you’re rebuilding' : 'Mid-pack team', (c - 0.5) * 0.3 * (0.3 + ambition));
  const role = roleScore(league, team, p);
  add(role > 0 ? 'Would be a top player here' : role < 0 ? 'Would be buried on the depth chart' : 'Regular role', role * (0.6 + ambition));
  if (p.teamId === team.id) add('Loyal to his current team', 0.12 * loyalty);
  else if (p.draft?.teamId === team.id || p.prospectOf === team.id) add('Drafted by your team', 0.05 * loyalty);
  const m = team.market ?? 1;
  add(m >= 1.15 ? 'Big market, bigger spotlight' : m <= 0.85 ? 'Small market' : 'Average market', (m - 1) * 0.12 * (0.4 + greed));
  if (a <= 25) {
    const coach = team.staff?.coach?.rating ?? 65;
    add(coach >= 75 ? 'Rates your coach for development' : coach <= 55 ? 'Unsure about your coach' : 'Neutral on your coach', ((coach - 65) / 30) * 0.05);
  }
  const lastChamp = league.history.at(-1)?.champion === team.id;
  if (lastChamp) add('Defending champions', 0.03 * (0.5 + ambition));
  const utility = factors.reduce((s, f) => s + f.effect, 0);
  const score = Math.round(Math.max(0, Math.min(100, 50 + utility * 250)));
  const label = score >= 75 ? 'Very interested' : score >= 60 ? 'Interested' : score >= 40 ? 'Open' : score >= 25 ? 'Lukewarm' : 'Not interested';
  return { score, label, utility, factors: factors.sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect)) };
}

/**
 * What he asks a specific team for. Interested players give a discount and
 * commit longer; uninterested ones want a premium and a shorter way out.
 */
export function askFromTeam(league: League, p: Player, team: Team, base = askingContract(league, p)): ContractOffer {
  const interest = teamInterest(league, p, team);
  const { moneyWeight } = termProfile(league, p);
  const factor = Math.max(0.78, Math.min(1.25, 1 - interest.utility / moneyWeight));
  const max = MAX_SALARY * (league.settings.salaryCap / BASE_CAP);
  const salary = Math.min(max, Math.max(LEAGUE_MIN_SALARY, round25k(base.salary * factor)));
  const a = age(p, league.season) + 1;
  let years = base.years;
  if (interest.score >= 70 && a >= 25 && a <= 31) years = Math.min(8, years + 1);
  if (interest.score < 35 && years > 1) years -= 1;
  return { salary, years };
}

function termPenalty(tp: TermProfile, years: number, wanted: number): number {
  const d = years - wanted;
  if (d < 0) return -d * tp.shortPenalty;
  return tp.longEffect < 0 ? Math.min(d, MAX_SECURITY_YEARS) * tp.longEffect : d * tp.longEffect;
}

/**
 * How good an offer looks to him: 1.0 = exactly his ask from this team.
 * Money counts by his greed; term by his age and appetite for security.
 */
export function offerUtility(league: League, p: Player, team: Team, offer: ContractOffer, base = askingContract(league, p)): number {
  const ask = askFromTeam(league, p, team, base);
  const tp = termProfile(league, p);
  return 1 + (offer.salary / ask.salary - 1) * tp.moneyWeight - termPenalty(tp, offer.years, ask.years) - twoWayPenalty(p, offer);
}

/**
 * Players prefer one-way deals: an established NHLer takes a two-way offer as
 * a slight (it says he might spend time in the minors); a depth player barely
 * minds. A one-way offer to a depth player is the default either way.
 */
export function twoWayPenalty(p: Player, offer: ContractOffer): number {
  if (!offer.twoWay) return 0;
  const o = overall(p);
  return o >= 72 ? 0.15 : o >= 66 ? 0.07 : 0.02;
}

function threshold(neg: NegotiationState | undefined, faRound = 0): number {
  return 1 - faRound * NEGOTIATION.faRoundDrop + (neg?.annoyance ?? 0);
}

/** Salary at a given term that would get him to yes. */
export function salaryNeeded(league: League, p: Player, team: Team, years: number, thr: number, base = askingContract(league, p)): number {
  const ask = askFromTeam(league, p, team, base);
  const tp = termProfile(league, p);
  const ratio = 1 + (thr - 1 + termPenalty(tp, years, ask.years)) / tp.moneyWeight;
  return Math.min(MAX_SALARY * (league.settings.salaryCap / BASE_CAP), Math.max(LEAGUE_MIN_SALARY, round25k(ratio * ask.salary + 12_500)));
}

/** Price per term for the UI: what each length of deal would take right now. */
export function priceByTerm(league: League, p: Player, team: Team, base = askingContract(league, p), faRound = 0): Array<{ years: number; salary: number }> {
  const thr = threshold(league.negotiations?.[p.id]?.teamId === team.id ? league.negotiations[p.id] : undefined, faRound);
  return [1, 2, 3, 4, 5, 6, 7, 8].map((years) => ({ years, salary: salaryNeeded(league, p, team, years, thr, base) }));
}

/**
 * Respond to one offer. Mutates the negotiation state stored on the league.
 * `faRound` > 0 lowers the bar during free agency.
 */
export function respondToOffer(league: League, p: Player, team: Team, offer: ContractOffer, opts: { faRound?: number; ask?: ContractOffer } = {}): OfferResult {
  if (offer.years < 1 || offer.years > 8) return { result: 'refuse', message: 'Contracts run 1 to 8 years.' };
  const max = MAX_SALARY * (league.settings.salaryCap / BASE_CAP);
  if (offer.salary < LEAGUE_MIN_SALARY || offer.salary > max) {
    return { result: 'refuse', message: `Salary must be between $${LEAGUE_MIN_SALARY / 1e6}M and $${(max / 1e6).toFixed(1)}M.` };
  }
  const negs = (league.negotiations ??= {});
  let neg = negs[p.id];
  if (!neg || neg.season !== league.season || neg.teamId !== team.id) neg = negs[p.id] = { season: league.season, teamId: team.id, attempts: 0, annoyance: 0 };
  if (neg.attempts >= NEGOTIATION.maxAttempts) {
    return { result: 'refuse', message: `${p.lastName}'s camp has stopped taking calls. He'll see what the market says.` };
  }
  neg.attempts++;
  const ask = opts.ask ?? askingContract(league, p);
  const thr = threshold(neg, opts.faRound ?? 0);
  const u = offerUtility(league, p, team, offer, ask);
  const left = NEGOTIATION.maxAttempts - neg.attempts;
  if (u >= thr) return { result: 'accept', message: `${p.lastName} accepts: ${offer.years} yr × $${(offer.salary / 1e6).toFixed(2)}M.` };
  if (u >= thr - NEGOTIATION.counterWindow) {
    // Counter at his preferred term, unless the offered term costs him little.
    const preferred = askFromTeam(league, p, team, ask).years;
    const years = salaryNeeded(league, p, team, offer.years, thr, ask) <= salaryNeeded(league, p, team, preferred, thr, ask) * 1.03 ? offer.years : preferred;
    // An established player who was offered a two-way deal asks for a one-way one.
    const oneWay = !!offer.twoWay && twoWayPenalty(p, offer) >= 0.05;
    const counter: ContractOffer = { salary: salaryNeeded(league, p, team, years, thr, ask), years, ...(offer.twoWay ? { twoWay: !oneWay } : {}) };
    return {
      result: 'counter',
      counter,
      attemptsLeft: left,
      message: `${p.lastName} counters at ${years} yr × $${(counter.salary / 1e6).toFixed(2)}M${oneWay ? ', one-way' : ''}.`,
    };
  }
  neg.annoyance += NEGOTIATION.lowballPenalty;
  return { result: 'reject', attemptsLeft: left, message: `${p.lastName}'s agent calls that offer insulting. His price just went up.` };
}

/** What an AI team is willing to pay for a player (per season). */
export function aiValuation(league: League, team: Team, p: Player): number {
  const strategy = team.controller.kind === 'ai' ? team.controller.strategy : 'balanced';
  const a = age(p, league.season) + 1;
  let v = marketValue(p, league.season, league.settings.salaryCap);
  if (strategy === 'contend') v *= a >= 30 ? 1.1 : 1.05;
  if (strategy === 'rebuild') v *= a >= 30 ? 0.75 : a <= 24 ? 1.05 : 0.9;
  return round25k(v);
}
