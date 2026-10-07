/**
 * AI front offices calling managers.
 *
 * AI teams don't only answer the phone. Now and then one of them makes a
 * manager an offer: a contender after one of his veterans, a team that saw a
 * name on his trade block, a seller with a player who would help him. The
 * offer is a normal pending trade proposal the manager accepts or declines,
 * and it stands for a limited time.
 *
 * Every offer is one the AI team would accept itself (the same evaluation it
 * uses for proposals it receives) and is in the neighbourhood of fair by the
 * values the manager sees on the trade screen; some are a little light and
 * some a little generous, which is the manager's to judge.
 */
import { assetFits, BLOCK_DISCOUNT, NEED_BONUS, positionNeeds, tradeBlock } from './block';
import { capRoom } from './contracts';
import { withMemo } from './memo';
import { age, overall } from './ratings';
import { deriveSeed, Rng } from './rng';
import { slider } from './sliders';
import {
  aiAsk,
  aiContext,
  aiStillWants,
  assetValue,
  evaluateForAi,
  packageIn,
  parsePickKey,
  projectedSlot,
  RETENTION,
  retainedCount,
  retainedSeasons,
  teamPicks,
  TRADE,
  tradeDeadline,
  tradeWindowOpen,
  validateTrade,
} from './trades';
import type { League, NeedTag, Player, PlayerId, Team, TradeAsset, TradeProposal } from './types';

export const AI_OFFER = {
  /** Chance per manager per day that some AI team calls. */
  perDay: 0.035,
  /** …multiplied in the last week before the deadline, */
  deadlineBoost: 3,
  /** …and for a manager who has put players on the block or listed needs. */
  activeBoost: 1.8,
  /** Chance per manager per day of the re-signing week and free agency. */
  offseasonPerDay: 0.08,
  /** How long an offer stands (days; in the offseason, days of the re-signing week and free agency). */
  days: 10,
  offseasonDays: 4,
  /** Open AI offers a manager can have at once. */
  maxOpen: 2,
  /** The same AI team doesn't call the same manager again for this long, */
  pairCooldown: 10,
  /** …and nobody calls about the same player for this long. */
  playerCooldown: 30,
  /** What the manager gets, as a share of what he gives (by his own values): between these. */
  fair: [0.9, 1.12] as const,
};

/** Offseason days are counted from here so they never collide with days of the season. */
const OFFSEASON_CLOCK = 10_000;
/** (Days in the re-signing week: free-agency days follow on.) */
const RESIGN_WEEK = 7;

/**
 * The day counter offers are timed against: the day of the season, or a
 * running count through the re-signing week and free agency. Null when AI
 * teams aren't calling (trades closed, the draft, training camp).
 */
export function offerClock(league: League): number | null {
  if (!tradeWindowOpen(league).open) return null;
  if (league.phase === 'regular-season') return league.day;
  const os = league.offseason;
  if (league.phase !== 'offseason' || !os) return null;
  if (os.stage === 're-sign') return OFFSEASON_CLOCK + (os.resignDay ?? 1);
  if (os.stage === 'free-agency') return OFFSEASON_CLOCK + RESIGN_WEEK + (os.faDay ?? ((os.faRound ?? 1) - 1) * 3 + 1);
  return null;
}

/** Days an open AI offer still stands (1 = today is the last day), or null if it isn't one. */
export function offerDaysLeft(league: League, t: TradeProposal): number | null {
  const clock = offerClock(league);
  if (!t.ai || t.status !== 'pending' || clock === null) return null;
  return Math.max(1, t.ai.expires - clock + 1);
}

