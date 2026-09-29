/**
 * Skills coaches and in-season training.
 *
 * Each team can employ up to three skills coaches. A coach is rated in three
 * skill groups (offense, defense, skating) and has one to three specialties,
 * the groups he's genuinely good at; the more specialties, the more he costs.
 * Each coach works with up to five players at a time, on one skill each:
 * either one the manager picks (a rating like shooting, or a situational skill
 * like net-front play) or, on "auto", the player's weakest important skill that
 * the coach can teach.
 *
 * Progress accrues a little every day of the season, so no one jumps several
 * points in a week, but a focused season can add a good chunk to one skill.
 * How much depends on the coach's rating in that skill's group, the player's
 * coachability, his age, and how much room the skill has left to grow.
 */
import { NAME_POOLS } from './names';
import { age, overall, overallWeights } from './ratings';
import { clamp, deriveSeed, Rng } from './rng';
import { ROLE_LABEL, ROLES, roleSkill, type Role } from './systems';
import type { GoalieRatings, League, Player, PlayerId, SkaterRatings, Team } from './types';
import { slider } from './sliders';

export type SkillGroup = 'offense' | 'defense' | 'skating' | 'goaltending';
/** Groups skills coaches specialize in (goaltending is the goalie coach's job). */
export const SKILL_GROUPS: SkillGroup[] = ['offense', 'defense', 'skating'];
export const SKILL_GROUP_LABEL: Record<SkillGroup, string> = { offense: 'Offense', defense: 'Defense', skating: 'Skating', goaltending: 'Goaltending' };

type SkaterKey = keyof SkaterRatings;
type GoalieKey = keyof GoalieRatings;
/** Anything a coach can work on: a rating or a situational (role) skill. */
export type TrainableSkill = SkaterKey | GoalieKey | Role;

export const RATING_LABEL: Record<SkaterKey | GoalieKey, string> = {
  skating: 'Skating',
  shooting: 'Shooting',
  passing: 'Passing',
  handling: 'Puck handling',
  offIQ: 'Offensive IQ',
  defIQ: 'Defensive IQ',
  checking: 'Checking',
  faceoffs: 'Faceoffs',
  discipline: 'Discipline',
  endurance: 'Endurance',
  reflexes: 'Reflexes',
  positioning: 'Positioning',
  rebounds: 'Rebound control',
  mental: 'Mental',
};

/** Which coaching group teaches each skill. */
export const SKILL_GROUP_OF: Record<TrainableSkill, SkillGroup> = {
  // Ratings
  shooting: 'offense',
  passing: 'offense',
  handling: 'offense',
  offIQ: 'offense',
  faceoffs: 'offense',
  defIQ: 'defense',
  checking: 'defense',
  discipline: 'defense',
  skating: 'skating',
  endurance: 'skating',
  // Goaltending is the goalie coach's.
  reflexes: 'goaltending',
  positioning: 'goaltending',
  rebounds: 'goaltending',
  mental: 'goaltending',
  // Situational skills
  netFront: 'offense',
  bumper: 'offense',
  halfWall: 'offense',
  oneTimer: 'offense',
  point: 'offense',
  shootout: 'offense',
  pkForward: 'defense',
  pkDefense: 'defense',
  forecheck: 'skating',
  transition: 'skating',
};

export const SKATER_SKILLS: SkaterKey[] = ['skating', 'shooting', 'passing', 'handling', 'offIQ', 'defIQ', 'checking', 'faceoffs', 'discipline', 'endurance'];
export const GOALIE_SKILLS: GoalieKey[] = ['reflexes', 'positioning', 'rebounds', 'mental'];
const isRole = (s: TrainableSkill): s is Role => (ROLES as string[]).includes(s);

export function skillLabel(s: TrainableSkill): string {
  return isRole(s) ? ROLE_LABEL[s] : RATING_LABEL[s];
}

/** Skills that make sense for a player (goalies train goaltending; only skaters get situational skills). */
export function skillsFor(p: Player): TrainableSkill[] {
  return p.goalie ? [...GOALIE_SKILLS] : [...SKATER_SKILLS, ...ROLES];
}

export interface SkillsCoach {
  id: string;
  name: string;
  /** 35–95 in each group. */
  ratings: Record<SkillGroup, number>;
  /** The groups he's genuinely good at (1–3). */
  specialties: SkillGroup[];
  salary: number;
  yearsLeft: number;
  /** Pick players and skills automatically. */
  auto: boolean;
  /** Up to five players (four goalies for a goalie coach), each on one skill ('auto' = the coach decides). */
  assignments: Array<{ playerId: PlayerId; skill: TrainableSkill | 'auto' }>;
  /** A goalie coach works only with goalies. */
  kind?: 'goalie';
}

