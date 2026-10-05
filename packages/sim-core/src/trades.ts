/**
 * Trades.
 *
 * Assets are players (roster or prospects) and draft picks up to four years
 * out (five drafts). AI teams value assets from their own point of view:
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
import { CONTRACT_MAX } from './farm';
import { capRoom, capSeason, marketValue, ROSTER_MAX, SUMMER_ROSTER_MAX } from './contracts';
import { scoutedPotential } from './draft';
import { autoLines } from './lines';
import { age, overall } from './ratings';
import { deriveSeed, Rng } from './rng';
import { healthyRoster, teamLines } from './roster';
import type { League, NeedTag, Player, PlayerId, Team, TeamId, TradeAsset, TradeProposal } from './types';
import { assetFits, BLOCK_DISCOUNT, NEED_BONUS, tradeBlock } from './block';
import { slider } from './sliders';
import { memo, withMemo } from './memo';

export const TRADE = {
  /** AI wants to come out ahead by this much (ratio of value received to value given). */
  aiMargin: 1.05,
  aiFlatMargin: 10,
  consolidation: [1, 0.7, 0.5, 0.35, 0.25, 0.2],
  futureDiscount: 0.85,
  /** Tradeable draft years: this one plus four more. */
  pickSeasonsAhead: 4,
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

/** The draft in progress (picks can be traded while it runs). */
function activeDraft(league: League) {
  return league.phase === 'offseason' && league.offseason?.stage === 'draft' ? league.offseason.draft : null;
}

/** During the draft, a pick in this year's draft (with its slot and whether it's been used). */
export function draftSlot(league: League, key: string) {
  const d = activeDraft(league);
  if (!d) return null;
  const { season, round, originalTeam } = parsePickKey(key);
  if (season !== d.season) return null;
  return d.picks.find((p) => p.round === round && p.originalTeamId === originalTeam) ?? null;
}

export function pickOwner(league: League, key: string): TeamId {
  const slot = draftSlot(league, key);
  if (slot) return slot.teamId;
  return league.pickOwners?.[key] ?? parsePickKey(key).originalTeam;
}

/** Draft years whose picks can still be traded (during the draft, this year's unused picks too). */
export function tradeablePickSeasons(league: League): number[] {
  const drafted = league.phase === 'offseason' && league.offseason?.draft ? league.offseason.draft.season : null;
  const first = drafted === league.season ? league.season + 1 : league.season;
  const years = Array.from({ length: TRADE.pickSeasonsAhead + 1 }, (_, i) => first + i);
  const d = activeDraft(league);
  return d ? [d.season, ...years] : years;
}

export function teamPicks(league: League, teamId: TeamId): string[] {
  const out: string[] = [];
  for (const season of tradeablePickSeasons(league)) {
    for (let round = 1; round <= 7; round++) {
      for (const orig of Object.keys(league.teams)) {
        const key = pickKey(season, round, orig);
        if (pickOwner(league, key) === teamId && !draftSlot(league, key)?.playerId) out.push(key);
      }
    }
  }
  return out;
}

export function pickLabel(key: string, league?: League): string {
  const { season, round, originalTeam } = parsePickKey(key);
  const ord = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][round];
  const slot = league ? draftSlot(league, key) : null;
  return slot ? `${season} ${ord} round, #${slot.overall} overall (${originalTeam})` : `${season} ${ord} round (${originalTeam})`;
}

/** Where a team's pick is likely to land (1 = first overall), from its current points %. */
export function projectedSlot(league: League, teamId: TeamId): number {
  // One pass over the schedule for every team's record (and once per page or trade evaluation: see memo.ts).
  const slots = memo('projected-slots', () => {
    const rec = new Map(Object.keys(league.teams).map((id) => [id, { w: 0, gp: 0, otl: 0 }]));
    for (const g of league.schedule) {
      if (!g.result) continue;
      const h = rec.get(g.home);
      const a = rec.get(g.away);
      const homeWon = g.result.homeScore > g.result.awayScore;
      if (h) {
        h.gp++;
        if (homeWon) h.w++;
        else if (g.result.overtime) h.otl++;
      }
      if (a) {
        a.gp++;
        if (!homeWon) a.w++;
        else if (g.result.overtime) a.otl++;
      }
    }
    // (Team order breaks ties, as a stable sort over the teams did before.)
    const rows = Object.keys(league.teams).map((id) => {
      const r = rec.get(id)!;
      return { id, pct: r.gp ? (2 * r.w + r.otl) / (2 * r.gp) : 0.5 };
    });
    rows.sort((x, y) => x.pct - y.pct);
    return new Map(rows.map((r, i) => [r.id, i + 1]));
  });
  return slots.get(teamId) ?? 0;
}

