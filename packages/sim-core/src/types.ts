import type { Role, Tactics } from './systems';
import type { SkillsCoach } from './skills';
import type { Scout, TeamScouting } from './scouting';

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
  /**
   * Sleeper: a late bloomer whose ceiling scouts badly underrate. The number is
   * how many points of potential they miss while he's a teenager (the disguise
   * fades by about 21, as he develops).
   */
  sleeper?: number;
}

export interface Contract {
  /** Annual cap hit in dollars. */
  salary: number;
  /** Seasons remaining including the current one. */
  yearsLeft: number;
  kind: 'ELC' | 'standard';
  /** Status when this deal expires. */
  expiresAs: 'RFA' | 'UFA';
  /**
   * Two-way deal: he earns `minorSalary` while in the AHL (one-way deals pay the
   * NHL salary wherever he plays). Missing on older saves: see isTwoWay().
   */
  twoWay?: boolean;
  minorSalary?: number;
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
  /** Other positions he can play (skaters). Worked out once for older saves. */
  altPos?: Position[];
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
  /** Team holding this player's rights while he develops outside the NHL roster. */
  prospectOf?: TeamId;
  /** A new deal agreed in advance (extension or re-signing); replaces his contract when it expires. */
  extension?: ContractOffer;
  /** How the player entered the league, if through the draft. */
  draft?: { season: number; round: number; overall: number; teamId: TeamId };
  /** Draft year while he's an eligible, undrafted prospect. */
  draftClass?: number;
  /** Where he plays outside the NHL this season (junior, college, Europe, AHL). */
  minorTeam?: { season: number; league: string; team: string };
  /**
   * Natural development during the current regular season (see development.ts):
   * his overall when it began, how many overall points have arrived since, and
   * the fraction of a rating point still owed.
   */
  devSeason?: { season: number; start: number; applied: number; carry: number };
  /** Signed but assigned to the team's AHL affiliate (farm team). */
  farm?: boolean;
  /** On waivers (off the active roster until he's claimed or clears). */
  onWaivers?: boolean;
  /** Last recalled from the farm (recent recalls go back down without waivers). */
  recalledOn?: { season: number; day: number };
  /** Called up to cover for an injury (goes back down when the regulars return, for auto-managed lineups). */
  injuryCallUp?: boolean;
  /** Waiting to be picked in a new league's fantasy draft. */
  inFantasyPool?: boolean;
  /** Height in inches and weight in pounds (derived from his frame when missing; see body.ts). */
  height?: number;
  weight?: number;
  /** How much he gets out of coaching, 1–99 (derived from his id when missing; see skills.ts). */
  coachability?: number;
  /** Points added to situational skills by skills coaches. */
  roleTraining?: Partial<Record<Role, number>>;
  /** Fractional progress toward the next point, by skill. */
  trainingProgress?: Record<string, number>;
  /** Points gained from coaching this season, by skill. */
  trainingLog?: { season: number; gains: Record<string, number> };
  /** Rare badges (see traits.ts), by tier 1–4. Re-checked each season. */
  traits?: Partial<Record<import('./traits').TraitId, import('./traits').TraitTier>>;
  /** Season his traits were last worked out. */
  traitsSeason?: number;
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
  /** 4-on-4 units: [F, F, D, D]. (Optional fields: older saves are completed on first use.) */
  fourOnFour?: PlayerId[][];
  /** 3-on-3 (overtime) units: [F, F, D]. */
  threeOnThree?: PlayerId[][];
  /** 4-on-3 power play: [half wall, flank, bumper, point]. */
  pp4?: PlayerId[];
  /** 3-man penalty kill (5-on-3, 4-on-3): [F, D, D]. */
  pk3?: PlayerId[];
  /** Extra attacker when the goalie is pulled: 6 skaters. */
  extraAttacker?: PlayerId[];
  /** Shootout order (first five shooters). */
  shootout?: PlayerId[];
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
  /** Head coach, head scout and head trainer. */
  staff?: Record<StaffRole, StaffMember>;
  /** Market size: 0.7 (small) … 1.5 (big). Drives attendance, ticket prices and revenue. */
  market?: number;
  finances?: TeamFinances;
  financeHistory?: TeamFinances[];
  /** Cumulative profit since the league began. */
  cash?: number;
  owner?: OwnerState;
  /** Buyout charges: cap hits for players no longer on the team. Seasons inclusive. */
  deadCap?: Array<{ playerName: string; amount: number; fromSeason: number; untilSeason: number; retained?: boolean }>;
  /** Draft picks and young players developing outside the active roster (junior/minors). */
  prospects?: PlayerId[];
  lines: Lines;
  /**
   * Human teams only: let the assistant coach rebuild the lines before every
   * game (the same logic AI teams use). Turned off when the manager edits lines.
   */
  autoLines?: boolean;
  /**
   * Where the manager wants players used when the assistant coach builds the
   * lines: a line or group of lines, a position, or a healthy scratch.
   */
  linePins?: Record<PlayerId, LinePin>;
  /** Draft-eligible prospects the manager is keeping an eye on. */
  watchlist?: PlayerId[];
  /** Human managers' trade block (AI blocks are computed). */
  tradeBlock?: TradeBlock;
  /** Coaching systems (AI teams pick theirs to suit the roster). */
  tactics?: Tactics;
  /** The AHL affiliate's name. */
  affiliate?: { city: string; name: string };
  /** The farm team has been stocked with its first players. */
  farmStocked?: boolean;
  /** Area scouts (up to four). */
  scouts?: Scout[];
  /** Skills coaches (up to three). */
  skillsCoaches?: SkillsCoach[];
  /** The goalie coach. */
  goalieCoach?: SkillsCoach;
  /** Games each forward line / defense pair (sorted ids joined by "|") has played together recently. */
  chemistry?: Record<string, number>;
}