const isAi = (t: Team) => t.controller.kind === 'ai';
const keyOf = (a: TradeAsset) => (a.kind === 'pick' ? a.key : a.id);
const nameOf = (p: Player) => `${p.firstName} ${p.lastName}`;
const slotGroup = (p: Player) => (p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F');
const POSITION: Record<string, string> = { C: 'center', W: 'the wing', D: 'defense', G: 'goal' };

/** Can he be dealt right now? (In the offseason, players whose contracts are up aren't anyone's to trade.) */
function movable(league: League, p: Player | undefined): p is Player {
  if (!p) return false;
  if (p.injury && p.injury.daysLeft > 10) return false;
  if (league.phase === 'offseason') {
    const os = league.offseason;
    if (p.teamId && !p.contract) return false;
    // During the re-signing week a contract that is up (and not yet renewed) is about to end.
    // (Once free agency opens, every contract left on a roster runs through next season at least.)
    if (os?.stage === 're-sign' && os.expiring[p.id] && !p.extension) return false;
    if (os?.rfa?.[p.id]) return false;
  }
  return true;
}

/** Pending AI offers are closed when their time is up, when they can no longer be made, or when the team that made one no longer wants it. */
function closeStale(league: League, clock: number | null) {
  for (const t of league.trades ?? []) {
    if (!t.ai || t.status !== 'pending') continue;
    const from = league.teams[t.fromTeam];
    const broken = clock === null ? null : validateTrade(league, t.fromTeam, t.toTeam, t.give, t.get);
    if (clock === null || clock > t.ai.expires || clock < t.ai.clock) {
      t.status = 'withdrawn';
      t.note = 'The offer expired.';
      t.resolvedDay = league.day;
    } else if (broken) {
      // (A signing, a call-up or another trade since: the deal can't be made any more.)
      t.status = 'invalid';
      t.note = broken;
      t.resolvedDay = league.day;
    } else if (!aiStillWants(league, t)) {
      t.status = 'withdrawn';
      t.note = `${from.city} pulled the offer: the deal no longer works for them.`;
      t.resolvedDay = league.day;
    }
  }
}

/**
 * One day of AI teams working the phones. Returns the offers made today.
 * (Deterministic: the same league on the same day gets the same calls.)
 */
export function aiOfferDay(league: League): TradeProposal[] {
  const clock = offerClock(league);
  if (!league.trades?.length && clock === null) return [];
  return withMemo(() => {
    closeStale(league, clock);
    // (Nothing on the first day of the re-signing week: the draft has only just ended.)
    if (clock === null || clock === OFFSEASON_CLOCK + 1) return [];
    const managers = Object.values(league.teams)
      .filter((t) => !isAi(t))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!managers.length || !Object.values(league.teams).some(isAi)) return [];
    const offseason = league.phase === 'offseason';
    const made: TradeProposal[] = [];
    for (const H of managers) {
      const rng = new Rng(deriveSeed(league.seed, `ai-offer:${league.season}:${clock}:${H.id}`));
      const open = (league.trades ?? []).filter((t) => t.ai && t.status === 'pending' && t.toTeam === H.id);
      if (open.length >= AI_OFFER.maxOpen) continue;
      const block = tradeBlock(league, H);
      let chance = offseason ? AI_OFFER.offseasonPerDay : AI_OFFER.perDay;
      if (!offseason && tradeDeadline(league) - league.day <= 7) chance *= AI_OFFER.deadlineBoost;
      if (block.players.length || block.needs.length) chance *= AI_OFFER.activeBoost;
      if (!rng.chance(Math.min(1, chance * slider(league, 'trades')))) continue;
      const t = makeOffer(league, H, clock, rng);
      if (t) made.push(t);
    }
    return made;
  });
}

type Idea = { from: Team; give: TradeAsset[]; get: TradeAsset[]; headline: Player; pitch: string };

