/**
 * Amateur scouting and the fog of war over the draft class.
 *
 * Next summer's draft class exists all season, playing in junior, college and
 * European leagues. Each team employs up to four area scouts, each with an
 * evaluation skill and a familiarity with every region (a scout from Sweden
 * knows the SHL and J20). Managers send scouts to regions; every day a scout
 * spends in a region builds the team's knowledge of it, faster for skilled
 * scouts who know the area, and a good head scout makes everyone better.
 *
 * Knowledge becomes confidence (0–100%). A prospect in a region you haven't
 * scouted shows no projection at all; as confidence grows, your scouts' read
 * on his ceiling converges on the truth. Every team's errors are its own, and
 * AI teams draft on what their scouts saw too.
 */
import { NAME_POOLS } from './names';
import { leagueRegion, MINOR_LEAGUES, minorLeagueOf, REGIONS, type Region } from './leagues';
import { clamp, deriveSeed, Rng } from './rng';
import type { League, Player, PlayerId, Team, TeamId } from './types';

export interface Scout {
  id: string;
  name: string;
  /** How well he evaluates talent, 40–95. */
  skill: number;
  /** How well he knows each region, 0–100. */
  familiarity: Record<Region, number>;
  salary: number;
  yearsLeft: number;
  /** Where he's scouting ('auto' lets the head scout decide; 'players' = a list of specific prospects). */
  assignment: Region | 'auto' | 'players';
  /** With 'players': the prospects he's following (up to 10, all in one league). */
  targets?: { league: string; ids: PlayerId[] };
  /** A schedule of assignments, one after another (the last one carries on to the end of the season). */
  plan?: ScoutPlan;
}

export type ScoutAssignment = Region | 'auto' | 'players';

/** One stop on a scout's schedule. */
export interface ScoutLeg {
  weeks: number;
  assignment: ScoutAssignment;
  targets?: { league: string; ids: PlayerId[] };
}

export interface ScoutPlan {
  /** The season it's for. */
  season: number;
  /** Regular-season day the first leg starts. */
  startDay: number;
  legs: ScoutLeg[];
}

export interface TeamScouting {
  season: number;
  /** Scouting days (weighted by quality) spent in each region this season. */
  points: Partial<Record<Region, number>>;
  /** Extra knowledge of specific prospects from scouts assigned to follow them. */
  playerPoints?: Record<PlayerId, number>;
}

export const SCOUTING = {
  maxScouts: 4,
  /** Knowledge points for ~63% confidence. A good scout earns ~1.3 a day. */
  K: 110,
  /** Error (rating points) in a projection with no knowledge, and the floor with full knowledge. */
  maxSd: 13,
  minSd: 2,
  /** Below this confidence, no projection is shown. */
  showAt: 0.08,
  poolSize: 12,
  /** A scout following specific prospects: at most this many, all in one league. */
  maxTargets: 10,
  /** His daily knowledge split across them, times this (1 target: 15× a region day; 10: 1.5× each). */
  targetFocus: 15,
  /** Most stops on one scout's schedule. */
  maxLegs: 12,
};

export function scoutSalary(skill: number): number {
  const t = clamp((skill - 40) / 55, 0, 1);
  return Math.round((150_000 + 1_050_000 * t * t) / 25_000) * 25_000;
}

export function generateScout(rng: Rng, id: string): Scout {
  const pool = NAME_POOLS[rng.weighted(NAME_POOLS.map((p) => p.weight))];
  const home = rng.shuffle(REGIONS.map((r) => r.id)).slice(0, rng.chance(0.4) ? 2 : 1);
  const familiarity = Object.fromEntries(
    REGIONS.map((r) => [r.id, home.includes(r.id) ? rng.int(72, 96) : Math.round(clamp(rng.normal(30, 12), 5, 60))]),
  ) as Record<Region, number>;
  const skill = Math.round(clamp(rng.normal(64, 11), 40, 95));
  return { id, name: `${rng.pick(pool.first)} ${rng.pick(pool.last)}`, skill, familiarity, salary: scoutSalary(skill), yearsLeft: rng.int(1, 4), assignment: 'auto' };
}

function nextId(league: League, rng: Rng) {
  const used = new Set([...(league.scoutPool ?? []), ...Object.values(league.teams).flatMap((t) => t.scouts ?? [])].map((s) => s.id));
  let id: string;
  do id = `sc-${league.season}-${rng.int(0, 1e7)}`;
  while (used.has(id));
  return id;
}

