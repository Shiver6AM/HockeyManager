/**
 * Core data model. Everything here is plain JSON-serializable data so the
 * same objects can live in a browser, a Web Worker, or a Postgres JSONB column.
 */

export type Position = 'C' | 'LW' | 'RW' | 'D' | 'G';
export type PlayerId = string;
export type TeamId = string;

export interface SkaterRatings {
  skating: number;
  shooting: number;
  passing: number;
  handling: number;
  offIQ: number;
  defIQ: number;
  checking: number;
  faceoffs: number;
  discipline: number;
  endurance: number;
}

export interface GoalieRatings {
  reflexes: number;
  positioning: number;
  rebounds: number;
  mental: number;
}

/** Traits the user never sees directly. Scouting will reveal them imperfectly. */
export interface HiddenTraits {
  /** Overall the player is trending toward at peak (40–99). */
  potential: number;
  /** 0–1: how much game-to-game performance varies (1 = very steady). */
  consistency: number;
  /** 0–1: likelihood of injury. */
  injuryProneness: number;
  personality: {
    greed: number; // cares about money
    loyalty: number; // prefers staying with current team
    ambition: number; // wants to win / play for a contender
  };
}

export interface Contract {
  /** Annual cap hit in dollars. */
  salary: number;
  /** Seasons remaining including the current one. */
  yearsLeft: number;
  kind: 'ELC' | 'standard';
  /** Status when this deal expires. */
  expiresAs: 'RFA' | 'UFA';
}

export type InjurySeverity = 'day-to-day' | 'short-term' | 'medium-term' | 'long-term' | 'season-ending';

export interface Injury {
  /** e.g. "Upper-body", "Knee sprain". */
  type: string;
  severity: InjurySeverity;
  /** Calendar days until the player is healthy again. */
  daysLeft: number;
  /** Day the injury happened. */
  sinceDay: number;
}

export interface Player {
  id: PlayerId;
  firstName: string;
  lastName: string;
  pos: Position;
  shoots: 'L' | 'R';
  birthYear: number;
  nationality: string;
  archetype: string;
  teamId: TeamId | null;
  skater?: SkaterRatings;
  goalie?: GoalieRatings;
  hidden: HiddenTraits;
  contract: Contract | null;
  injury: Injury | null;
}

/** Who makes decisions for a team. Adding human managers never changes the team count. */
export type TeamController =
  | { kind: 'ai'; strategy: 'contend' | 'balanced' | 'rebuild' }
  | { kind: 'human'; userId: string };

export interface Lines {
  /** 4 forward lines: [LW, C, RW]. */
  forwards: PlayerId[][];
  /** 3 defense pairs. */
  defense: PlayerId[][];
  /** [starter, backup] */
  goalies: PlayerId[];
  /** Power-play units: 5 skaters each. */
  pp: PlayerId[][];
  /** Penalty-kill units: 4 skaters each (2F, 2D). */
  pk: PlayerId[][];
}

export interface Team {
  id: TeamId;
  city: string;
  name: string;
  abbr: string;
  colors: [string, string];
  conference: string;
  division: string;
  controller: TeamController;
  roster: PlayerId[];
  lines: Lines;
  /**
   * Human teams only: let the assistant coach rebuild the lines before every
   * game (the same logic AI teams use). Turned off when the manager edits lines.
   */
  autoLines?: boolean;
}

/**
 * How the league moves forward in time. The sim-core only knows how to
 * "advance N days"; deciding *when* to do that is the server's job.
 */
export type AdvanceMode =
  | { mode: 'commissioner' }
  | {
      mode: 'scheduled';
      /** Cron expression in the league's timezone, e.g. "0 23 * * *". */
      cron: string;
      timezone: string;
      /** Sim days to advance per scheduled tick. */
      daysPerTick: number;
      /** If true, a tick fires early once every human manager has readied up. */
      advanceEarlyWhenAllReady: boolean;
    };

export interface LeagueSettings {
  gamesPerTeam: number;
  salaryCap: number;
  salaryFloor: number;
  advance: AdvanceMode;
  /** Home-ice advantage multiplier on shot-attempt rate. */
  homeIce: number;
}

export type Strength = 'EV' | 'PP' | 'SH' | 'EN';

export interface GoalEvent {
  period: number; // 4 = OT
  time: number; // seconds into the period
  teamId: TeamId;
  scorer: PlayerId;
  assists: PlayerId[];
  strength: Strength;
}

export interface PenaltyEvent {
  period: number;
  time: number;
  teamId: TeamId;
  playerId: PlayerId;
  minutes: number;
  infraction: string;
}

