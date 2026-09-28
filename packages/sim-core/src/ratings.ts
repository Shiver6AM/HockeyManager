import type { GoalieRatings, Player, Position, SkaterRatings } from './types';

/** Weights used to collapse individual ratings into a single overall per position. */
const FORWARD_W: Partial<Record<keyof SkaterRatings, number>> = {
  skating: 0.17,
  shooting: 0.18,
  passing: 0.15,
  handling: 0.14,
  offIQ: 0.18,
  defIQ: 0.08,
  checking: 0.04,
  endurance: 0.06,
};
const CENTER_W: Partial<Record<keyof SkaterRatings, number>> = {
  ...FORWARD_W,
  shooting: 0.15,
  faceoffs: 0.05,
};
const DEFENSE_W: Partial<Record<keyof SkaterRatings, number>> = {
  skating: 0.17,
  shooting: 0.06,
  passing: 0.14,
  handling: 0.08,
  offIQ: 0.1,
  defIQ: 0.26,
  checking: 0.13,
  endurance: 0.06,
};
const GOALIE_W: Record<keyof GoalieRatings, number> = {
  reflexes: 0.35,
  positioning: 0.35,
  rebounds: 0.15,
  mental: 0.15,
};

function weighted<T extends object>(r: T, w: Partial<Record<keyof T, number>>): number {
  let sum = 0;
  let tot = 0;
  for (const k in w) {
    const wt = w[k] ?? 0;
    sum += (r[k] as unknown as number) * wt;
    tot += wt;
  }
  return sum / tot;
}

export function skaterOverall(r: SkaterRatings, pos: Position): number {
  if (pos === 'D') return weighted(r, DEFENSE_W);
  if (pos === 'C') return weighted(r, CENTER_W);
  return weighted(r, FORWARD_W);
}

export function overall(p: Player): number {
  if (p.pos === 'G') return Math.round(weighted(p.goalie!, GOALIE_W));
  return Math.round(skaterOverall(p.skater!, p.pos));
}

export function goalieQuality(g: GoalieRatings): number {
  return weighted(g, GOALIE_W);
}

/** Offensive threat of a skater: drives attempt rate & chance creation. */
export function offensiveDrive(r: SkaterRatings): number {
  return 0.3 * r.skating + 0.25 * r.handling + 0.2 * r.passing + 0.25 * r.offIQ;
}

/** Ability to suppress the other team's attempts. */
export function defensiveDrive(r: SkaterRatings): number {
  return 0.45 * r.defIQ + 0.3 * r.skating + 0.25 * r.checking;
}

export function age(p: Player, season: number): number {
  return season - p.birthYear;
}
