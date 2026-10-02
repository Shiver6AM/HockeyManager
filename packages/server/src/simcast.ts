/**
 * Simcasts: watch one of the next day's games play by play, together.
 *
 * The game is played out when the simcast starts (the league keeps that
 * result, so the day's sim uses it) and revealed a play at a time on a shared
 * game clock that everyone watching follows. While a simcast is running the
 * league can't be simmed. Sessions live in memory: a restart simply ends them
 * (the game's result is kept in the league either way).
 */
import { presimGame, type GameSummary, type League, type PlayEvent } from '@hockey-gm/sim-core';
import { teamInfo } from './views';

/** Game seconds per real second at each speed. */
export const SIMCAST_SPEEDS = { 1: 8, 2: 16, 4: 32, 10: 80, 30: 240 } as const;
export type SimcastSpeed = keyof typeof SIMCAST_SPEEDS;

/** Game seconds of intermission between periods (a few real seconds). */
const INTERMISSION = 40;
/** Nobody watching for this long (ms): the simcast ends so the league isn't stuck. */
const ABANDON_MS = 90_000;
/** A finished simcast stays up this long so everyone sees the final. */
const LINGER_MS = 5 * 60_000;

export interface SimcastRow {
  t: number;
  period: number;
  clock: number;
  type: PlayEvent['type'];
  side: 'home' | 'away' | null;
  text: string;
  x?: number;
  y?: number;
  homeScore: number;
  awayScore: number;
  homeShots: number;
  awayShots: number;
  player?: string;
  strength?: string;
}

/** What the box score needs from each play (kept on the server). */
interface RawPlay {
  t: number;
  type: PlayEvent['type'];
  side: 'home' | 'away' | null;
  pid?: string;
  oid?: string;
  aids?: string[];
  pim?: number;
  box?: { home: number[]; away: number[] };
  pulled?: 'home' | 'away';
  clock: number;
  period: number;
}

interface BoxPlayer {
  id: string;
  name: string;
  pos: string;
}

interface Session {
  /** Changes with every new simcast, so a browser knows to start its play list over. */
  sid: string;
  leagueId: string;
  gameId: number;
  season: number;
  day: number;
  playoff: boolean;
  seriesNote: string | null;
  hostId: string;
  hostName: string;
  home: ReturnType<typeof teamInfo>;
  away: ReturnType<typeof teamInfo>;
  rows: SimcastRow[];
  end: number;
  /** Game time shown at `baseAt`. */
  pos: number;
  baseAt: number;
  speed: SimcastSpeed;
  paused: boolean;
  viewers: Map<string, { name: string; seen: number }>;
  finishedAt: number | null;
  raw: RawPlay[];
  dressed: { home: BoxPlayer[]; away: BoxPlayer[] };
  result: GameSummary;
}

const sessions = new Map<string, Session>();

const position = (s: Session, now = Date.now()) => (s.paused ? s.pos : Math.min(s.end, s.pos + ((now - s.baseAt) / 1000) * SIMCAST_SPEEDS[s.speed]));

function rebase(s: Session, now = Date.now()) {
  s.pos = position(s, now);
  s.baseAt = now;
}

/** Drop sessions nobody watches, and mark finished ones. */
function sweep(leagueId: string) {
  const s = sessions.get(leagueId);
  if (!s) return null;
  const now = Date.now();
  if (!s.finishedAt && position(s, now) >= s.end) s.finishedAt = now;
  const lastSeen = Math.max(s.baseAt, ...[...s.viewers.values()].map((v) => v.seen));
  if ((s.finishedAt && now - s.finishedAt > LINGER_MS) || now - lastSeen > ABANDON_MS) {
    sessions.delete(leagueId);
    return null;
  }
  return s;
}

/** A simcast still in progress blocks the league's sim. */
export function simcastBlocking(leagueId: string): boolean {
  const s = sweep(leagueId);
  return !!s && !s.finishedAt;
}

export function simcastSummary(leagueId: string) {
  const s = sweep(leagueId);
  if (!s) return null;
  return {
    gameId: s.gameId,
    home: s.home,
    away: s.away,
    host: s.hostName,
    live: !s.finishedAt,
    viewers: s.viewers.size,
  };
}

const PERIOD_NAME = (p: number, playoff: boolean) => (p <= 3 ? `${p}${['st', 'nd', 'rd'][p - 1]} period` : playoff ? (p === 4 ? 'Overtime' : `${p - 3}OT`) : 'Overtime');

