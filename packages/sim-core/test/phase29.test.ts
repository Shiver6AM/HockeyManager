import { beforeAll, describe, expect, it } from 'vitest';
import {
  advanceDays,
  AI_OFFER,
  evaluateForAi,
  generateLeague,
  offerClock,
  offerDaysLeft,
  offseasonStep,
  overall,
  respondToTrade,
  setTradeBlock,
  tradeDeadline,
  validateTrade,
  type League,
  type TradeProposal,
} from '../src/index';

/** A league with three managers; one of them works his trade block. */
function managedLeague(seed: number): { L: League; managers: string[] } {
  const L = generateLeague({ seed } as never);
  const ids = Object.keys(L.teams).sort();
  const managers = [ids[0], ids[7], ids[19]];
  for (const id of managers) L.teams[id].controller = { kind: 'human', userId: id } as never;
  const t = L.teams[managers[2]];
  const shop = t.roster
    .map((id) => L.players[id])
    .sort((a, b) => overall(b) - overall(a))
    .slice(6, 9)
    .map((p) => p.id);
  setTradeBlock(L, t, { players: shop, picks: [], needs: ['D'] });
  return { L, managers };
}

const offers = (L: League) => (L.trades ?? []).filter((t) => t.ai);

describe('AI teams make managers trade offers', () => {
  let L: League;
  let managers: string[];
  /** Every offer as it stood on the day it was made. */
  const asMade: Array<{ t: TradeProposal; legal: string | null; aiSaysYes: boolean; day: number; daysLeft: number | null; open: number }> = [];

  beforeAll(() => {
    ({ L, managers } = managedLeague(29));
    const seen = new Set<string>();
    const deadline = tradeDeadline(L);
    while (L.phase === 'regular-season' && L.day <= deadline + 3) {
      advanceDays(L, 1);
      for (const t of offers(L)) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        asMade.push({
          t: structuredClone(t),
          legal: validateTrade(L, t.fromTeam, t.toTeam, t.give, t.get),
          aiSaysYes: evaluateForAi(L, t.fromTeam, t.get, t.give).accept,
          day: L.day,
          daysLeft: offerDaysLeft(L, t),
          open: offers(L).filter((x) => x.status === 'pending' && x.toTeam === t.toTeam).length,
        });
      }
    }
  }, 120_000);

  it('every manager hears from someone before the deadline, the one with a trade block most often', () => {
    const count = (id: string) => asMade.filter((x) => x.t.toTeam === id).length;
    for (const id of managers) expect(count(id)).toBeGreaterThan(0);
    expect(asMade.length).toBeGreaterThanOrEqual(6);
    expect(asMade.length).toBeLessThan(60);
    expect(count(managers[2])).toBeGreaterThanOrEqual(Math.max(count(managers[0]), count(managers[1])) - 2);
  });

  it('each offer is a legal trade the AI team would accept, from an AI team to a manager', () => {
    for (const x of asMade) {
      expect(x.legal).toBeNull();
      expect(x.aiSaysYes).toBe(true);
      expect(L.teams[x.t.fromTeam].controller.kind).toBe('ai');
      expect(managers).toContain(x.t.toTeam);
      expect(x.t.status).toBe('pending');
      expect(x.t.give.length).toBeGreaterThan(0);
      expect(x.t.get.length).toBeGreaterThan(0);
      expect(x.t.ai!.pitch.length).toBeGreaterThan(10);
      // The player the call is about is in the deal.
      expect([...x.t.give, ...x.t.get].some((a) => a.kind === 'player' && a.id === x.t.ai!.headline)).toBe(true);
    }
  });

  it('offers stand for a limited time, never past the deadline, and a manager has at most two open', () => {
    const deadline = tradeDeadline(L);
    for (const x of asMade) {
      expect(x.t.ai!.expires).toBeLessThanOrEqual(deadline);
      expect(x.t.ai!.expires - x.t.ai!.clock).toBeLessThan(AI_OFFER.days);
      expect(x.daysLeft).toBeGreaterThanOrEqual(1);
      expect(x.daysLeft).toBeLessThanOrEqual(AI_OFFER.days);
      expect(x.open).toBeLessThanOrEqual(AI_OFFER.maxOpen);
    }
    // After the deadline nothing is left open, and nothing new was made.
    expect(L.day).toBeGreaterThan(deadline);
    expect(offerClock(L)).toBeNull();
    expect(offers(L).filter((t) => t.status === 'pending')).toHaveLength(0);
    expect(asMade.every((x) => x.day <= deadline)).toBe(true);
    expect(offers(L).some((t) => t.status === 'withdrawn' && t.note === 'The offer expired.')).toBe(true);
  });

  it('the same team does not call the same manager twice in a few days', () => {
    for (const a of asMade) {
      for (const b of asMade) {
        if (a === b || a.t.fromTeam !== b.t.fromTeam || a.t.toTeam !== b.t.toTeam) continue;
        expect(Math.abs(a.t.ai!.clock - b.t.ai!.clock)).toBeGreaterThanOrEqual(AI_OFFER.pairCooldown);
      }
    }
  });
});