export interface SkaterGameLine {
  g: number;
  a: number;
  pm: number;
  pim: number;
  sog: number;
  att: number; // shot attempts
  ppg: number;
  ppa: number;
  shg: number;
  hits: number;
  blk: number;
  fow: number;
  fol: number;
  toi: number; // seconds
}

export interface GoalieGameLine {
  sa: number;
  ga: number;
  toi: number;
  decision: 'W' | 'L' | 'OTL' | null;
}

export interface TeamGameLine {
  goals: number;
  shots: number;
  attempts: number;
  hits: number;
  blocks: number;
  pim: number;
  ppGoals: number;
  ppOpps: number;
  fow: number;
  periodGoals: number[];
}

export interface InjuryEvent {
  period: number;
  time: number;
  teamId: TeamId;
  playerId: PlayerId;
  type: string;
  severity: InjurySeverity;
  days: number;
}

export interface BoxScore {
  home: TeamGameLine;
  away: TeamGameLine;
  overtime: boolean;
  shootout: boolean;
  goals: GoalEvent[];
  penalties: PenaltyEvent[];
  injuries: InjuryEvent[];
  /** Who dressed for each side (skaters and goalies). */
  rosters: { home: PlayerId[]; away: PlayerId[] };
  skaters: Record<PlayerId, SkaterGameLine>;
  goalies: Record<PlayerId, GoalieGameLine>;
  /** Player credited with the game-winning goal (not in shootouts). */
  gwg: PlayerId | null;
  stars: PlayerId[];
}

export interface ScheduledGame {
  id: number;
  day: number;
  home: TeamId;
  away: TeamId;
  result: GameSummary | null;
  /** Set for playoff games. */
  seriesId?: string;
  gameNumber?: number;
}

export interface PlayoffSeries {
  id: string; // e.g. "R1-East-1"
  round: number; // 1..4 (4 = final)
  conference: string | null; // null for the final
  /** Higher seed has home ice. */
  high: TeamId;
  low: TeamId;
  highWins: number;
  lowWins: number;
  games: ScheduledGame[];
  winner: TeamId | null;
}

export interface Playoffs {
  rounds: PlayoffSeries[][];
  /** Day the current round's game 1 is played. */
  roundStartDay: number;
  champion: TeamId | null;
}

export interface AwardWinner {
  playerId: PlayerId | null;
  teamId: TeamId;
  /** Short, human-readable reason, e.g. "132 PTS". */
  note: string;
}

export interface SeasonRecord {
  season: number;
  champion: TeamId | null;
  runnerUp: TeamId | null;
  awards: Record<string, AwardWinner>;
}

export interface Transaction {
  day: number;
  season: number;
  type: 'call-up' | 'send-down' | 'injury' | 'return';
  teamId: TeamId;
  playerId: PlayerId;
  note: string;
}

export interface GameSummary {
  homeScore: number;
  awayScore: number;
  overtime: boolean;
  shootout: boolean;
  box: BoxScore;
}

export interface SkaterSeasonStats extends SkaterGameLine {
  gp: number;
  gwg: number;
}

export interface GoalieSeasonStats {
  gp: number;
  gs: number;
  w: number;
  l: number;
  otl: number;
  sa: number;
  ga: number;
  so: number;
  toi: number;
}

export interface League {
  id: string;
  name: string;
  seed: number;
  season: number; // e.g. 2026 for 2026-27
  /** Next sim day to be played (0-based). */
  day: number;
  phase: 'regular-season' | 'playoffs' | 'offseason';
  settings: LeagueSettings;
  teams: Record<TeamId, Team>;
  players: Record<PlayerId, Player>;
  schedule: ScheduledGame[];
  skaterStats: Record<PlayerId, SkaterSeasonStats>;
  goalieStats: Record<PlayerId, GoalieSeasonStats>;
  playoffs: Playoffs | null;
  playoffSkaterStats: Record<PlayerId, SkaterSeasonStats>;
  playoffGoalieStats: Record<PlayerId, GoalieSeasonStats>;
  /** Awards for the current season as they're decided. */
  awards: Record<string, AwardWinner>;
  history: SeasonRecord[];
  transactions: Transaction[];
}

export interface StandingsRow {
  teamId: TeamId;
  gp: number;
  w: number;
  l: number;
  otl: number;
  pts: number;
  rw: number; // regulation wins
  row: number; // regulation + OT wins
  gf: number;
  ga: number;
  pointsPct: number;
  streak: string;
  last10: string;
}