export function refillScoutPool(league: League, rng = new Rng(deriveSeed(league.seed, `scout-pool:${league.season}:${league.day}:${(league.scoutPool ?? []).length}`))) {
  const pool = (league.scoutPool ??= []);
  while (pool.length < SCOUTING.poolSize) pool.push(generateScout(rng, nextId(league, rng)));
}

/** Every team starts with two or three area scouts. */
export function initScouts(league: League) {
  const rng = new Rng(deriveSeed(league.seed, 'scouts'));
  for (const t of Object.values(league.teams)) {
    if (t.scouts) continue;
    t.scouts = Array.from({ length: rng.int(2, 3) }, () => generateScout(rng, nextId(league, rng)));
  }
  refillScoutPool(league, rng);
}

export const scoutPayroll = (t: Team) => (t.scouts ?? []).reduce((s, x) => s + x.salary, 0);

export function hireScout(league: League, team: Team, scoutId: string): Scout {
  const scouts = (team.scouts ??= []);
  if (scouts.length >= SCOUTING.maxScouts) throw new Error(`You already have ${SCOUTING.maxScouts} scouts. Let one go first.`);
  const s = (league.scoutPool ?? []).find((x) => x.id === scoutId);
  if (!s) throw new Error('That scout is not available');
  league.scoutPool = league.scoutPool!.filter((x) => x.id !== scoutId);
  const hired = { ...s, assignment: 'auto' as const, yearsLeft: Math.max(2, s.yearsLeft) };
  scouts.push(hired);
  refillScoutPool(league);
  return hired;
}

export function releaseScout(league: League, team: Team, scoutId: string): { settlement: number } {
  const s = team.scouts?.find((x) => x.id === scoutId);
  if (!s) throw new Error('Not one of your scouts');
  team.scouts = team.scouts!.filter((x) => x.id !== scoutId);
  const settlement = Math.round((s.salary * Math.max(0, s.yearsLeft - 1)) / 2);
  if (team.finances) team.finances.staff += settlement;
  (league.scoutPool ??= []).push({ ...s, assignment: 'auto', yearsLeft: 2 });
  return { settlement };
}

export function assignScout(team: Team, scoutId: string, region: Region | 'auto') {
  const s = team.scouts?.find((x) => x.id === scoutId);
  if (!s) throw new Error('Not one of your scouts');
  s.assignment = region;
  s.targets = undefined;
  s.plan = undefined;
}

function checkTargets(league: League, leagueName: string, ids: PlayerId[]): { league: string; ids: PlayerId[] } {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new Error('Pick at least one prospect');
  if (unique.length > SCOUTING.maxTargets) throw new Error(`A scout can follow at most ${SCOUTING.maxTargets} prospects`);
  for (const id of unique) {
    const p = league.players[id];
    if (!p || !isDraftClass(league, p)) throw new Error('Scouts can only follow draft-eligible prospects');
    const lg = minorLeagueOf(league, p).league;
    if (lg !== leagueName && MINOR_LEAGUES[lg]?.name !== leagueName) throw new Error(`All of them have to play in the ${leagueName}`);
  }
  return { league: leagueName, ids: unique };
}

/** Send a scout to follow specific draft-eligible prospects (up to 10, all in one league). */
export function assignScoutTargets(league: League, team: Team, scoutId: string, leagueName: string, ids: PlayerId[]) {
  const s = team.scouts?.find((x) => x.id === scoutId);
  if (!s) throw new Error('Not one of your scouts');
  s.targets = checkTargets(league, leagueName, ids);
  s.assignment = 'players';
  s.plan = undefined;
}

// ---- Schedules ----

/** Last regular-season day. */
function lastRegularDay(league: League) {
  return league.schedule.reduce((m, g) => Math.max(m, g.day), 0) || 181;
}

/**
 * The window a new schedule covers: from today to the end of the regular
 * season, or the whole of next season when set in the summer. Null during the
 * playoffs (scouts carry on with what they're doing until the draft).
 */
export function scoutPlanWindow(league: League): { season: number; startDay: number; weeks: number; nextSeason: boolean } | null {
  const last = lastRegularDay(league);
  if (league.phase === 'regular-season') return { season: league.season, startDay: league.day, weeks: Math.max(1, Math.ceil((last + 1 - league.day) / 7)), nextSeason: false };
  if (league.phase === 'offseason') return { season: league.season + 1, startDay: 0, weeks: Math.ceil((last + 1) / 7), nextSeason: true };
  return null;
}

/**
 * Give a scout a schedule: a list of assignments with durations in weeks,
 * run back to back, adding up to no more than the weeks left in the season.
 * Following specific prospects needs a draft class to follow.
 */