function describe(L: League, e: PlayEvent, playoff: boolean, cities: { home: string; away: string }): string {
  const n = (id?: string) => {
    const p = id ? L.players[id] : null;
    return p ? `${p.firstName[0]}. ${p.lastName}` : 'someone';
  };
  switch (e.type) {
    case 'period-start':
      return `Start of the ${PERIOD_NAME(e.period, playoff).toLowerCase()}`;
    case 'period-end':
      return `End of the ${PERIOD_NAME(e.period, playoff).toLowerCase()}`;
    case 'goal': {
      const a = e.assists?.length ? ` (${e.assists.map(n).join(', ')})` : ' (unassisted)';
      const st = e.strength === 'PP' ? ' · power-play goal' : e.strength === 'SH' ? ' · short-handed goal' : e.strength === 'EN' ? ' · empty net' : '';
      return `GOAL! ${n(e.player)}${a}${e.rebound ? ' on the rebound' : ''}${st}`;
    }
    case 'shot':
      return e.text === 'wide of the empty net'
        ? `${n(e.player)} fires at the empty net, but it's cleared`
        : `${n(e.player)} shoots${e.rebound ? ' the rebound' : ''}, saved by ${n(e.other)}${e.text === 'rebound' ? ', rebound!' : e.text === 'covered' ? ', who covers it up' : ''}`;
    case 'miss':
      return `${n(e.player)} ${e.rebound ? 'misses on the rebound' : 'misses the net'}`;
    case 'block':
      return `${n(e.player)}'s shot is blocked by ${n(e.other)}`;
    case 'penalty':
      return `Penalty: ${n(e.player)}, ${e.text}`;
    case 'penalty-over':
      return `Penalty over: ${e.side ? cities[e.side] : ''} back to ${e.box && (e.box[e.side!]?.length ?? 0) > 0 ? 'fewer men short' : 'full strength'}`;
    case 'fight':
      return `Fight! ${n(e.player)} and ${n(e.other)} drop the gloves (5 minutes each)`;
    case 'hit':
      return `${n(e.player)} lays a hit on ${n(e.other)}`;
    case 'injury':
      return `${n(e.player)} is hurt and leaves the game (${e.text?.toLowerCase()})`;
    case 'goalie-pulled':
      return `${n(e.player)} heads to the bench for an extra attacker`;
    case 'goalie-back':
      return `${n(e.player)} returns to the net`;
    case 'goalie-change':
      return `Goalie change: ${n(e.other)} replaces ${n(e.player)}`;
    case 'shootout':
      return `Shootout: ${e.side ? cities[e.side] : 'someone'} win it`;
    case 'final':
      return 'Final';
    default:
      return e.type;
  }
}

export function startSimcast(L: League, leagueId: string, gameId: number, host: { id: string; name: string }) {
  if (simcastBlocking(leagueId)) throw new Error('A game is already being simcast. Join it from the top of the screen.');
  const { game, result, events } = presimGame(L, gameId);
  if (!events.length) throw new Error('That game has no play-by-play');
  const playoff = L.phase === 'playoffs';
  const home = L.teams[game.home];
  const away = L.teams[game.away];
  const rows: SimcastRow[] = events.map((e) => {
    const p = e.player ? L.players[e.player] : null;
    return {
      // A short intermission between periods.
      t: e.t + (e.period - 1) * INTERMISSION,
      period: e.period,
      clock: e.clock,
      type: e.type,
      side: e.side,
      text: describe(L, e, playoff, { home: home.city, away: away.city }),
      x: e.x,
      y: e.y,
      homeScore: e.homeScore,
      awayScore: e.awayScore,
      homeShots: e.homeShots,
      awayShots: e.awayShots,
      player: p ? `${p.firstName} ${p.lastName}` : undefined,
      strength: e.strength,
    };
  });
  const raw: RawPlay[] = events.map((e, i) => ({
    t: rows[i].t,
    type: e.type,
    side: e.side,
    pid: e.player,
    oid: e.other,
    aids: e.assists,
    pim: e.type === 'penalty' ? Number(/(\d+) minutes/.exec(e.text ?? '')?.[1] ?? 2) : e.type === 'fight' ? 5 : undefined,
    box: e.box,
    pulled: e.pulled,
    clock: e.clock,
    period: e.period,
  }));
  const dressedOf = (ids: string[]) =>
    ids.filter((id) => L.players[id]).map((id) => ({ id, name: `${L.players[id].firstName[0]}. ${L.players[id].lastName}`, pos: L.players[id].pos }));
  // The final score (a shootout adds the deciding goal).
  const last = rows[rows.length - 1];
  last.homeScore = result.homeScore;
  last.awayScore = result.awayScore;
  const series = game.seriesId ? L.playoffs?.rounds.flat().find((s) => s.id === game.seriesId) : null;
  const now = Date.now();
  const s: Session = {
    sid: `${gameId}-${now}`,
    leagueId,
    gameId,
    season: L.season,
    day: L.day,
    playoff,
    seriesNote: series ? `Game ${game.gameNumber} · series ${series.highWins}-${series.lowWins}` : null,
    hostId: host.id,
    hostName: host.name,
    home: teamInfo(home),
    away: teamInfo(away),
    rows,
    end: last.t + 1,
    pos: 0,
    baseAt: now,
    speed: 1,
    paused: false,
    viewers: new Map([[host.id, { name: host.name, seen: now }]]),
    finishedAt: null,
    raw,
    dressed: { home: dressedOf(result.box.rosters.home), away: dressedOf(result.box.rosters.away) },
    result,
  };
  sessions.set(leagueId, s);
  return simcastSummary(leagueId)!;
}