export type PinSlot = 'L1' | 'L2' | 'L3' | 'L4' | 'top6' | 'top9' | 'bottom6' | 'P1' | 'P2' | 'P3' | 'top4' | 'G1' | 'G2' | 'scratch';
export interface LinePin {
  slot?: PinSlot;
  /** Forwards: the position to play. */
  pos?: 'C' | 'LW' | 'RW';
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
  /**
   * Mean overall of the league's best (roster-sized) group of players at creation.
   * Each summer ratings are nudged back toward it so talent can't slowly inflate or
   * deflate over decades, which would throw off the game-sim calibration.
   */
  talentAnchor?: number;
  /** Standard deviation of that same group at creation (keeps the star/depth spread stable). */
  talentSpread?: number;
  /** Commissioner sliders (multipliers; see sliders.ts). */
  sim?: Partial<Record<string, number>>;
  /**
   * The same anchors for skaters and goalies separately (the best 21 skaters and
   * 2 goalies per team). Goalies are anchored on their own so the size of the
   * goalie pool (AHL depth) can't push goaltending up or scoring down.
   */
  skaterAnchor?: { mean: number; sd: number };
  goalieAnchor?: { mean: number; sd: number };
  /** 'commissioner' = trades involving a human team wait for commissioner approval. */
  tradeReview?: 'none' | 'commissioner';
  /** Last regular-season day on which trades are allowed (default: ~78% of the season). */
  tradeDeadlineDay?: number;
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
  type:
    | 'call-up'
    | 'send-down'
    | 'injury'
    | 'return'
    | 'draft'
    | 're-sign'
    | 'signing'
    | 'departure'
    | 'release'
    | 'promotion'
    | 'retirement'
    | 'buyout'
    | 'extension'
    | 'qualifying-offer'
    | 'offer-sheet'
    | 'arbitration'
    | 'trade'
    | 'waivers'
    | 'waiver-claim';
  teamId: TeamId;
  playerId: PlayerId;
  note: string;
}