describe('answering an AI offer', () => {
  /** Sim until a manager has an open offer. */
  function untilOffer(L: League): TradeProposal {
    for (let i = 0; i < 120; i++) {
      advanceDays(L, 1);
      const t = offers(L).find((x) => x.status === 'pending');
      if (t) return t;
    }
    throw new Error('no offer in 120 days');
  }

  it('accepting makes the trade', () => {
    const { L } = managedLeague(31);
    const t = untilOffer(L);
    const owner = (a: TradeProposal['give'][number]) => (a.kind === 'player' ? (L.players[a.id].teamId ?? L.players[a.id].prospectOf) : null);
    const r = respondToTrade(L, t.id, t.toTeam, true);
    expect(r.status).toBe('completed');
    for (const a of t.give) if (a.kind === 'player') expect(owner(a)).toBe(t.toTeam);
    for (const a of t.get) if (a.kind === 'player') expect(owner(a)).toBe(t.fromTeam);
    expect(offerDaysLeft(L, t)).toBeNull();
  });

  it('declining ends it, and nobody calls about that player again this season', () => {
    const { L } = managedLeague(32);
    const t = untilOffer(L);
    expect(() => respondToTrade(L, t.id, t.fromTeam, false)).toThrow(/receiving team/);
    respondToTrade(L, t.id, t.toTeam, false);
    expect(t.status).toBe('rejected');
    while (L.phase === 'regular-season' && L.day <= tradeDeadline(L)) advanceDays(L, 1);
    const again = offers(L).filter((x) => x.id !== t.id && x.toTeam === t.toTeam && x.ai!.headline === t.ai!.headline);
    expect(again).toHaveLength(0);
  }, 60_000);

  it('an AI team backs out if the deal has stopped working for it', () => {
    const { L } = managedLeague(33);
    // An offer in which the AI team is after one of the manager's players.
    let t = untilOffer(L);
    while (!t.get.some((a) => a.kind === 'player')) {
      respondToTrade(L, t.id, t.toTeam, false);
      t = untilOffer(L);
    }
    // He is badly hurt (in effect: every rating drops) before the manager answers.
    const p = L.players[(t.get.find((a) => a.kind === 'player') as { id: string }).id];
    const r = (p.skater ?? p.goalie) as unknown as Record<string, number>;
    for (const k of Object.keys(r)) r[k] = 30;
    const answer = respondToTrade(L, t.id, t.toTeam, true);
    expect(answer.status).toBe('withdrawn');
    expect(answer.note).toMatch(/backed out/);
    expect(p.teamId ?? p.prospectOf).toBe(t.toTeam);
  }, 60_000);
});

describe('AI offers and the rest of the sim', () => {
  it('a league with no managers gets no offers', () => {
    const L = generateLeague({ seed: 34 } as never);
    advanceDays(L, 60);
    expect(offers(L)).toHaveLength(0);
  });

  it('simming a day at a time or all at once makes the same offers', () => {
    const a = managedLeague(35).L;
    const b = managedLeague(35).L;
    advanceDays(a, 45);
    for (let i = 0; i < 45; i++) advanceDays(b, 1);
    expect(offers(a).length).toBeGreaterThan(0);
    expect(JSON.stringify(a.trades)).toBe(JSON.stringify(b.trades));
  }, 60_000);

  it('offers are made in the re-signing week and free agency too, and none outlives the offseason', () => {
    let made = 0;
    for (const seed of [36, 37]) {
      const { L } = managedLeague(seed);
      while (L.phase !== 'offseason') advanceDays(L, 30);
      const stages = new Set<string>();
      const before = offers(L).length;
      while (L.phase === 'offseason') {
        offseasonStep(L, { force: true });
        for (const t of offers(L).slice(before)) {
          if (t.ai!.clock >= 10_000 && t.status === 'pending' && L.phase === 'offseason') {
            stages.add(L.offseason!.stage);
            expect(validateTrade(L, t.fromTeam, t.toTeam, t.give, t.get)).toBeNull();
            // Nobody on an expiring contract is in an offseason offer.
            for (const x of [...t.give, ...t.get]) {
              const p = x.kind === 'player' ? L.players[x.id] : null;
              if (p?.teamId) expect(p.contract!.yearsLeft > 1 || !!p.extension).toBe(true);
            }
          }
        }
      }
      made += offers(L).filter((t) => t.ai!.clock >= 10_000).length;
      for (const s of stages) expect(['re-sign', 'free-agency']).toContain(s);
      // The new season has begun: every offseason offer is closed.
      expect(offers(L).filter((t) => t.ai!.clock >= 10_000 && t.status === 'pending')).toHaveLength(0);
    }
    expect(made).toBeGreaterThan(0);
  }, 120_000);
});
