import { autoLines } from './lines';
import { FRANCHISES, NAME_POOLS } from './names';
import { clamp, deriveSeed, Rng } from './rng';
import { overall } from './ratings';
import { buildSchedule } from './schedule';
import { salaryScale } from './contracts';
import { initFinances } from './finances';
import { initStaff } from './staff';
import type {
  AdvanceMode,
  Contract,
  GoalieRatings,
  League,
  Player,
  Position,
  SkaterRatings,
  Team,
  TeamController,
} from './types';

type SkaterKey = keyof SkaterRatings;

const FORWARD_ARCHETYPES: Record<string, Partial<Record<SkaterKey, number>>> = {
  Sniper: { shooting: 9, offIQ: 3, handling: 2, defIQ: -6, checking: -4 },
  Playmaker: { passing: 9, offIQ: 5, handling: 3, shooting: -3, defIQ: -3, checking: -5 },
  'Power Forward': { checking: 10, shooting: 3, skating: -2, handling: -2 },
  'Two-Way': { defIQ: 8, faceoffs: 3, shooting: -3, offIQ: -1 },
  Speedster: { skating: 10, handling: 3, checking: -6, defIQ: -3, passing: -1 },
  Grinder: { checking: 9, defIQ: 4, endurance: 3, shooting: -6, handling: -6, passing: -5, offIQ: -5, discipline: -6 },
};
/** Once-a-generation talent: elite everywhere, no real weakness. Never picked at random. */
const GENERATIONAL: Partial<Record<SkaterKey, number>> = {
  skating: 4, shooting: 3, passing: 4, handling: 4, offIQ: 5, defIQ: -2, checking: -4, endurance: 3,
};

const DEFENSE_ARCHETYPES: Record<string, Partial<Record<SkaterKey, number>>> = {
  'Offensive D': { passing: 7, offIQ: 7, skating: 4, shooting: 5, defIQ: -5, checking: -5 },
  'Shutdown D': { defIQ: 7, checking: 8, offIQ: -7, passing: -4, shooting: -3 },
  'Two-Way D': { skating: 2, defIQ: 2, passing: 1 },
};

const NATIONALITY_WEIGHTS = NAME_POOLS.map((p) => p.weight);

export interface GenerateOptions {
  seed: number;
  season?: number;
  name?: string;
  /** Teams that start human-controlled: teamAbbr -> userId. Everything else is AI. */
  humans?: Record<string, string>;
  advance?: AdvanceMode;
}

let idCounter = 0;

function makeName(rng: Rng) {
  const pool = NAME_POOLS[rng.weighted(NATIONALITY_WEIGHTS)];
  return { firstName: rng.pick(pool.first), lastName: rng.pick(pool.last), nationality: pool.nationality };
}

/** Typical NHL age distribution, weighted toward mid-20s. */
function sampleAge(rng: Rng): number {
  const ages = [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37];
  const w = [1, 3, 5, 7, 9, 10, 10, 10, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0.5];
  return ages[rng.weighted(w)];
}

/** Players below/after their prime are a bit weaker at a given depth slot. */
function ageAdjustment(age: number): number {
  if (age <= 20) return -4;
  if (age <= 22) return -2;
  if (age >= 35) return -3;
  if (age >= 33) return -1;
  return 0;
}

function potentialFor(rng: Rng, ovr: number, age: number): number {
  if (age >= 27) return ovr;
  const yearsToPeak = 27 - age;
  const growth = Math.max(0, rng.normal(yearsToPeak * 1.8, 3 + yearsToPeak * 0.6));
  return Math.round(clamp(ovr + growth, ovr, 97));
}

