/**
 * Trades.
 *
 * Assets are players (roster or prospects) and draft picks up to two years
 * out. AI teams value assets from their own point of view:
 *
 *  - players: today's rating on a convex scale (stars are worth far more than
 *    depth), plus scouted upside for young players, minus age decline, plus
 *    contract surplus or minus overpay;
 *  - picks: the expected slot (from the original team's current standing),
 *    discounted for distance;
 *  - strategy: contenders pay for help now; rebuilders pay for youth and picks.
 *
 * What an AI team receives is summed with diminishing weights (1, 0.7, 0.5…),
 * so three depth players never add up to one star. It accepts only deals that
 * favor it by a small margin, and never one that breaks its cap or leaves it
 * without enough players at a position.
 */
import { capRoom, capSeason, marketValue, ROSTER_MAX, SUMMER_ROSTER_MAX } from './contracts';
import { scoutedPotential } from './draft';
import { autoLines } from './lines';
import { age, overall } from './ratings';
import { deriveSeed, Rng } from './rng';
import { healthyRoster } from './roster';
import type { League, Player, PlayerId, Team, TeamId, TradeAsset, TradeProposal } from './types';

export const TRADE = {
  /** AI wants to come out ahead by this much (ratio of value received to value given). */
  aiMargin: 1.05,
  aiFlatMargin: 10,
  consolidation: [1, 0.7, 0.5, 0.35, 0.25, 0.2],
  futureDiscount: 0.85,
  pickSeasonsAhead: 2,
};

const group = (p: Player) => (p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F');
const MIN_GROUP = { F: 12, D: 6, G: 2 };

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

export function pickKey(season: number, round: number, originalTeam: TeamId) {
  return `${season}:${round}:${originalTeam}`;
}

export function parsePickKey(key: string) {
  const [season, round, team] = key.split(':');
  return { season: Number(season), round: Number(round), originalTeam: team };
}

export function pickOwner(league: League, key: string): TeamId {
  return league.pickOwners?.[key] ?? parsePickKey(key).originalTeam;
}

/** Draft years whose picks can still be traded. */
export function tradeablePickSeasons(league: League): number[] {
  const drafted = league.phase === 'offseason' && league.offseason?.draft ? league.offseason.draft.season : null;
  const first = drafted === league.season ? league.season + 1 : league.season;
  return Array.from({ length: TRADE.pickSeasonsAhead + 1 }, (_, i) => first + i);
}

export function teamPicks(league: League, teamId: TeamId): string[] {
  const out: string[] = [];
  for (const season of tradeablePickSeasons(league)) {
    for (let round = 1; round <= 7; round++) {
      for (const orig of Object.keys(league.teams)) {
        const key = pickKey(season, round, orig);
        if (pickOwner(league, key) === teamId) out.push(key);
      }
    }
  }
  return out;
}

export function pickLabel(key: string): string {
  const { season, round, originalTeam } = parsePickKey(key);
  const ord = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][round];
  return `${season} ${ord} round (${originalTeam})`;
}

/** Where a team's pick is likely to land (1 = first overall), from its current points %. */
function projectedSlot(league: League, teamId: TeamId): number {
  const rows = Object.keys(league.teams).map((id) => {
    let w = 0, gp = 0, otl = 0;
    for (const g of league.schedule) {
      if (!g.result || (g.home !== id && g.away !== id)) continue;
      gp++;
      const mine = g.home === id ? g.result.homeScore : g.result.awayScore;
      const theirs = g.home === id ? g.result.awayScore : g.result.homeScore;
      if (mine > theirs) w++;
      else if (g.result.overtime) otl++;
    }
    return { id, pct: gp ? (2 * w + otl) / (2 * gp) : 0.5 };
  });
  rows.sort((a, b) => a.pct - b.pct);
  return rows.findIndex((r) => r.id === teamId) + 1;
}

