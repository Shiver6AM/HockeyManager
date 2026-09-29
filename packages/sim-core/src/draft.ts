/**
 * The entry draft: a new class of teenagers every summer, an NHL-style
 * lottery for non-playoff teams, team-specific scouting, and pick-by-pick
 * execution that pauses whenever a human manager is on the clock.
 */
import { draftScoutSd, isDraftClass } from './scouting';
import { archetypeForCeiling, generatePlayer } from './generate';
import { scoutingError } from './staff';
import { clamp, deriveSeed, Rng } from './rng';
import { age, ARCHETYPE_CEILING, overall } from './ratings';
import type { DraftPick, DraftState, League, Player, Position, StandingsRow, TeamId } from './types';

export const DRAFT_ROUNDS = 7;

export const DRAFT_TUNING = {
  /** Ceiling tiers [mean, sd] and how often each appears in a class. */
  tiers: [
    [85, 4],
    [74, 3.5],
    [58, 7],
  ] as Array<[number, number]>,
  tierWeights: [0.05, 0.11, 0.84],
};

/** 2021-era NHL lottery odds (%), worst team first. */
export const LOTTERY_ODDS = [18.5, 13.5, 11.5, 9.5, 8.5, 7.5, 6.5, 6.0, 5.0, 3.5, 3.0, 2.5, 2.0, 1.5, 0.5, 0.5];
export const LOTTERY_MAX_JUMP = 10;

export function generateDraftClass(league: League, season: number, size = 32 * DRAFT_ROUNDS + 40): Player[] {
  const rng = new Rng(deriveSeed(league.seed, `draft-class:${season}`));
  const out: Player[] = [];
  const positions: Position[] = ['C', 'LW', 'RW', 'D', 'G'];
  const posWeights = [22, 19, 19, 31, 9];
  for (let i = 0; i < size; i++) {
    const pos = positions[rng.weighted(posWeights)];
    const a = rng.chance(0.2) ? 19 : 18;
    // Ceiling tiers: a handful of future stars, some solid regulars, many long shots.
    const tier = rng.weighted(DRAFT_TUNING.tierWeights);
    const [mu, sd] = DRAFT_TUNING.tiers[tier];
    let potential = clamp(rng.normal(mu, sd), 45, 97);
    const archetype = archetypeForCeiling(rng, pos, potential);
    // Some styles top out: a grinder can become a great grinder, not a franchise player.
    const cap = archetype ? ARCHETYPE_CEILING[archetype] : undefined;
    if (cap !== undefined) potential = Math.min(potential, cap + rng.normal(0, 1.5));
    const now = clamp(potential - rng.normal(19, 3.5) + (a - 18) * 2, 36, potential);
    const p = generatePlayer(rng, pos, now + 4, season + 1, a + 1, archetype); // ages as of next season
    p.id = `d${season}-${i}`;
    p.birthYear = season + 1 - (a + 1);
    p.hidden.potential = Math.round(Math.max(overall(p), potential));
    p.contract = null;
    p.teamId = null;
    p.draftClass = season;
    out.push(p);
  }
  addSleepers(league, season, out);
  return out;
}

/**
 * A few late bloomers in every class: modest now, with modest numbers and
 * modest scouting reports, but a real ceiling. Scouts (and Central Scouting)
 * miss most of it while he's a teenager; it shows as he develops.
 */
export function addSleepers(league: League, season: number, cls: Player[]) {
  const rng = new Rng(deriveSeed(league.seed, `sleepers:${season}`));
  const n = rng.int(3, 7);
  const candidates = rng.shuffle(cls.filter((p) => p.hidden.potential <= 68 && p.pos !== 'G' && ARCHETYPE_CEILING[p.archetype] === undefined));
  for (const p of candidates.slice(0, n)) {
    const was = p.hidden.potential;
    const ceiling = Math.round(clamp(rng.normal(81, 4), 74, 90));
    p.hidden.potential = ceiling;
    // Scouts see roughly what they'd have seen before: the ceiling he seemed to have.
    p.hidden.sleeper = ceiling - was;
  }
}

/** How much of a sleeper's ceiling scouts still miss (fades from full at 19 to none at 22). */
export function sleeperMask(league: League, p: Player): number {
  const s = p.hidden.sleeper;
  if (!s || s <= 0) return 0; // (negative: already revealed)
  const a = age(p, league.season);
  return a <= 19 ? s : a >= 22 ? 0 : s * ((22 - a) / 3);
}

/** The ceiling a scout can see: the real one, minus what a sleeper hides. */
export function apparentPotential(league: League, p: Player): number {
  return p.hidden.potential - sleeperMask(league, p);
}