function contractFor(rng: Rng, ovr: number, age: number): Contract {
  if (age <= 21) {
    return { salary: 950_000, yearsLeft: rng.int(1, 3), kind: 'ELC', expiresAs: 'RFA' };
  }
  const base = salaryScale(ovr);
  const salary = Math.round(clamp(base * rng.normal(1, 0.15), 775_000, 15_500_000) / 25_000) * 25_000;
  const maxYears = age >= 34 ? 1 : age >= 31 ? 3 : 6;
  return {
    salary,
    yearsLeft: rng.int(1, maxYears),
    kind: 'standard',
    expiresAs: age + 1 >= 27 ? 'UFA' : 'RFA',
  };
}

function generateSkaterRatings(rng: Rng, pos: Position, target: number, archetype: string): SkaterRatings {
  const offsets =
    archetype === 'Generational' ? GENERATIONAL : (pos === 'D' ? DEFENSE_ARCHETYPES : FORWARD_ARCHETYPES)[archetype] ?? {};
  const r = {} as SkaterRatings;
  const keys: SkaterKey[] = ['skating', 'shooting', 'passing', 'handling', 'offIQ', 'defIQ', 'checking', 'faceoffs', 'discipline', 'endurance'];
  for (const k of keys) {
    let v = target + (offsets[k] ?? 0) + rng.normal(0, 4);
    if (k === 'faceoffs') v += pos === 'C' ? 4 : -14;
    if (k === 'discipline') v = 72 + (offsets[k] ?? 0) + rng.normal(0, 9);
    if (pos === 'D' && k === 'shooting') v -= 4;
    r[k] = Math.round(clamp(v, 25, 99));
  }
  return r;
}

/** Nudge every rating so the computed overall lands on the target. */
function fitToTarget(p: Player, target: number) {
  for (let i = 0; i < 3; i++) {
    const diff = target - overall(p);
    if (diff === 0) return;
    const ratings = (p.skater ?? p.goalie) as unknown as Record<string, number>;
    for (const k in ratings) {
      if (p.skater && (k === 'discipline')) continue;
      ratings[k] = Math.round(clamp(ratings[k] + diff, 25, 99));
    }
  }
}

/** Pick a playing style that fits a young player's ceiling rather than his current level. */
export function archetypeForCeiling(rng: Rng, pos: Position, ceiling: number): string | undefined {
  if (pos === 'G') return undefined;
  const pool = pos === 'D' ? DEFENSE_ARCHETYPES : FORWARD_ARCHETYPES;
  const names = Object.keys(pool);
  const weights = names.map((n) => (n === 'Grinder' ? (ceiling < 66 ? 3 : 0.2) : 1));
  return names[rng.weighted(weights)];
}

export function generatePlayer(
  rng: Rng,
  pos: Position,
  target: number,
  season: number,
  forcedAge?: number,
  forcedArchetype?: string,
): Player {
  const age = forcedAge ?? sampleAge(rng);
  const ovr = Math.round(clamp(target + ageAdjustment(age), 40, 97));
  const { firstName, lastName, nationality } = makeName(rng);
  let archetype: string;
  let skater: SkaterRatings | undefined;
  let goalie: GoalieRatings | undefined;

  if (pos === 'G') {
    archetype = rng.pick(['Butterfly', 'Hybrid', 'Athletic']);
    const g = (bias: number) => Math.round(clamp(ovr + bias + rng.normal(0, 3), 25, 99));
    goalie = {
      reflexes: g(archetype === 'Athletic' ? 4 : 0),
      positioning: g(archetype === 'Butterfly' ? 4 : 0),
      rebounds: g(archetype === 'Hybrid' ? 3 : -1),
      mental: g(0),
    };
  } else if (forcedArchetype) {
    archetype = forcedArchetype;
    skater = generateSkaterRatings(rng, pos, ovr, archetype);
  } else {
    const pool = pos === 'D' ? DEFENSE_ARCHETYPES : FORWARD_ARCHETYPES;
    const names = Object.keys(pool);
    // Low-end forwards skew toward grinders; high-end away from them.
    const weights = names.map((n) => (n === 'Grinder' ? (ovr < 68 ? 4 : 0.3) : 1));
    archetype = names[rng.weighted(weights)];
    skater = generateSkaterRatings(rng, pos, ovr, archetype);
  }

  const p: Player = {
    id: `p${++idCounter}`,
    firstName,
    lastName,
    pos,
    shoots: rng.chance(pos === 'RW' ? 0.35 : 0.62) ? 'L' : 'R',
    birthYear: season - age,
    nationality,
    archetype,
    teamId: null,
    skater,
    goalie,
    hidden: {
      potential: 0,
      consistency: clamp(rng.normal(0.65, 0.15), 0.2, 1),
      injuryProneness: clamp(rng.normal(0.3, 0.15), 0.02, 0.95),
      personality: { greed: rng.next(), loyalty: rng.next(), ambition: rng.next() },
    },
    contract: null,
    injury: null,
  };
  fitToTarget(p, ovr);
  p.hidden.potential = potentialFor(rng, overall(p), age);
  p.contract = contractFor(rng, overall(p), age);
  return p;
}

