/**
 * Game simulation.
 *
 * The game is simulated second by second. Each second, each team may generate
 * a shot attempt, a penalty, a hit, or a stoppage, with rates driven by the
 * ratings of the skaters currently on the ice. Lines rotate by shift length
 * toward target ice-time shares; power-play and penalty-kill units take over
 * when strengths differ; goalies get pulled late when trailing.
 *
 * All tuning constants live in TUNING so the calibration harness can adjust them.
 */
import { clamp, deriveSeed, Rng } from './rng';
import { CHEMISTRY, SLOT_BASIS, slotBonusOf, unitChemistry } from './chemistry';
import { completeLines } from './lines';
import { defensiveDrive, goalieQuality, offensiveDrive } from './ratings';
import { slider } from './sliders';
import { tierOf } from './traits';
import {
  combine,
  DEFAULT_TACTICS,
  evenStrengthEffect,
  EXTRA_ATTACKER_SLOTS,
  FOUR_SLOTS,
  penaltyKillFits,
  powerPlayFitsOf,
  relativeFit,
  THREE_SLOTS,
  NEUTRAL,
  penaltyKillEffect,
  PK3_SLOTS,
  PK_SLOTS,
  PP4_SLOTS,
  PP_FORMATIONS,
  powerPlayEffect,
  roleSkills,
  type Role,
  type Slot,
  type SystemEffect,
  type Tactics,
} from './systems';
import type {
  BoxScore,
  InjuryEvent,
  InjurySeverity,
  GameSummary,
  GoalEvent,
  GoalieGameLine,
  League,
  PenaltyEvent,
  PlayEvent,
  PlayerId,
  SkaterGameLine,
  Strength,
  Lines,
  Team,
  TeamGameLine,
} from './types';

export const TUNING = {
  /** Shot attempts per team per 60 minutes, by (my skaters)v(their skaters). */
  attemptsPer60: {
    '5v5': 52,
    '4v4': 60,
    '3v3': 110,
    '5v4': 92,
    '4v5': 13,
    '5v3': 130,
    '3v5': 10,
    '4v3': 110,
    '3v4': 14,
    '6v5': 95,
    '5v6': 30,
    '6v4': 120,
    '4v6': 12,
  } as Record<string, number>,
  /** Sensitivity of attempt rate to (offense - opposing defense), per 10 rating points. */
  driveEffect: 0.13,
  blockBase: 0.25,
  missBase: 0.34,
  /** Base shooting % on shots on goal, by situation. */
  shPct: { EV: 0.089, PP: 0.118, SH: 0.09, OT: 0.1, EN: 0.92 } as Record<string, number>,
  shooterEffect: 0.13, // per 10 shooting points (a little flatter now that elite shooters carry traits)
  supportEffect: 0.1, // teammates' passing/IQ vs defense
  goalieEffect: 0.19, // per 10 goalie points
  defenseShotFactor: 0.62, // D point shots are lower quality
  reboundChance: 0.07,
  reboundBoost: 1.9,
  freezeChance: 0.36,
  missStoppage: 0.15,
  randomStoppagesPer60: 18,
  penaltiesPer60: 3.35, // minors per team
  hitsPer60: 21,
  fightsPerGame: 0.15,
  homeIce: 1.1,
  scoreEffect: 0.12, // attempt-rate swing per goal of deficit, 3rd period
  backupStartChance: 0.12,
  /** Chance the backup starts when the team played yesterday. */
  backupStartBackToBack: 0.6,
  fatigue: {
    /** Energy lost per second on ice for an average-endurance skater. */
    drainPerSec: 0.5,
    recoverPerSec: 0.2,
    /** Below this energy, ratings start to suffer. */
    threshold: 80,
    /** Rating points lost per energy point below the threshold. */
    penaltyPerPoint: 0.15,
    intermissionRecovery: 35,
    /** Starting energy / drain multiplier on the second night of a back-to-back. */
    backToBackStart: 92,
    backToBackDrain: 1.1,
  },
  injuries: {
    skatersPerTeamGame: 0.32,
    goaliesPerTeamGame: 0.012,
    severityWeights: [0.36, 0.33, 0.19, 0.08, 0.04],
  },
  pullGoalie: { down1: 170, down2: 240 },
  formSd: { skater: 3, goalie: 4.5 },
  forwardShare: [0.285, 0.275, 0.245, 0.195],
  defenseShare: [0.37, 0.34, 0.29],
};

const INFRACTIONS = [
  ['Tripping', 16],
  ['Hooking', 14],
  ['Slashing', 11],
  ['Holding', 10],
  ['Interference', 11],
  ['Roughing', 9],
  ['High-sticking', 10],
  ['Cross-checking', 7],
  ['Delay of game', 5],
  ['Too many men', 2],
  ['Holding the stick', 3],
  ['Unsportsmanlike conduct', 2],
] as const;

/** Per-game effective ratings, including that night's form. */
interface GP {
  id: PlayerId;
  pos: string;
  off: number;
  def: number;
  shoot: number;
  pass: number;
  support: number;
  check: number;
  disc: number;
  fo: number;
  block: number;
  gq: number;
  endurance: number;
  prone: number;
  energy: number;
  lastT: number;
  on: boolean;
  drainMult: number;
  roles: Record<Role, number>;
  /** Rating adjustments while on the ice this shift (slot fit, chemistry, system fit). */
  oB: number;
  dB: number;
  /** This player's box-score line (skaters). */
  st?: SkaterGameLine;
  /** Trait effects (see traits.ts); absent for players without any. */
  tb?: TraitBoosts;
}

/** What a player's traits do in a game (all zero/one for none). */
interface TraitBoosts {
  /** Shooting points added to his shots on goal. */
  snipe: number;
  /** Extra shooting points on the power play. */
  pp: number;
  /** Extra shooting points late in close games and in overtime. */
  clutch: number;
  /** Multiplier on his shots being blocked or missing the net. */
  miss: number;
  /** Rebound finishing and pursuit. */
  reb: number;
  /** Weight when an assist is handed out. */
  assist: number;
  /** Weight when a hit or a fight is handed out. */
  hit: number;
  fight: number;
  /** Penalty-kill defense points. */
  pk: number;
  /** Leadership: points added to everyone on the ice with him. */
  lead: number;
  /** Shootout scoring chance (skaters), or stopping chance (goalies). */
  so: number;
  /** Goalies: extra quality in big moments; rebound multiplier. */
  big: number;
  rebCtl: number;
}