export const SKILLS = {
  maxCoaches: 3,
  maxPlayers: 5,
  maxGoalies: 4,
  goaliePoolSize: 6,
  /** Rating points per day for an average coach, player and age, far from the ceiling. */
  basePerDay: 0.025,
  /** Situational skills are narrower, so focused work moves them a bit faster. */
  roleFactor: 1.2,
  /** Most a situational skill can be raised above its natural level. */
  roleCap: 12,
  poolSize: 15,
};

// ---------------------------------------------------------------------------
// Coaches: generation, pay, hiring
// ---------------------------------------------------------------------------

/** Salary: pay for each specialty (more for a better one), plus a premium for versatility. */
export function skillsCoachSalary(c: Pick<SkillsCoach, 'ratings' | 'specialties'>): number {
  const per = c.specialties.reduce((s, g) => {
    const t = clamp((c.ratings[g] - 55) / 40, 0, 1);
    return s + 250_000 + 1_100_000 * t * t;
  }, 0);
  const premium = 1 + 0.2 * (c.specialties.length - 1);
  return Math.round((per * premium) / 25_000) * 25_000;
}

export function generateSkillsCoach(rng: Rng, id: string, quality = rng.normal(0, 1)): SkillsCoach {
  const pool = NAME_POOLS[rng.weighted(NAME_POOLS.map((p) => p.weight))];
  const n = 1 + rng.weighted([0.5, 0.33, 0.17]);
  const specialties = rng.shuffle([...SKILL_GROUPS]).slice(0, n) as SkillGroup[];
  const ratings = {} as Record<SkillGroup, number>;
  for (const g of SKILL_GROUPS) {
    ratings[g] = specialties.includes(g)
      ? Math.round(clamp(72 + 7 * quality + rng.normal(0, 5), 58, 95))
      : Math.round(clamp(rng.normal(47, 6), 35, 57));
  }
  ratings.goaltending = Math.round(clamp(rng.normal(38, 5), 30, 50));
  const c: SkillsCoach = {
    id,
    name: `${rng.pick(pool.first)} ${rng.pick(pool.last)}`,
    ratings,
    specialties: SKILL_GROUPS.filter((g) => specialties.includes(g)),
    salary: 0,
    yearsLeft: rng.int(1, 3),
    auto: true,
    assignments: [],
  };
  c.salary = skillsCoachSalary(c);
  return c;
}

/** A goalie coach: rated in goaltending, works with up to four goalies. */
export function generateGoalieCoach(rng: Rng, id: string, quality = rng.normal(0, 1)): SkillsCoach {
  const pool = NAME_POOLS[rng.weighted(NAME_POOLS.map((p) => p.weight))];
  const c: SkillsCoach = {
    id,
    name: `${rng.pick(pool.first)} ${rng.pick(pool.last)}`,
    ratings: { offense: 35, defense: 40, skating: 35, goaltending: Math.round(clamp(70 + 8 * quality + rng.normal(0, 4), 52, 96)) },
    specialties: ['goaltending'],
    salary: 0,
    yearsLeft: rng.int(1, 3),
    auto: true,
    assignments: [],
    kind: 'goalie',
  };
  c.salary = skillsCoachSalary(c);
  return c;
}

/** Every coach on staff: skills coaches and the goalie coach. */
export const coachesOf = (team: Team): SkillsCoach[] => [...(team.skillsCoaches ?? []), ...(team.goalieCoach ? [team.goalieCoach] : [])];

function nextCoachId(league: League, rng: Rng): string {
  const used = new Set(
    [...(league.skillsCoachPool ?? []), ...(league.goalieCoachPool ?? []), ...Object.values(league.teams).flatMap((t) => coachesOf(t))].map((c) => c.id),
  );
  let id: string;
  do id = `sc${league.season}-${rng.int(0, 1e7)}`;
  while (used.has(id));
  return id;
}

/** Keep the market stocked, always with a few strong candidates. */
export function refillSkillsCoachPool(league: League, rng = new Rng(deriveSeed(league.seed, `skills-pool:${league.season}:${league.day}:${(league.skillsCoachPool ?? []).length}`))) {
  const pool = (league.skillsCoachPool ??= []);
  const strong = pool.filter((c) => c.specialties.some((g) => c.ratings[g] >= 80)).length;
  for (let i = strong; i < 4; i++) pool.push(generateSkillsCoach(rng, nextCoachId(league, rng), rng.normal(1.3, 0.4)));
  while (pool.length < SKILLS.poolSize) pool.push(generateSkillsCoach(rng, nextCoachId(league, rng)));
  const gpool = (league.goalieCoachPool ??= []);
  if (!gpool.some((c) => c.ratings.goaltending >= 80)) gpool.push(generateGoalieCoach(rng, nextCoachId(league, rng), 1.4));
  while (gpool.length < SKILLS.goaliePoolSize) gpool.push(generateGoalieCoach(rng, nextCoachId(league, rng)));
}

