import { beforeAll, describe, expect, it } from 'vitest';
import {
  advanceToEndOfSeason,
  age,
  aiContext,
  askFromTeam,
  assetFits,
  capRoom,
  compensationPicks,
  compensationRounds,
  decideOfferSheet,
  evaluateForAi,
  generateDraftClass,
  generateLeague,
  offseasonStep,
  overall,
  pickOwner,
  QO_TIERS,
  qoResponse,
  qualifyingOffer,
  aiWouldQualify,
  marketValue,
  setTradeBlock,
  teamPicks,
  tenderOfferSheet,
  tradeablePickSeasons,
  tradeBlock,
  walkAwayFromAward,
  walkAwayThreshold,
  type League,
  type Player,
  type Team,
} from '../src/index';

describe('playing style and talent', () => {
  const L = generateLeague({ seed: 71 });
  it('grinders and enforcers fill the bottom of rosters, not the top', () => {
    const skaters = Object.values(L.players).filter((p) => p.teamId && p.pos !== 'G');
    const role = (p: Player) => p.archetype === 'Grinder' || p.archetype === 'Enforcer';
    expect(skaters.filter((p) => overall(p) >= 84).filter(role)).toHaveLength(0);
    expect(skaters.filter((p) => overall(p) < 65).filter(role).length).toBeGreaterThan(20);
    expect(skaters.some((p) => p.archetype === 'Enforcer')).toBe(true);
  });

  it('draft classes: grinders and enforcers are never top-5 talents, rarely first-rounders, and capped', () => {
    for (let s = 0; s < 8; s++) {
      const cls = generateDraftClass(L, L.season + s).filter((p) => p.pos !== 'G');
      const ranked = [...cls].sort((a, b) => b.hidden.potential - a.hidden.potential);
      const role = (p: Player) => p.archetype === 'Grinder' || p.archetype === 'Enforcer';
      expect(ranked.slice(0, 5).filter(role)).toHaveLength(0); // never a top-5 talent
      expect(ranked.slice(0, 15).filter(role).length).toBeLessThanOrEqual(1); // rarely a first-rounder
      for (const p of cls) {
        if (p.archetype === 'Enforcer') expect(p.hidden.potential).toBeLessThanOrEqual(80);
        if (p.archetype === 'Grinder') expect(p.hidden.potential).toBeLessThanOrEqual(88);
      }
    }
  });
});

describe('five years of picks', () => {
  it('every team can trade its picks in five drafts', () => {
    const L = generateLeague({ seed: 72 });
    expect(tradeablePickSeasons(L)).toHaveLength(5);
    expect(teamPicks(L, 'HAL')).toHaveLength(5 * 7);
  });
});

describe('trade blocks', () => {
  const L = generateLeague({ seed: 73, humans: { HAL: 'me' } });
  const ai = Object.values(L.teams).filter((t) => t.controller.kind === 'ai');
  const rebuilder = ai.find((t) => t.controller.kind === 'ai' && t.controller.strategy === 'rebuild')!;

  it('AI blocks follow strategy: rebuilders shop veterans and want picks and youth', () => {
    const b = tradeBlock(L, rebuilder);
    expect(b.needs).toEqual(expect.arrayContaining(['picks', 'prospects', 'young']));
    for (const id of b.players) {
      const p = L.players[id];
      expect(age(p, L.season) >= 29 || (p.contract?.yearsLeft ?? 0) <= 1).toBe(true);
    }
  });

  it('managers set their own block; only assets they own are kept', () => {
    const hal = L.teams.HAL;
    const mine = hal.roster.slice(0, 2);
    const theirs = rebuilder.roster[0];
    setTradeBlock(L, hal, { players: [...mine, theirs], picks: [teamPicks(L, 'HAL')[0], 'bogus'], needs: ['D', 'picks'], note: 'Shopping depth' });
    const b = tradeBlock(L, hal);
    expect(b.players).toEqual(mine);
    expect(b.picks).toEqual([teamPicks(L, 'HAL')[0]]);
    expect(b.needs).toEqual(['D', 'picks']);
    expect(() => setTradeBlock(L, rebuilder, { players: [], picks: [], needs: [] })).toThrow(/managers/);
  });

  it('assets that fit a team’s needs are flagged, and the AI values them higher', () => {
    const pick = teamPicks(L, 'HAL').find((k) => k.split(':')[1] === '2')!;
    expect(assetFits(L, { kind: 'pick', key: pick }, ['picks'])).toEqual(['picks']);
    expect(assetFits(L, { kind: 'pick', key: pick }, ['D'])).toEqual([]);
    const withNeed = evaluateForAi(L, rebuilder.id, [{ kind: 'pick', key: pick }], [], { needs: ['picks'], onBlock: new Set() });
    const without = evaluateForAi(L, rebuilder.id, [{ kind: 'pick', key: pick }], [], { needs: [], onBlock: new Set() });
    expect(withNeed.ratio).toBeGreaterThan(without.ratio);
    expect(aiContext(L, rebuilder.id).needs).toContain('picks');
  });
});