/** One play in a game's play-by-play (recorded only when a game is simcast). */
export interface PlayEvent {
  /** Seconds since the opening faceoff. */
  t: number;
  period: number;
  /** Seconds into the period. */
  clock: number;
  type: 'period-start' | 'period-end' | 'faceoff' | 'shot' | 'miss' | 'block' | 'goal' | 'penalty' | 'penalty-over' | 'fight' | 'hit' | 'injury' | 'goalie-pulled' | 'goalie-back' | 'goalie-change' | 'shootout' | 'final';
  side: 'home' | 'away' | null;
  player?: PlayerId;
  /** The goalie who saved it, the blocker, the player hit, the other fighter, a new goalie. */
  other?: PlayerId;
  assists?: PlayerId[];
  strength?: Strength;
  rebound?: boolean;
  /** Where the shot was taken, in feet from center ice (x toward the far goal, y across). */
  x?: number;
  y?: number;
  text?: string;
  homeScore: number;
  awayScore: number;
  homeShots: number;
  awayShots: number;
  /** Penalty time left (seconds) for each player in the box, when anyone is. */
  box?: { home: number[]; away: number[] };
  /** A team playing with its goalie pulled. */
  pulled?: 'home' | 'away';
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
  offseason?: OffseasonState | null;
  /** Coaches, scouts and trainers looking for work. */
  staffPool?: StaffMember[];
  skillsCoachPool?: SkillsCoach[];
  goalieCoachPool?: SkillsCoach[];
  /** Players on waivers right now. */
  waivers?: import('./waivers').WaiverEntry[];
  /** Next draft's class, generated when the season starts so scouts can watch it. */
  draftClass?: { season: number; ids: PlayerId[] };
  /** Central Scouting's latest published list (see css.ts). */
  css?: { season: number; index: number; ranks: Record<PlayerId, number>; prev?: Record<PlayerId, number> };
  /** A new league's fantasy draft (see start.ts). */
  fantasy?: FantasyDraft;
  /** Created at an offseason start: no season has been played yet (no books to close). */
  freshStart?: boolean;
  /** Scouting knowledge by team (see scouting.ts). */
  scouting?: Record<TeamId, TeamScouting>;
  /** Area scouts on the job market. */
  scoutPool?: Scout[];
  /** This season's junior/AHL stats for prospects. */
  prospectStats?: Record<PlayerId, MinorLine>;
  /** Games already played out for a simcast, used when their day is simmed. */
  presimmed?: PresimmedGame[];
  news?: NewsItem[];
  /** Bookkeeping for news generation (streaks, processed transactions). */
  newsState?: { txCursor: number; streaks: Record<TeamId, number>; nextId: number };
  hallOfFame?: HallOfFamer[];
  /** Draft pick ownership by pick key "season:round:originalTeam". Missing = original team. */
  pickOwners?: Record<string, TeamId>;
  trades?: TradeProposal[];
  /** Ongoing contract talks (reset each season/team). */
  negotiations?: Record<PlayerId, NegotiationState>;
  /** One line per player per season they appeared in. */
  careerStats?: Record<PlayerId, CareerLine[]>;
  retired?: Record<PlayerId, RetiredPlayer>;
}

export type OffseasonStage = 'fantasy-draft' | 'draft' | 're-sign' | 'free-agency' | 'training-camp';

/** A new league's fantasy draft: every signed player in one pool, snake order. */
export interface FantasyDraft {
  /** The commissioner has started it (picks run until a manager is on the clock). */
  started: boolean;
  /** Round-1 order (reversed in even rounds). */
  order: TeamId[];
  picks: Array<{ round: number; overall: number; teamId: TeamId; playerId: PlayerId | null }>;
  current: number;
  /** Everyone who went into the pool. */
  pool: PlayerId[];
  /** Where the league goes after the last pick. */
  then: 're-sign' | 'draft' | 'season';
  /** Managers who let the AI pick for them. */
  auto: Record<TeamId, boolean>;
  /** Managers' ranked wish lists (used when they're picked for). */
  lists?: Record<TeamId, PlayerId[]>;
  done?: boolean;
}

export interface DraftPick {
  round: number;
  overall: number;
  /** Team that currently owns the pick (picks become tradeable in Phase 5). */
  teamId: TeamId;
  originalTeamId: TeamId;
  playerId: PlayerId | null;
}

export interface DraftState {
  season: number;
  /** Prospect ids in the class (drafted or not). */
  classIds: PlayerId[];
  picks: DraftPick[];
  /** Index into picks of the pick on the clock; picks.length when done. */
  current: number;
  /** Teams that moved up in the lottery: [teamId, from, to]. */
  lottery: Array<[TeamId, number, number]>;
  /** False until the lottery is drawn (left out: already drawn, as in older saves). */
  lotteryHeld?: boolean;
  /** Lottery teams worst first, with their odds (%) of winning a draw. */
  lotteryOdds?: Array<[TeamId, number]>;
  /** The draw's result, decided when the draft was created and applied when it's held. Never shown before then. */
  lotteryPlan?: { order: TeamId[]; lottery: Array<[TeamId, number, number]> };
  /** When the draw was shown live (ms since epoch): clients reveal it pick by pick from then. */
  lotteryShow?: number;
  /** The draft clock. Absent until the draft is started (or when it's simmed straight through). */
  clock?: DraftClock;
}

