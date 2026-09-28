/**
 * Front-office staff. Each team has a head coach, a head scout and a head
 * trainer, rated 40 (poor) to 95 (elite):
 *
 *  - coach   → how fast young players develop (−8% … +10%)
 *  - scout   → how accurate the team's read on prospects' potential is
 *  - trainer → how long injuries keep players out (+17% … −20%)
 *
 * An average staffer (65) is neutral.
 *
 * Staff are paid from the team's budget, not the salary cap.
 */
import { NAME_POOLS } from './names';
import { clamp, deriveSeed, Rng } from './rng';
import type { League, StaffMember, StaffRole, Team, TeamId } from './types';

export const STAFF_ROLES: StaffRole[] = ['coach', 'scout', 'trainer'];
export const STAFF_LABEL: Record<StaffRole, string> = { coach: 'Head coach', scout: 'Head scout', trainer: 'Head trainer' };

export function staffSalary(rating: number): number {
  const t = clamp((rating - 40) / 55, 0, 1);
  return Math.round((500_000 + 4_500_000 * t * t) / 25_000) * 25_000;
}

export function generateStaff(rng: Rng, role: StaffRole, rating: number, id: string): StaffMember {
  const pool = NAME_POOLS[rng.weighted(NAME_POOLS.map((p) => p.weight))];
  const r = Math.round(clamp(rating, 40, 95));
  return { id, name: `${rng.pick(pool.first)} ${rng.pick(pool.last)}`, role, rating: r, salary: staffSalary(r), yearsLeft: rng.int(1, 4) };
}

/** Give every team a staff and fill the job market. */
export function initStaff(league: League) {
  const rng = new Rng(deriveSeed(league.seed, 'staff'));
  let n = 0;
  for (const t of Object.values(league.teams)) {
    t.staff = Object.fromEntries(STAFF_ROLES.map((role) => [role, generateStaff(rng, role, rng.normal(65, 10), `s${++n}`)])) as Team['staff'];
  }
  refillStaffPool(league, rng);
}

export function refillStaffPool(league: League, rng = new Rng(deriveSeed(league.seed, `staff-pool:${league.season}`))) {
  const pool = (league.staffPool ??= []);
  let n = pool.length + league.season * 1000;
  for (const role of STAFF_ROLES) {
    while (pool.filter((s) => s.role === role).length < 8) pool.push(generateStaff(rng, role, rng.normal(62, 12), `s${league.season}-${++n}`));
  }
}

const rating = (league: League, teamId: TeamId | null | undefined, role: StaffRole) =>
  (teamId && league.teams[teamId]?.staff?.[role]?.rating) || 65;

/** ~0.92 … 1.1 multiplier on young players' growth; 1.0 at 65. */
export function coachDevMultiplier(league: League, teamId: TeamId | null | undefined): number {
  return 1 + ((rating(league, teamId, 'coach') - 65) / 30) * 0.1;
}

/** Standard deviation of a team's scouting error on young players (6 … 2). */
export function scoutingError(league: League, teamId: TeamId, young: boolean): number {
  if (teamId === 'league') return young ? 4 : 2;
  const base = 6 - ((rating(league, teamId, 'scout') - 40) / 55) * 4;
  return young ? base : base / 2;
}

/** ~1.17 … 0.8 multiplier on injury length; 1.0 at 65. */
export function trainerInjuryMultiplier(league: League, teamId: TeamId | null | undefined): number {
  return 1 - ((rating(league, teamId, 'trainer') - 65) / 30) * 0.2;
}

export function staffPayroll(team: Team): number {
  return STAFF_ROLES.reduce((s, r) => s + (team.staff?.[r]?.salary ?? 0), 0);
}

/**
 * Hire someone from the pool. The outgoing staffer's remaining salary is paid
 * off (half of it, as a settlement) and he returns to the pool.
 */
export function hireStaff(league: League, team: Team, staffId: string): { settlement: number } {
  const pool = league.staffPool ?? [];
  const hire = pool.find((s) => s.id === staffId);
  if (!hire) throw new Error('That person is not available');
  const old = team.staff?.[hire.role];
  const settlement = old ? Math.round((old.salary * Math.max(0, old.yearsLeft - 1)) / 2) : 0;
  league.staffPool = pool.filter((s) => s.id !== staffId);
  if (old) league.staffPool.push({ ...old, yearsLeft: 2 });
  (team.staff ??= {} as Team['staff'] & object)[hire.role] = { ...hire, yearsLeft: Math.max(2, hire.yearsLeft) };
  if (team.finances) team.finances.staff += settlement;
  return { settlement };
}

/** Each summer: contracts run down; AI teams upgrade weak spots; expiring staff re-sign. */
export function offseasonStaff(league: League) {
  const rng = new Rng(deriveSeed(league.seed, `staff-summer:${league.season}`));
  refillStaffPool(league, rng);
  for (const t of Object.values(league.teams)) {
    for (const role of STAFF_ROLES) {
      const s = t.staff?.[role];
      if (!s) continue;
      s.yearsLeft -= 1;
      if (s.yearsLeft <= 0) s.yearsLeft = rng.int(2, 4); // re-signs
      if (t.controller.kind === 'ai' && s.rating < 58) {
        const best = (league.staffPool ?? []).filter((x) => x.role === role).sort((a, b) => b.rating - a.rating)[0];
        if (best && best.rating > s.rating + 5 && rng.chance(0.6)) hireStaff(league, t, best.id);
      }
    }
  }
}
