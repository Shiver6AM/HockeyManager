import { beforeAll, describe, expect, it } from 'vitest';
import {
  advanceDays,
  aiAsk,
  aiContext,
  assetValue,
  contenderScore,
  evaluateForAi,
  generateLeague,
  overall,
  parsePickKey,
  pickValue,
  teamPicks,
  validateTrade,
  withMemo,
  type League,
  type TradeAsset,
} from '../src/index';

/** The search as it was before it was sped up: every combination gets the full check. */
function slowAsk(league: League, aiId: string, otherId: string, incoming: TradeAsset[], outgoing: TradeAsset[]): TradeAsset[] | null {
  const already = new Set(incoming.map((a) => (a.kind === 'pick' ? a.key : a.id)));
  const other = league.teams[otherId];
  const team = league.teams[aiId];
  const candidates: TradeAsset[] = [
    ...other.roster.map((id) => ({ kind: 'player' as const, id })),
    ...(other.prospects ?? []).map((id) => ({ kind: 'player' as const, id })),
    ...teamPicks(league, otherId)
      .filter((key) => parsePickKey(key).round <= 3)
      .map((key) => ({ kind: 'pick' as const, key })),
  ].filter((a) => !already.has(a.kind === 'pick' ? a.key : a.id));
  const scored = candidates
    .map((a) => ({ a, v: assetValue(league, team, a) }))
    .filter((x) => x.v > 0)
    .sort((x, y) => x.v - y.v)
    .slice(0, 40);
  const ctx = aiContext(league, aiId);
  const works = (extra: TradeAsset[]) => {
    const next = [...incoming, ...extra];
    return !validateTrade(league, otherId, aiId, next, outgoing) && evaluateForAi(league, aiId, next, outgoing, ctx).accept;
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

describe('faster trade asks and page calculations give the same answers', () => {
  let L: League;
  beforeAll(() => {
    L = generateLeague({ seed: 2801, humans: { HAL: 'me' } });
    advanceDays(L, 25);
  });

  it('team rankings and pick values are the same inside the page cache as outside it', () => {
    const teams = Object.keys(L.teams);
    const plain = teams.map((t) => contenderScore(L, t));
    const picks = teamPicks(L, 'QUE');
    const plainPicks = picks.map((k) => pickValue(L, L.teams.HAL, k));
    withMemo(() => {
      expect(teams.map((t) => contenderScore(L, t))).toEqual(plain);
      expect(teams.map((t) => contenderScore(L, t))).toEqual(plain); // (second time: from the cache)
      expect(picks.map((k) => pickValue(L, L.teams.HAL, k))).toEqual(plainPicks);
    });
    expect(new Set(plain).size).toBe(teams.length);
  });

  it('the cache does not outlive the work it was opened for', () => {
    const before = contenderScore(L, 'HAL');
    withMemo(() => contenderScore(L, 'HAL'));
    // Swap the roster for the league's weakest players: outside the cache the answer follows the league.
    const copy = structuredClone(L);
    copy.teams.HAL.roster = Object.values(copy.players)
      .filter((p) => p.teamId && p.pos !== 'G')
      .sort((a, b) => overall(a) - overall(b))
      .slice(0, 20)
      .map((p) => p.id);
    expect(contenderScore(copy, 'HAL')).toBe(0);
    expect(before).toBeGreaterThan(0);
    expect(() => withMemo(() => Promise.resolve(1))).toThrow(/synchronous/);
  });

  it('"what would they want?" picks the same package as the exhaustive search, from small gaps to hopeless ones', () => {
    const ai = Object.keys(L.teams).filter((t) => L.teams[t].controller.kind === 'ai').slice(0, 4);
    let asked = 0;
    let hopeless = 0;
    for (const t of ai) {
      const theirs = L.teams[t].roster.map((id) => ({ id, v: assetValue(L, L.teams[t], { kind: 'player', id }) })).sort((a, b) => b.v - a.v);
      const mine = L.teams.HAL.roster.map((id) => ({ id, v: assetValue(L, L.teams[t], { kind: 'player', id }) })).sort((a, b) => a.v - b.v);
      const deals: Array<[TradeAsset[], TradeAsset[]]> = [
        [[], [{ kind: 'player', id: theirs[theirs.length - 3].id }]], // a depth player for nothing
        [[], [{ kind: 'player', id: theirs[8].id }]],
        [[{ kind: 'player', id: mine[0].id }], [{ kind: 'player', id: theirs[0].id }]], // their best for my worst
        [[], theirs.slice(0, 3).map((x) => ({ kind: 'player' as const, id: x.id }))], // their three best for nothing
        [[{ kind: 'player', id: mine[mine.length - 1].id }], [{ kind: 'player', id: theirs[2].id }]],
      ];
      for (const [give, get] of deals) {
        const fast = aiAsk(L, t, 'HAL', give, get);
        const slow = slowAsk(L, t, 'HAL', give, get);
        expect(fast).toEqual(slow);
        asked++;
        if (!slow) hopeless++;
      }
    }
    expect(asked).toBe(20);
    expect(hopeless).toBeGreaterThan(0);
    expect(hopeless).toBeLessThan(asked);
  }, 120_000);
});
