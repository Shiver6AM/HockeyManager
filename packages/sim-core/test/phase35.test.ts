import { describe, expect, it } from 'vitest';
import { advanceDays, generateLeague } from '../src/index';

describe('team game totals', () => {
  it('every played game keeps shots, power play, penalties and faceoffs per side, matching its box score', () => {
    const L = generateLeague({ seed: 3501 } as never);
    advanceDays(L, 5);
    const played = L.schedule.filter((g) => g.result);
    expect(played.length).toBeGreaterThan(20);
    let ppo = 0;
    for (const g of played) {
      const r = g.result!;
      expect(r.teams).toBeTruthy();
      for (const s of ['home', 'away'] as const) {
        const box = r.box![s];
        expect(r.teams![s]).toEqual({ sog: box.shots, ppg: box.ppGoals, ppo: box.ppOpps, pim: box.pim, fow: box.fow });
        expect(r.teams![s].ppg).toBeLessThanOrEqual(r.teams![s].ppo);
        ppo += r.teams![s].ppo;
      }
    }
    expect(ppo / played.length).toBeGreaterThan(2); // about three power plays a side each game
  });
});