/** Leagues without skills coaches get them: each team starts with one to three, on auto. */
export function initSkillsCoaches(league: League) {
  const rng = new Rng(deriveSeed(league.seed, 'skills-coaches'));
  for (const t of Object.values(league.teams)) {
    if (!t.skillsCoaches) {
      const n = 1 + rng.weighted([0.3, 0.45, 0.25]);
      t.skillsCoaches = Array.from({ length: n }, () => generateSkillsCoach(rng, nextCoachId(league, rng)));
    }
  }
  const grng = new Rng(deriveSeed(league.seed, 'goalie-coaches'));
  for (const t of Object.values(league.teams)) if (!t.goalieCoach) t.goalieCoach = generateGoalieCoach(grng, nextCoachId(league, grng));
  refillSkillsCoachPool(league, rng);
}

export function skillsCoachPayroll(team: Team): number {
  return coachesOf(team).reduce((s, c) => s + c.salary, 0);
}

export function hireSkillsCoach(league: League, team: Team, coachId: string): SkillsCoach {
  // A goalie coach replaces the current one (who's paid a settlement).
  const gc = (league.goalieCoachPool ?? []).find((x) => x.id === coachId);
  if (gc) {
    if (team.goalieCoach) releaseSkillsCoach(league, team, team.goalieCoach.id);
    league.goalieCoachPool = league.goalieCoachPool!.filter((x) => x.id !== coachId);
    team.goalieCoach = { ...gc, yearsLeft: Math.max(2, gc.yearsLeft), auto: true, assignments: [] };
    refillSkillsCoachPool(league);
    return team.goalieCoach;
  }
  const coaches = (team.skillsCoaches ??= []);
  if (coaches.length >= SKILLS.maxCoaches) throw new Error(`You already have ${SKILLS.maxCoaches} skills coaches. Let one go first.`);
  const pool = league.skillsCoachPool ?? [];
  const c = pool.find((x) => x.id === coachId);
  if (!c) throw new Error('That coach is not available');
  league.skillsCoachPool = pool.filter((x) => x.id !== coachId);
  const hired = { ...c, yearsLeft: Math.max(2, c.yearsLeft), auto: true, assignments: [] };
  coaches.push(hired);
  refillSkillsCoachPool(league);
  return hired;
}

/** Let a coach go: half his remaining salary is paid as a settlement. */
export function releaseSkillsCoach(league: League, team: Team, coachId: string): { settlement: number } {
  const c = coachesOf(team).find((x) => x.id === coachId);
  if (!c) throw new Error('Not one of your coaches');
  if (c.kind === 'goalie') team.goalieCoach = undefined;
  else team.skillsCoaches = team.skillsCoaches!.filter((x) => x.id !== coachId);
  const settlement = Math.round((c.salary * Math.max(0, c.yearsLeft - 1)) / 2);
  if (team.finances) team.finances.staff += settlement;
  (c.kind === 'goalie' ? (league.goalieCoachPool ??= []) : (league.skillsCoachPool ??= [])).push({ ...c, auto: true, assignments: [], yearsLeft: 2 });
  return { settlement };
}

export function setCoachPlan(team: Team, coachId: string, plan: { auto: boolean; assignments: SkillsCoach['assignments'] }, league: League) {
  const c = coachesOf(team).find((x) => x.id === coachId);
  if (!c) throw new Error('Not one of your coaches');
  const max = c.kind === 'goalie' ? SKILLS.maxGoalies : SKILLS.maxPlayers;
  if (plan.assignments.length > max) throw new Error(`A coach can work with at most ${max} players`);
  const ids = plan.assignments.map((a) => a.playerId);
  if (new Set(ids).size !== ids.length) throw new Error('A player is listed twice for this coach');
  for (const a of plan.assignments) {
    const p = league.players[a.playerId];
    if (!p || p.teamId !== team.id) throw new Error('Coaches can only work with players on your roster');
    if (c.kind === 'goalie' && p.pos !== 'G') throw new Error('A goalie coach works with goalies');
    if (a.skill !== 'auto' && !skillsFor(p).includes(a.skill)) throw new Error(`${p.lastName} can't work on that skill`);
    const other = coachesOf(team).find((x) => x.id !== coachId && !x.auto && x.assignments.some((y) => y.playerId === a.playerId));
    if (other) throw new Error(`${p.firstName} ${p.lastName} is already working with ${other.name}`);
  }
  c.auto = plan.auto;
  c.assignments = plan.assignments.map((a) => ({ ...a }));
}