function makeOffer(league: League, H: Team, clock: number, rng: Rng): TradeProposal | null {
  const trades = (league.trades ??= []);
  // Who called lately, and about whom.
  const recent = trades.filter((t) => t.ai && t.toTeam === H.id && t.season === league.season && clock >= t.ai.clock);
  const calledLately = new Set(recent.filter((t) => clock - t.ai!.clock < AI_OFFER.pairCooldown).map((t) => t.fromTeam));
  // (A player he said no about isn't raised again this season.)
  const askedAbout = new Set(recent.filter((t) => t.status === 'rejected' || clock - t.ai!.clock < AI_OFFER.playerCooldown).map((t) => t.ai!.headline));
  const callers = rng
    .shuffle(Object.values(league.teams).filter(isAi).sort((a, b) => a.id.localeCompare(b.id)))
    .filter((t) => !calledLately.has(t.id))
    .slice(0, 10);
  if (!callers.length) return null;

  // Is the manager's team buying or selling? (Only once the standings mean something.)
  const n = Object.keys(league.teams).length;
  const played = league.phase === 'regular-season' ? league.schedule.filter((g) => g.result && (g.home === H.id || g.away === H.id)).length : 0;
  const slot = played >= 15 ? projectedSlot(league, H.id) : 0; // 1 = last place
  const selling = slot > 0 && slot <= n / 3;
  const buying = slot > n / 2;
  const block = tradeBlock(league, H);
  const wantHis = 1 + (block.players.length ? 2 : 0) + (selling ? 1 : 0);
  const offerMine = 1 + (block.needs.some((x) => x !== 'picks' && x !== 'prospects' && x !== 'cap-space') ? 2 : 0) + (buying ? 1 : 0);
  const order = rng.next() * (wantHis + offerMine) < wantHis ? [buyFromManager, sellToManager] : [sellToManager, buyFromManager];

  for (const idea of order) {
    for (const A of callers) {
      const found = idea(league, A, H, askedAbout, rng);
      if (!found) continue;
      const expires = league.phase === 'offseason' ? clock + AI_OFFER.offseasonDays - 1 : Math.min(clock + AI_OFFER.days - 1, tradeDeadline(league));
      const t: TradeProposal = {
        id: `t${league.season}-${trades.length + 1}`,
        season: league.season,
        day: league.day,
        fromTeam: found.from.id,
        toTeam: H.id,
        give: found.give,
        get: found.get,
        status: 'pending',
        ai: { clock, expires, headline: found.headline.id, pitch: found.pitch },
      };
      trades.push(t);
      return t;
    }
  }
  return null;
}

/** What the manager's side of a deal is worth to him: what he sees on the trade screen. */
const toManager = (league: League, H: Team, a: TradeAsset) => assetValue(league, H, a);