/** A team's scouts' read on a player's ceiling. Each team's error is different, but repeatable. */
export function scoutedPotential(league: League, teamId: TeamId, p: Player): number {
  const young = age(p, league.season) <= 21;
  const rng = new Rng(deriveSeed(league.seed, `scout:${teamId}:${p.id}`));
  // Draft-eligible players: the error shrinks as the team's scouts get to know his region.
  if (isDraftClass(league, p)) return Math.round(apparentPotential(league, p) + rng.normal(0, 1) * draftScoutSd(league, teamId, p));
  // Better head scouts make smaller (but still repeatable) errors.
  return Math.round(apparentPotential(league, p) + rng.normal(0, scoutingError(league, teamId, young)));
}

/** Scouts' projection, in terms of the role he'd fill at his position. */
export function projectionLabel(scouted: number, pos?: string): string {
  const tier = scouted >= 86 ? 0 : scouted >= 80 ? 1 : scouted >= 74 ? 2 : scouted >= 68 ? 3 : scouted >= 62 ? 4 : 5;
  const labels: Record<string, string[]> = {
    C: ['Franchise center', 'First-line center', 'Top-six center', 'Third-line center', 'Fourth-line center', 'Long shot'],
    W: ['Franchise winger', 'First-line winger', 'Top-six winger', 'Middle-six winger', 'Fourth-line winger', 'Long shot'],
    D: ['Franchise defenseman', 'Top-pair defenseman', 'Top-four defenseman', 'Third-pair defenseman', 'Depth defenseman', 'Long shot'],
    G: ['Franchise goalie', 'Starting goalie', 'Starter / 1B', 'Backup goalie', 'Depth goalie', 'Long shot'],
    any: ['Franchise talent', 'Top-line / top-pair', 'Top-six / top-four', 'Middle-six / third pair', 'Depth player', 'Long shot'],
  };
  const key = pos === 'C' || pos === 'D' || pos === 'G' ? pos : pos === 'LW' || pos === 'RW' ? 'W' : 'any';
  return labels[key][tier];
}

/**
 * Draft order: non-playoff teams go through the lottery (two draws, a team can
 * jump at most 10 spots); playoff teams follow by round eliminated, then points.
 */
export function buildDraftOrder(league: League, st: StandingsRow[], season: number): { order: TeamId[]; lottery: DraftState['lottery'] } {
  const rng = new Rng(deriveSeed(league.seed, `lottery:${season}`));
  const po = league.playoffs;
  const playoffTeams = new Set(po?.rounds[0].flatMap((s) => [s.high, s.low]) ?? []);
  const worstFirst = [...st].reverse();
  const nonPlayoff = worstFirst.filter((r) => !playoffTeams.has(r.teamId)).map((r) => r.teamId);

  const order = [...nonPlayoff];
  const lottery: DraftState['lottery'] = [];
  const winners = new Set<TeamId>();
  for (let draw = 0; draw < 2 && order.length > draw; draw++) {
    const candidates = nonPlayoff.filter((t) => !winners.has(t));
    const odds = candidates.map((t) => LOTTERY_ODDS[nonPlayoff.indexOf(t)] ?? 0.5);
    const winner = candidates[rng.weighted(odds)];
    winners.add(winner);
    const from = order.indexOf(winner);
    const to = Math.max(draw, from - LOTTERY_MAX_JUMP);
    if (to < from) {
      order.splice(from, 1);
      order.splice(to, 0, winner);
      lottery.push([winner, from + 1, to + 1]);
    }
  }

  // Playoff teams: earlier exits pick earlier; ties by fewer points.
  const exitRound = new Map<TeamId, number>();
  for (const round of po?.rounds ?? []) {
    for (const s of round) {
      if (!s.winner) continue;
      exitRound.set(s.winner === s.high ? s.low : s.high, s.round);
      if (s.round === 4) exitRound.set(s.winner, 5);
    }
  }
  const pts = new Map(st.map((r) => [r.teamId, r.pts]));
  const playoffOrder = [...playoffTeams].sort((a, b) => (exitRound.get(a) ?? 0) - (exitRound.get(b) ?? 0) || pts.get(a)! - pts.get(b)!);
  return { order: [...order, ...playoffOrder], lottery };
}

/** Make sure this season's draft class exists (it plays all season so scouts can watch it). */
export function ensureDraftClass(league: League) {
  if (league.phase === 'offseason') return;
  if (league.draftClass?.season === league.season) return;
  const prospects = generateDraftClass(league, league.season);
  for (const p of prospects) league.players[p.id] = p;
  league.draftClass = { season: league.season, ids: prospects.map((p) => p.id) };
}