/** Depth-chart targets (overall) for a typical roster. */
const FORWARD_TIERS = [81, 74, 68, 63]; // per line
const DEFENSE_TIERS = [80, 77, 73, 70, 66, 63, 60];
const GOALIE_TIERS = [77, 68];
/** How many once-a-generation players a new league starts with. */
const GENERATIONAL_PLAYERS = 2;

/** Mean overall of the best N players in the league, where N = total roster spots. */
export function talentLevel(league: League): number {
  return talentStats(league).mean;
}

export function talentStats(league: League): { mean: number; sd: number } {
  const n = Object.keys(league.teams).length * 23;
  const ovrs = Object.values(league.players)
    .filter((p) => !league.retired?.[p.id])
    .map(overall)
    .sort((a, b) => b - a)
    .slice(0, n);
  const mean = ovrs.reduce((s, x) => s + x, 0) / ovrs.length;
  const sd = Math.sqrt(ovrs.reduce((s, x) => s + (x - mean) ** 2, 0) / ovrs.length);
  return { mean, sd };
}

export function generateLeague(opts: GenerateOptions): League {
  const season = opts.season ?? 2026;
  const rng = new Rng(deriveSeed(opts.seed, 'generate'));
  idCounter = 0;
  const players: Record<string, Player> = {};
  const teams: Record<string, Team> = {};

  const generationalTeams = new Set(
    rng.shuffle(FRANCHISES.map((f) => f.abbr)).slice(0, GENERATIONAL_PLAYERS),
  );

  for (const f of FRANCHISES) {
    const teamRng = rng.child(f.abbr);
    const strength = teamRng.normal(0, 1.6); // some teams are just better
    const roster: Player[] = [];
    const add = (pos: Position, target: number) => {
      // Occasional franchise superstar on a top line.
      const star = target >= 80 && teamRng.chance(0.1) ? teamRng.int(3, 6) : 0;
      const p = generatePlayer(teamRng, pos, target + strength + star + teamRng.normal(0, 2.5), season);
      p.teamId = f.abbr;
      roster.push(p);
    };
    for (const tier of FORWARD_TIERS) for (const pos of ['LW', 'C', 'RW'] as Position[]) add(pos, tier);
    // A couple of teams start with a generational superstar on the top line.
    if (generationalTeams.has(f.abbr)) {
      const slot = teamRng.int(0, 2);
      const old = roster[slot];
      const star = generatePlayer(teamRng, old.pos, teamRng.normal(94.5, 1.2), season, teamRng.int(21, 28), 'Generational');
      star.teamId = f.abbr;
      roster[slot] = star;
    }
    add(teamRng.pick(['LW', 'C', 'RW'] as Position[]), 60);
    add(teamRng.pick(['LW', 'C', 'RW'] as Position[]), 59);
    for (const tier of DEFENSE_TIERS) add('D', tier);
    for (const tier of GOALIE_TIERS) add('G', tier);

    // Keep payroll under the cap by trimming standard contracts proportionally.
    const cap = 104_000_000;
    const payroll = roster.reduce((s, p) => s + (p.contract?.salary ?? 0), 0);
    if (payroll > cap * 0.97) {
      const scale = (cap * 0.95) / payroll;
      for (const p of roster) {
        if (p.contract && p.contract.kind === 'standard') {
          p.contract.salary = Math.max(775_000, Math.round((p.contract.salary * scale) / 25_000) * 25_000);
        }
      }
    }

    for (const p of roster) players[p.id] = p;
    const humanUser = opts.humans?.[f.abbr];
    const controller: TeamController = humanUser
      ? { kind: 'human', userId: humanUser }
      : { kind: 'ai', strategy: strength > 1.5 ? 'contend' : strength < -1.5 ? 'rebuild' : 'balanced' };
    teams[f.abbr] = {
      id: f.abbr,
      city: f.city,
      name: f.name,
      abbr: f.abbr,
      colors: f.colors,
      conference: f.conference,
      division: f.division,
      controller,
      roster: roster.map((p) => p.id),
      lines: autoLines(roster),
    };
  }

  // Free-agent pool: depth players looking for work.
  const faRng = rng.child('free-agents');
  for (let i = 0; i < 70; i++) {
    const pos: Position = i < 6 ? 'G' : faRng.pick(['C', 'LW', 'RW', 'D', 'D'] as Position[]);
    const p = generatePlayer(faRng, pos, faRng.normal(60, 3), season);
    p.contract = null;
    players[p.id] = p;
  }

  // Each team starts with a few prospects developing in junior/minors.
  const prRng = rng.child('prospects');
  let prN = 0;
  for (const t of Object.values(teams)) {
    t.prospects = [];
    for (let i = 0; i < 4; i++) {
      const pos = prRng.pick(['C', 'LW', 'RW', 'D', 'D', 'G'] as Position[]);
      const a = prRng.int(18, 21);
      const potential = Math.min(95, Math.max(55, prRng.normal(69, 6)));
      const p = generatePlayer(prRng, pos, potential - (24 - a) * 3.2 + 4, season, a, archetypeForCeiling(prRng, pos, potential));
      p.id = `pr${++prN}`;
      const round = potential >= 76 ? 1 : potential >= 71 ? 2 : potential >= 66 ? prRng.int(3, 4) : prRng.int(5, 7);
      p.draft = { season: season - Math.max(1, a - 17), round, overall: (round - 1) * 32 + prRng.int(1, 32), teamId: t.id };
      p.hidden.potential = Math.round(Math.max(overall(p), potential));
      p.contract = null;
      p.teamId = null;
      p.prospectOf = t.id;
      players[p.id] = p;
      t.prospects.push(p.id);
    }
  }

  const league: League = {
    id: `league-${opts.seed}`,
    name: opts.name ?? 'Continental Hockey League',
    seed: opts.seed,
    season,
    day: 0,
    phase: 'regular-season',
    settings: {
      gamesPerTeam: 82,
      salaryCap: 104_000_000,
      salaryFloor: 76_900_000,
      advance: opts.advance ?? { mode: 'commissioner' },
      homeIce: 1.04,
    },
    teams,
    players,
    schedule: [],
    skaterStats: {},
    goalieStats: {},
    playoffs: null,
    playoffSkaterStats: {},
    playoffGoalieStats: {},
    awards: {},
    history: [],
    transactions: [],
    offseason: null,
    careerStats: {},
    retired: {},
  };
  initStaff(league);
  initFinances(league);
  const talent = talentStats(league);
  league.settings.talentAnchor = talent.mean;
  league.settings.talentSpread = talent.sd;
  league.schedule = buildSchedule(Object.values(teams), new Rng(deriveSeed(opts.seed, `schedule:${season}`)));
  return league;
}
