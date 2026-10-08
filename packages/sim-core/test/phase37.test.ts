import { describe, expect, it } from 'vitest';
import { advanceDays, assign, autoLines, DEFAULT_TACTICS, FORWARD_USAGE, DEFENSE_USAGE, generateLeague, healthyRoster, outOfPosition, overall, playsPos, slotValue, teamLines, type Player, type Position } from '../src/index';

const POS: Position[] = ['LW', 'C', 'RW'];

describe('the assistant coach’s lines', () => {
  it('assign finds the cheapest matching', () => {
    expect(assign([[4, 1, 3], [2, 0, 5], [3, 2, 2]])).toEqual([1, 0, 2]);
    expect(assign([[1, 9, 9, 0]])).toEqual([3]);
  });

  it('no swap of two players, and no scratch for a dressed one, would make the lineup better', () => {
    const L = generateLeague({ seed: 3701 });
    advanceDays(L, 1); // (players' other positions are worked out as the season starts)
    for (const t of Object.values(L.teams)) {
      const roster = healthyRoster(L, t);
      const lines = autoLines(roster, t.tactics ?? DEFAULT_TACTICS);
      const fs = FORWARD_USAGE[t.tactics?.fUsage ?? 'balanced'].share;
      const ds = DEFENSE_USAGE[t.tactics?.dUsage ?? 'balanced'].share;
      const by = new Map(roster.map((p) => [p.id, p]));
      const spots: Array<{ p: Player; pos: Position; w: number }> = [];
      lines.forwards.forEach((l, i) => l.forEach((id, j) => spots.push({ p: by.get(id)!, pos: POS[j], w: fs[i] })));
      lines.defense.forEach((pr, i) => pr.forEach((id) => spots.push({ p: by.get(id)!, pos: 'D', w: ds[i] })));
      for (const a of spots)
        for (const b of spots) {
          const now = a.w * slotValue(a.p, a.pos) + b.w * slotValue(b.p, b.pos);
          const swapped = a.w * slotValue(b.p, a.pos) + b.w * slotValue(a.p, b.pos);
          expect(now).toBeGreaterThanOrEqual(swapped - 1e-6);
        }
      const dressed = new Set(spots.map((s) => s.p.id));
      for (const x of roster.filter((p) => p.pos !== 'G' && !dressed.has(p.id)))
        for (const s of spots) expect(slotValue(s.p, s.pos)).toBeGreaterThanOrEqual(slotValue(x, s.pos) - 1e-6);
    }
  });

  it('uses players’ other positions instead of leaving a better player out of position or down the lineup', () => {
    const L = generateLeague({ seed: 3702 });
    advanceDays(L, 1);
    let flexUsed = 0;
    let offPos = 0;
    for (const t of Object.values(L.teams)) {
      const roster = healthyRoster(L, t);
      const lines = autoLines(roster, t.tactics ?? DEFAULT_TACTICS);
      lines.forwards.forEach((l) =>
        l.forEach((id, j) => {
          const p = L.players[id];
          if (p.pos !== POS[j] && p.altPos?.includes(POS[j])) flexUsed++;
          offPos += outOfPosition(p, POS[j]) >= 1 ? 1 : 0;
        }),
      );
      // Nobody clearly better (3+ overall) who plays the same spot sits on a lower line.
      for (let a = 0; a < 4; a++)
        for (let b = a + 1; b < 4; b++)
          for (let j = 0; j < 3; j++) {
            const up = L.players[lines.forwards[a][j]];
            const down = L.players[lines.forwards[b][j]];
            if (playsPos(down, POS[j]) && playsPos(up, POS[j])) expect(overall(down)).toBeLessThan(overall(up) + 3);
          }
    }
    expect(flexUsed).toBeGreaterThanOrEqual(4); // a center on the wing, a winger on his other side, where it helps
    expect(offPos).toBeLessThan(6); // hardly anyone truly out of position (a winger at center, a D up front)
  });

  it('short of forwards, a defenseman moves up instead of the lines failing (or the placements being stuck)', () => {
    const L = generateLeague({ seed: 3703, humans: { HAL: 'me' } });
    const hal = L.teams.HAL;
    const nhl = hal.roster.map((id) => L.players[id]).filter((p) => !p.farm);
    const fwds = nhl.filter((p) => p.pos !== 'D' && p.pos !== 'G');
    for (const p of fwds.slice(11)) p.farm = true; // eleven forwards
    const d = nhl.filter((p) => p.pos === 'D');
    expect(d.length).toBeGreaterThanOrEqual(7);
    hal.linePins = { [fwds[0].id]: { slot: 'L1' } };
    const lines = teamLines(L, hal);
    const up = lines.forwards.flat().filter((id) => L.players[id].pos === 'D');
    expect(up).toHaveLength(1);
    expect(lines.forwards[0]).toContain(fwds[0].id);
    expect(new Set([...lines.forwards.flat(), ...lines.defense.flat()]).size).toBe(18);
  });
});