/** A game already played out for a simcast; the day's sim uses this result. */
export interface PresimmedGame {
  season: number;
  day: number;
  gameId: number;
  result: GameSummary;
  events?: PlayEvent[];
}

export interface DraftClock {
  /** Time allowed per pick (ms). */
  perPick: number;
  /** The pick (index into picks) and team the clock is running for. */
  pick: number;
  teamId: TeamId;
  /** When the manager on the clock runs out of time (his scouts' choice is taken). */
  deadline: number;
  /** When an AI team on the clock makes its pick. */
  aiAt: number | null;
  /** Paused: the time that was left (ms), and for an AI team, until its pick. */
  paused?: { left: number; aiLeft: number | null };
}

export interface ContractOffer {
  salary: number;
  years: number;
  /** Two-way (a lower AHL salary while in the minors). Left out, the usual default applies (see defaultTwoWay). */
  twoWay?: boolean;
}

export interface OffseasonState {
  /** The season that just ended. */
  season: number;
  stage: OffseasonStage;
  draft: DraftState;
  /** Players whose contracts end this summer, with what they're asking for. */
  expiring: Record<PlayerId, ContractOffer>;
  /** Explicit human decisions on expiring players: false = let him go. (Deals live on player.extension.) */
  resign: Record<PlayerId, boolean>;
  /** RFAs whose team extended a qualifying offer (keeps his rights on a 1-year deal). */
  qualified?: Record<PlayerId, boolean>;
  /** Old saves: free agency ran in three bidding rounds (now days; see faDay). */
  faRound?: number;
  /** Free agency day (1-based, up to FA_DAYS). */
  faDay?: number;
  /** Sealed offers by team. They stand until the player decides (or the team withdraws). */
  bids?: Record<TeamId, Record<PlayerId, ContractOffer>>;
  /** The day each free agent with offers on the table will decide (he listens 3–5 days from the first offer). */
  faClock?: Record<PlayerId, number>;
  /** How many times each free agent has turned down every offer (he lowers his sights each time). */
  faHoldouts?: Record<PlayerId, number>;
  faLog?: FaResult[];
  /** Free agents who turned down every offer they had. */
  faHoldoutLog?: FaHoldout[];
  /** Asking prices for this summer's free agents. */
  freeAgentAsks: Record<PlayerId, ContractOffer>;
  /** Each human team's ranked draft list, used when they're auto-picked for. */
  draftLists?: Record<TeamId, PlayerId[]>;
  /** Rating changes from this summer's development: [before, after]. */
  development: Record<PlayerId, [number, number]>;
  /** Qualified RFAs without a deal: offer sheets during free agency, then arbitration. */
  rfa?: Record<PlayerId, RfaCase>;
  /** Offer sheets tendered this bidding round, by offering team. */
  sheets?: Record<TeamId, Record<PlayerId, ContractOffer>>;
  /** Day of the re-signing week (1–7); free agency opens after day 7. */
  resignDay?: number;
  /** Offers to expiring players, answered on the next day. */
  pendingOffers?: Record<PlayerId, PendingOffer>;
  /** The latest answer from each player a team made an offer to. */
  responses?: Record<PlayerId, OfferResponse>;
  /** Expiring players AI teams have already decided on this week. */
  aiDecided?: Record<PlayerId, boolean>;
}

export interface PendingOffer {
  teamId: TeamId;
  offer: ContractOffer;
  /** Offseason step (re-sign day) when it was made. */
  madeOn: number;
  /** He asked for an extra day to think it over. */
  delayed?: boolean;
}

export interface OfferResponse {
  teamId: TeamId;
  offer: ContractOffer;
  /** Re-sign day the answer arrived. */
  day: number;
  result: 'accept' | 'counter' | 'reject' | 'refuse' | 'considering';
  counter?: ContractOffer;
  message: string;
}

export interface OfferSheet {
  fromTeam: TeamId;
  offer: ContractOffer;
  /** Draft picks (keys) the original team receives if it doesn't match. */
  compensation: string[];
  /** The original team's decision; undecided sheets are settled at the next advance. */
  decision?: 'match' | 'decline';
  round: number;
}

export interface RfaCase {
  teamId: TeamId;
  qualifyingOffer: ContractOffer;
  /** He filed for salary arbitration (heard at the end of free agency). */
  arbitration: boolean;
  status: 'unsigned' | 'signed' | 'awarded' | 'walked' | 'departed';
  award?: ContractOffer;
  sheet?: OfferSheet;
}

