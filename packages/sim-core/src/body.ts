/**
 * Height and weight. Each player's frame is fixed (derived from his id and
 * name, so every existing save gets one too) and fits his style: enforcers and
 * shutdown defensemen are big, speedsters and playmakers smaller, butterfly
 * goalies tall. Weight follows height, adds a little for physical players
 * (checking), and teenagers fill out (about 10 lb) until about 23.
 */
import { age } from './ratings';
import { clamp, deriveSeed, Rng } from './rng';
import type { Player } from './types';

/** Mean height (inches) and weight (lb) at that height, by archetype. */
const FRAMES: Record<string, [number, number]> = {
  Sniper: [72.5, 190],
  Playmaker: [71.5, 185],
  'Power Forward': [74, 214],
  'Two-Way': [72.5, 196],
  Speedster: [70.5, 179],
  Grinder: [73, 205],
  Enforcer: [75, 228],
  Generational: [73, 200],
  'Offensive D': [72.5, 192],
  'Shutdown D': [75, 217],
  'Two-Way D': [74, 205],
  Butterfly: [76, 205],
  Hybrid: [74.5, 198],
  Athletic: [73.5, 190],
};

export interface Body {
  /** Inches. */
  height: number;
  /** Pounds. */
  weight: number;
}

export function bodyOf(p: Player, season?: number): Body {
  const [hMean, wMean] = FRAMES[p.archetype] ?? (p.pos === 'G' ? [74.5, 198] : p.pos === 'D' ? [73.5, 202] : [72.5, 195]);
  const rng = new Rng(deriveSeed(0xb0d7, `body:${p.id}:${p.firstName}:${p.lastName}`));
  const height = p.height ?? Math.round(clamp(hMean + rng.normal(0, 1.6), 67, 80));
  const frame = rng.normal(0, 7);
  if (p.weight !== undefined && season === undefined) return { height, weight: p.weight };
  const physical = p.skater ? clamp((p.skater.checking - 70) * 0.35, -5, 8) : 0;
  const a = season !== undefined ? age(p, season) : 25;
  const youth = Math.max(0, 23 - a) * 2;
  const weight = Math.round(clamp(wMean + (height - hMean) * 5.5 + frame + physical - youth, 155, 260));
  return { height, weight };
}

/** 6'2" */
export const formatHeight = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;