/** An AI team wants one of the manager's players, and pays in picks, prospects and players it's shopping. */
function buyFromManager(league: League, A: Team, H: Team, askedAbout: Set<PlayerId>, rng: Rng): Idea | null {
  const ctx = aiContext(league, A.id);
  const hBlock = new Set(tradeBlock(league, H).players);
  const strategy = A.controller.kind === 'ai' ? A.controller.strategy : 'balanced';
  // What it's shopping for: the positions it's weak at, plus veterans (contenders) or youth (rebuilders).
  const wants = ctx.needs.filter((x): x is NeedTag => x === 'C' || x === 'W' || x === 'D' || x === 'G' || x === 'veteran' || x === 'young');
  const roster = H.roster.map((id) => league.players[id]).filter(Boolean);
  // Nobody calls about a franchise player unless he's been made available.
  const core = new Set(
    [...roster]
      .sort((a, b) => toManager(league, H, { kind: 'player', id: b.id }) - toManager(league, H, { kind: 'player', id: a.id }))
      .slice(0, 4)
      .map((p) => p.id),
  );
  const pool = [...roster, ...(H.prospects ?? []).filter((id) => hBlock.has(id)).map((id) => league.players[id])];
  const season = league.season + (league.phase === 'offseason' ? 1 : 0);
  const targets = pool
    .filter((p) => movable(league, p) && !askedAbout.has(p.id))
    .map((p) => {
      const a: TradeAsset = { kind: 'player', id: p.id };
      const fits = assetFits(league, a, wants);
      const onBlock = hBlock.has(p.id);
      const worth = assetValue(league, A, a) * (assetFits(league, a, ctx.needs).length ? NEED_BONUS : 1);
      return { p, a, fits, onBlock, worth };
    })
    .filter((x) => x.worth > 20 && (x.onBlock || (x.fits.length > 0 && !core.has(x.p.id) && overall(x.p) >= 66)))
    // A rebuilding team isn't trading for a 31-year-old; a contender isn't trading for a project.
    .filter((x) => x.onBlock || (strategy === 'rebuild' ? age(x.p, season) <= 26 : strategy === 'contend' ? overall(x.p) >= 70 : true))
    .sort((x, y) => Number(y.onBlock) - Number(x.onBlock) || y.worth - x.worth)
    .slice(0, 4);
  if (!targets.length) return null;

  // What it can pay with.
  const aBlock = new Set(tradeBlock(league, A).players);
  const pieces: TradeAsset[] = [
    ...teamPicks(league, A.id)
      .filter((k) => parsePickKey(k).round <= 4)
      .map((key) => ({ kind: 'pick' as const, key })),
    ...(A.prospects ?? []).filter((id) => movable(league, league.players[id])).map((id) => ({ kind: 'player' as const, id })),
    ...A.roster.filter((id) => aBlock.has(id) && movable(league, league.players[id])).map((id) => ({ kind: 'player' as const, id })),
  ];
  const scored = pieces
    .map((a) => ({ a, mine: toManager(league, H, a), cost: Math.max(0, assetValue(league, A, a)) * (ctx.onBlock.has(keyOf(a)) ? BLOCK_DISCOUNT : 1) }))
    .filter((x) => x.mine > 3)
    .sort((x, y) => y.mine - x.mine)
    .slice(0, 16);
  const fair = AI_OFFER.fair[0] + rng.next() * (AI_OFFER.fair[1] - AI_OFFER.fair[0]);

  for (const target of targets) {
    const need = Math.max(8, toManager(league, H, target.a)) * fair;
    const budget = (target.worth - TRADE.aiFlatMargin) / TRADE.aiMargin; // the most it can give and still say yes
    let best: { xs: typeof scored; cost: number } | null = null;
    const consider = (xs: typeof scored) => {
      const cost = xs.reduce((s, x) => s + x.cost, 0);
      if (cost > budget || (best && cost >= best.cost)) return;
      if (packageIn(xs.map((x) => x.mine)) < need) return;
      const give = xs.map((x) => x.a);
      if (validateTrade(league, A.id, H.id, give, [target.a])) return;
      if (!evaluateForAi(league, A.id, [target.a], give, ctx).accept) return;
      best = { xs, cost };
    };
    for (let i = 0; i < scored.length; i++) {
      consider([scored[i]]);
      for (let j = i + 1; j < scored.length; j++) {
        consider([scored[i], scored[j]]);
        for (let k = j + 1; k < scored.length; k++) consider([scored[i], scored[j], scored[k]]);
      }
    }
    if (!best) continue;
    const p = target.p;
    const need0 = target.fits.find((x) => POSITION[x]);
    const pitch = target.onBlock
      ? `We saw ${nameOf(p)} on your trade block. Here's what we can do.`
      : strategy === 'contend'
        ? need0
          ? `We're going for it this year and need help at ${POSITION[need0]}. ${nameOf(p)} is the player we want.`
          : `We're going for it this year, and ${nameOf(p)} would put us over the top.`
        : strategy === 'rebuild'
          ? `We're building for the future, and ${nameOf(p)} fits our timeline.`
          : need0
            ? `We need help at ${POSITION[need0]}, and we like ${nameOf(p)}.`
            : `We like ${nameOf(p)}. Here's our offer.`;
    return { from: A, give: (best as { xs: typeof scored }).xs.map((x) => x.a), get: [target.a], headline: p, pitch };
  }
  return null;
}