export function setScoutPlan(league: League, team: Team, scoutId: string, legs: ScoutLeg[]) {
  const s = team.scouts?.find((x) => x.id === scoutId);
  if (!s) throw new Error('Not one of your scouts');
  const w = scoutPlanWindow(league);
  if (!w) throw new Error('The regular season is over. Scouts keep their current assignment until the draft.');
  if (!legs.length) throw new Error('Add at least one assignment');
  if (legs.length > SCOUTING.maxLegs) throw new Error(`At most ${SCOUTING.maxLegs} assignments`);
  const total = legs.reduce((n, l) => n + l.weeks, 0);
  for (const l of legs) if (!Number.isInteger(l.weeks) || l.weeks < 1) throw new Error('Each assignment lasts at least a week');
  if (total > w.weeks) throw new Error(`That's ${total} weeks; there ${w.weeks === 1 ? 'is 1 week' : `are ${w.weeks} weeks`} left in the ${w.nextSeason ? 'next ' : ''}season`);
  const clean: ScoutLeg[] = legs.map((l) => {
    if (l.assignment === 'players') {
      if (w.nextSeason) throw new Error("Next season's draft class isn't known yet: plan regions for now");
      if (!l.targets) throw new Error('Choose the prospects to follow');
      return { weeks: l.weeks, assignment: 'players', targets: checkTargets(league, l.targets.league, l.targets.ids) };
    }
    if (l.assignment !== 'auto' && !REGIONS.some((r) => r.id === l.assignment)) throw new Error('Unknown region');
    return { weeks: l.weeks, assignment: l.assignment };
  });
  s.plan = { season: w.season, startDay: w.startDay, legs: clean };
  if (!w.nextSeason) applyPlan(league, s);
}

/** Clear a scout's schedule (he keeps whatever he's doing now). */
export function clearScoutPlan(team: Team, scoutId: string) {
  const s = team.scouts?.find((x) => x.id === scoutId);
  if (!s) throw new Error('Not one of your scouts');
  s.plan = undefined;
}

/** Which leg of his schedule a scout is on (the last one carries on after the schedule runs out). */
export function currentLeg(league: League, s: Scout): { index: number; leg: ScoutLeg } | null {
  const plan = s.plan;
  if (!plan || plan.season !== league.season || league.phase === 'offseason') return null;
  let day = plan.startDay;
  for (let i = 0; i < plan.legs.length; i++) {
    day += plan.legs[i].weeks * 7;
    if (league.day < day) return { index: i, leg: plan.legs[i] };
  }
  return { index: plan.legs.length - 1, leg: plan.legs[plan.legs.length - 1] };
}

/** Put a scout on today's leg of his schedule. */
function applyPlan(league: League, s: Scout) {
  const cur = currentLeg(league, s);
  if (!cur) return;
  s.assignment = cur.leg.assignment;
  s.targets = cur.leg.assignment === 'players' ? cur.leg.targets : undefined;
}

/** The prospects a scout is following (still draft-eligible). */
export function scoutTargets(league: League, s: Scout): Player[] {
  if (s.assignment !== 'players' || !s.targets) return [];
  return s.targets.ids.map((id) => league.players[id]).filter((p): p is Player => !!p && isDraftClass(league, p));
}

/**
 * Where each scout actually is today. 'auto' scouts go where they know best
 * among regions nobody else on staff covers, and move on once a region is
 * well scouted.
 */
export function scoutRegions(league: League, team: Team): Array<{ scout: Scout; region: Region }> {
  const out: Array<{ scout: Scout; region: Region }> = [];
  const covered = new Set<Region>();
  for (const s of team.scouts ?? []) if (s.assignment !== 'auto' && s.assignment !== 'players') covered.add(s.assignment);
  for (const s of team.scouts ?? []) {
    if (s.assignment === 'players') continue; // following specific prospects (see scoutingDay)
    if (s.assignment !== 'auto') {
      out.push({ scout: s, region: s.assignment });
      continue;
    }
    const options = REGIONS.map((r) => r.id)
      .filter((r) => !covered.has(r))
      .sort((a, b) => autoScore(league, team, s, b) - autoScore(league, team, s, a));
    const region = options[0] ?? REGIONS[0].id;
    covered.add(region);
    out.push({ scout: s, region });
  }
  return out;
}

function autoScore(league: League, team: Team, s: Scout, r: Region) {
  // Prefer familiar regions, but move on from ones that are already well known.
  return s.familiarity[r] - 120 * regionConfidence(league, team.id, r);
}