function traitBoosts(p: Parameters<typeof tierOf>[0]): TraitBoosts | undefined {
  if (!p.traits) return undefined;
  const t = (id: Parameters<typeof tierOf>[1]) => tierOf(p, id);
  return {
    snipe: 0.4 * t('sniper'),
    pp: 0.5 * t('ppSpecialist'),
    clutch: 1.0 * t('clutch'),
    miss: 1 - 0.035 * t('dangler'),
    reb: t('netFront'),
    assist: 1 + 0.06 * t('playmaker'),
    hit: 1 + 0.35 * t('enforcer'),
    fight: 1 + 0.8 * t('enforcer'),
    pk: 1.5 * t('pkSpecialist'),
    lead: 0.3 * t('leader'),
    so: 0.03 * t('shootoutArtist') + 0.02 * t('reboundControl'),
    big: 1.0 * t('bigGame'),
    rebCtl: 1 - 0.12 * t('reboundControl'),
  };
}

interface Side {
  key: 'home' | 'away';
  team: Team;
  /** The team's lines with every special unit filled in. */
  lines: Lines;
  tactics: Tactics;
  /** Effect of the current on-ice unit's system fit. */
  sys: SystemEffect;
  /** Slot each on-ice skater is playing (special teams), for shot selection. */
  slotOf: Map<PlayerId, Slot>;
  goalie: PlayerId;
  backup: PlayerId;
  goalieIn: boolean;
  goaliePulled: boolean;
  box: { id: PlayerId; left: number; double: boolean }[];
  fIdx: number;
  dIdx: number;
  fLeft: number;
  dLeft: number;
  fTime: number[];
  dTime: number[];
  esTime: number;
  ppClock: number; // seconds into current PP/PK
  onIce: GP[];
  off: number;
  def: number;
  support: number;
  block: number;
  line: TeamGameLine;
  goalieStartGoals: number;
  /** Players knocked out of this game by injury. */
  out: Set<PlayerId>;
  /** Every dressed skater (for substitutions). */
  dressed: PlayerId[];
}

export interface GameContext {
  playoff?: boolean;
  homeBackToBack?: boolean;
  awayBackToBack?: boolean;
  /** Record a play-by-play here (for simcasts). Recording never changes the result. */
  pbp?: PlayEvent[];
}

const SEVERITIES: InjurySeverity[] = ['day-to-day', 'short-term', 'medium-term', 'long-term', 'season-ending'];
const INJURY_DAYS: Record<InjurySeverity, [number, number]> = {
  'day-to-day': [1, 4],
  'short-term': [5, 20],
  'medium-term': [21, 45],
  'long-term': [46, 100],
  'season-ending': [120, 220],
};
const INJURY_TYPES: Record<InjurySeverity, string[]> = {
  'day-to-day': ['Upper-body', 'Lower-body', 'Illness', 'Bruised foot'],
  'short-term': ['Upper-body', 'Lower-body', 'Groin strain', 'Ankle sprain', 'Hand'],
  'medium-term': ['Upper-body', 'Lower-body', 'Concussion', 'Shoulder', 'Knee sprain', 'Broken finger'],
  'long-term': ['Broken foot', 'Knee', 'Shoulder separation', 'Broken wrist', 'Concussion'],
  'season-ending': ['Torn ACL', 'Shoulder surgery', 'Achilles tear', 'Hip surgery'],
};

export function sampleInjury(rng: Rng): { type: string; severity: InjurySeverity; days: number } {
  const severity = SEVERITIES[rng.weighted(TUNING.injuries.severityWeights)];
  const [lo, hi] = INJURY_DAYS[severity];
  return { severity, days: rng.int(lo, hi), type: rng.pick(INJURY_TYPES[severity]) };
}

const newSkaterLine = (): SkaterGameLine => ({
  g: 0, a: 0, pm: 0, pim: 0, sog: 0, att: 0, ppg: 0, ppa: 0, shg: 0, hits: 0, blk: 0, fow: 0, fol: 0, toi: 0,
});
const newTeamLine = (): TeamGameLine => ({
  goals: 0, shots: 0, attempts: 0, hits: 0, blocks: 0, pim: 0, ppGoals: 0, ppOpps: 0, fow: 0, periodGoals: [0, 0, 0],
});

function weightedPick<T>(rng: Rng, items: T[], w: (t: T) => number): T {
  return items[rng.weighted(items.map(w))];
}