/** What everyone watching sees now (and note that this viewer is watching). */
/**
 * What everyone watching sees now (and note that this viewer is watching).
 * `after` is how many plays the browser already has for this simcast (`sid`):
 * only the plays after those are sent, and the box score only when it changed.
 */
export function simcastView(leagueId: string, viewer: { id: string; name: string } | null, have: { sid?: string; after?: number } = {}) {
  const s = sweep(leagueId);
  if (!s) return null;
  const now = Date.now();
  if (viewer) s.viewers.set(viewer.id, { name: viewer.name, seen: now });
  for (const [id, v] of s.viewers) if (now - v.seen > 20_000 && id !== viewer?.id) s.viewers.delete(id);
  const pos = position(s, now);
  const shown = s.rows.filter((r) => r.t <= pos);
  const from = have.sid === s.sid ? Math.max(0, Math.min(have.after ?? 0, shown.length)) : 0;
  const cur = shown[shown.length - 1] ?? null;
  const periodEnded = cur?.type === 'period-end' || cur?.type === 'final';
  // The game clock: time since the period started, from the last play shown (or running between plays).
  const periodStart = [...shown].reverse().find((r) => r.type === 'period-start');
  const period = cur?.period ?? 1;
  const clock = periodEnded ? cur!.clock : periodStart ? Math.max(cur?.clock ?? 0, Math.floor(pos - periodStart.t + periodStart.clock)) : 0;
  const len = period <= 3 || s.playoff ? 1200 : 300;
  return {
    gameId: s.gameId,
    home: s.home,
    away: s.away,
    playoff: s.playoff,
    seriesNote: s.seriesNote,
    host: s.hostName,
    hostId: s.hostId,
    viewers: [...s.viewers.values()].map((v) => v.name),
    speed: s.speed,
    speeds: Object.keys(SIMCAST_SPEEDS).map(Number),
    paused: s.paused,
    done: !!s.finishedAt,
    progress: Math.min(1, pos / s.end),
    period,
    periodName: PERIOD_NAME(period, s.playoff),
    /** Time left in the period (seconds). */
    timeLeft: Math.max(0, len - Math.min(len, clock)),
    intermission: periodEnded && cur?.type !== 'final',
    homeScore: cur?.homeScore ?? 0,
    awayScore: cur?.awayScore ?? 0,
    homeShots: cur?.homeShots ?? 0,
    awayShots: cur?.awayShots ?? 0,
    sid: s.sid,
    /** Plays shown so far in total; `plays` holds only the ones after `from`. */
    total: shown.length,
    from,
    plays: shown.slice(from),
    /** Penalties running now: time left for each player in the box (the first two on each side tick). */
    penalties: penaltyState(s, shown.length, clock, periodEnded),
    /** A team with its goalie pulled for an extra attacker. */
    emptyNet: shown.length && !periodEnded ? (s.raw[shown.length - 1].pulled ?? null) : null,
    box: s.finishedAt ? finalBox(s) : from === 0 || shown.length > from ? liveBox(s, shown.length) : null,
    serverNow: now,
  };
}

function penaltyState(s: Session, n: number, clock: number, stopped: boolean) {
  const last = n ? s.raw[n - 1] : null;
  if (!last?.box) return null;
  const elapsed = stopped ? 0 : Math.max(0, clock - last.clock);
  const run = (xs: number[]) => xs.map((left, i) => (i < 2 ? Math.max(0, left - elapsed) : left)).filter((x) => x > 0);
  const home = run(last.box.home);
  const away = run(last.box.away);
  if (!home.length && !away.length) return null;
  return { home, away };
}

type Line = { id: string; name: string; pos: string; g: number; a: number; p: number; sog: number; hits: number; blk: number; pim: number; pm?: number; toi?: number };
type GLine = { id: string; name: string; sa: number; ga: number; sv: number; toi?: number };