describe('restricted free agents', () => {
  let L: League;
  let hal: Team;
  let rfas: Player[];

  beforeAll(() => {
    // Find a league where the human team has at least two expiring RFAs.
    for (let seed = 80; seed < 120; seed++) {
      const G = generateLeague({ seed, humans: { HAL: 'me' } });
      advanceToEndOfSeason(G);
      offseasonStep(G, { force: true }); // -> draft
      offseasonStep(G, { force: true }); // -> re-sign
      // RFAs who won't simply accept their qualifying offer (the interesting cases).
      const ids = Object.keys(G.offseason!.expiring).filter(
        (id) => G.players[id]?.teamId === 'HAL' && G.players[id].contract?.expiresAs === 'RFA' && qoResponse(G, G.players[id]) !== 'accept',
      );
      if (ids.length >= 2) {
        L = G;
        hal = G.teams.HAL;
        rfas = ids.map((id) => G.players[id]).sort((a, b) => overall(b) - overall(a));
        break;
      }
    }
    for (const p of rfas) (L.offseason!.qualified ??= {})[p.id] = true;
    while (L.offseason!.stage === 're-sign') offseasonStep(L, { force: true }); // -> free agency
  });

  it('qualified RFAs without a deal stay on their qualifying offer as open cases', () => {
    expect(L.offseason!.stage).toBe('free-agency');
    for (const p of rfas) {
      expect(p.teamId).toBe('HAL');
      expect(L.offseason!.rfa![p.id]).toMatchObject({ teamId: 'HAL', status: 'unsigned' });
      expect(p.contract?.yearsLeft).toBe(1);
    }
  });

  it('compensation scales with the offer', () => {
    expect(compensationRounds(L, 1_000_000)).toEqual([]);
    expect(compensationRounds(L, 4_000_000)).toEqual([2]);
    expect(compensationRounds(L, 0.2 * L.settings.salaryCap)).toEqual([1, 1, 1, 1]);
  });

  it('offer sheet → human declines → player moves and picks change hands', () => {
    const p = rfas[0];
    const bidder = Object.values(L.teams)
      .filter((t) => t.id !== 'HAL' && t.controller.kind === 'ai')
      .sort((a, b) => capRoom(L, b) - capRoom(L, a))[0];
    const ask = askFromTeam(L, p, bidder);
    const offer = { salary: Math.min(capRoom(L, bidder) - 100_000, Math.round((ask.salary * 1.4) / 25_000) * 25_000 + 250_000), years: ask.years };
    expect(() => tenderOfferSheet(L, hal, p, offer)).toThrow(/your own RFA/);
    tenderOfferSheet(L, bidder, p, offer);
    offseasonStep(L, { force: true }); // round 1: he signs the best sheet; HAL decides
    const c = L.offseason!.rfa![p.id];
    expect(c.sheet).toBeTruthy(); // ours, or an AI team's that he liked better
    expect(c.status).toBe('unsigned');
    const from = c.sheet!.fromTeam;
    const terms = c.sheet!.offer;
    const comp = compensationPicks(L, from, terms.salary)!;
    decideOfferSheet(L, hal, p.id, false);
    offseasonStep(L, { force: true }); // round 2 settles it
    expect(c.status).toBe('departed');
    expect(p.teamId).toBe(from);
    expect(p.contract).toMatchObject({ salary: terms.salary, yearsLeft: terms.years });
    for (const k of comp) expect(pickOwner(L, k)).toBe('HAL');
    expect(L.transactions.some((t) => t.type === 'offer-sheet' && t.playerId === p.id)).toBe(true);
  });

  it('arbitration at the end of free agency; managers may walk away from big awards in camp', () => {
    while (L.offseason!.stage === 'free-agency') offseasonStep(L, { force: true });
    expect(L.offseason!.stage).toBe('training-camp');
    const p = rfas[1];
    const c = L.offseason!.rfa![p.id];
    expect(['awarded', 'signed', 'departed']).toContain(c.status);
    if (c.status === 'awarded') {
      expect(c.award!.salary).toBeGreaterThanOrEqual(c.qualifyingOffer.salary);
      expect(p.contract!.salary).toBe(c.award!.salary);
      if (c.award!.salary >= walkAwayThreshold(L)) {
        walkAwayFromAward(L, hal, p.id);
        expect(p.teamId).toBeNull();
      } else expect(() => walkAwayFromAward(L, hal, p.id)).toThrow(/Only awards/);
    }
    while (L.phase === 'offseason') offseasonStep(L, { force: true });
    expect(L.phase).toBe('regular-season');
  });
});