export function simulateGame(
  league: League,
  homeTeam: Team,
  awayTeam: Team,
  seed: number,
  ctx: GameContext = {},
): GameSummary {
  const rng = new Rng(seed);
  const playoff = !!ctx.playoff;
  const T = TUNING;
  // Commissioner sliders (all 1 by default, which leaves every number untouched).
  const K = {
    injuries: slider(league, 'injuryRate'),
    injuryLength: slider(league, 'injuryLength'),
    scoring: slider(league, 'scoring'),
    penalties: slider(league, 'penalties'),
    fights: slider(league, 'fights'),
    random: slider(league, 'randomness'),
  };
  const homeIce = slider(league, 'homeIce') === 1 ? T.homeIce : 1 + (T.homeIce - 1) * slider(league, 'homeIce');
  const skaters: Record<PlayerId, SkaterGameLine> = {};
  const goalies: Record<PlayerId, GoalieGameLine> = {};
  const gp: Record<PlayerId, GP> = {};

  // ---- Build per-game player views (with nightly form) ----
  const prepare = (team: Team, backToBack: boolean) => {
    const L = team.lines;
    const startEnergy = backToBack ? T.fatigue.backToBackStart : 100;
    const drainMult = backToBack ? T.fatigue.backToBackDrain : 1;
    for (const id of [...L.forwards.flat(), ...L.defense.flat()]) {
      const p = league.players[id];
      const s = p.skater!;
      const form = rng.normal(0, T.formSd.skater * (1.4 - p.hidden.consistency) * K.random);
      const tb = traitBoosts(p);
      const tr = (id: Parameters<typeof tierOf>[1]) => (tb ? tierOf(p, id) : 0);
      gp[id] = {
        id,
        pos: p.pos,
        off: offensiveDrive(s) + form + 0.25 * tr('speedster'),
        def: defensiveDrive(s) + form + 0.5 * tr('shutdown'),
        shoot: s.shooting + form,
        pass: s.passing + form,
        support: (s.passing + s.offIQ) / 2 + form + 0.35 * tr('playmaker'),
        check: s.checking,
        disc: s.discipline,
        fo: s.faceoffs + form + 1.2 * tr('faceoffAce'),
        block: 0.5 * s.defIQ + 0.5 * s.checking + 1.2 * tr('shotBlocker'),
        gq: 0,
        endurance: s.endurance,
        prone: p.hidden.injuryProneness * (1 - 0.15 * tr('ironMan')),
        energy: startEnergy,
        lastT: 0,
        on: false,
        drainMult: drainMult * (1 - 0.06 * tr('ironMan')),
        roles: roleSkills(p),
        oB: 0,
        dB: 0,
        tb,
      };
      skaters[id] = newSkaterLine();
      gp[id].st = skaters[id];
    }
    for (const id of L.goalies) {
      const p = league.players[id];
      const form = rng.normal(0, T.formSd.goalie * (1.4 - p.hidden.consistency) * K.random);
      gp[id] = {
        id, pos: 'G', off: 0, def: 0, shoot: 0, pass: 0, support: 0, check: 0, disc: 0, fo: 0, block: 0,
        gq: goalieQuality(p.goalie!) + form - (backToBack ? 1.5 : 0) + 0.6 * tierOf(p, 'brickWall'),
        endurance: 100, prone: p.hidden.injuryProneness, energy: 100, lastT: 0, on: false, drainMult: 1,
        roles: {} as Record<Role, number>,
        oB: 0,
        dB: 0,
        tb: traitBoosts(p),
      };
    }
  };
  prepare(homeTeam, !!ctx.homeBackToBack);
  prepare(awayTeam, !!ctx.awayBackToBack);

  const makeSide = (key: 'home' | 'away', team: Team, backToBack: boolean): Side => {
    const backupStarts = !playoff && rng.chance(backToBack ? T.backupStartBackToBack : T.backupStartChance);
    const [g1, g2] = team.lines.goalies;
    const goalie = backupStarts ? g2 : g1;
    const backup = backupStarts ? g1 : g2;
    goalies[goalie] = { sa: 0, ga: 0, toi: 0, decision: null };
    const tactics = team.tactics ?? DEFAULT_TACTICS;
    const dressed = [...team.lines.forwards.flat(), ...team.lines.defense.flat()].map((id) => league.players[id]);
    const lines = completeLines(team.lines, dressed, tactics);
    return {
      key, team, lines, tactics, sys: NEUTRAL, slotOf: new Map(), goalie, backup, goalieIn: true, goaliePulled: false, box: [],
      fIdx: 0, dIdx: 0, fLeft: 45, dLeft: 50, fTime: [0, 0, 0, 0], dTime: [0, 0, 0], esTime: 0, ppClock: 0,
      onIce: [], off: 0, def: 0, support: 0, block: 0, line: newTeamLine(), goalieStartGoals: 0,
      out: new Set(),
      dressed: [...lines.forwards.flat(), ...lines.defense.flat()],
    };
  };
  const home = makeSide('home', homeTeam, !!ctx.homeBackToBack);
  const away = makeSide('away', awayTeam, !!ctx.awayBackToBack);
  const other = (s: Side) => (s === home ? away : home);
  const sides = [home, away] as const;
  // Line chemistry doesn't change during a game.
  const chemCache = new Map<string, number>();
  const chemOf = (s: Side, ids: PlayerId[], defense: boolean) => {
    const k = s.key + ids.join('|');
    let v = chemCache.get(k);
    if (v === undefined) {
      v = unitChemistry(s.team, ids.map((id) => league.players[id]), defense).total;
      chemCache.set(k, v);
    }
    return v;
  };

  const goals: GoalEvent[] = [];
  const penalties: PenaltyEvent[] = [];
  const injuries: InjuryEvent[] = [];
  let period = 1;
  let clock = 0; // seconds into period
  let gameT = 0; // seconds since opening faceoff
  let overtime = false;
  /** Regular-season OT is 3v3; playoff OT is full-strength sudden death. */
  let threeOnThree = false;

  // ---- Play-by-play (simcasts): its own random stream, so the game plays out exactly the same ----
  const rec = ctx.pbp;
  const locRng = rec ? new Rng(deriveSeed(seed, 'pbp')) : null;
  const ev = (e: Omit<PlayEvent, 't' | 'period' | 'clock' | 'homeScore' | 'awayScore' | 'homeShots' | 'awayShots'>) => {
    if (!rec) return;
    rec.push({
      t: gameT,
      period,
      clock,
      homeScore: home.line.goals,
      awayScore: away.line.goals,
      homeShots: home.line.shots,
      awayShots: away.line.shots,
      ...e,
    });
  };
  /** Where a shot came from: defensemen from the point, rebounds from the crease, the rest mostly from the slot. */
  const shotSpot = (s: Side, shooter: GP, kind: 'rebound' | 'shot' | 'goal' | 'empty') => {
    const r = locRng!;
    let dist: number;
    let spread: number;
    if (kind === 'empty') {
      dist = 25 + r.next() * 90;
      spread = 0.5;
    } else if (kind === 'rebound') {
      dist = 4 + r.next() * 10;
      spread = 0.9;
    } else if (shooter.pos === 'D' && r.chance(0.8)) {
      dist = 42 + r.next() * 20;
      spread = 0.75;
    } else {
      dist = 8 + Math.pow(r.next(), 1.4) * (kind === 'goal' ? 30 : 45);
      spread = 1.05;
    }
    const a = (r.next() * 2 - 1) * spread;
    let x = 89 - dist * Math.cos(a);
    let y = dist * Math.sin(a);
    y = clamp(y, -38, 38);
    x = clamp(x, -95, 86);
    // Teams change ends every period: home attacks the right-hand net in periods 1, 3 and 5.
    const right = (s === home) === (period % 2 === 1);
    return { x: Math.round((right ? x : -x) * 10) / 10, y: Math.round((right ? y : -y) * 10) / 10 };
  };

  // ---- Fatigue: energy is updated lazily whenever a player's on-ice status is touched ----
  const touch = (p: GP) => {
    const dt = gameT - p.lastT;
    if (dt > 0) {
      if (p.on) p.energy -= T.fatigue.drainPerSec * (1.5 - p.endurance / 100) * p.drainMult * dt;
      else p.energy += T.fatigue.recoverPerSec * dt;
      p.energy = clamp(p.energy, 0, 100);
      p.lastT = gameT;
    }
  };
  const fat = (p: GP) => {
    touch(p);
    return Math.max(0, T.fatigue.threshold - p.energy) * T.fatigue.penaltyPerPoint;
  };

  // ---- Strength & on-ice composition ----
  const skaterCount = (s: Side): number => {
    const o = other(s);
    let n = threeOnThree ? 3 + Math.min(2, o.box.length) : 5 - Math.min(2, s.box.length);
    if (threeOnThree && s.box.length > 0) n = 3;
    if (s.goaliePulled) n += 1;
    return n;
  };
  const baseCount = (s: Side) => skaterCount(s) - (s.goaliePulled ? 1 : 0);

  const situation = (s: Side): 'EV' | 'PP' | 'SH' => {
    const mine = baseCount(s);
    const theirs = baseCount(other(s));
    if (mine > theirs) return 'PP';
    if (mine < theirs) return 'SH';
    return 'EV';
  };

  const pickEsLine = (times: number[], shares: number[], current: number, total: number) => {
    let best = -1;
    let bestDef = -Infinity;
    for (let i = 0; i < times.length; i++) {
      if (i === current) continue;
      const deficit = shares[i] * (total + 60) - times[i];
      if (deficit > bestDef) {
        bestDef = deficit;
        best = i;
      }
    }
    return best;
  };

  type UnitEff = { sys: SystemEffect; oB: number[]; dB: number[]; slotOf: Map<PlayerId, Slot> };
  const unitCache = new Map<string, UnitEff>();
  /** Effects of units exactly as listed in the lines, keyed by the lines' own arrays. */
  const listedCache = new Map<PlayerId[], Map<string, UnitEff>>();
  /** A forward line plus a defense pair, built once per game so it can key the cache. */
  const evUnits = new Map<Side, PlayerId[][]>();
  const evUnit = (s: Side, f: number, d: number) => {
    let m = evUnits.get(s);
    if (!m) evUnits.set(s, (m = []));
    const k = f * 8 + d;
    return (m[k] ??= [...s.lines.forwards[f], ...s.lines.defense[d]]);
  };
  const distinct = (ids: PlayerId[]) => {
    for (let i = 1; i < ids.length; i++) for (let j = 0; j < i; j++) if (ids[i] === ids[j]) return false;
    return true;
  };
  const makeEff = (s: Side, sit: 'EV' | 'PP' | 'SH', base: number, chosen: PlayerId[], slots: Slot[] | null): UnitEff => {
    const slotOf = new Map<PlayerId, Slot>();
    if (slots) chosen.forEach((id, i) => slots[i] && slotOf.set(id, slots[i]));
    return { ...unitEffect(s, sit, base, chosen, slots), slotOf };
  };
  const unitEffect = (s: Side, sit: 'EV' | 'PP' | 'SH', base: number, chosen: PlayerId[], slots: Slot[] | null) => {
    const L = s.lines;
    const unit = chosen.map((id) => gp[id]);
    const avgOf = (xs: GP[], r: Role) => xs.reduce((a, p) => a + p.roles[r], 0) / Math.max(1, xs.length);
    const fwdU = unit.filter((p) => p.pos !== 'D');
    const dU = unit.filter((p) => p.pos === 'D');
    let sys: SystemEffect;
    if (sit === 'PP') {
      const fit = chosen.reduce((sum, id, i) => sum + (slots?.[i] ? gp[id].roles[slots[i].role] : 60), 0) / chosen.length;
      const rel = base >= 5 ? relativeFit(powerPlayFitsOf(unit.map((p) => p.roles)), s.tactics.pp) : undefined;
      sys = powerPlayEffect(s.tactics.pp, fit, rel);
    } else if (sit === 'SH') {
      const fit = chosen.reduce((sum, id, i) => sum + (slots?.[i] ? gp[id].roles[slots[i].role] : 60), 0) / chosen.length;
      const rel = relativeFit(penaltyKillFits((r) => avgOf(r === 'pkDefense' ? (dU.length ? dU : unit) : fwdU.length ? fwdU : unit, r)), s.tactics.pk);
      sys = penaltyKillEffect(s.tactics.pk, fit, other(s).tactics.pp, rel);
    } else {
      const avg = (r: Role) => {
        const pool = r === 'point' ? dU : fwdU;
        return avgOf(pool.length ? pool : unit, r);
      };
      sys = combine(evenStrengthEffect(s.tactics, avg), NEUTRAL);
    }
    const oB = unit.map(() => sys.offAdj);
    const dB = unit.map(() => sys.defAdj);
    if (slots) {
      const which = sit === 'PP' ? 'pp' : sit === 'SH' ? 'pk' : 'ev';
      chosen.forEach((id, i) => {
        const slot = slots[i];
        if (!slot) return;
        const b = slotBonusOf(gp[id].roles, slot, which);
        if (sit === 'SH') dB[i] += b;
        else oB[i] += b;
      });
    }
    // Traits: penalty killers dig in short-handed; a leader lifts everyone on the ice with him.
    let lead = 0;
    unit.forEach((p, i) => {
      if (!p.tb) return;
      if (sit === 'SH') dB[i] += p.tb.pk;
      lead = Math.max(lead, p.tb.lead);
    });
    if (lead) for (let i = 0; i < unit.length; i++) {
      oB[i] += lead;
      dB[i] += lead;
    }
    if (!slots && sit === 'EV' && base >= 5 && !s.goaliePulled) {
      for (const [ids, defense] of [
        [L.forwards[s.fIdx], false],
        [L.defense[s.dIdx], true],
      ] as const) {
        if (!ids.every((id) => chosen.includes(id))) continue;
        const c = chemOf(s, ids, defense);
        for (const id of ids) {
          const i = chosen.indexOf(id);
          oB[i] += c;
          dB[i] += c;
        }
      }
    }
    return { sys, oB, dB };
  };

  const setOnIce = (s: Side) => {
    const L = s.lines;
    const sit = situation(s);
    const base = baseCount(s);
    let ids: PlayerId[];
    let slots: Slot[] | null = null;
    if (sit === 'PP') {
      if (base >= 5) {
        ids = s.ppClock < 70 ? L.pp[0] : L.pp[1];
        slots = PP_FORMATIONS[s.tactics.pp].slots;
      } else {
        ids = L.pp4!;
        slots = PP4_SLOTS;
      }
    } else if (sit === 'SH') {
      if (base >= 4) {
        ids = s.ppClock < 60 ? L.pk[0] : L.pk[1];
        slots = PK_SLOTS;
      } else {
        ids = L.pk3!;
        slots = PK3_SLOTS;
      }
    } else if (base >= 5) {
      ids = s.goaliePulled ? L.extraAttacker!.slice(0, 5) : evUnit(s, s.fIdx, s.dIdx);
      if (s.goaliePulled) slots = EXTRA_ATTACKER_SLOTS.slice(0, 5);
    } else if (base === 4) {
      ids = L.fourOnFour![s.fIdx % 2];
      slots = FOUR_SLOTS;
    } else {
      ids = L.threeOnThree![s.fIdx % 3];
      slots = THREE_SLOTS;
    }
    // Anyone in the box or hurt is replaced by the next available skater of the same kind.
    // (Common case, nobody missing: the unit takes the ice as listed.)
    let chosen: PlayerId[];
    if (!s.goaliePulled && s.box.length === 0 && s.out.size === 0 && distinct(ids)) {
      chosen = ids;
    } else {
      const unavailable = new Set([...s.box.map((b) => b.id), ...s.out]);
      if (s.goaliePulled) {
        const extra = [...L.extraAttacker!, ...L.forwards[0], ...L.forwards[1]].find((id) => !ids.includes(id) && !unavailable.has(id));
        if (extra) ids = [...ids, extra];
      }
      const dressed = s.dressed;
      chosen = [];
      for (const id of ids) {
        if (!unavailable.has(id) && !chosen.includes(id)) {
          chosen.push(id);
          continue;
        }
        const isD = league.players[id].pos === 'D';
        const free = (x: PlayerId) => !unavailable.has(x) && !chosen.includes(x) && !ids.includes(x);
        const sub =
          dressed.find((x) => free(x) && (league.players[x].pos === 'D') === isD) ??
          dressed.find((x) => free(x)) ??
          dressed.find((x) => !unavailable.has(x) && !chosen.includes(x));
        if (sub) chosen.push(sub);
      }
    }
    for (const p of s.onIce) {
      touch(p);
      p.on = false;
    }
    s.onIce = chosen.map((id) => gp[id]);
    // How well this unit fits the team's systems, its players' spots and its chemistry.
    // A unit's effect is the same every time it takes the ice, so it's computed once per game.
    const small = `${sit}|${base}|${s.goaliePulled ? 1 : 0}|${sit === 'SH' ? other(s).tactics.pp : ''}`;
    let eff: UnitEff | undefined;
    if (chosen === ids) {
      let m = listedCache.get(ids);
      if (!m) listedCache.set(ids, (m = new Map()));
      eff = m.get(small);
      if (!eff) m.set(small, (eff = makeEff(s, sit, base, chosen, slots)));
    } else {
      const ukey = `${s.key}|${small}|${chosen.join(',')}`;
      eff = unitCache.get(ukey);
      if (!eff) unitCache.set(ukey, (eff = makeEff(s, sit, base, chosen, slots)));
    }
    s.slotOf = eff.slotOf;
    s.sys = eff.sys;
    s.onIce.forEach((p, i) => {
      p.oB = eff!.oB[i];
      p.dB = eff!.dB[i];
    });
    let off = 0, def = 0, sup = 0, blk = 0;
    for (const p of s.onIce) {
      touch(p);
      p.on = true;
      const f = fat(p);
      off += p.off + p.oB - f;
      def += p.def + p.dB - f;
      sup += p.support + p.oB - f;
      blk += p.block + p.dB - f;
    }
    const k = s.onIce.length;
    s.off = off / k;
    s.def = def / k;
    s.support = sup / k;
    s.block = blk / k;
  };

  // Shot-attempt rates only change when the units on the ice (or their fatigue),
  // the score, the strength or the goalie change, i.e. whenever the ice is
  // refreshed, so they're computed then rather than every second.
  let homeRate = 0;
  let awayRate = 0;
  const refreshBoth = () => {
    setOnIce(home);
    setOnIce(away);
    homeRate = attemptRate(home);
    awayRate = attemptRate(away);
  };
  /** Same units, updated fatigue (the 15-second re-check when nothing else changed). */
  const refreshFatigue = (s: Side) => {
    let off = 0, def = 0, sup = 0, blk = 0;
    for (const p of s.onIce) {
      touch(p);
      p.on = true;
      const f = fat(p);
      off += p.off + p.oB - f;
      def += p.def + p.dB - f;
      sup += p.support + p.oB - f;
      blk += p.block + p.dB - f;
    }
    const k = s.onIce.length;
    s.off = off / k;
    s.def = def / k;
    s.support = sup / k;
    s.block = blk / k;
  };

  // ---- Faceoffs ----
  const faceoff = () => {
    const hc = home.onIce.reduce((a, b) => (b.fo > a.fo ? b : a));
    const ac = away.onIce.reduce((a, b) => (b.fo > a.fo ? b : a));
    const pHome = clamp(0.5 + (hc.fo - ac.fo) * 0.005, 0.3, 0.7);
    if (rng.chance(pHome)) {
      skaters[hc.id].fow++;
      skaters[ac.id].fol++;
      home.line.fow++;
    } else {
      skaters[ac.id].fow++;
      skaters[hc.id].fol++;
      away.line.fow++;
    }
  };

  const strengthKey = (s: Side) => `${skaterCount(s)}v${skaterCount(other(s))}`;
  const attemptRate = (s: Side): number => {
    const o = other(s);
    const key = strengthKey(s);
    const base = T.attemptsPer60[key] ?? T.attemptsPer60['5v5'];
    let r = (base / 3600) * Math.exp((T.driveEffect * (s.off - o.def)) / 10) * s.sys.att * o.sys.oppAtt;
    if (s === home) r *= homeIce;
    if (period >= 2 && period <= 3) {
      const diff = s.line.goals - o.line.goals;
      const d = clamp(diff, -2, 2);
      r *= 1 - T.scoreEffect * d;
    }
    if (!o.goalieIn) r *= 0.55; // leading team is protecting, not attacking, the empty net
    return r;
  };

  const creditGoal = (s: Side, scorer: GP, rebound: boolean) => {
    const o = other(s);
    const sit = situation(s);
    const strength: Strength = !o.goalieIn ? 'EN' : sit;
    const mates = s.onIce.filter((p) => p.id !== scorer.id);
    const assists: PlayerId[] = [];
    const nA = rng.weighted([0.05, 0.2, 0.75]);
    let pool = [...mates];
    for (let i = 0; i < nA && pool.length; i++) {
      const a = weightedPick(rng, pool, (p) => Math.exp((0.6 * p.pass + 0.4 * p.off - 70) / 12) * (p.pos === 'D' ? 0.8 : 1) * (rebound && i === 0 ? 1.3 : 1) * (p.tb?.assist ?? 1));
      assists.push(a.id);
      pool = pool.filter((p) => p !== a);
    }
    const st = skaters[scorer.id];
    st.g++;
    if (strength === 'PP') st.ppg++;
    if (strength === 'SH') st.shg++;
    for (const a of assists) {
      skaters[a].a++;
      if (strength === 'PP') skaters[a].ppa++;
    }
    if (strength !== 'PP') {
      for (const p of s.onIce) skaters[p.id].pm++;
      for (const p of o.onIce) skaters[p.id].pm--;
    }
    s.line.goals++;
    if (period <= 3) s.line.periodGoals[period - 1]++;
    if (strength === 'PP') {
      s.line.ppGoals++;
      // A power-play goal ends the shortest remaining minor.
      const minor = o.box.filter((b) => !b.double || b.left <= 120).sort((a, b) => a.left - b.left)[0];
      if (minor) {
        if (minor.double && minor.left > 120) minor.left -= 120;
        else o.box = o.box.filter((b) => b !== minor);
      }
    }
    if (o.goalieIn) goalies[o.goalie].ga++;
    goals.push({ period, time: clock, teamId: s.team.id, scorer: scorer.id, assists, strength });
  };

  const goalEvent = (s: Side, scorer: GP, rebound: boolean, spot: { x: number; y: number }) => {
    const g = goals[goals.length - 1];
    ev({ type: 'goal', side: s.key, player: scorer.id, assists: g.assists, strength: g.strength, rebound, ...spot });
  };

  /** Resolve one shot attempt. Returns 'goal' | 'stoppage' | 'rebound' | 'play'. */
  const shotAttempt = (s: Side, rebound: boolean): 'goal' | 'stoppage' | 'rebound' | 'play' => {
    const o = other(s);
    const sit = situation(s);
    // Rebounds go to whoever is at the net; special-teams slots decide who shoots.
    const shooter = rebound
      ? weightedPick(rng, s.onIce.some((p) => p.pos !== 'D') ? s.onIce.filter((p) => p.pos !== 'D') : s.onIce, (p) => Math.exp((p.shoot - 70) / 30) * Math.exp((p.roles.netFront - 70) / 45) * (1 + 0.3 * (p.tb?.reb ?? 0)))
      : weightedPick(
          rng,
          s.onIce,
          (p) => Math.exp((0.6 * p.shoot + 0.4 * p.off - 70) / 36) * (p.pos === 'D' ? 0.62 * s.sys.dShare : 1) * (s.slotOf.get(p.id)?.shoot ?? 1),
        );
    skaters[shooter.id].att++;
    s.line.attempts++;
    const emptyNet = !o.goalieIn;

    // Blocked?
    if (!rebound && !emptyNet) {
      const pBlock = clamp(T.blockBase * Math.exp((0.2 * (o.block - 70)) / 10) * (sit === 'PP' ? 0.9 : 1) * (shooter.tb?.miss ?? 1), 0.1, 0.4);
      if (rng.chance(pBlock)) {
        const blocker = weightedPick(rng, o.onIce, (p) => (p.pos === 'D' ? 1.8 : 1) * Math.exp((p.block - 70) / 15));
        skaters[blocker.id].blk++;
        o.line.blocks++;
        if (rec) ev({ type: 'block', side: s.key, player: shooter.id, other: blocker.id, ...shotSpot(s, shooter, 'shot') });
        return 'play';
      }
    }
    // Missed the net?
    const pMiss = clamp(T.missBase * Math.exp((-0.2 * (shooter.shoot - 70)) / 10) * (emptyNet ? 1.3 : 1) * (shooter.tb?.miss ?? 1), 0.1, 0.5);
    if (rng.chance(pMiss)) {
      if (rec) ev({ type: 'miss', side: s.key, player: shooter.id, rebound, ...shotSpot(s, shooter, emptyNet ? 'empty' : rebound ? 'rebound' : 'shot') });
      return rng.chance(T.missStoppage) ? 'stoppage' : 'play';
    }

    // On goal.
    skaters[shooter.id].sog++;
    s.line.shots++;
    if (emptyNet) {
      if (rng.chance(T.shPct.EN)) {
        creditGoal(s, shooter, false);
        if (rec) goalEvent(s, shooter, false, shotSpot(s, shooter, 'empty'));
        return 'goal';
      }
      if (rec) ev({ type: 'shot', side: s.key, player: shooter.id, ...shotSpot(s, shooter, 'empty'), text: 'wide of the empty net' });
      return 'play';
    }
    goalies[o.goalie].sa++;
    const baseKey = threeOnThree && sit === 'EV' ? 'OT' : sit;
    const mates = s.onIce.filter((p) => p !== shooter);
    const support = mates.length ? mates.reduce((a, p) => a + p.support, 0) / mates.length : shooter.support;
    const g = gp[o.goalie];
    // Traits: a sniper's finish, power-play and clutch shooters, a big-game goalie.
    const close = (period >= 3 || overtime) && Math.abs(s.line.goals - o.line.goals) <= 1;
    const tb = shooter.tb;
    const shotBonus = tb ? tb.snipe + (sit === 'PP' ? tb.pp : 0) + (close ? tb.clutch : 0) : 0;
    const gBonus = g.tb && playoff && close ? g.tb.big : 0;
    let pGoal =
      T.shPct[baseKey] *
      Math.exp((T.shooterEffect * (shooter.shoot + shooter.oB + shotBonus - fat(shooter) - 72)) / 10) *
      Math.exp((T.supportEffect * (support - o.def)) / 10) *
      Math.exp((-T.goalieEffect * (g.gq + gBonus - 76)) / 10);
    if (shooter.pos === 'D') pGoal *= T.defenseShotFactor;
    if (rebound) pGoal *= T.reboundBoost * (1 + 0.06 * (tb?.reb ?? 0));
    pGoal *= s.sys.shq * o.sys.oppShq;
    pGoal *= K.scoring;
    pGoal = clamp(pGoal, 0.01, 0.6);
    if (rng.chance(pGoal)) {
      creditGoal(s, shooter, rebound);
      if (rec) goalEvent(s, shooter, rebound, shotSpot(s, shooter, rebound ? 'rebound' : 'goal'));
      return 'goal';
    }
    const spot = rec ? shotSpot(s, shooter, rebound ? 'rebound' : 'shot') : null;
    if (!rebound && rng.chance(T.reboundChance * s.sys.rebound * (g.tb?.rebCtl ?? 1))) {
      if (rec) ev({ type: 'shot', side: s.key, player: shooter.id, other: o.goalie, rebound, ...spot!, text: 'rebound' });
      return 'rebound';
    }
    const frozen = rng.chance(T.freezeChance);
    if (rec) ev({ type: 'shot', side: s.key, player: shooter.id, other: o.goalie, rebound, ...spot!, text: frozen ? 'covered' : undefined });
    return frozen ? 'stoppage' : 'play';
  };

  const takePenalty = (s: Side) => {
    const offender = weightedPick(rng, s.onIce, (p) => Math.exp(-(p.disc - 72) / 12) * (0.8 + p.check / 250));
    const inf = INFRACTIONS[rng.weighted(INFRACTIONS.map((x) => x[1]))][0];
    const double = inf === 'High-sticking' && rng.chance(0.25);
    const minutes = double ? 4 : 2;
    const o = other(s);
    const hadAdvantage = baseCount(o) > baseCount(s);
    s.box.push({ id: offender.id, left: minutes * 60, double });
    skaters[offender.id].pim += minutes;
    s.line.pim += minutes;
    if (!hadAdvantage) o.line.ppOpps++;
    o.ppClock = 0;
    s.ppClock = 0;
    penalties.push({ period, time: clock, teamId: s.team.id, playerId: offender.id, minutes, infraction: inf });
    if (rec) ev({ type: 'penalty', side: s.key, player: offender.id, text: `${inf}, ${minutes} minutes` });
  };

  /** Fighting majors: offsetting 5-minute penalties, no power play. */
  const fight = () => {
    const pick = (s: Side) => weightedPick(rng, s.onIce, (p) => Math.exp((p.check - 70) / 6) * Math.exp(-(p.disc - 72) / 15) * (p.tb?.fight ?? 1));
    const h = pick(home);
    const a = pick(away);
    for (const [s, p] of [[home, h], [away, a]] as const) {
      skaters[p.id].pim += 5;
      s.line.pim += 5;
      penalties.push({ period, time: clock, teamId: s.team.id, playerId: p.id, minutes: 5, infraction: 'Fighting' });
    }
    if (rec) ev({ type: 'fight', side: 'home', player: h.id, other: a.id, text: 'Fighting, 5 minutes each' });
  };

  const hit = (s: Side) => {
    const h = weightedPick(rng, s.onIce, (p) => Math.exp((p.check - 70) / 10) * (p.tb?.hit ?? 1));
    skaters[h.id].hits++;
    s.line.hits++;
    if (rec) ev({ type: 'hit', side: s.key, player: h.id, other: locRng!.pick(other(s).onIce).id });
  };

  /** A skater (or occasionally a goalie) gets hurt and leaves the game. */
  const injury = (s: Side, goalie: boolean): boolean => {
    let victim: PlayerId;
    if (goalie) {
      if (!s.goalieIn || s.out.has(s.backup) || !goalies[s.goalie]) return false;
      victim = s.goalie;
      s.goalie = s.backup;
      s.backup = victim;
      goalies[s.goalie] ??= { sa: 0, ga: 0, toi: 0, decision: null };
    } else {
      const dressed = [...s.team.lines.forwards.flat(), ...s.team.lines.defense.flat()];
      if (dressed.length - s.out.size <= 14) return false; // keep enough bodies to finish
      victim = weightedPick(rng, s.onIce, (p) => 0.4 + p.prone * 2).id;
    }
    s.out.add(victim);
    const inj = sampleInjury(rng);
    if (K.injuryLength !== 1) inj.days = Math.max(1, Math.round(inj.days * K.injuryLength));
    injuries.push({ period, time: clock, teamId: s.team.id, playerId: victim, type: inj.type, severity: inj.severity, days: inj.days });
    if (rec) ev({ type: 'injury', side: s.key, player: victim, other: goalie ? s.goalie : undefined, text: `${inj.type} injury` });
    return true;
  };

  const updateGoaliePull = (s: Side) => {
    const o = other(s);
    const deficit = o.line.goals - s.line.goals;
    const left = 1200 - clock;
    const shouldPull =
      period === 3 && s.box.length === 0 &&
      ((deficit === 1 && left <= T.pullGoalie.down1) || (deficit === 2 && left <= T.pullGoalie.down2));
    if (shouldPull !== s.goaliePulled) {
      s.goaliePulled = shouldPull;
      s.goalieIn = !shouldPull;
      if (rec) ev({ type: shouldPull ? 'goalie-pulled' : 'goalie-back', side: s.key, player: s.goalie });
      return true;
    }
    return false;
  };

  /** Change shifts on elapsed time; special-teams units rotate by PP clock. */
  const tickShifts = (s: Side): boolean => {
    let changed = false;
    s.fLeft--;
    s.dLeft--;
    const sit = situation(s);
    if (sit === 'EV' && !threeOnThree) {
      s.esTime++;
      s.fTime[s.fIdx]++;
      s.dTime[s.dIdx]++;
    }
    if (s.fLeft <= 0) {
      s.fIdx = pickEsLine(s.fTime, T.forwardShare, s.fIdx, s.esTime);
      s.fLeft = clamp(rng.normal(threeOnThree ? 38 : 44, 8), 22, 75);
      changed = true;
    }
    if (s.dLeft <= 0) {
      s.dIdx = pickEsLine(s.dTime, T.defenseShare, s.dIdx, s.esTime);
      s.dLeft = clamp(rng.normal(threeOnThree ? 42 : 50, 9), 25, 85);
      changed = true;
    }
    if (sit !== 'EV') {
      s.ppClock++;
      if (s.ppClock === 70 || s.ppClock === 60) changed = true;
    }
    return changed;
  };

  const tickBox = (s: Side): boolean => {
    if (!s.box.length) return false;
    const before = s.box.length;
    // Only the first two penalties run concurrently.
    for (let i = 0; i < Math.min(2, s.box.length); i++) s.box[i].left--;
    s.box = s.box.filter((b) => b.left > 0);
    return s.box.length !== before;
  };

  // ---- Main loop ----
  const periodLength = (p: number) => (p <= 3 || playoff ? 1200 : 300);
  let lastWasRebound: Side | null = null;
  const playPeriod = () => {
    clock = 0;
    lastWasRebound = null;
    if (period > 1) {
      for (const p of Object.values(gp)) {
        touch(p);
        p.energy = Math.min(100, p.energy + T.fatigue.intermissionRecovery);
      }
    }
    for (const s of [home, away]) {
      s.fIdx = 0;
      s.dIdx = 0;
      s.fLeft = clamp(rng.normal(44, 8), 25, 70);
      s.dLeft = clamp(rng.normal(50, 9), 25, 80);
    }
    refreshBoth();
    if (rec) ev({ type: 'period-start', side: null });
    faceoff();
    const len = periodLength(period);
    // Event rates that are constant through the period.
    const hP = ((T.penaltiesPer60 * K.penalties) / 3600) * (overtime ? 0.5 : 1);
    const injR = (T.injuries.skatersPerTeamGame * K.injuries) / 3600;
    const gInjR = (T.injuries.goaliesPerTeamGame * K.injuries) / 3600;
    const aP = hP;
    const hitR = T.hitsPer60 / 3600;
    const stopR = T.randomStoppagesPer60 / 3600;
    const fightR = overtime ? 0 : (T.fightsPerGame * K.fights) / 3600;
    const otherR = hP + aP + 2 * hitR + stopR + fightR + 2 * injR + 2 * gInjR;
    while (clock < len) {
      clock++;
      gameT++;
      // Ice time
      for (const s of sides) {
        for (const p of s.onIce) p.st!.toi++;
        if (s.goalieIn) goalies[s.goalie].toi++;
      }
      // A side re-picks its unit when its own line changes, or when either
      // side's strength changes (penalties, pulled goalie); otherwise the same
      // players stay out there and only their fatigue is updated.
      const boxH = tickBox(home);
      const shiftH = tickShifts(home);
      const pullH = updateGoaliePull(home);
      const boxA = tickBox(away);
      const shiftA = tickShifts(away);
      const pullA = updateGoaliePull(away);
      const strength = boxH || pullH || boxA || pullA;
      const fullH = strength || shiftH;
      const fullA = strength || shiftA;
      if (fullH || fullA) {
        if (fullH) setOnIce(home);
        else refreshFatigue(home);
        if (fullA) setOnIce(away);
        else refreshFatigue(away);
        homeRate = attemptRate(home);
        awayRate = attemptRate(away);
      } else if (gameT % 15 === 0) {
        refreshFatigue(home);
        refreshFatigue(away);
        homeRate = attemptRate(home);
        awayRate = attemptRate(away);
      }

      if (lastWasRebound) {
        const s = lastWasRebound;
        lastWasRebound = null;
        const r = shotAttempt(s, true);
        if (r === 'goal') {
          if (overtime) return endPeriod();
          refreshBoth();
          faceoff();
        } else if (r === 'stoppage') faceoff();
        continue;
      }

      // One event per second at most: pick which (if any) happens.
      const hA = homeRate;
      const aA = awayRate;
      const total = hA + aA + otherR;
      let u = rng.next();
      if (u >= total) continue;
      let shooterSide: Side | null = null;
      if (u < hA) shooterSide = home;
      else if (u < hA + aA) shooterSide = away;
      u -= hA + aA;
      if (shooterSide) {
        const s = shooterSide;
        const r = shotAttempt(s, false);
        if (r === 'goal') {
          if (overtime) return endPeriod();
          refreshBoth();
          faceoff();
        } else if (r === 'rebound') lastWasRebound = s;
        else if (r === 'stoppage') faceoff();
      } else if ((u -= hP) < 0) {
        takePenalty(home);
        refreshBoth();
        faceoff();
      } else if ((u -= aP) < 0) {
        takePenalty(away);
        refreshBoth();
        faceoff();
      } else if ((u -= hitR) < 0) hit(home);
      else if ((u -= hitR) < 0) hit(away);
      else if ((u -= fightR) < 0) {
        fight();
        faceoff();
      } else if ((u -= injR) < 0) {
        if (injury(home, false)) refreshBoth();
      } else if ((u -= injR) < 0) {
        if (injury(away, false)) refreshBoth();
      } else if ((u -= gInjR) < 0) {
        injury(home, true);
      } else if ((u -= gInjR) < 0) {
        injury(away, true);
      } else faceoff();
    }
    endPeriod();
  };
  const endPeriod = () => {
    if (rec) ev({ type: 'period-end', side: null });
  };

  for (period = 1; period <= 3; period++) {
    // Pull a struggling starter after two periods.
    if (period === 3) {
      for (const s of [home, away]) {
        const ga = goalies[s.goalie].ga;
        if (!s.out.has(s.backup) && (ga >= 5 || (ga >= 4 && goalies[s.goalie].sa <= 22 && rng.chance(0.5)))) {
          const out = s.goalie;
          s.goalie = s.backup;
          s.backup = out;
          goalies[s.goalie] ??= { sa: 0, ga: 0, toi: 0, decision: null };
          if (rec) ev({ type: 'goalie-change', side: s.key, player: out, other: s.goalie });
        }
      }
    }
    playPeriod();
  }
  period = 3;
  let shootout = false;
  if (home.line.goals === away.line.goals) {
    overtime = true;
    threeOnThree = !playoff;
    for (const s of [home, away]) {
      s.goaliePulled = false;
      s.goalieIn = true;
    }
    // Playoff OT: 20-minute sudden-death periods until someone scores.
    const maxPeriod = playoff ? 13 : 4;
    for (period = 4; period <= maxPeriod && home.line.goals === away.line.goals; period++) playPeriod();
    period = Math.min(period, maxPeriod);
    if (home.line.goals === away.line.goals) {
      shootout = true;
      const winner = runShootout(rng, league, home.lines, away.lines, gp[home.goalie].gq, gp[away.goalie].gq);
      (winner === 'home' ? home : away).line.goals++;
      if (rec) ev({ type: 'shootout', side: winner, text: 'wins the shootout' });
    }
  }
  if (rec) ev({ type: 'final', side: home.line.goals > away.line.goals ? 'home' : 'away' });

  // ---- Decisions, GWG, stars ----
  const homeWon = home.line.goals > away.line.goals;
  const winSide = homeWon ? home : away;
  const loseSide = homeWon ? away : home;
  const mainGoalie = (s: Side) => {
    const ids = s.team.lines.goalies.filter((id) => goalies[id]);
    return ids.reduce((a, b) => (goalies[b].toi > goalies[a].toi ? b : a));
  };
  goalies[mainGoalie(winSide)].decision = 'W';
  goalies[mainGoalie(loseSide)].decision = overtime && !playoff ? 'OTL' : 'L';

  let gwg: PlayerId | null = null;
  if (!shootout) {
    const loserGoals = loseSide.line.goals;
    const winGoals = goals.filter((g) => g.teamId === winSide.team.id);
    gwg = winGoals[loserGoals]?.scorer ?? null;
  }

  const starScore: Array<[PlayerId, number]> = [];
  for (const [id, l] of Object.entries(skaters)) starScore.push([id, l.g * 3 + l.a * 2 + l.sog * 0.15 + l.blk * 0.1 + l.pm * 0.3]);
  for (const [id, l] of Object.entries(goalies)) {
    starScore.push([id, (l.sa - l.ga) * 0.14 - l.ga * 0.6 + (l.decision === 'W' ? 1.5 : 0) + (l.ga === 0 && l.toi > 3000 ? 3 : 0)]);
  }
  starScore.sort((a, b) => b[1] - a[1]);

  const box: BoxScore = {
    home: home.line,
    away: away.line,
    overtime,
    shootout,
    goals,
    penalties,
    injuries,
    rosters: {
      home: [...homeTeam.lines.forwards.flat(), ...homeTeam.lines.defense.flat(), ...homeTeam.lines.goalies],
      away: [...awayTeam.lines.forwards.flat(), ...awayTeam.lines.defense.flat(), ...awayTeam.lines.goalies],
    },
    skaters,
    goalies,
    gwg,
    stars: starScore.slice(0, 3).map((x) => x[0]),
  };
  return { homeScore: home.line.goals, awayScore: away.line.goals, overtime, shootout, box };
}