/** The box score so far, from the plays shown. */
function liveBox(s: Session, n: number) {
  const make = (side: 'home' | 'away') => {
    const lines = new Map<string, Line>(s.dressed[side].filter((p) => p.pos !== 'G').map((p) => [p.id, { ...p, g: 0, a: 0, p: 0, sog: 0, hits: 0, blk: 0, pim: 0 }]));
    const goalies = new Map<string, GLine>(s.dressed[side].filter((p) => p.pos === 'G').map((p) => [p.id, { id: p.id, name: p.name, sa: 0, ga: 0, sv: 0 }]));
    return { lines, goalies };
  };
  const box = { home: make('home'), away: make('away') };
  const other = (x: 'home' | 'away') => (x === 'home' ? 'away' : 'home');
  for (const r of s.raw.slice(0, n)) {
    if (!r.side) continue;
    const mine = box[r.side].lines;
    const theirs = box[other(r.side)];
    const me = r.pid ? mine.get(r.pid) : undefined;
    switch (r.type) {
      case 'goal':
        if (me) {
          me.g++;
          me.p++;
          me.sog++;
        }
        for (const a of r.aids ?? []) {
          const x = mine.get(a);
          if (x) {
            x.a++;
            x.p++;
          }
        }
        {
          const g = r.oid ? theirs.goalies.get(r.oid) : undefined; // (none: an empty net)
          if (g) {
            g.sa++;
            g.ga++;
          }
        }
        break;
      case 'shot':
        if (me) me.sog++;
        if (r.oid) {
          const g = theirs.goalies.get(r.oid);
          if (g) {
            g.sa++;
            g.sv++;
          }
        }
        break;
      case 'block': {
        const b = r.oid ? theirs.lines.get(r.oid) : undefined;
        if (b) b.blk++;
        break;
      }
      case 'hit':
        if (me) me.hits++;
        break;
      case 'penalty':
        if (me) me.pim += r.pim ?? 2;
        break;
      case 'fight': {
        if (me) me.pim += 5;
        const o = r.oid ? theirs.lines.get(r.oid) : undefined;
        if (o) o.pim += 5;
        break;
      }
    }
  }
  const out = (side: 'home' | 'away') => ({
    skaters: [...box[side].lines.values()].sort((a, b) => b.p - a.p || b.g - a.g || b.sog - a.sog),
    goalies: [...box[side].goalies.values()].filter((g) => g.sa > 0 || [...box[side].goalies.values()].every((x) => x.sa === 0)).slice(0, 2),
  });
  return { final: false, home: out('home'), away: out('away') };
}

/** After the final: the full box score (with ice time and plus-minus). */
function finalBox(s: Session) {
  const b = s.result.box;
  const side = (key: 'home' | 'away') => {
    const names = new Map(s.dressed[key].map((p) => [p.id, p]));
    return {
      skaters: Object.entries(b.skaters)
        .filter(([id]) => names.has(id) && names.get(id)!.pos !== 'G')
        .map(([id, l]) => ({ id, name: names.get(id)!.name, pos: names.get(id)!.pos, g: l.g, a: l.a, p: l.g + l.a, sog: l.sog, hits: l.hits, blk: l.blk, pim: l.pim, pm: l.pm, toi: l.toi }))
        .sort((x, y) => y.p - x.p || y.g - x.g || (y.toi ?? 0) - (x.toi ?? 0)),
      goalies: Object.entries(b.goalies)
        .filter(([id]) => names.has(id))
        .map(([id, g]) => ({ id, name: names.get(id)!.name, sa: g.sa, ga: g.ga, sv: g.sa - g.ga, toi: g.toi })),
    };
  };
  return { final: true, home: side('home'), away: side('away') };
}

export function controlSimcast(
  leagueId: string,
  who: { id: string; canAdvance: boolean },
  action: { kind: 'speed'; speed: number } | { kind: 'pause' | 'resume' | 'skip-period' | 'skip-end' | 'end' },
) {
  const s = sweep(leagueId);
  if (!s) throw new Error('No game is being simcast');
  if (s.hostId !== who.id && !who.canAdvance) throw new Error(`Only ${s.hostName} (who started it) or a commissioner can run the simcast`);
  const now = Date.now();
  rebase(s, now);
  switch (action.kind) {
    case 'speed':
      if (!(action.speed in SIMCAST_SPEEDS)) throw new Error('Unknown speed');
      s.speed = action.speed as SimcastSpeed;
      break;
    case 'pause':
      s.paused = true;
      break;
    case 'resume':
      s.paused = false;
      break;
    case 'skip-period': {
      const pos = s.pos;
      const cur = [...s.rows].reverse().find((r) => r.t <= pos);
      // In an intermission: on to the next period. Otherwise: to the end of this one.
      const next =
        cur?.type === 'period-end'
          ? s.rows.find((r) => r.t > pos && r.type === 'period-start')
          : s.rows.find((r) => r.type === 'period-end' && r.t >= pos);
      s.pos = next ? next.t : s.end;
      break;
    }
    case 'skip-end':
      s.pos = s.end;
      break;
    case 'end':
      sessions.delete(leagueId);
      return { ended: true };
  }
  if (s.pos >= s.end && !s.finishedAt) s.finishedAt = now;
  return { ended: false };
}
