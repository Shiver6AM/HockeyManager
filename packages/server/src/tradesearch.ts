/**
 * Trade search: every player on another team (or in another team's prospect
 * pool), filtered by anything a GM would look at when picking a target —
 * position, type, age, ratings, scouted potential, trade value, contract,
 * season stats — and sorted. Everything here is what the viewer can already
 * see elsewhere: overall and ratings are public, potential is his own scouts'
 * grade, value is the neutral league-wide figure the trade center shows.
 */
import {
  age,
  assetFits,
  bodyOf,
  capRoom,
  coachability,
  overall,
  playerValue,
  scoutedPotential,
  tradeBlock,
  traitList,
  TRAITS,
  computeTraits,
  type League,
  type Player,
  type Team,
  projectionLabel,
} from '@hockey-gm/sim-core';
import { z } from 'zod';
import { grade } from './routers/offseason';
import { ovrChange, teamInfo } from './views';

/** Potential grades, worst to best (a range filter runs over their index). */
export const GRADES = ['F', 'D', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'] as const;

export const SKATER_RATINGS = ['skating', 'shooting', 'passing', 'handling', 'offIQ', 'defIQ', 'checking', 'faceoffs', 'discipline', 'endurance'] as const;
export const GOALIE_RATINGS = ['reflexes', 'positioning', 'rebounds', 'mental'] as const;
/** Season stats a range can be set on (skaters, then goalies). */
export const SKATER_STATS = ['gp', 'g', 'a', 'p', 'ppg', 'gpg', 'pm', 'pim', 'sog', 'shPct', 'ppp', 'shp', 'gwg', 'hits', 'blk', 'toi', 'foPct'] as const;
export const GOALIE_STATS = ['gp', 'gs', 'w', 'svPct', 'gaa', 'so'] as const;

const range = z.object({ min: z.number().optional(), max: z.number().optional() }).optional();
const rangeMap = z.record(z.string().max(16), range).optional();

export const searchInput = z.object({
  /** Any of these positions (empty = all). */
  pos: z.array(z.enum(['C', 'LW', 'RW', 'D', 'G'])).max(5).default([]),
  /** Also count players who can play the position (not only those listed at it). */
  altPos: z.boolean().default(false),
  types: z.array(z.string().max(40)).max(30).default([]),
  shoots: z.enum(['L', 'R']).nullable().default(null),
  name: z.string().max(40).default(''),
  age: range,
  overall: range,
  /** Index into GRADES. */
  potential: range,
  value: range,
  /** Cap hit, in millions. */
  aav: range,
  /** Years left on the deal. */
  term: range,
  /** Overall change since last season. */
  ovrChange: range,
  height: range,
  weight: range,
  coachability: range,
  ratings: rangeMap,
  stats: rangeMap,
  /** Which season's stats the stat ranges (and the table) use. */
  statSeason: z.enum(['recent', 'current', 'last']).default('recent'),
  expiresAs: z.enum(['any', 'UFA', 'RFA', 'ELC', 'unsigned']).default('any'),
  health: z.enum(['any', 'healthy', 'injured']).default('any'),
  /** Front-office direction: AI teams' strategy, or 'human' for managed teams. */
  strategy: z.array(z.enum(['contend', 'balanced', 'rebuild', 'human'])).max(4).default([]),
  teams: z.array(z.string().max(8)).max(40).default([]),
  traits: z.array(z.string().max(40)).max(20).default([]),
  /** NHL roster, AHL farm, unsigned prospects. */
  where: z.array(z.enum(['nhl', 'farm', 'prospect'])).max(3).default(['nhl', 'farm']),
  onBlock: z.boolean().default(false),
  fitsNeeds: z.boolean().default(false),
  /** His cap hit fits in my cap space as is. */
  affordable: z.boolean().default(false),
  sort: z.string().max(24).default('value'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  limit: z.number().int().min(1).max(300).default(100),
});
export type SearchInput = z.infer<typeof searchInput>;

/** A neutral front office (consensus scouting, no contend/rebuild lean) for league-wide trade values. */
const MARKET = { id: 'league', controller: { kind: 'human', userId: '' }, roster: [] } as unknown as Team;

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function statsFor(L: League, p: Player, which: SearchInput['statSeason']) {
  const now = { season: L.season, skater: L.skaterStats[p.id] ?? null, goalie: L.goalieStats[p.id] ?? null };
  const lines = L.careerStats?.[p.id] ?? [];
  const lastLine = lines.filter((c) => c.season === L.season - 1 && (c.skater?.gp || c.goalie?.gp));
  // (A player traded mid-season has a line per team: add them up.)
  const sumLast = () => {
    if (!lastLine.length) return null;
    const sk = lastLine.map((c) => c.skater).filter(Boolean) as NonNullable<(typeof lastLine)[number]['skater']>[];
    const gl = lastLine.map((c) => c.goalie).filter(Boolean) as NonNullable<(typeof lastLine)[number]['goalie']>[];
    const add = <T extends object>(xs: T[]) =>
      xs.length ? (xs.reduce((a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, ((a as Record<string, number>)[k] ?? 0) + (b as Record<string, number>)[k]])) as T, {} as T) as T) : null;
    return { season: L.season - 1, skater: add(sk), goalie: add(gl) };
  };
  const played = (s: { skater: { gp: number } | null; goalie: { gp: number } | null } | null) => !!s && (s.skater?.gp ?? s.goalie?.gp ?? 0) > 0;
  if (which === 'current') return played(now) ? now : null;
  if (which === 'last') return sumLast();
  return played(now) ? now : sumLast();
}