export function pickValue(league: League, forTeam: Team, key: string): number {
  const { season, round, originalTeam } = parsePickKey(key);
  const yearsOut = Math.max(0, season - league.season);
  // During the draft the slot is known; next year's is uncertain, so regress it toward the middle.
  const live = draftSlot(league, key);
  const slot = live ? live.overall - (round - 1) * Object.keys(league.teams).length : projectedSlot(league, originalTeam);
  const expectedSlot = yearsOut === 0 || live ? slot : 16.5 + (slot - 16.5) * 0.4;
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
  if (a.kind === 'pick') return pickValue(league, forTeam, a.key);
  const p = league.players[a.id];
  if (!a.retain || !p.contract) return playerValue(league, forTeam, p);
  // Retained salary: the team getting him values the cheaper contract; the team keeping part of it pays for that.
  const kept = retainedAmount(p, a.retain);
  const owner = p.teamId ?? p.prospectOf;
  if (owner === forTeam.id) return playerValue(league, forTeam, p) + (kept / 1e6) * retainedSeasons(league, p) * 6;
  return playerValue(league, forTeam, { ...p, contract: { ...p.contract, salary: p.contract.salary - kept } });
}

// ---------------------------------------------------------------------------
// Retained salary
// ---------------------------------------------------------------------------

export const RETENTION = { max: 0.5, maxContracts: 3 };

export const retainedAmount = (p: Player, share: number) => Math.round(((p.contract?.salary ?? 0) * Math.min(RETENTION.max, Math.max(0, share))) / 1000) * 1000;

/** Seasons of his contract still to count against the cap (this one included). */
export function retainedSeasons(league: League, p: Player): number {
  if (!p.contract) return 0;
  return Math.max(0, league.season + p.contract.yearsLeft - 1 - capSeason(league) + 1);
}

/** Retained-salary contracts a team is carrying now. */
export function retainedCount(league: League, team: Team): number {
  const now = capSeason(league);
  return (team.deadCap ?? []).filter((d) => d.retained && d.untilSeason >= now).length;
}

/** Value of a package received, with diminishing returns for quantity. */
export function packageIn(values: number[]): number {
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

/** Days until the deadline (0 = deadline day; negative = passed). Null outside the regular season. */
export function daysToDeadline(league: League): number | null {
  return league.phase === 'regular-season' ? tradeDeadline(league) - league.day : null;
}

export function tradeWindowOpen(league: League): { open: boolean; reason?: string } {
  if (league.phase === 'playoffs') return { open: false, reason: 'Trades are frozen during the playoffs.' };
  if (league.phase === 'regular-season' && league.day > tradeDeadline(league)) return { open: false, reason: 'The trade deadline has passed.' };
  return { open: true };
}

function owns(league: League, teamId: TeamId, a: TradeAsset): boolean {
  if (a.kind === 'pick') {
    if (draftSlot(league, a.key)?.playerId) return false; // already used
    return tradeablePickSeasons(league).includes(parsePickKey(a.key).season) && pickOwner(league, a.key) === teamId;
  }
  const p = league.players[a.id];
  return !!p && (p.teamId === teamId || p.prospectOf === teamId);
}

/** His cap hit as he moves (less whatever the sending team retains). */
const salaryOf = (league: League, a: TradeAsset) => {
  if (a.kind !== 'player') return 0;
  const p = league.players[a.id];
  return (p?.contract?.salary ?? 0) - (a.retain && p ? retainedAmount(p, a.retain) : 0);
};
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
  for (const [teamId, out] of [
    [fromId, give],
    [toId, get],
  ] as const) {
    const kept = out.filter((a) => a.kind === 'player' && a.retain);
    for (const a of kept) {
      if (a.kind !== 'player') continue;
      const p = league.players[a.id];
      if (a.retain! > RETENTION.max) return `A team can retain at most ${RETENTION.max * 100}% of a salary.`;
      if (!p.contract || !p.teamId) return `${p.firstName} ${p.lastName} has no NHL contract to retain part of.`;
      if (retainedSeasons(league, p) < 1) return `${p.firstName} ${p.lastName}'s contract is expiring: there's nothing to retain.`;
    }
    if (kept.length && retainedCount(league, league.teams[teamId]) + kept.length > RETENTION.maxContracts) {
      return `${league.teams[teamId].city} can carry at most ${RETENTION.maxContracts} retained contracts.`;
    }
  }
  const cap = league.settings.salaryCap;
  const maxRoster = CONTRACT_MAX;
  for (const [teamId, out, inn] of [
    [fromId, give, get],
    [toId, get, give],
  ] as const) {
    const team = league.teams[teamId];
    const delta = inn.reduce((s, a) => s + salaryOf(league, a), 0) - out.reduce((s, a) => s + salaryOf(league, a), 0);
    if (delta > 0 && capRoom(league, team) - delta < 0) return `${team.city} would be over the salary cap by $${((delta - capRoom(league, team)) / 1e6).toFixed(2)}M.`;
    const rosterAfter = team.roster.length - out.filter((a) => onRoster(league, a)).length + inn.filter((a) => onRoster(league, a)).length;
    // Only block trades that add contracts past the limit.
    if (rosterAfter > maxRoster && rosterAfter > team.roster.length) return `${team.city} would be over the ${CONTRACT_MAX}-contract limit (${rosterAfter}).`;
  }
  void cap;
  return null;
}

