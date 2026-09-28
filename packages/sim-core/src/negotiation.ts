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

export function offerUtility(league: League, p: Player, team: Team, offer: ContractOffer, ask = askingContract(league, p)): number {
  const { greed, loyalty, ambition } = p.hidden.personality;
  const a = age(p, league.season) + 1;
  const money = offer.salary / ask.salary;
  let u = 1 + (money - 1) * (0.7 + 0.6 * greed);
  // Term: veterans want security; young players take what they asked for.
  const dy = offer.years - ask.years;
  u -= a >= 31 ? Math.max(0, -dy) * 0.05 : Math.abs(dy) * 0.03;
  u += (contenderScore(league, team.id) - 0.5) * 0.24 * ambition;
  u += roleScore(league, team, p) * (0.5 + ambition);
  if (p.teamId === team.id) u += 0.1 * loyalty;
  return u;
}

function threshold(neg: NegotiationState | undefined, faRound = 0): number {
  return 1 - faRound * NEGOTIATION.faRoundDrop + (neg?.annoyance ?? 0);
}

/** Salary (at his preferred term) that would get him to yes. */
export function salaryNeeded(league: League, p: Player, team: Team, years: number, thr: number, ask = askingContract(league, p)): number {
  const base = offerUtility(league, p, team, { salary: ask.salary, years }, ask);
  const w = 0.7 + 0.6 * p.hidden.personality.greed;
  const money = 1 + (thr - base) / w;
  return Math.min(MAX_SALARY * (league.settings.salaryCap / BASE_CAP), Math.max(LEAGUE_MIN_SALARY, round25k(money * ask.salary + 12_500)));
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
    const years = ask.years;
    const counter = { salary: salaryNeeded(league, p, team, years, thr, ask), years };
    return {
      result: 'counter',
      counter,
      attemptsLeft: left,
      message: `${p.lastName} counters at ${years} yr × $${(counter.salary / 1e6).toFixed(2)}M.`,
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