describe('qualifying offers', () => {
  const L = generateLeague({ seed: 91 });
  const somePlayer = Object.values(L.players).find((p) => p.teamId && p.contract)!;
  const withSalary = (salary: number): Player => ({ ...somePlayer, contract: { ...somePlayer.contract!, salary } });

  it('prices QOs in NHL-style tiers that scale with the cap', () => {
    expect(qualifyingOffer(withSalary(775_000), L).salary).toBe(Math.round((775_000 * QO_TIERS.lowRate) / 25_000) * 25_000);
    const mid = qualifyingOffer(withSalary(950_000), L).salary;
    expect(mid).toBeGreaterThan(950_000);
    expect(mid).toBeLessThanOrEqual(QO_TIERS.midMax);
    expect(qualifyingOffer(withSalary(4_000_000), L).salary).toBe(4_000_000); // 100% above the threshold
    expect(qualifyingOffer(withSalary(4_000_000), L).years).toBe(1);
    const richer = { ...L, settings: { ...L.settings, salaryCap: L.settings.salaryCap * 1.2 } } as League;
    expect(qualifyingOffer(withSalary(1_200_000), richer).salary).toBeGreaterThan(qualifyingOffer(withSalary(1_200_000), L).salary);
  });

  it('players accept a fair QO, file for arbitration when worth clearly more, or hold out', () => {
    const cheapStar = { ...withSalary(900_000), birthYear: L.season - 25 };
    const worth = marketValue(cheapStar, L.season, L.settings.salaryCap);
    if (worth > 2_000_000) expect(qoResponse(L, cheapStar)).toBe('arbitration');
    const overpaid = withSalary(Math.round((marketValue(somePlayer, L.season, L.settings.salaryCap) * 1.3) / 25_000) * 25_000 + 1_000_000);
    expect(qoResponse(L, overpaid)).toBe('accept');
    const kid = { ...withSalary(900_000), birthYear: L.season - 19 };
    delete L.careerStats?.[kid.id];
    if (marketValue(kid, L.season, L.settings.salaryCap) > 1_100_000) expect(qoResponse(L, kid)).toBe('holdout'); // not arbitration-eligible yet
  });

  it('AI teams do not qualify players whose QO is more than they are worth', () => {
    const team = Object.values(L.teams).find((t) => t.controller.kind === 'ai')!;
    const overpaid = withSalary(12_000_000);
    const cheap = withSalary(900_000);
    expect(aiWouldQualify(L, team, overpaid)).toBe(marketValue(overpaid, L.season, L.settings.salaryCap) * 1.15 >= 12_000_000);
    expect(aiWouldQualify(L, team, cheap)).toBe(true);
  });

  it('unqualified RFAs become UFAs, and qualified ones who accept sign on the spot', () => {
    // Find a league where Halifax has at least two expiring RFAs.
    let G!: League;
    let rfas: string[] = [];
    for (let seed = 92; seed < 130 && rfas.length < 2; seed++) {
      G = generateLeague({ seed, humans: { HAL: 'me' } });
      advanceToEndOfSeason(G);
      offseasonStep(G, { force: true });
      while (G.offseason!.stage === 'draft') offseasonStep(G, { force: true });
      rfas = Object.keys(G.offseason!.expiring).filter((id) => G.players[id]?.teamId === 'HAL' && G.players[id].contract?.expiresAs === 'RFA');
    }
    expect(rfas.length).toBeGreaterThan(1);
    const [drop, ...rest] = rfas;
    G.offseason!.resign[drop] = false;
    for (const id of rest) (G.offseason!.qualified ??= {})[id] = true;
    while (G.offseason!.stage === 're-sign') offseasonStep(G, { force: true }); // -> free agency
    expect(G.players[drop].teamId).toBeNull();
    expect(G.transactions.some((t) => t.playerId === drop && /not qualified and becomes an unrestricted free agent/.test(t.note))).toBe(true);
    for (const id of rest) {
      const c = G.offseason!.rfa![id];
      if (!c) continue; // re-signed by other means
      if (c.status === 'signed') expect(G.transactions.some((t) => t.playerId === id && /accepts his qualifying offer/.test(t.note))).toBe(true);
      else expect(c.status).toBe('unsigned');
      expect(G.players[id].contract!.salary).toBe(c.qualifyingOffer.salary);
    }
  });
});
