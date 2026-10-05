/**
 * Starting a new league: where it begins, and the optional fantasy draft.
 *
 * Start points:
 *  - 're-sign' (default): the offseason, the week before free agency. The
 *    entry draft has just happened; managers re-sign their own players, then
 *    free agency opens.
 *  - 'draft': the offseason, at the entry draft.
 *  - 'season': opening night of the regular season.
 *
 * Offseason starts are "fresh": nobody has played a game yet, so there is no
 * development, aging or retirement pass, and no season's books to close. The
 * draft order runs from the weakest roster to the strongest (with the usual
 * lottery), and the draft class has played a junior season that teams' scouts
 * have been watching.
 *
 * Fantasy draft: every signed player goes into one pool (unsigned prospects
 * stay with their teams) and the teams draft full rosters, snake order, 23
 * rounds, keeping each player's contract. Managers pick when they're on the
 * clock (or let the AI pick for them); afterwards farm teams are stocked,
 * leftovers become free agents, and the league carries on to the start point.
 */
import { askingContract, capRoom, LEAGUE_MIN_SALARY } from './contracts';
import { contenderScore } from './negotiation';
import { createDraft, ensureDraftClass, runDraft, scoutedPotential } from './draft';
import { initFarm } from './farmInit';
import { generateLeague, type GenerateOptions } from './generate';
import { ensureLeagueLife, standings } from './league';
import { autoLines } from './lines';
import { memo, withMemo } from './memo';
import { finishDraft } from './offseason';
import { prospectGameDay } from './prospects';
import { age, overall } from './ratings';
import { ensureBodies, healthyRoster, teamLines } from './roster';
import { deriveSeed, Rng } from './rng';
import { initScouts, scoutingDay } from './scouting';
import { suggestTactics } from './systems';
import type { ContractOffer, FantasyDraft, League, Player, PlayerId, Team, TeamId } from './types';

export type StartPoint = 're-sign' | 'draft' | 'season';
export const START_POINTS: Record<StartPoint, string> = {
  're-sign': 'Offseason: the week before free agency',
  draft: 'Offseason: the entry draft',
  season: 'Opening night of the regular season',
};

export interface NewLeagueOptions extends GenerateOptions {
  start?: StartPoint;
  fantasy?: boolean;
}

/** Create a league at the chosen start point, with or without a fantasy draft. */
export function createLeague(opts: NewLeagueOptions): League {
  const start = opts.start ?? 're-sign';
  const first = opts.season ?? 2026; // the first regular season played
  if (start === 'season' && !opts.fantasy) {
    const L = generateLeague({ ...opts, season: first });
    // Scouts and this season's draft class exist from opening night, so managers can plan before the first game.
    initScouts(L);
    ensureDraftClass(L);
    return L;
  }

  // The summer before `first`: the league exists as of the end of the previous season.
  const L = generateLeague({ ...opts, season: first - 1 });
  L.freshStart = true;
  if (opts.fantasy) {
    ensureLeagueLife(L, { farm: false });
    prepareDraftYear(L);
    setupFantasy(L, start);
  } else {
    ensureLeagueLife(L);
    prepareDraftYear(L);
    openFreshOffseason(L, start as 'draft' | 're-sign');
  }
  return L;
}

/** Give the coming draft class a junior season, and every team's scouts time to watch it. */
function prepareDraftYear(L: League) {
  const day = L.day;
  for (let d = 0; d < 160; d++) {
    L.day = d; // each day has its own games
    prospectGameDay(L);
    scoutingDay(L);
  }
  L.day = day;
}

/** Open the offseason without a season behind it (see the file comment). */
export function openFreshOffseason(L: League, stage: 'draft' | 're-sign') {
  // Weakest rosters pick first; AI strategies follow the same ranking.
  const strength = new Map(Object.keys(L.teams).map((id) => [id, contenderScore(L, id)]));
  const st = standings(L).sort((a, b) => strength.get(b.teamId)! - strength.get(a.teamId)!);
  st.forEach((r, i) => {
    const t = L.teams[r.teamId];
    if (t.controller.kind === 'ai') t.controller.strategy = i < 10 ? 'contend' : i >= st.length - 8 ? 'rebuild' : 'balanced';
  });
  const expiring: Record<PlayerId, ContractOffer> = {};
  for (const t of Object.values(L.teams)) {
    for (const id of t.roster) {
      const p = L.players[id];
      if (p.contract && p.contract.yearsLeft <= 1) expiring[id] = askingContract(L, p);
    }
  }
  const { state: draft, prospects } = createDraft(L, st, L.season);
  for (const p of prospects) L.players[p.id] = p;
  L.schedule = [];
  L.playoffs = null;
  L.negotiations = {};
  L.phase = 'offseason';
  L.offseason = { season: L.season, stage: 'draft', draft, expiring, resign: {}, freeAgentAsks: {}, development: {} };
  if (stage === 're-sign') {
    // Everyone is AI-run at creation: the draft happens now, then the re-signing
    // week opens on day 1 with no decisions made, for managers to make.
    runDraft(L, { force: true });
    finishDraft(L);
    L.offseason.stage = 're-sign';
    L.offseason.resignDay = 1;
  }
}