function runShootout(rng: Rng, league: League, home: Lines, away: Lines, homeGq: number, awayGq: number): 'home' | 'away' {
  // The coach's shootout order first, then everyone else by shootout skill.
  const shooters = (l: Lines) => {
    const rest = [...l.forwards.flat(), ...l.defense.flat()]
      .filter((id) => !l.shootout?.includes(id))
      .map((id) => league.players[id])
      .sort((a, b) => roleSkills(b).shootout - roleSkills(a).shootout);
    return [...(l.shootout ?? []).map((id) => league.players[id]).filter(Boolean), ...rest];
  };
  const hs = shooters(home);
  const as = shooters(away);
  const hg = league.players[home.goalies[0]];
  const ag = league.players[away.goalies[0]];
  const pScore = (id: string, gq: number) => {
    const p = league.players[id];
    const skill = roleSkills(p).shootout;
    // Shootout Artist shooters score more; Rebound Control goalies give up fewer.
    const goalie = home.forwards.flat().includes(id) || home.defense.flat().includes(id) ? ag : hg;
    const bonus = 0.03 * tierOf(p, 'shootoutArtist') - 0.02 * (goalie ? tierOf(goalie, 'reboundControl') : 0);
    return clamp(0.32 + (skill - 78) * 0.008 - (gq - 76) * 0.008 + bonus, 0.12, 0.65);
  };
  let h = 0;
  let a = 0;
  for (let round = 0; round < 3; round++) {
    if (rng.chance(pScore(hs[round].id, awayGq))) h++;
    if (h > a + (3 - round)) return 'home';
    if (rng.chance(pScore(as[round].id, homeGq))) a++;
    if (a > h + (2 - round)) return 'away';
    if (h > a + (2 - round)) return 'home';
  }
  let round = 3;
  while (h === a) {
    const hi = round % hs.length;
    const ai = round % as.length;
    const hScore = rng.chance(pScore(hs[hi].id, awayGq));
    const aScore = rng.chance(pScore(as[ai].id, homeGq));
    if (hScore && !aScore) return 'home';
    if (aScore && !hScore) return 'away';
    round++;
  }
  return h > a ? 'home' : 'away';
}