/** An AI team offers the manager a player it's shopping, and asks for picks, prospects or what he has on his block. */
function sellToManager(league: League, A: Team, H: Team, askedAbout: Set<PlayerId>, rng: Rng): Idea | null {
  const hBlock = tradeBlock(league, H);
  const stated = hBlock.needs.filter((x) => x !== 'picks' && x !== 'prospects' && x !== 'cap-space');
  const weak = positionNeeds(league, H);
  const roster = H.roster.map((id) => league.players[id]).filter(Boolean);
  const nth = (g: string, i: number) =>
    roster
      .filter((p) => slotGroup(p) === g)
      .map(overall)
      .sort((a, b) => b - a)[i] ?? 0;
  // Someone who would play a real role for him: top nine up front, top four on the back end, or his starter in goal.
  const wouldPlay = (p: Player) => overall(p) > (slotGroup(p) === 'F' ? nth('F', 8) : slotGroup(p) === 'D' ? nth('D', 3) : nth('G', 0));
  const candidates = tradeBlock(league, A)
    .players.map((id) => league.players[id])
    .filter((p) => movable(league, p) && p.teamId === A.id && !askedAbout.has(p.id) && overall(p) >= 68)
    .map((p) => {
      const a: TradeAsset = { kind: 'player', id: p.id };
      return { p, statedFit: assetFits(league, a, stated), weakFit: assetFits(league, a, weak), mine: toManager(league, H, a) };
    })
    .filter((x) => x.mine > 20 && wouldPlay(x.p) && (x.statedFit.length > 0 || x.weakFit.length > 0 || overall(x.p) >= 74))
    .sort((x, y) => Number(y.statedFit.length > 0) - Number(x.statedFit.length > 0) || y.mine - x.mine)
    .slice(0, 3);
  if (!candidates.length) return null;

  // It asks for futures and for what he's shopping, never for players he hasn't made available.
  const shopping = new Set([...hBlock.players, ...hBlock.picks]);
  const allow = (a: TradeAsset) => (a.kind === 'pick' ? true : shopping.has(a.id) || !league.players[a.id]?.teamId) && (a.kind === 'pick' || movable(league, league.players[a.id]));
  const fair = AI_OFFER.fair[0] + rng.next() * (AI_OFFER.fair[1] - AI_OFFER.fair[0]);
  const strategy = A.controller.kind === 'ai' ? A.controller.strategy : 'balanced';

  for (const c of candidates) {
    const salary = c.p.contract?.salary ?? 0;
    // If he can't fit the salary, it offers to keep half of it.
    const canRetain = !!c.p.contract && retainedSeasons(league, c.p) >= 1 && retainedCount(league, A) < RETENTION.maxContracts;
    const shares = capRoom(league, H) >= salary ? [0] : canRetain ? [0, RETENTION.max] : [0];
    for (const retain of shares) {
      const out: TradeAsset = retain ? { kind: 'player', id: c.p.id, retain } : { kind: 'player', id: c.p.id };
      const ask = aiAsk(league, A.id, H.id, [], [out], allow);
      if (!ask?.length) continue;
      const cost = ask.reduce((s, a) => s + Math.max(0, toManager(league, H, a)), 0);
      if (toManager(league, H, out) < cost * fair) continue;
      const fit = c.statedFit.find((x) => POSITION[x]) ?? c.weakFit.find((x) => POSITION[x]);
      const kept = retain ? ` We'd keep ${Math.round(retain * 100)}% of his salary.` : '';
      const pitch =
        (c.statedFit.length
          ? fit
            ? `You're looking for help at ${POSITION[fit]}. ${nameOf(c.p)} is available.`
            : `You're looking for a proven veteran. ${nameOf(c.p)} is available.`
          : strategy === 'rebuild'
            ? `We're moving veterans, and ${nameOf(c.p)} could help you right now.`
            : fit
              ? `${nameOf(c.p)} is available, and you could use help at ${POSITION[fit]}.`
              : `${nameOf(c.p)} is available. We think he'd help you.`) + kept;
      return { from: A, give: [out], get: ask, headline: c.p, pitch };
    }
  }
  return null;
}
