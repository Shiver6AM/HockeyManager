import { describe, expect, it } from 'vitest';
import {
  advanceDays,
  advanceToEndOfSeason,
  aiAsk,
  capRoom,
  evaluateForAi,
  generateLeague,
  offseasonStep,
  overall,
  pickKey,
  pickOwner,
  playerValue,
  proposeTrade,
  respondToTrade,
  reviewTrade,
  teamPicks,
  tradeDeadline,
  validateTrade,
  type League,
  type TradeAsset,
} from '../src/index';

const P = (id: string): TradeAsset => ({ kind: 'player', id });
const byOvr = (L: League, teamId: string) => L.teams[teamId].roster.map((id) => L.players[id]).sort((a, b) => overall(b) - overall(a));

describe('AI trade valuation', () => {
  it('stars are worth far more than depth, and three depth players do not buy a star', () => {
    const L = generateLeague({ seed: 11, humans: { HAL: 'me' } });
    const ai = 'KC';
    const star = byOvr(L, ai)[0];
    const depth = byOvr(L, 'HAL').slice(-6, -3); // three healthy depth guys
    expect(playerValue(L, L.teams[ai], star)).toBeGreaterThan(3 * playerValue(L, L.teams[ai], depth[0]));
    const v = evaluateForAi(L, ai, depth.map((p) => P(p.id)), [P(star.id)]);
    expect(v.accept).toBe(false);
  });

  it('accepts a clear overpay', () => {
    const L = generateLeague({ seed: 12, humans: { HAL: 'me' } });
    const theirs = byOvr(L, 'KC')[10];
    const mine = byOvr(L, 'HAL')[0];
    const v = evaluateForAi(L, 'KC', [P(mine.id)], [P(theirs.id)]);
    expect(v.accept).toBe(true);
  });

  it('rebuilding teams value picks and youth more than contenders do', () => {
    const L = generateLeague({ seed: 13 });
    const [a, b] = Object.values(L.teams);
    a.controller = { kind: 'ai', strategy: 'rebuild' };
    b.controller = { kind: 'ai', strategy: 'contend' };
    const pick: TradeAsset = { kind: 'pick', key: pickKey(L.season, 1, 'HAL') };
    expect(evaluateForAi(L, a.id, [pick], []).ratio).toBeGreaterThan(evaluateForAi(L, b.id, [pick], []).ratio);
  });

  it('can say what it would take', () => {
    const L = generateLeague({ seed: 14, humans: { HAL: 'me' } });
    const target = byOvr(L, 'KC')[2];
    const ask = aiAsk(L, 'KC', 'HAL', [], [P(target.id)]);
    expect(ask).not.toBeNull();
    expect(evaluateForAi(L, 'KC', ask!, [P(target.id)]).accept).toBe(true);
    // It asks for the least it would take, not our franchise player.
    const franchise = byOvr(L, 'HAL')[0];
    expect(ask!.some((a) => a.kind === 'player' && a.id === franchise.id)).toBe(false);
  });
});

describe('trade rules', () => {
  it('enforces the cap, ownership and the deadline', () => {
    const L = generateLeague({ seed: 15, humans: { HAL: 'me' } });
    const expensive = byOvr(L, 'KC').filter((p) => p.contract)[0];
    // Load HAL to the cap, then try to take on salary for nothing.
    L.settings.salaryCap = L.teams.HAL.roster.reduce((s, id) => s + (L.players[id].contract?.salary ?? 0), 0) + 100_000;
    expect(validateTrade(L, 'HAL', 'KC', [], [P(expensive.id)])).toMatch(/salary cap/);
    expect(validateTrade(L, 'HAL', 'KC', [P(expensive.id)], [])).toMatch(/doesn't own/);
    L.day = tradeDeadline(L) + 1;
    expect(validateTrade(L, 'HAL', 'KC', [], [])).toMatch(/deadline/);
  });

  it('moves players and picks; traded picks are used by their new owner at the draft', () => {
    const L = generateLeague({ seed: 16, humans: { HAL: 'me', QUE: 'you' } });
    const pk = pickKey(L.season, 1, 'HAL');
    // Someone Halifax can fit under its cap.
    const theirGuy = byOvr(L, 'QUE').find((p) => (p.contract?.salary ?? 0) <= capRoom(L, L.teams.HAL))!;
    const t = proposeTrade(L, 'HAL', 'QUE', [{ kind: 'pick', key: pk }], [P(theirGuy.id)]);
    expect(t.status).toBe('pending');
    respondToTrade(L, t.id, 'QUE', true);
    expect(t.status).toBe('completed');
    expect(theirGuy.teamId).toBe('HAL');
    expect(L.teams.HAL.roster).toContain(theirGuy.id);
    expect(pickOwner(L, pk)).toBe('QUE');
    expect(teamPicks(L, 'QUE')).toContain(pk);
    advanceToEndOfSeason(L);
    offseasonStep(L, { force: false }); // opens the draft
    const pick = L.offseason!.draft.picks.find((p) => p.round === 1 && p.originalTeamId === 'HAL')!;
    expect(pick.teamId).toBe('QUE');
  }, 60_000);

  it('commissioner review holds human trades until approved', () => {
    const L = generateLeague({ seed: 17, humans: { HAL: 'me' } });
    L.settings.tradeReview = 'commissioner';
    const mine = byOvr(L, 'HAL')[0];
    const theirs = byOvr(L, 'KC')[12];
    const t = proposeTrade(L, 'HAL', 'KC', [P(mine.id)], [P(theirs.id)]);
    expect(t.status).toBe('awaiting-approval');
    expect(mine.teamId).toBe('HAL');
    reviewTrade(L, t.id, true);
    expect(t.status).toBe('completed');
    expect(mine.teamId).toBe('KC');
  });

  it('voids pending trades whose assets have moved', () => {
    const L = generateLeague({ seed: 18, humans: { HAL: 'me', QUE: 'you', KC: 'them' } });
    const star = byOvr(L, 'HAL')[0];
    const a = proposeTrade(L, 'HAL', 'QUE', [P(star.id)], []);
    const b = proposeTrade(L, 'HAL', 'KC', [P(star.id)], []);
    respondToTrade(L, a.id, 'QUE', true);
    expect(a.status).toBe('completed');
    expect(b.status).toBe('invalid');
  });
});

describe('AI-to-AI trades', () => {
  it('happen during a season and leave every roster legal', () => {
    const L = generateLeague({ seed: 99 });
    for (const t of Object.values(L.teams)) if (t.controller.kind === 'ai') t.controller.strategy = t.id < 'L' ? 'contend' : 'rebuild';
    advanceDays(L, 160);
    const done = (L.trades ?? []).filter((t) => t.status === 'completed');
    expect(done.length).toBeGreaterThan(0);
    for (const team of Object.values(L.teams)) {
      for (const id of team.roster) expect(L.players[id].teamId).toBe(team.id);
      for (const id of team.prospects ?? []) expect(L.players[id].prospectOf).toBe(team.id);
    }
  }, 60_000);
});