export function createDraft(league: League, st: StandingsRow[], season: number): { state: DraftState; prospects: Player[] } {
  const existing = league.draftClass?.season === season ? league.draftClass.ids.map((id) => league.players[id]).filter(Boolean) : null;
  const prospects = existing?.length ? existing : generateDraftClass(league, season);
  const { order, lottery } = buildDraftOrder(league, st, season);
  const picks: DraftPick[] = [];
  for (let round = 1; round <= DRAFT_ROUNDS; round++) {
    for (const teamId of order) {
      const owner = league.pickOwners?.[`${season}:${round}:${teamId}`] ?? teamId;
      picks.push({ round, overall: picks.length + 1, teamId: owner, originalTeamId: teamId, playerId: null });
    }
  }
  // These picks are now real; their ownership lives in the draft itself.
  for (const key of Object.keys(league.pickOwners ?? {})) if (key.startsWith(`${season}:`)) delete league.pickOwners![key];
  return { state: { season, classIds: prospects.map((p) => p.id), picks, current: 0, lottery }, prospects };
}

export function availableProspects(league: League): Player[] {
  const d = league.offseason?.draft;
  if (!d) return [];
  const taken = new Set(d.picks.map((p) => p.playerId).filter(Boolean));
  return d.classIds.filter((id) => !taken.has(id) && league.players[id]).map((id) => league.players[id]);
}

/** How much a team wants a prospect: mostly scouted ceiling, a bit of readiness and need. */
export function draftValue(league: League, teamId: TeamId, p: Player): number {
  const team = league.teams[teamId];
  const pool = [...team.roster, ...(team.prospects ?? [])].map((id) => league.players[id]).filter(Boolean);
  const goalies = pool.filter((x) => x.pos === 'G').length;
  const d = pool.filter((x) => x.pos === 'D').length;
  let v = scoutedPotential(league, teamId, p) + 0.15 * overall(p);
  if (p.pos === 'G') v -= goalies >= 4 ? 4 : 1.5; // goalies are notoriously hard to project
  if (p.pos === 'D' && d < 9) v += 0.8;
  return v;
}

export function onTheClock(league: League): DraftPick | null {
  const d = league.offseason?.draft;
  if (!d || d.current >= d.picks.length) return null;
  return d.picks[d.current];
}

export function makePick(league: League, teamId: TeamId, playerId: string) {
  const pick = onTheClock(league);
  if (!pick) throw new Error('The draft is over');
  if (pick.teamId !== teamId) throw new Error(`${pick.teamId} is on the clock, not ${teamId}`);
  const p = league.players[playerId];
  if (!p || !availableProspects(league).some((x) => x.id === playerId)) throw new Error('That player is not available');
  const team = league.teams[teamId];
  pick.playerId = playerId;
  p.prospectOf = teamId;
  p.draftClass = undefined;
  p.draft = { season: league.offseason!.draft.season, round: pick.round, overall: pick.overall, teamId };
  (team.prospects ??= []).push(playerId);
  league.offseason!.draft.current++;
  league.transactions.push({
    day: league.day,
    season: league.season,
    type: 'draft',
    teamId,
    playerId,
    note: `Round ${pick.round}, #${pick.overall}: ${p.firstName} ${p.lastName} (${p.pos}, ${age(p, league.season + 1)})`,
  });
}

export function autoPick(league: League): void {
  const pick = onTheClock(league)!;
  const pool = availableProspects(league);
  // A manager's own ranked list comes first.
  const list = league.offseason?.draftLists?.[pick.teamId] ?? [];
  const listed = list.find((id) => pool.some((p) => p.id === id));
  if (listed) return makePick(league, pick.teamId, listed);
  let best = pool[0];
  let bestV = -Infinity;
  for (const p of pool) {
    const v = draftValue(league, pick.teamId, p);
    if (v > bestV) {
      bestV = v;
      best = p;
    }
  }
  makePick(league, pick.teamId, best.id);
}

/**
 * Make picks until a human manager is on the clock (or the draft ends).
 * With `force`, humans who haven't picked get their scouts' top choice.
 * Returns the number of picks made.
 */
export function runDraft(league: League, opts: { force: boolean; maxPicks?: number }): number {
  let made = 0;
  for (;;) {
    const pick = onTheClock(league);
    if (!pick || made >= (opts.maxPicks ?? Infinity)) return made;
    if (league.teams[pick.teamId].controller.kind === 'human' && !opts.force) return made;
    autoPick(league);
    made++;
  }
}