export function pickValue(league: League, forTeam: Team, key: string): number {
  const { season, round, originalTeam } = parsePickKey(key);
  const yearsOut = Math.max(0, season - league.season);
  // Next year's slot is uncertain: regress the projection toward the middle.
  const slot = projectedSlot(league, originalTeam);
  const expectedSlot = yearsOut === 0 ? slot : 16.5 + (slot - 16.5) * 0.4;
  let v: number;
  if (round === 1) v = 110 + 340 * Math.pow((33 - expectedSlot) / 32, 2.2);
  else if (round === 2) v = 55;
  else if (round === 3) v = 28;
  else v = 10;
  v *= Math.pow(TRADE.futureDiscount, yearsOut);
  const strategy = forTeam.controller.kind === 'ai' ? forTeam.controller.strategy : 'balanced';
  if (strategy === 'rebuild') v *= 1.3;
  if (strategy === 'contend') v *= 0.8;
  return v;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export function playerValue(league: League, forTeam: Team, p: Player): number {
  const strategy = forTeam.controller.kind === 'ai' ? forTeam.controller.strategy : 'balanced';
  const a = age(p, league.season + (league.phase === 'offseason' ? 1 : 0));
  const ovr = overall(p);
  let eff = ovr;
  if (a <= 24) {
    const upside = Math.max(0, scoutedPotential(league, forTeam.id, p) - ovr);
    eff += upside * (a <= 21 ? 0.6 : 0.4) * (strategy === 'contend' ? 0.5 : strategy === 'rebuild' ? 1.2 : 1);
  }
  let v = Math.pow(Math.max(0, eff - 55), 1.8);
  if (a >= 34) v *= strategy === 'contend' ? 0.8 : 0.55;
  else if (a >= 31) v *= strategy === 'contend' ? 0.95 : strategy === 'rebuild' ? 0.65 : 0.85;
  // Contract: cheap good players are gold; overpaid ones cost value.
  if (p.contract) {
    const surplusM = (marketValue(p, league.season, league.settings.salaryCap) - p.contract.salary) / 1e6;
    v += surplusM * Math.min(p.contract.yearsLeft, 4) * 8;
    // A pending UFA is a rental.
    if (p.contract.yearsLeft <= 1 && p.contract.expiresAs === 'UFA' && !p.extension) v *= strategy === 'contend' ? 0.85 : 0.5;
  }
  if (p.injury && p.injury.daysLeft > 60) v *= 0.7;
  if (p.pos === 'G') {
    const starter = forTeam.roster.map((id) => league.players[id]).filter((x) => x.pos === 'G' && x.id !== p.id).map(overall).sort((x, y) => y - x)[0] ?? 0;
    if (starter >= ovr) v *= 0.6;
  }
  return Math.max(-200, v);
}

export function assetValue(league: League, forTeam: Team, a: TradeAsset): number {
  return a.kind === 'pick' ? pickValue(league, forTeam, a.key) : playerValue(league, forTeam, league.players[a.id]);
}

/** Value of a package received, with diminishing returns for quantity. */
function packageIn(values: number[]): number {
  const sorted = [...values].sort((a, b) => b - a);
  return sorted.reduce((s, v, i) => s + (v > 0 ? v * (TRADE.consolidation[i] ?? 0.15) : v), 0);
}

// ---------------------------------------------------------------------------
// Validation & execution
// ---------------------------------------------------------------------------

export function tradeDeadline(league: League): number {
  if (league.settings.tradeDeadlineDay !== undefined) return league.settings.tradeDeadlineDay;
  const last = league.schedule.reduce((m, g) => Math.max(m, g.day), 0);
  return Math.round(last * 0.78);
}

export function tradeWindowOpen(league: League): { open: boolean; reason?: string } {
  if (league.phase === 'playoffs') return { open: false, reason: 'Trades are frozen during the playoffs.' };
  if (league.phase === 'regular-season' && league.day > tradeDeadline(league)) return { open: false, reason: 'The trade deadline has passed.' };
  if (league.phase === 'offseason' && league.offseason?.stage === 'draft') return { open: false, reason: 'Trades reopen after the draft.' };
  return { open: true };
}

function owns(league: League, teamId: TeamId, a: TradeAsset): boolean {
  if (a.kind === 'pick') return tradeablePickSeasons(league).includes(parsePickKey(a.key).season) && pickOwner(league, a.key) === teamId;
  const p = league.players[a.id];
  return !!p && (p.teamId === teamId || p.prospectOf === teamId);
}

const salaryOf = (league: League, a: TradeAsset) => (a.kind === 'player' ? (league.players[a.id]?.contract?.salary ?? 0) : 0);
const onRoster = (league: League, a: TradeAsset) => a.kind === 'player' && !!league.players[a.id]?.teamId;

/** Returns a reason the trade can't happen, or null if it's legal. */
export function validateTrade(league: League, fromId: TeamId, toId: TeamId, give: TradeAsset[], get: TradeAsset[]): string | null {
  const w = tradeWindowOpen(league);
  if (!w.open) return w.reason!;
  if (fromId === toId) return 'A team cannot trade with itself.';
  if (!give.length && !get.length) return 'The trade is empty.';
  const keys = [...give, ...get].map((a) => (a.kind === 'pick' ? a.key : a.id));
  if (new Set(keys).size !== keys.length) return 'An asset is listed twice.';
  for (const a of give) if (!owns(league, fromId, a)) return `${fromId} doesn't own ${describeAsset(league, a)}.`;
  for (const a of get) if (!owns(league, toId, a)) return `${toId} doesn't own ${describeAsset(league, a)}.`;
  const cap = league.settings.salaryCap;
  const maxRoster = league.phase === 'offseason' ? SUMMER_ROSTER_MAX : ROSTER_MAX + 3;
  for (const [teamId, out, inn] of [
    [fromId, give, get],
    [toId, get, give],
  ] as const) {
    const team = league.teams[teamId];
    const delta = inn.reduce((s, a) => s + salaryOf(league, a), 0) - out.reduce((s, a) => s + salaryOf(league, a), 0);
    if (delta > 0 && capRoom(league, team) - delta < 0) return `${team.city} would be over the salary cap by $${((delta - capRoom(league, team)) / 1e6).toFixed(2)}M.`;
    const rosterAfter = team.roster.length - out.filter((a) => onRoster(league, a)).length + inn.filter((a) => onRoster(league, a)).length;
    if (rosterAfter > maxRoster) return `${team.city} would have too many players (${rosterAfter}).`;
  }
  void cap;
  return null;
}

export function describeAsset(league: League, a: TradeAsset): string {
  if (a.kind === 'pick') return pickLabel(a.key);
  const p = league.players[a.id];
  return p ? `${p.firstName} ${p.lastName} (${p.pos}, ${overall(p)})` : a.id;
}

function moveAsset(league: League, a: TradeAsset, from: Team, to: Team) {
  if (a.kind === 'pick') {
    (league.pickOwners ??= {})[a.key] = to.id;
    return;
  }
  const p = league.players[a.id];
  if (p.teamId === from.id) {
    from.roster = from.roster.filter((id) => id !== p.id);
    to.roster.push(p.id);
    p.teamId = to.id;
  } else {
    from.prospects = (from.prospects ?? []).filter((id) => id !== p.id);
    (to.prospects ??= []).push(p.id);
    p.prospectOf = to.id;
  }
  delete league.negotiations?.[p.id];
}

function refreshLines(league: League, team: Team, removed: Set<PlayerId>) {
  const dressed = [...team.lines.forwards.flat(), ...team.lines.defense.flat(), ...team.lines.goalies];
  const affected = dressed.some((id) => removed.has(id));
  if (team.controller.kind === 'ai' || team.autoLines || affected) {
    if (team.controller.kind === 'human' && affected) team.autoLines = true;
    try {
      team.lines = autoLines(healthyRoster(league, team));
    } catch {
      /* short-handed; game-day call-ups will fix it */
    }
  }
}

export function executeTrade(league: League, fromId: TeamId, toId: TeamId, give: TradeAsset[], get: TradeAsset[]) {
  const from = league.teams[fromId];
  const to = league.teams[toId];
  for (const a of give) moveAsset(league, a, from, to);
  for (const a of get) moveAsset(league, a, to, from);
  const ids = (xs: TradeAsset[]) => new Set(xs.filter((a) => a.kind === 'player').map((a) => (a as { id: string }).id));
  refreshLines(league, from, ids(give));
  refreshLines(league, to, ids(get));
  const list = (xs: TradeAsset[]) => (xs.length ? xs.map((a) => describeAsset(league, a)).join(', ') : 'nothing');
  const note = `${from.city} trade ${list(give)} to ${to.city} for ${list(get)}`;
  const first = give.find((a) => a.kind === 'player') ?? get.find((a) => a.kind === 'player');
  const playerId = first && first.kind === 'player' ? first.id : '';
  for (const t of [fromId, toId]) league.transactions.push({ day: league.day, season: league.season, type: 'trade', teamId: t, playerId, note });
  void capSeason;
}

// ---------------------------------------------------------------------------
// AI decisions
// ---------------------------------------------------------------------------

export interface TradeVerdict {
  accept: boolean;
  /** Value received / value given, from the AI's point of view. */
  ratio: number;
  reason: string;
}

/** How the AI team `aiId` feels about receiving `incoming` for `outgoing`. */
export function evaluateForAi(league: League, aiId: TeamId, incoming: TradeAsset[], outgoing: TradeAsset[]): TradeVerdict {
  const team = league.teams[aiId];
  const vin = packageIn(incoming.map((a) => assetValue(league, team, a)));
  const vout = outgoing.reduce((s, a) => s + Math.max(0, assetValue(league, team, a)), 0);
  // Don't leave the roster short at a position.
  const roster = team.roster.map((id) => league.players[id]);
  for (const g of ['F', 'D', 'G'] as const) {
    const lose = outgoing.filter((a) => a.kind === 'player' && league.players[a.id].teamId === aiId && group(league.players[a.id]) === g).length;
    const gain = incoming.filter((a) => a.kind === 'player' && league.players[a.id].teamId && group(league.players[a.id]) === g).length;
    const have = roster.filter((p) => group(p) === g).length;
    if (have - lose + gain < MIN_GROUP[g]) return { accept: false, ratio: vin / Math.max(1, vout), reason: `We'd be short at ${g === 'F' ? 'forward' : g === 'D' ? 'defense' : 'goalie'}.` };
  }
  const ratio = vin / Math.max(1, vout);
  const accept = vin >= vout * TRADE.aiMargin + TRADE.aiFlatMargin;
  const reason = accept
    ? 'Deal.'
    : ratio >= 0.85
      ? "Close, but we'd need a little more."
      : ratio >= 0.6
        ? "We'd need quite a bit more."
        : "Not interested.";
  return { accept, ratio, reason };
}

/**
 * The cheapest addition (up to three assets) from the other team's side that
 * gets the AI to yes, or null if nothing does. "Cheapest" is by the AI's own
 * valuation, so it asks for the least it would take, not the best thing you own.
 */
export function aiAsk(league: League, aiId: TeamId, otherId: TeamId, incoming: TradeAsset[], outgoing: TradeAsset[]): TradeAsset[] | null {
  const already = new Set(incoming.map((a) => (a.kind === 'pick' ? a.key : a.id)));
  const other = league.teams[otherId];
  const team = league.teams[aiId];
  const candidates: TradeAsset[] = [
    ...other.roster.map((id) => ({ kind: 'player' as const, id })),
    ...(other.prospects ?? []).map((id) => ({ kind: 'player' as const, id })),
    ...teamPicks(league, otherId).map((key) => ({ kind: 'pick' as const, key })),
  ].filter((a) => !already.has(a.kind === 'pick' ? a.key : a.id));
  const scored = candidates
    .map((a) => ({ a, v: assetValue(league, team, a) }))
    .filter((x) => x.v > 0)
    .sort((x, y) => x.v - y.v)
    .slice(0, 40);
  const works = (extra: TradeAsset[]) => {
    const next = [...incoming, ...extra];
    return !validateTrade(league, otherId, aiId, next, outgoing) && evaluateForAi(league, aiId, next, outgoing).accept;
  };
  let best: { assets: TradeAsset[]; cost: number } | null = null;
  const consider = (xs: typeof scored) => {
    const cost = xs.reduce((s, x) => s + x.v, 0);
    if (best && cost >= best.cost) return;
    if (works(xs.map((x) => x.a))) best = { assets: xs.map((x) => x.a), cost };
  };
  for (let i = 0; i < scored.length; i++) {
    consider([scored[i]]);
    for (let j = i + 1; j < scored.length; j++) {
      consider([scored[i], scored[j]]);
      for (let k = j + 1; k < Math.min(scored.length, j + 12); k++) consider([scored[i], scored[j], scored[k]]);
    }
  }
  return best ? (best as { assets: TradeAsset[] }).assets : null;
}

// ---------------------------------------------------------------------------
// Proposals (human-involved trades)
// ---------------------------------------------------------------------------

export function proposeTrade(league: League, fromId: TeamId, toId: TeamId, give: TradeAsset[], get: TradeAsset[]): TradeProposal {
  const err = validateTrade(league, fromId, toId, give, get);
  if (err) throw new Error(err);
  const trades = (league.trades ??= []);
  const t: TradeProposal = {
    id: `t${league.season}-${trades.length + 1}`,
    season: league.season,
    day: league.day,
    fromTeam: fromId,
    toTeam: toId,
    give,
    get,
    status: 'pending',
  };
  trades.push(t);
  const to = league.teams[toId];
  if (to.controller.kind === 'ai') {
    const v = evaluateForAi(league, toId, give, get);
    if (!v.accept) {
      t.status = 'rejected';
      t.note = v.reason;
    } else finalizeAccepted(league, t);
  }
  return t;
}

function needsReview(league: League, t: TradeProposal): boolean {
  if (league.settings.tradeReview !== 'commissioner') return false;
  return [t.fromTeam, t.toTeam].some((id) => league.teams[id].controller.kind === 'human');
}

function finalizeAccepted(league: League, t: TradeProposal) {
  if (needsReview(league, t)) {
    t.status = 'awaiting-approval';
    t.note = 'Waiting for the commissioner to approve.';
    return;
  }
  complete(league, t);
}

function complete(league: League, t: TradeProposal) {
  const err = validateTrade(league, t.fromTeam, t.toTeam, t.give, t.get);
  if (err) {
    t.status = 'invalid';
    t.note = err;
    return;
  }
  executeTrade(league, t.fromTeam, t.toTeam, t.give, t.get);
  t.status = 'completed';
  t.resolvedDay = league.day;
  invalidateStale(league);
}

export function respondToTrade(league: League, tradeId: string, teamId: TeamId, accept: boolean) {
  const t = league.trades?.find((x) => x.id === tradeId);
  if (!t || t.status !== 'pending') throw new Error('That trade is no longer pending');
  if (t.toTeam !== teamId) throw new Error('Only the receiving team can respond');
  t.resolvedDay = league.day;
  if (!accept) {
    t.status = 'rejected';
    return t;
  }
  finalizeAccepted(league, t);
  return t;
}

export function withdrawTrade(league: League, tradeId: string, teamId: TeamId) {
  const t = league.trades?.find((x) => x.id === tradeId);
  if (!t || (t.status !== 'pending' && t.status !== 'awaiting-approval')) throw new Error('That trade is no longer pending');
  if (t.fromTeam !== teamId) throw new Error('Only the proposing team can withdraw');
  t.status = 'withdrawn';
  t.resolvedDay = league.day;
}

export function reviewTrade(league: League, tradeId: string, approve: boolean) {
  const t = league.trades?.find((x) => x.id === tradeId);
  if (!t || t.status !== 'awaiting-approval') throw new Error('That trade is not awaiting approval');
  if (approve) complete(league, t);
  else {
    t.status = 'vetoed';
    t.note = 'Vetoed by the commissioner.';
    t.resolvedDay = league.day;
  }
}

/** Pending trades whose assets have moved (or that broke the rules) are voided. */
export function invalidateStale(league: League) {
  for (const t of league.trades ?? []) {
    if (t.status !== 'pending' && t.status !== 'awaiting-approval') continue;
    const err = validateTrade(league, t.fromTeam, t.toTeam, t.give, t.get);
    if (err) {
      t.status = 'invalid';
      t.note = err;
      t.resolvedDay = league.day;
    }
  }
}

// ---------------------------------------------------------------------------
// AI-to-AI trades during the season
// ---------------------------------------------------------------------------

/**
 * Occasionally a contender buys a veteran from a rebuilding team with
 * prospects and picks. More likely in the days before the deadline.
 */
export function aiTradeDay(league: League): TradeProposal | null {
  if (league.phase !== 'regular-season' || !tradeWindowOpen(league).open) return null;
  const rng = new Rng(deriveSeed(league.seed, `ai-trade:${league.season}:${league.day}`));
  const deadline = tradeDeadline(league);
  const chance = deadline - league.day <= 7 ? 0.7 : 0.18;
  if (!rng.chance(chance)) return null;
  const ai = Object.values(league.teams).filter((t) => t.controller.kind === 'ai');
  const buyers = ai.filter((t) => t.controller.kind === 'ai' && t.controller.strategy === 'contend');
  const sellers = ai.filter((t) => t.controller.kind === 'ai' && t.controller.strategy === 'rebuild');
  if (!buyers.length || !sellers.length) return null;
  // Nobody guts a roster in one season: at most two sales / two purchases per team.
  const dealsThisSeason = (teamId: TeamId, side: 'fromTeam' | 'toTeam') =>
    (league.trades ?? []).filter((t) => t.season === league.season && t.status === 'completed' && t[side] === teamId && league.teams[t.fromTeam].controller.kind === 'ai' && league.teams[t.toTeam].controller.kind === 'ai').length;
  const buyer = rng.pick(buyers);
  const seller = rng.pick(sellers);
  if (dealsThisSeason(buyer.id, 'fromTeam') >= 2 || dealsThisSeason(seller.id, 'toTeam') >= 2) return null;
  // Sellers move veterans and pending free agents, not their young core.
  const vets = seller.roster
    .map((id) => league.players[id])
    .filter((p) => overall(p) >= 70 && !p.injury && (age(p, league.season) >= 29 || (p.contract?.yearsLeft ?? 0) <= 1))
    .sort((a, b) => overall(b) - overall(a));
  if (!vets.length) return null;
  const target = vets[rng.int(0, Math.min(2, vets.length - 1))];
  const get: TradeAsset[] = [{ kind: 'player', id: target.id }];
  // Build the buyer's offer from prospects and picks, cheapest first, until the seller says yes.
  const pieces: TradeAsset[] = [
    ...(buyer.prospects ?? []).map((id) => ({ kind: 'player' as const, id })),
    ...teamPicks(league, buyer.id).filter((k) => parsePickKey(k).round <= 3).map((key) => ({ kind: 'pick' as const, key })),
  ];
  const scored = pieces.map((a) => ({ a, v: assetValue(league, seller, a) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const give: TradeAsset[] = [];
  for (const { a } of scored) {
    if (give.length >= 3) break;
    give.push(a);
    if (validateTrade(league, buyer.id, seller.id, give, get)) {
      give.pop();
      continue;
    }
    if (evaluateForAi(league, seller.id, give, get).accept) {
      // The buyer has to like it too.
      if (!evaluateForAi(league, buyer.id, get, give).accept && evaluateForAi(league, buyer.id, get, give).ratio < 0.9) return null;
      const t: TradeProposal = {
        id: `t${league.season}-${(league.trades ??= []).length + 1}`,
        season: league.season,
        day: league.day,
        fromTeam: buyer.id,
        toTeam: seller.id,
        give,
        get,
        status: 'pending',
      };
      league.trades.push(t);
      complete(league, t);
      return t;
    }
  }
  return null;
}
