/**
 * Seeded, deterministic random numbers.
 *
 * Every random decision in the sim flows through an Rng. Seeds are derived
 * hierarchically (league seed -> "game:123" -> events), so a game's result
 * depends only on the league seed and the game id — never on how many other
 * games were simulated before it. That is what makes "advance 1 day x 7" and
 * "advance 7 days" produce identical leagues.
 */

/** 32-bit FNV-1a hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Combine a parent seed with a label into a child seed. */
export function deriveSeed(parent: number, label: string): number {
  return hashString(`${parent >>> 0}|${label}`);
}

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform float in [0, 1). Mulberry32. */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Standard normal via Box–Muller. */
  normal(mean = 0, sd = 1): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Pick an index with probability proportional to weights. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Exponential waiting time for an event with the given rate. */
  exponential(rate: number): number {
    return -Math.log(1 - this.next()) / rate;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Child generator with an independent, reproducible stream. */
  child(label: string): Rng {
    return new Rng(deriveSeed(this.state, label));
  }
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