export function describeAsset(league: League, a: TradeAsset): string {
  if (a.kind === 'pick') return pickLabel(a.key, league);
  const p = league.players[a.id];
  return p ? `${p.firstName} ${p.lastName} (${p.pos}, ${overall(p)}${a.retain ? `, ${Math.round(a.retain * 100)}% retained` : ''})` : a.id;
}

function moveAsset(league: League, a: TradeAsset, from: Team, to: Team) {
  if (a.kind === 'pick') {
    const slot = draftSlot(league, a.key);
    if (slot) slot.teamId = to.id;
    else (league.pickOwners ??= {})[a.key] = to.id;
    return;
  }
  const p = league.players[a.id];
  if (a.retain && p.contract && p.teamId === from.id) {
    // The old team keeps part of his salary on its cap for the rest of the contract.
    const kept = retainedAmount(p, a.retain);
    const seasons = retainedSeasons(league, p);
    if (kept > 0 && seasons > 0) {
      const now = capSeason(league);
      (from.deadCap ??= []).push({ playerName: `${p.firstName} ${p.lastName} (retained)`, amount: kept, fromSeason: now, untilSeason: now + seasons - 1, retained: true });
      p.contract.salary -= kept;
    }
  }
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
      team.lines = teamLines(league, team);
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

/** What an AI team is looking for and shopping, computed once per decision. */
export interface AiContext {
  needs: NeedTag[];
  onBlock: Set<string>;
}

export function aiContext(league: League, aiId: TeamId): AiContext {
  const b = tradeBlock(league, league.teams[aiId]);
  return { needs: b.needs, onBlock: new Set([...b.players, ...b.picks]) };
}

/** How the AI team `aiId` feels about receiving `incoming` for `outgoing`. */
export function evaluateForAi(league: League, aiId: TeamId, incoming: TradeAsset[], outgoing: TradeAsset[], ctx = aiContext(league, aiId)): TradeVerdict {
  const team = league.teams[aiId];
  // Assets that fit a need are worth a bit more; ones already on the block a bit less.
  const vin = packageIn(incoming.map((a) => assetValue(league, team, a) * (assetFits(league, a, ctx.needs).length ? NEED_BONUS : 1)));
  const vout = outgoing.reduce((s, a) => s + Math.max(0, assetValue(league, team, a)) * (ctx.onBlock.has(a.kind === 'pick' ? a.key : a.id) ? BLOCK_DISCOUNT : 1), 0);
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
export function aiAsk(
  league: League,
  aiId: TeamId,
  otherId: TeamId,
  incoming: TradeAsset[],
  outgoing: TradeAsset[],
  /** Limit what it may ask for (default: anything the other team owns). */
  allow?: (a: TradeAsset) => boolean,
): TradeAsset[] | null {
  return withMemo(() => aiAskInner(league, aiId, otherId, incoming, outgoing, allow));
}

function aiAskInner(league: League, aiId: TeamId, otherId: TeamId, incoming: TradeAsset[], outgoing: TradeAsset[], allow?: (a: TradeAsset) => boolean): TradeAsset[] | null {
  const already = new Set(incoming.map((a) => (a.kind === 'pick' ? a.key : a.id)));
  const other = league.teams[otherId];
  const team = league.teams[aiId];
  const candidates: TradeAsset[] = [
    ...other.roster.map((id) => ({ kind: 'player' as const, id })),
    ...(other.prospects ?? []).map((id) => ({ kind: 'player' as const, id })),
    // Late-round picks are near-worthless and would crowd out real options (five drafts' worth).
    ...teamPicks(league, otherId)
      .filter((key) => parsePickKey(key).round <= 3)
      .map((key) => ({ kind: 'pick' as const, key })),
  ].filter((a) => !already.has(a.kind === 'pick' ? a.key : a.id) && (!allow || allow(a)));
  const ctx = aiContext(league, aiId);
  // What each asset is worth to the AI inside a package (as evaluateForAi counts it: a bonus if it fills a need).
  const worth = (a: TradeAsset) => assetValue(league, team, a) * (assetFits(league, a, ctx.needs).length ? NEED_BONUS : 1);
  const scored = candidates
    .map((a) => ({ a, v: assetValue(league, team, a), adj: worth(a) }))
    .filter((x) => x.v > 0)
    .sort((x, y) => x.v - y.v)
    .slice(0, 40);
  // The bar the package has to clear, worked out once. Thousands of combinations are
  // then weeded out with arithmetic; only ones that clear it get the full check
  // (cap, contract limits, roster holes).
  const have = incoming.map(worth);
  const giving = outgoing.reduce((s, a) => s + Math.max(0, assetValue(league, team, a)) * (ctx.onBlock.has(a.kind === 'pick' ? a.key : a.id) ? BLOCK_DISCOUNT : 1), 0);
  const bar = giving * TRADE.aiMargin + TRADE.aiFlatMargin;
  const clears = (xs: typeof scored) => packageIn([...have, ...xs.map((x) => x.adj)]) >= bar;
  // Nothing the other team owns gets there: don't bother searching.
  const bestThree = [...scored].sort((x, y) => y.adj - x.adj).slice(0, 3);
  if (!clears(bestThree) && !clears(bestThree.slice(0, 2)) && !clears(bestThree.slice(0, 1))) return null;
  const works = (extra: TradeAsset[]) => {
    const next = [...incoming, ...extra];
    return !validateTrade(league, otherId, aiId, next, outgoing) && evaluateForAi(league, aiId, next, outgoing, ctx).accept;
  };
  let best: { assets: TradeAsset[]; cost: number } | null = null;
  const consider = (xs: typeof scored) => {
    const cost = xs.reduce((s, x) => s + x.v, 0);
    if (best && cost >= best.cost) return;
    if (!clears(xs)) return;
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
  // An AI team's own offer: it has to still want the deal (an injury or a slump since can change that).
  if (t.ai && league.teams[t.fromTeam].controller.kind === 'ai' && !aiStillWants(league, t)) {
    t.status = 'withdrawn';
    t.note = `${league.teams[t.fromTeam].city} backed out: the deal no longer works for them.`;
    return t;
  }
  finalizeAccepted(league, t);
  return t;
}

/** Would the AI team that made this offer still take it? (A little slack: it doesn't back out over a rounding error.) */
export function aiStillWants(league: League, t: TradeProposal): boolean {
  if (validateTrade(league, t.fromTeam, t.toTeam, t.give, t.get)) return true; // (not its call: the trade is void anyway)
  const v = evaluateForAi(league, t.fromTeam, t.get, t.give);
  return v.accept || (v.ratio >= 1 && !v.reason.startsWith("We'd be short"));
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
  const chance = Math.min(1, (deadline - league.day <= 7 ? 0.7 : 0.18) * slider(league, 'trades'));
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
  // Sellers move what's on their block (veterans and pending free agents), not their young core.
  const vets = tradeBlock(league, seller)
    .players.map((id) => league.players[id])
    .filter((p) => p && p.teamId === seller.id && overall(p) >= 70 && !p.injury)
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
  const sellerCtx = aiContext(league, seller.id);
  const buyerCtx = aiContext(league, buyer.id);
  for (const { a } of scored) {
    if (give.length >= 3) break;
    give.push(a);
    if (validateTrade(league, buyer.id, seller.id, give, get)) {
      give.pop();
      continue;
    }
    if (evaluateForAi(league, seller.id, give, get, sellerCtx).accept) {
      // The buyer has to like it too.
      const b = evaluateForAi(league, buyer.id, get, give, buyerCtx);
      if (!b.accept && b.ratio < 0.9) return null;
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