function statLine(L: League, p: Player, which: SearchInput['statSeason']) {
  const s = statsFor(L, p, which);
  if (!s) return null;
  if (p.pos === 'G') {
    const g = s.goalie;
    if (!g || !g.gp) return null;
    return {
      season: s.season,
      gp: g.gp,
      gs: g.gs,
      w: g.w,
      l: g.l,
      otl: g.otl,
      svPct: g.sa ? r3(1 - g.ga / g.sa) : null,
      gaa: g.toi ? Math.round(((g.ga * 3600) / g.toi) * 100) / 100 : null,
      so: g.so,
    };
  }
  const k = s.skater;
  if (!k || !k.gp) return null;
  const fo = k.fow + k.fol;
  return {
    season: s.season,
    gp: k.gp,
    g: k.g,
    a: k.a,
    p: k.g + k.a,
    ppg: Math.round(((k.g + k.a) / k.gp) * 100) / 100,
    gpg: Math.round((k.g / k.gp) * 100) / 100,
    pm: k.pm,
    pim: k.pim,
    sog: k.sog,
    shPct: k.sog ? r1((k.g / k.sog) * 100) : null,
    ppp: k.ppg + k.ppa,
    shp: k.shg,
    gwg: k.gwg,
    hits: k.hits,
    blk: k.blk,
    /** Minutes per game. */
    toi: r1(k.toi / 60 / k.gp),
    foPct: fo >= 20 ? r1((k.fow / fo) * 100) : null,
  };
}

const inRange = (v: number | null | undefined, r: { min?: number; max?: number } | undefined) => {
  if (!r || (r.min === undefined && r.max === undefined)) return true;
  if (v === null || v === undefined) return false;
  return (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);
};

export interface SearchRow {
  id: string;
  name: string;
  pos: Player['pos'];
  altPos: Player['pos'][];
  shoots: 'L' | 'R';
  age: number;
  archetype: string;
  teamId: string;
  strategy: 'contend' | 'balanced' | 'rebuild' | 'human';
  where: 'nhl' | 'farm' | 'prospect';
  overall: number;
  ovrChange: number | null;
  potential: { grade: string; projection: string };
  value: number;
  contract: { salary: number; yearsLeft: number; expiresAs: 'RFA' | 'UFA'; kind: 'ELC' | 'standard' } | null;
  injury: { type: string; severity: string; daysLeft: number } | null;
  onBlock: boolean;
  fits: string[];
  traits: Array<{ id: string; label: string; tier: number; tierName: string }>;
  height: number;
  weight: number;
  coachability: number;
  ratings: Record<string, number>;
  stats: ReturnType<typeof statLine>;
}