/** A player (the team sending him may retain part of his salary: 0 to 0.5) or a draft pick. */
export type TradeAsset = { kind: 'player'; id: PlayerId; retain?: number } | { kind: 'pick'; key: string };

export interface TradeProposal {
  id: string;
  season: number;
  day: number;
  fromTeam: TeamId;
  toTeam: TeamId;
  /** Assets going from fromTeam to toTeam. */
  give: TradeAsset[];
  /** Assets going from toTeam to fromTeam. */
  get: TradeAsset[];
  status: 'pending' | 'awaiting-approval' | 'completed' | 'rejected' | 'withdrawn' | 'vetoed' | 'invalid';
  note?: string;
  resolvedDay?: number;
  /** Set on an offer an AI front office made to a manager. */
  ai?: {
    /** The offer clock (see offerClock) when it was made, and the last day it stands. */
    clock: number;
    expires: number;
    /** The player the call was about. */
    headline: PlayerId;
    /** What their GM said. */
    pitch: string;
  };
}

export type StaffRole = 'coach' | 'scout' | 'trainer';

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  /** 40 (poor) … 95 (elite). */
  rating: number;
  salary: number;
  yearsLeft: number;
}

export interface TeamFinances {
  season: number;
  homeGames: number;
  attendance: number;
  gate: number;
  media: number;
  sponsorship: number;
  playoffGate: number;
  salaries: number;
  staff: number;
  operations: number;
  /** Running record, used for fan demand. */
  gp: number;
  pts: number;
}

export type OwnerGoal = 'win-now' | 'make-playoffs' | 'develop-youth' | 'turn-profit';

export interface OwnerState {
  goal: OwnerGoal;
  /** 0 … 100. */
  confidence: number;
  lastReview: string | null;
}

export type NewsKind = 'game' | 'milestone' | 'streak' | 'trade' | 'signing' | 'injury' | 'award' | 'playoffs' | 'draft' | 'retirement' | 'hof' | 'owner' | 'staff';

export interface NewsItem {
  id: number;
  season: number;
  day: number;
  kind: NewsKind;
  headline: string;
  teamIds: TeamId[];
  playerIds: PlayerId[];
}

export interface HallOfFamer {
  playerId: PlayerId;
  name: string;
  pos: Position;
  inducted: number;
  seasons: number;
  lastTeamId: TeamId | null;
  summary: string;
}

export interface FaHoldout {
  day: number;
  playerId: PlayerId;
  /** Teams that had offers in (they come off the table). */
  teamIds: TeamId[];
}

export interface FaResult {
  /** Free agency day he signed (older saves: the bidding round). */
  round: number;
  playerId: PlayerId;
  teamId: TeamId;
  offer: ContractOffer;
  /** How many teams had offers in when he decided. */
  bidders: number;
}

export interface NegotiationState {
  season: number;
  teamId: TeamId;
  attempts: number;
  /** Raised by insulting offers. */
  annoyance: number;
}

export interface CareerLine {
  season: number;
  teamId: TeamId | null;
  age: number;
  overall: number;
  skater: SkaterSeasonStats | null;
  goalie: GoalieSeasonStats | null;
  playoffSkater: SkaterSeasonStats | null;
  playoffGoalie: GoalieSeasonStats | null;
  /** A season in junior or the AHL (prospects). */
  minor?: MinorLine | null;
  /** Organization holding his rights that season, for minor-league seasons. */
  orgId?: TeamId | null;
}

/** A prospect's season in junior or the AHL. Goalie fields only for goalies. */
export interface MinorLine {
  league: string;
  /** Club within that league (e.g. "Kingston" in the OHL, or the AHL affiliate). */
  team?: string;
  gp: number;
  g: number;
  a: number;
  pim: number;
  pm: number;
  w?: number;
  l?: number;
  sa?: number;
  ga?: number;
  so?: number;
}

export interface RetiredPlayer {
  id: PlayerId;
  name: string;
  pos: Position;
  birthYear: number;
  retiredAfter: number;
  lastTeamId: TeamId | null;
  peakOverall: number;
  career: CareerLine[];
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

export type NeedTag = 'C' | 'W' | 'D' | 'G' | 'young' | 'prospects' | 'picks' | 'veteran' | 'cap-space';

/** Players and picks a team is shopping, and what it wants back. */
export interface TradeBlock {
  players: PlayerId[];
  picks: string[];
  needs: NeedTag[];
  note?: string;
}