/** Each summer: contracts run down (expiring coaches re-sign); AI teams fill empty chairs. */
export function offseasonSkillsCoaches(league: League) {
  const rng = new Rng(deriveSeed(league.seed, `skills-summer:${league.season}`));
  refillSkillsCoachPool(league, rng);
  for (const t of Object.values(league.teams)) {
    for (const c of coachesOf(t)) {
      c.yearsLeft -= 1;
      if (c.yearsLeft <= 0) c.yearsLeft = rng.int(1, 3);
    }
    if (t.controller.kind === 'ai' && (t.skillsCoaches?.length ?? 0) < 2 && rng.chance(0.5)) {
      const pick = [...(league.skillsCoachPool ?? [])].sort((a, b) => b.salary - a.salary)[rng.int(3, 8)];
      if (pick) hireSkillsCoach(league, t, pick.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Coachability and training
// ---------------------------------------------------------------------------

/**
 * How much a player gets out of coaching, 1–99 (50 is typical). Derived from
 * his id so it's stable for his career and older saves get it too.
 */
const coachabilityCache = new Map<string, number>();
export function coachability(p: Player): number {
  if (p.coachability !== undefined) return p.coachability;
  let v = coachabilityCache.get(p.id);
  if (v === undefined) {
    v = Math.round(clamp(new Rng(deriveSeed(0xc0ac4, `coachability:${p.id}`)).normal(52, 18), 5, 99));
    if (coachabilityCache.size > 100_000) coachabilityCache.clear();
    coachabilityCache.set(p.id, v);
  }
  return v;
}

export function coachabilityLabel(c: number): string {
  return c >= 80 ? 'Very coachable' : c >= 62 ? 'Coachable' : c >= 40 ? 'Average' : c >= 22 ? 'Stubborn' : 'Hard to coach';
}

/** Current value of a skill (rating or situational). */
export function skillValue(p: Player, s: TrainableSkill): number {
  if (isRole(s)) return roleSkill(p, s);
  const r = (p.skater ?? p.goalie) as unknown as Record<string, number>;
  return r[s] ?? 0;
}

/** Rating points per day this coach adds to this player's skill. */
export function trainingRate(league: League, coach: SkillsCoach, p: Player, s: TrainableSkill): number {
  const group = SKILL_GROUP_OF[s];
  const cr = coach.ratings[group] ?? 35;
  const coachF = 0.55 + 0.9 * clamp((cr - 35) / 60, 0, 1);
  const learnF = 0.5 + 0.9 * (coachability(p) / 100);
  const a = age(p, league.season);
  const ageF = a <= 21 ? 1.25 : a <= 24 ? 1.12 : a <= 27 ? 1 : a <= 30 ? 0.8 : a <= 33 ? 0.62 : 0.45;
  const v = skillValue(p, s);
  const room = clamp((97 - v) / 35, 0.12, 1);
  let rate = SKILLS.basePerDay * coachF * learnF * ageF * room * slider(league, 'coaching');
  if (isRole(s)) {
    rate *= SKILLS.roleFactor;
    if ((p.roleTraining?.[s] ?? 0) >= SKILLS.roleCap) rate = 0;
  }
  return rate;
}

/**
 * The coach's pick for a player: the important skill he's weakest at that this
 * coach can teach, weighing how much it counts toward the player's game.
 */
export function autoSkill(league: League, coach: SkillsCoach, p: Player): TrainableSkill | null {
  const w = overallWeights(p.pos) as Record<string, number>;
  const keys = Object.keys(w).filter((k) => w[k] > 0) as Array<SkaterKey | GoalieKey>;
  const r = (p.skater ?? p.goalie) as unknown as Record<string, number>;
  const avg = keys.reduce((s, k) => s + r[k] * w[k], 0) / keys.reduce((s, k) => s + w[k], 0);
  let best: TrainableSkill | null = null;
  let bestV = -Infinity;
  for (const k of keys) {
    if (!coach.specialties.includes(SKILL_GROUP_OF[k])) continue; // he only teaches his specialties on auto
    const weakness = avg - r[k] + 6;
    const v = w[k] * Math.max(0.5, weakness) * trainingRate(league, coach, p, k);
    if (v > bestV) {
      bestV = v;
      best = k;
    }
  }
  return best;
}

/** On auto: the five players who'd gain the most (young, coachable, with obvious weaknesses). */
export function autoPlayers(league: League, team: Team, coach: SkillsCoach, taken: Set<PlayerId>): PlayerId[] {
  const goalieCoach = coach.kind === 'goalie';
  const scored = team.roster
    .map((id) => league.players[id])
    .filter((p) => p && !taken.has(p.id) && !p.injury && (p.pos === 'G') === goalieCoach)
    .map((p) => {
      const s = autoSkill(league, coach, p);
      const score = s ? trainingRate(league, coach, p, s) * (1 + Math.max(0, overall(p) - 60) / 40) : 0;
      return { id: p.id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, goalieCoach ? SKILLS.maxGoalies : SKILLS.maxPlayers).map((x) => x.id);
}

type Plan = Array<{ coach: SkillsCoach; player: Player; skill: TrainableSkill }>;
/** Coaches revisit their plans weekly (or when the roster or their assignments change). */
const planCache = new WeakMap<Team, { key: string; plan: Plan }>();

/** The effective plan for today: auto coaches pick their own players; 'auto' skills are resolved. */
export function resolvePlan(league: League, team: Team): Plan {
  const key = `${league.season}:${Math.floor(league.day / 7)}:${team.roster.join(',')}:${coachesOf(team).map((c) => `${c.id}${c.auto ? 'a' : 'm'}${c.assignments.map((a) => a.playerId + a.skill).join('')}`).join('|')}`;
  const hit = planCache.get(team);
  if (hit && hit.key === key && hit.plan.every((x) => league.players[x.player.id] === x.player)) return hit.plan;
  const plan = computePlan(league, team);
  planCache.set(team, { key, plan });
  return plan;
}

function computePlan(league: League, team: Team): Plan {
  const out: Array<{ coach: SkillsCoach; player: Player; skill: TrainableSkill }> = [];
  const taken = new Set<PlayerId>();
  const coaches = coachesOf(team);
  // Manual assignments claim their players first.
  for (const c of coaches) {
    if (c.auto) continue;
    for (const a of c.assignments) {
      const p = league.players[a.playerId];
      if (!p || p.teamId !== team.id || taken.has(p.id)) continue;
      const skill = a.skill === 'auto' ? autoSkill(league, c, p) : a.skill;
      if (!skill) continue;
      taken.add(p.id);
      out.push({ coach: c, player: p, skill });
    }
  }
  for (const c of coaches) {
    if (!c.auto) continue;
    for (const id of autoPlayers(league, team, c, taken)) {
      const p = league.players[id];
      const skill = autoSkill(league, c, p);
      if (!skill) continue;
      taken.add(id);
      out.push({ coach: c, player: p, skill });
    }
  }
  return out;
}

function raise(league: League, p: Player, s: TrainableSkill) {
  const before = overall(p);
  if (isRole(s)) {
    (p.roleTraining ??= {})[s] = (p.roleTraining[s] ?? 0) + 1;
  } else {
    const r = (p.skater ?? p.goalie) as unknown as Record<string, number>;
    r[s] = Math.min(99, r[s] + 1);
  }
  const after = overall(p);
  // Real improvement raises his ceiling too.
  if (after > before) p.hidden.potential = Math.min(99, Math.max(after, p.hidden.potential + (after - before)));
  const log = (p.trainingLog ??= { season: league.season, gains: {} });
  if (log.season !== league.season) {
    log.season = league.season;
    log.gains = {};
  }
  log.gains[s] = (log.gains[s] ?? 0) + 1;
}

/** One day of practice for every team. Called once per game day during the season. */
export function trainingDay(league: League) {
  for (const t of Object.values(league.teams)) {
    for (const { coach, player, skill } of resolvePlan(league, t)) {
      const prog = (player.trainingProgress ??= {});
      const key = skill as string;
      prog[key] = (prog[key] ?? 0) + trainingRate(league, coach, player, skill);
      while (prog[key] >= 1) {
        prog[key] -= 1;
        if (skillValue(player, skill) >= 99) {
          prog[key] = 0;
          break;
        }
        raise(league, player, skill);
      }
    }
  }
}

/** Projected gain over a full season at today's rate (for the UI). */
export function projectedSeasonGain(league: League, coach: SkillsCoach, p: Player, s: TrainableSkill): number {
  return Math.round(trainingRate(league, coach, p, s) * 190 * 10) / 10;
}