export function searchPlayers(L: League, viewer: string | null, q: SearchInput) {
  const season = L.season + (L.phase === 'offseason' ? 1 : 0);
  const me = viewer ? L.teams[viewer] : null;
  const myNeeds = me ? tradeBlock(L, me).needs : [];
  const room = me ? capRoom(L, me) : Infinity;
  const name = q.name.trim().toLowerCase();
  const wantTraits = new Set(q.traits);
  const posOk = (p: Player) => !q.pos.length || q.pos.some((x) => p.pos === x || (q.altPos && (p.altPos ?? []).includes(x)));

  const rows: SearchRow[] = [];
  let matched = 0;
  for (const t of Object.values(L.teams)) {
    if (t.id === viewer) continue;
    if (q.teams.length && !q.teams.includes(t.id)) continue;
    const strategy = t.controller.kind === 'ai' ? t.controller.strategy : 'human';
    if (q.strategy.length && !q.strategy.includes(strategy)) continue;
    const block = new Set(tradeBlock(L, t).players);
    const ids: Array<[string, 'nhl' | 'farm' | 'prospect']> = [
      ...t.roster.map((id) => [id, L.players[id]?.farm ? 'farm' : 'nhl'] as [string, 'nhl' | 'farm']),
      ...(t.prospects ?? []).map((id) => [id, 'prospect'] as [string, 'prospect']),
    ];
    for (const [id, where] of ids) {
      const p = L.players[id];
      if (!p || !q.where.includes(where)) continue;
      // Cheap tests first.
      if (!posOk(p)) continue;
      if (q.types.length && !q.types.includes(p.archetype)) continue;
      if (q.shoots && p.shoots !== q.shoots) continue;
      if (name && !`${p.firstName} ${p.lastName}`.toLowerCase().includes(name)) continue;
      const a = age(p, season);
      if (!inRange(a, q.age)) continue;
      const ovr = overall(p);
      if (!inRange(ovr, q.overall)) continue;
      const c = p.contract ?? null;
      if (!inRange(c ? c.salary / 1e6 : null, q.aav)) continue;
      if (!inRange(c ? c.yearsLeft : null, q.term)) continue;
      if (q.expiresAs === 'unsigned' ? !!c : q.expiresAs === 'ELC' ? c?.kind !== 'ELC' : q.expiresAs !== 'any' && c?.expiresAs !== q.expiresAs) continue;
      if (q.health === 'healthy' && p.injury) continue;
      if (q.health === 'injured' && !p.injury) continue;
      if (q.affordable && (c?.salary ?? 0) > room) continue;
      const onBlock = block.has(id);
      if (q.onBlock && !onBlock) continue;
      const fits = assetFits(L, { kind: 'player', id }, myNeeds);
      if (q.fitsNeeds && !fits.length) continue;
      const ratings = (p.pos === 'G' ? p.goalie : p.skater) as Record<string, number> | undefined;
      let ok = true;
      for (const [k, r] of Object.entries(q.ratings ?? {})) {
        // (A rating the player doesn't have — a goalie's reflexes on a skater — rules him out.)
        if (!inRange(ratings?.[k], r)) ok = false;
      }
      if (!ok) continue;
      const body = bodyOf(p, season);
      if (!inRange(body.height, q.height) || !inRange(body.weight, q.weight)) continue;
      const coach = coachability(p);
      if (!inRange(coach, q.coachability)) continue;
      const chg = ovrChange(L, p).ovrChange;
      if (!inRange(chg, q.ovrChange)) continue;
      const traits = traitList(p.traitsSeason === undefined ? { ...p, traits: computeTraits(p) } : p);
      if (wantTraits.size && !traits.some((x) => wantTraits.has(x.id))) continue;
      const stats = statLine(L, p, q.statSeason);
      for (const [k, r] of Object.entries(q.stats ?? {})) {
        if (!inRange((stats as Record<string, number | null> | null)?.[k], r)) ok = false;
      }
      if (!ok) continue;
      const scouted = scoutedPotential(L, viewer ?? 'league', p);
      const g = grade(scouted);
      if (!inRange(GRADES.indexOf(g as (typeof GRADES)[number]), q.potential)) continue;
      const value = Math.round(playerValue(L, MARKET, p));
      if (!inRange(value, q.value)) continue;
      matched++;
      rows.push({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        pos: p.pos,
        altPos: p.altPos ?? [],
        shoots: p.shoots,
        age: a,
        archetype: p.archetype,
        teamId: t.id,
        strategy,
        where,
        overall: ovr,
        ovrChange: chg,
        potential: { grade: g, projection: projectionLabel(scouted, p.pos) },
        value,
        contract: c ? { salary: c.salary, yearsLeft: c.yearsLeft, expiresAs: c.expiresAs, kind: c.kind } : null,
        injury: p.injury ? { type: p.injury.type, severity: p.injury.severity, daysLeft: p.injury.daysLeft } : null,
        onBlock,
        fits,
        traits: traits.map((x) => ({ id: x.id, label: x.label, tier: x.tier, tierName: x.tierName })),
        height: body.height,
        weight: body.weight,
        coachability: coach,
        ratings: ratings ? { ...ratings } : {},
        stats,
      });
    }
  }

  const key = q.sort;
  const val = (r: (typeof rows)[number]): number | string | null => {
    switch (key) {
      case 'name':
        return r.name;
      case 'team':
        return L.teams[r.teamId].abbr;
      case 'pos':
        return r.pos;
      case 'potential':
        return GRADES.indexOf(r.potential.grade as (typeof GRADES)[number]);
      case 'aav':
        return r.contract?.salary ?? null;
      case 'term':
        return r.contract?.yearsLeft ?? null;
      case 'age':
      case 'overall':
      case 'value':
      case 'ovrChange':
      case 'height':
      case 'weight':
        return r[key];
      default:
        if (key.startsWith('s.')) return (r.stats as Record<string, number | null> | null)?.[key.slice(2)] ?? null;
        if (key.startsWith('r.')) return r.ratings[key.slice(2)] ?? null;
        return r.value;
    }
  };
  const sign = q.dir === 'asc' ? 1 : -1;
  rows.sort((x, y) => {
    const a = val(x);
    const b = val(y);
    // (Missing values always last.)
    if (a === null && b === null) return y.value - x.value;
    if (a === null) return 1;
    if (b === null) return -1;
    const d = typeof a === 'string' ? a.localeCompare(b as string) : a - (b as number);
    return d ? d * sign : y.value - x.value;
  });

  return {
    total: matched,
    players: rows.slice(0, q.limit),
    capRoom: me ? room : null,
    myNeeds,
  };
}

/** What the search form offers: player types, traits, rating and stat names. */
export function searchCatalog(L: League) {
  const types = new Map<string, Set<string>>();
  for (const p of Object.values(L.players)) {
    const k = p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F';
    if (!types.has(p.archetype)) types.set(p.archetype, new Set());
    types.get(p.archetype)!.add(k);
  }
  return {
    types: [...types].map(([name, groups]) => ({ name, groups: [...groups] })).sort((a, b) => a.name.localeCompare(b.name)),
    traits: TRAITS.map((t) => ({ id: t.id, label: t.label, who: t.who })),
    grades: GRADES,
    skaterRatings: SKATER_RATINGS,
    goalieRatings: GOALIE_RATINGS,
    teams: Object.values(L.teams).map(teamInfo),
  };
}
