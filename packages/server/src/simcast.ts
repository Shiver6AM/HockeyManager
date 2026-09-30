/**
 * Simcasts: watch one of the next day's games play by play, together.
 *
 * The game is played out when the simcast starts (the league keeps that
 * result, so the day's sim uses it) and revealed a play at a time on a shared
 * game clock that everyone watching follows. While a simcast is running the
 * league can't be simmed. Sessions live in memory: a restart simply ends them
 * (the game's result is kept in the league either way).
 */
import { presimGame, type League, type PlayEvent } from '@hockey-gm/sim-core';
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

interface Session {
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
  // The final score (a shootout adds the deciding goal).
  const last = rows[rows.length - 1];
  last.homeScore = result.homeScore;
  last.awayScore = result.awayScore;
  const series = game.seriesId ? L.playoffs?.rounds.flat().find((s) => s.id === game.seriesId) : null;
  const now = Date.now();
  const s: Session = {
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
  };
  sessions.set(leagueId, s);
  return simcastSummary(leagueId)!;
}

/** What everyone watching sees now (and note that this viewer is watching). */
export function simcastView(leagueId: string, viewer: { id: string; name: string } | null) {
  const s = sweep(leagueId);
  if (!s) return null;
  const now = Date.now();
  if (viewer) s.viewers.set(viewer.id, { name: viewer.name, seen: now });
  for (const [id, v] of s.viewers) if (now - v.seen > 20_000 && id !== viewer?.id) s.viewers.delete(id);
  const pos = position(s, now);
  const shown = s.rows.filter((r) => r.t <= pos);
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
    plays: shown,
    serverNow: now,
  };
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