// ---------------------------------------------------------------------------
// Fantasy draft
// ---------------------------------------------------------------------------

export const FANTASY_ROUNDS = 23;
/** Every roster needs these to dress a lineup… */
const NEED = { F: 12, D: 6, G: 2 };
/** …and can't hoard one position (AI teams stay a little leaner, so the pool's goalies go around). */
const MAX = { F: 16, D: 9, G: 3 };
const AI_MAX = { F: 15, D: 8, G: 2 };
const grp = (p: Player): 'F' | 'D' | 'G' => (p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F');

function setupFantasy(L: League, then: StartPoint) {
  const pool: PlayerId[] = [];
  for (const t of Object.values(L.teams)) {
    for (const id of t.roster) {
      const p = L.players[id];
      p.teamId = null;
      p.farm = false;
      p.inFantasyPool = true;
      pool.push(id);
    }
    t.roster = [];
    t.lines = { forwards: [], defense: [], goalies: [], pp: [], pk: [] };
  }
  const order = new Rng(deriveSeed(L.seed, 'fantasy-order')).shuffle(Object.keys(L.teams));
  const picks: FantasyDraft['picks'] = [];
  for (let round = 1; round <= FANTASY_ROUNDS; round++) {
    const row = round % 2 ? order : [...order].reverse();
    for (const teamId of row) picks.push({ round, overall: picks.length + 1, teamId, playerId: null });
  }
  L.fantasy = { started: false, order, picks, current: 0, pool, then, auto: {} };
  L.schedule = [];
  L.playoffs = null;
  L.phase = 'offseason';
  L.offseason = {
    season: L.season,
    stage: 'fantasy-draft',
    draft: { season: L.season, classIds: [], picks: [], current: 0, lottery: [] },
    expiring: {},
    resign: {},
    freeAgentAsks: {},
    development: {},
  };
}

export function fantasyOnClock(L: League) {
  const f = L.fantasy;
  if (!f || f.current >= f.picks.length) return null;
  return f.picks[f.current];
}

export function fantasyAvailable(L: League): Player[] {
  return (L.fantasy?.pool ?? []).map((id) => L.players[id]).filter((p) => p && p.inFantasyPool);
}

function counts(L: League, team: Team) {
  const c = { F: 0, D: 0, G: 0 };
  for (const id of team.roster) c[grp(L.players[id])]++;
  return c;
}

const PLURAL = { F: 'forwards', D: 'defensemen', G: 'goalies' } as const;

/**
 * What's left in the pool at each position, and what every team still needs
 * there to dress a lineup. (The pool is exactly as big as the draft, so every
 * player in it ends up on a team: a goalie taken as a spare is a goalie some
 * other team never gets.)
 */
function fantasySupply(L: League) {
  const f = L.fantasy!;
  return memo(`fantasy-supply:${f.current}`, () => {
    const left = { F: 0, D: 0, G: 0 };
    for (const p of fantasyAvailable(L)) left[grp(p)]++;
    const short: Record<TeamId, { F: number; D: number; G: number }> = {};
    const total = { F: 0, D: 0, G: 0 };
    const picksLeft: Record<TeamId, number> = {};
    for (const x of f.picks.slice(f.current)) picksLeft[x.teamId] = (picksLeft[x.teamId] ?? 0) + 1;
    for (const t of Object.values(L.teams)) {
      const c = counts(L, t);
      short[t.id] = { F: Math.max(0, NEED.F - c.F), D: Math.max(0, NEED.D - c.D), G: Math.max(0, NEED.G - c.G) };
      for (const k of ['F', 'D', 'G'] as const) total[k] += short[t.id][k];
    }
    return { left, short, total, picksLeft };
  });
}

/** The rules as written: roster shape, leaving enough for everyone else, and the cap. */
function strictProblem(L: League, teamId: TeamId, p: Player): string | null {
  const f = L.fantasy!;
  const team = L.teams[teamId];
  const c = counts(L, team);
  const g = grp(p);
  const max = team.controller.kind === 'ai' || f.auto[teamId] ? AI_MAX : MAX;
  if (c[g] >= max[g]) return `You already have ${max[g]} ${PLURAL[g]}`;
  const supply = fantasySupply(L);
  // A spare while other teams are still short there, and there aren't enough left for them.
  if (c[g] >= NEED[g] && supply.left[g] - 1 < supply.total[g] - supply.short[teamId][g]) {
    return `The ${PLURAL[g]} left are needed by teams that don't have ${NEED[g]} yet`;
  }
  const left = (supply.picksLeft[teamId] ?? 0) - 1; // after this pick
  c[g]++;
  // (He only has to save picks for positions the pool can still fill.)
  const stillThere = { ...supply.left, [g]: supply.left[g] - 1 };
  const shortOf = (k: 'F' | 'D' | 'G') => Math.min(Math.max(0, NEED[k] - c[k]), stillThere[k]);
  const missing = shortOf('F') + shortOf('D') + shortOf('G');
  if (missing > left) {
    const short = (['G', 'D', 'F'] as const).filter((k) => shortOf(k) > 0).map((k) => PLURAL[k]);
    return `You need to fill your lineup first (still short of ${short.join(' and ')})`;
  }
  const salary = p.contract?.salary ?? LEAGUE_MIN_SALARY;
  if (capRoom(L, team) - salary < left * LEAGUE_MIN_SALARY) return 'He would leave you without cap room to fill the rest of your roster';
  return null;
}

/** Why this team can't take this player now (roster shape or cap), or null if it can. */
export function fantasyPickProblem(L: League, teamId: TeamId, p: Player): string | null {
  if (!p.inFantasyPool) return 'He has already been drafted';
  const problem = strictProblem(L, teamId, p);
  if (!problem) return null;
  // If the rules leave him nobody at all (everyone left is too expensive, say), they give way:
  // a manager on the clock can always make a pick.
  const f = L.fantasy!;
  const someone = memo(`fantasy-open:${teamId}:${f.current}`, () => fantasyAvailable(L).some((x) => !strictProblem(L, teamId, x)));
  return someone ? problem : null;
}

/** How much a team wants a player in the fantasy draft. */
export function fantasyValue(L: League, teamId: TeamId, p: Player): number {
  const a = age(p, L.season + 1);
  const ovr = overall(p);
  let v = ovr;
  if (a <= 24) v += Math.max(0, scoutedPotential(L, teamId, p) - ovr) * 0.3;
  v -= Math.max(0, a - 31) * 0.8;
  v -= ((p.contract?.salary ?? LEAGUE_MIN_SALARY) / 1_000_000) * 0.15;
  return v;
}

export function fantasyPick(L: League, teamId: TeamId, playerId: PlayerId) {
  const f = L.fantasy;
  const pick = fantasyOnClock(L);
  if (!f || !pick) throw new Error('The fantasy draft is over');
  if (!f.started) throw new Error("The fantasy draft hasn't started yet");
  if (pick.teamId !== teamId) throw new Error("You're not on the clock");
  const p = L.players[playerId];
  if (!p) throw new Error('No such player');
  const problem = fantasyPickProblem(L, teamId, p);
  if (problem) throw new Error(problem);
  take(L, pick, p);
}

function take(L: League, pick: FantasyDraft['picks'][number], p: Player) {
  const f = L.fantasy!;
  p.inFantasyPool = undefined;
  p.teamId = pick.teamId;
  L.teams[pick.teamId].roster.push(p.id);
  pick.playerId = p.id;
  f.current++;
}

function autoFantasyPick(L: League) {
  const pick = fantasyOnClock(L)!;
  // (Choosing reads the league only: the pool is counted once per pick.)
  const choice = withMemo(() => {
    const pool = fantasyAvailable(L);
    const ranked = pool.map((p) => ({ p, v: fantasyValue(L, pick.teamId, p) })).sort((a, b) => b.v - a.v);
    const list = L.fantasy!.lists?.[pick.teamId] ?? [];
    const fromList = list.map((id) => L.players[id]).find((p) => p && p.inFantasyPool && !strictProblem(L, pick.teamId, p));
    const best = fromList ?? ranked.find(({ p }) => !strictProblem(L, pick.teamId, p))?.p;
    if (best) return best;
    // Nothing fits under the cap: take the cheapest player at a position still needed.
    const c = counts(L, L.teams[pick.teamId]);
    const need = (['G', 'D', 'F'] as const).find((k) => c[k] < NEED[k] && pool.some((p) => grp(p) === k));
    const cands = pool.filter((p) => (need ? grp(p) === need : c[grp(p)] < MAX[grp(p)]));
    return cands.sort((a, b) => (a.contract?.salary ?? 0) - (b.contract?.salary ?? 0))[0] ?? pool[0];
  });
  take(L, pick, choice);
}

/** Make picks until a manager is on the clock (or all of them, when forced). Returns picks made. */
export function runFantasy(L: League, opts: { force: boolean }): number {
  const f = L.fantasy;
  if (!f) return 0;
  f.started = true;
  let made = 0;
  for (;;) {
    const pick = fantasyOnClock(L);
    if (!pick) return made;
    if (L.teams[pick.teamId].controller.kind === 'human' && !opts.force && !f.auto[pick.teamId]) return made;
    autoFantasyPick(L);
    made++;
  }
}

/** After the last pick: farm teams, lines, free agents, and on to the start point. */
export function finishFantasy(L: League): 're-sign' | 'draft' | 'training-camp' {
  const f = L.fantasy!;
  for (const id of f.pool) {
    const p = L.players[id];
    if (p?.inFantasyPool) {
      p.inFantasyPool = undefined;
      p.teamId = null;
      p.contract = null;
    }
  }
  initFarm(L);
  for (const t of Object.values(L.teams)) {
    ensureBodies(L, t);
    t.tactics = suggestTactics(healthyRoster(L, t).filter((p) => p.pos !== 'G'));
    t.lines = teamLines(L, t);
  }
  f.done = true;
  if (f.then === 'season') {
    L.offseason!.stage = 'training-camp';
    return 'training-camp';
  }
  openFreshOffseason(L, f.then);
  return f.then;
}