function headScoutFactor(team: Team) {
  return 0.9 + ((team.staff?.scout?.rating ?? 65) - 65) / 300;
}

/** Knowledge a scout adds per day in a region. */
export function scoutRate(team: Team, s: Scout, r: Region): number {
  return (0.6 + s.skill / 100) * (0.45 + s.familiarity[r] / 100) * headScoutFactor(team);
}

function state(league: League, teamId: TeamId): TeamScouting {
  const all = (league.scouting ??= {});
  let st = all[teamId];
  if (!st || st.season !== league.season) st = all[teamId] = { season: league.season, points: {} };
  return st;
}

/** Move every scout with a schedule onto today's stop. */
export function applyScoutPlans(league: League) {
  for (const t of Object.values(league.teams)) for (const s of t.scouts ?? []) if (s.plan) applyPlan(league, s);
}

/** One day on the road for every team's scouts (regular season and playoffs). */
export function scoutingDay(league: League) {
  for (const t of Object.values(league.teams)) {
    for (const scout of t.scouts ?? []) if (scout.plan) applyPlan(league, scout);
    const st = state(league, t.id);
    for (const { scout, region } of scoutRegions(league, t)) st.points[region] = (st.points[region] ?? 0) + scoutRate(t, scout, region);
    for (const scout of t.scouts ?? []) {
      const targets = scoutTargets(league, scout);
      if (!targets.length) continue;
      const pp = (st.playerPoints ??= {});
      for (const p of targets) pp[p.id] = (pp[p.id] ?? 0) + (scoutRate(t, scout, playerRegion(league, p)) * SCOUTING.targetFocus) / targets.length;
    }
  }
}

/** 0 … 1: how well a team knows this season's players in a region. */
export function regionConfidence(league: League, teamId: TeamId, r: Region): number {
  const st = league.scouting?.[teamId];
  if (!st || st.season !== league.season) return 0;
  return 1 - Math.exp(-(st.points[r] ?? 0) / SCOUTING.K);
}

export function isDraftClass(league: League, p: Player): boolean {
  return p.draftClass !== undefined && !p.prospectOf && !p.teamId;
}

/** Scouting region of a draft-eligible player (pro leagues count as the US). */
export function playerRegion(league: League, p: Player): Region {
  const r = leagueRegion(minorLeagueOf(league, p).league);
  return r === 'pro' ? 'usa' : r;
}

/** A team's confidence in its read on a draft-eligible player (1 for everyone else). */
export function scoutConfidence(league: League, teamId: TeamId, p: Player): number {
  if (!isDraftClass(league, p)) return 1;
  if (teamId === 'league') return 0.5;
  // Knowledge is about this season's viewings; in the summer the class is judged on what was seen.
  const st = league.scouting?.[teamId];
  if (!st) return 0;
  const r = playerRegion(league, p);
  return 1 - Math.exp(-((st.points[r] ?? 0) + (st.playerPoints?.[p.id] ?? 0)) / SCOUTING.K);
}

/** Error sd of a team's projection for a draft-eligible player. */
export function draftScoutSd(league: League, teamId: TeamId, p: Player): number {
  const c = scoutConfidence(league, teamId, p);
  return SCOUTING.minSd + (SCOUTING.maxSd - SCOUTING.minSd) * (1 - c);
}

/** Each summer: scouts' contracts run down (expiring ones re-sign); AI teams keep at least three. */
export function offseasonScouts(league: League) {
  const rng = new Rng(deriveSeed(league.seed, `scouts-summer:${league.season}`));
  refillScoutPool(league, rng);
  for (const t of Object.values(league.teams)) {
    for (const s of t.scouts ?? []) {
      s.yearsLeft -= 1;
      if (s.yearsLeft <= 0) s.yearsLeft = rng.int(1, 3);
      // Last year's prospects have been drafted: back on the road.
      if (s.assignment === 'players') {
        s.assignment = 'auto';
        s.targets = undefined;
      }
      // Last season's schedule is done; one made in the summer for the new season stands.
      if (s.plan && s.plan.season <= league.season) s.plan = undefined;
      else if (s.plan) s.assignment = s.plan.legs[0].assignment;
    }
    if (t.controller.kind === 'ai' && (t.scouts?.length ?? 0) < 3) {
      const pick = [...(league.scoutPool ?? [])].sort((a, b) => b.skill - a.skill)[rng.int(0, 5)];
      if (pick) hireScout(league, t, pick.id);
    }
  }
}
