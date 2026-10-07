/**
 * Commissioner sliders: multipliers on key simulation variables, stored in
 * `league.settings.sim`. 1 is the calibrated, NHL-like default; every slider
 * at 1 gives exactly the default simulation.
 */
import type { League } from './types';

export const SIM_SLIDERS = {
  injuryRate: { label: 'Injury frequency', group: 'Injuries', min: 0, max: 3, step: 0.1, help: 'How often players get hurt in games. 0 turns injuries off.' },
  injuryLength: { label: 'Injury length', group: 'Injuries', min: 0.25, max: 2, step: 0.05, help: 'How long injured players are out.' },
  scoring: { label: 'Scoring', group: 'Game play', min: 0.7, max: 1.3, step: 0.05, help: 'Shooting percentages: more or fewer goals on the same shots.' },
  penalties: { label: 'Penalties', group: 'Game play', min: 0.25, max: 2, step: 0.05, help: 'Minor penalties called per game (and so power plays).' },
  fights: { label: 'Fighting', group: 'Game play', min: 0, max: 3, step: 0.1, help: 'How often fights break out. 0 means none.' },
  homeIce: { label: 'Home-ice advantage', group: 'Game play', min: 0, max: 2, step: 0.1, help: 'How much playing at home helps. 0 means none.' },
  randomness: { label: 'Night-to-night randomness', group: 'Game play', min: 0.25, max: 2, step: 0.05, help: 'How much players’ form swings from game to game: higher means more upsets.' },
  development: { label: 'Young player development', group: 'Players', min: 0.5, max: 2, step: 0.05, help: 'How fast young players grow toward their potential, during the season and over the summer.' },
  aging: { label: 'Veteran decline', group: 'Players', min: 0.5, max: 2, step: 0.05, help: 'How fast players decline in their 30s.' },
  coaching: { label: 'Skills coaching effect', group: 'Players', min: 0, max: 2, step: 0.1, help: 'How much skills and goalie coaches improve players during the season.' },
  retirement: { label: 'Retirements', group: 'Players', min: 0.5, max: 2, step: 0.05, help: 'How likely veterans are to retire each summer.' },
  trades: { label: 'AI trade activity', group: 'League', min: 0, max: 3, step: 0.1, help: 'How often AI teams trade with each other during the season. 0 means never.' },
} as const;

export type SimSlider = keyof typeof SIM_SLIDERS;
export type SimSliders = Partial<Record<SimSlider, number>>;

/** The current value of a slider (1 = default). */
export function slider(league: League, key: SimSlider): number {
  const v = league.settings.sim?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
}

/** Clamp a submitted set of slider values to their ranges (unknown keys dropped). */
export function cleanSliders(input: Record<string, unknown>): SimSliders {
  const out: SimSliders = {};
  for (const [k, def] of Object.entries(SIM_SLIDERS) as Array<[SimSlider, (typeof SIM_SLIDERS)[SimSlider]]>) {
    const v = input[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const c = Math.min(def.max, Math.max(def.min, Math.round(v / def.step) * def.step));
    const r = Math.round(c * 100) / 100;
    if (r !== 1) out[k] = r;
  }
  return out;
}
