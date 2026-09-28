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
import { clamp, Rng } from './rng';
import { defensiveDrive, goalieQuality, offensiveDrive } from './ratings';
import type {
  BoxScore,
  InjuryEvent,
  InjurySeverity,
  GameSummary,
  GoalEvent,
  GoalieGameLine,
  League,
  PenaltyEvent,
  PlayerId,
  SkaterGameLine,
  Strength,
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
  driveEffect: 0.14,
  blockBase: 0.25,
  missBase: 0.34,
  /** Base shooting % on shots on goal, by situation. */
  shPct: { EV: 0.089, PP: 0.118, SH: 0.09, OT: 0.1, EN: 0.92 } as Record<string, number>,
  shooterEffect: 0.16, // per 10 shooting points
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
  forwardShare: [0.3, 0.28, 0.24, 0.18],
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
}

interface Side {
  key: 'home' | 'away';
  team: Team;
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
}

export interface GameContext {
  playoff?: boolean;
  homeBackToBack?: boolean;
  awayBackToBack?: boolean;
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
      const form = rng.normal(0, T.formSd.skater * (1.4 - p.hidden.consistency));
      gp[id] = {
        id,
        pos: p.pos,
        off: offensiveDrive(s) + form,
        def: defensiveDrive(s) + form,
        shoot: s.shooting + form,
        pass: s.passing + form,
        support: (s.passing + s.offIQ) / 2 + form,
        check: s.checking,
        disc: s.discipline,
        fo: s.faceoffs + form,
        block: 0.5 * s.defIQ + 0.5 * s.checking,
        gq: 0,
        endurance: s.endurance,
        prone: p.hidden.injuryProneness,
        energy: startEnergy,
        lastT: 0,
        on: false,
        drainMult,
      };
      skaters[id] = newSkaterLine();
    }
    for (const id of L.goalies) {
      const p = league.players[id];
      const form = rng.normal(0, T.formSd.goalie * (1.4 - p.hidden.consistency));
      gp[id] = {
        id, pos: 'G', off: 0, def: 0, shoot: 0, pass: 0, support: 0, check: 0, disc: 0, fo: 0, block: 0,
        gq: goalieQuality(p.goalie!) + form - (backToBack ? 1.5 : 0),
        endurance: 100, prone: p.hidden.injuryProneness, energy: 100, lastT: 0, on: false, drainMult: 1,
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
    return {
      key, team, goalie, backup, goalieIn: true, goaliePulled: false, box: [],
      fIdx: 0, dIdx: 0, fLeft: 45, dLeft: 50, fTime: [0, 0, 0, 0], dTime: [0, 0, 0], esTime: 0, ppClock: 0,
      onIce: [], off: 0, def: 0, support: 0, block: 0, line: newTeamLine(), goalieStartGoals: 0,
      out: new Set(),
    };
  };
  const home = makeSide('home', homeTeam, !!ctx.homeBackToBack);
  const away = makeSide('away', awayTeam, !!ctx.awayBackToBack);
  const other = (s: Side) => (s === home ? away : home);

  const goals: GoalEvent[] = [];
  const penalties: PenaltyEvent[] = [];
  const injuries: InjuryEvent[] = [];
  let period = 1;
  let clock = 0; // seconds into period
  let gameT = 0; // seconds since opening faceoff
  let overtime = false;
  /** Regular-season OT is 3v3; playoff OT is full-strength sudden death. */
  let threeOnThree = false;

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

  const setOnIce = (s: Side) => {
    const L = s.team.lines;
    const n = skaterCount(s);
    const sit = situation(s);
    let ids: PlayerId[];
    if (sit === 'PP') {
      const unit = s.ppClock < 70 ? L.pp[0] : L.pp[1];
      ids = [unit[0], unit[1], unit[2], unit[4], unit[3]].slice(0, Math.min(5, n));
    } else if (sit === 'SH') {
      const unit = s.ppClock < 60 ? L.pk[0] : L.pk[1];
      ids = n >= 4 ? unit.slice(0, 4) : [unit[0], unit[2], unit[3]];
    } else {
      const f = L.forwards[s.fIdx];
      const d = L.defense[s.dIdx];
      const base = baseCount(s);
      if (base >= 5) ids = [...f, ...d];
      else if (base === 4) ids = [f[1], f[0], ...d];
      else ids = [f[1], f[0], d[0]];
    }
    // Anyone in the box or hurt is replaced by the next available skater of the same kind.
    const unavailable = new Set([...s.box.map((b) => b.id), ...s.out]);
    if (s.goaliePulled) {
      const extra = [...L.forwards[0], ...L.forwards[1]].find((id) => !ids.includes(id) && !unavailable.has(id));
      if (extra) ids = [...ids, extra];
    }
    const dressed = [...L.forwards.flat(), ...L.defense.flat()];
    const chosen: PlayerId[] = [];
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
    for (const p of s.onIce) {
      touch(p);
      p.on = false;
    }
    s.onIce = chosen.map((id) => gp[id]);
    let off = 0, def = 0, sup = 0, blk = 0;
    for (const p of s.onIce) {
      touch(p);
      p.on = true;
      const f = fat(p);
      off += p.off - f;
      def += p.def - f;
      sup += p.support - f;
      blk += p.block - f;
    }
    const k = s.onIce.length;
    s.off = off / k;
    s.def = def / k;
    s.support = sup / k;
    s.block = blk / k;
  };

  const refreshBoth = () => {
    setOnIce(home);
    setOnIce(away);
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
    let r = (base / 3600) * Math.exp((T.driveEffect * (s.off - o.def)) / 10);
    if (s === home) r *= T.homeIce;
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
      const a = weightedPick(rng, pool, (p) => Math.exp((0.6 * p.pass + 0.4 * p.off - 70) / 12) * (p.pos === 'D' ? 0.8 : 1) * (rebound && i === 0 ? 1.3 : 1));
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

  /** Resolve one shot attempt. Returns 'goal' | 'stoppage' | 'rebound' | 'play'. */
  const shotAttempt = (s: Side, rebound: boolean): 'goal' | 'stoppage' | 'rebound' | 'play' => {
    const o = other(s);
    const sit = situation(s);
    const shooter = rebound
      ? weightedPick(rng, s.onIce.filter((p) => p.pos !== 'D'), (p) => Math.exp((p.shoot - 70) / 30))
      : weightedPick(rng, s.onIce, (p) => Math.exp((0.6 * p.shoot + 0.4 * p.off - 70) / 36) * (p.pos === 'D' ? 0.62 : 1));
    skaters[shooter.id].att++;
    s.line.attempts++;
    const emptyNet = !o.goalieIn;

    // Blocked?
    if (!rebound && !emptyNet) {
      const pBlock = clamp(T.blockBase * Math.exp((0.2 * (o.block - 70)) / 10) * (sit === 'PP' ? 0.9 : 1), 0.1, 0.4);
      if (rng.chance(pBlock)) {
        const blocker = weightedPick(rng, o.onIce, (p) => (p.pos === 'D' ? 1.8 : 1) * Math.exp((p.block - 70) / 15));
        skaters[blocker.id].blk++;
        o.line.blocks++;
        return 'play';
      }
    }
    // Missed the net?
    const pMiss = clamp(T.missBase * Math.exp((-0.2 * (shooter.shoot - 70)) / 10) * (emptyNet ? 1.3 : 1), 0.1, 0.5);
    if (rng.chance(pMiss)) return rng.chance(T.missStoppage) ? 'stoppage' : 'play';

    // On goal.
    skaters[shooter.id].sog++;
    s.line.shots++;
    if (emptyNet) {
      if (rng.chance(T.shPct.EN)) {
        creditGoal(s, shooter, false);
        return 'goal';
      }
      return 'play';
    }
    goalies[o.goalie].sa++;
    const baseKey = threeOnThree && sit === 'EV' ? 'OT' : sit;
    const mates = s.onIce.filter((p) => p !== shooter);
    const support = mates.length ? mates.reduce((a, p) => a + p.support, 0) / mates.length : shooter.support;
    const g = gp[o.goalie];
    let pGoal =
      T.shPct[baseKey] *
      Math.exp((T.shooterEffect * (shooter.shoot - fat(shooter) - 72)) / 10) *
      Math.exp((T.supportEffect * (support - o.def)) / 10) *
      Math.exp((-T.goalieEffect * (g.gq - 76)) / 10);
    if (shooter.pos === 'D') pGoal *= T.defenseShotFactor;
    if (rebound) pGoal *= T.reboundBoost;
    pGoal = clamp(pGoal, 0.01, 0.6);
    if (rng.chance(pGoal)) {
      creditGoal(s, shooter, rebound);
      return 'goal';
    }
    if (!rebound && rng.chance(T.reboundChance)) return 'rebound';
    return rng.chance(T.freezeChance) ? 'stoppage' : 'play';
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
  };

  /** Fighting majors: offsetting 5-minute penalties, no power play. */
  const fight = () => {
    const pick = (s: Side) => weightedPick(rng, s.onIce, (p) => Math.exp((p.check - 70) / 6) * Math.exp(-(p.disc - 72) / 15));
    const h = pick(home);
    const a = pick(away);
    for (const [s, p] of [[home, h], [away, a]] as const) {
      skaters[p.id].pim += 5;
      s.line.pim += 5;
      penalties.push({ period, time: clock, teamId: s.team.id, playerId: p.id, minutes: 5, infraction: 'Fighting' });
    }
  };

  const hit = (s: Side) => {
    const h = weightedPick(rng, s.onIce, (p) => Math.exp((p.check - 70) / 10));
    skaters[h.id].hits++;
    s.line.hits++;
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
    injuries.push({ period, time: clock, teamId: s.team.id, playerId: victim, type: inj.type, severity: inj.severity, days: inj.days });
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
    faceoff();
    const len = periodLength(period);
    while (clock < len) {
      clock++;
      gameT++;
      // Ice time
      for (const s of [home, away]) {
        for (const p of s.onIce) skaters[p.id].toi++;
        if (s.goalieIn) goalies[s.goalie].toi++;
      }
      let needRefresh = false;
      for (const s of [home, away]) {
        if (tickBox(s)) needRefresh = true;
        if (tickShifts(s)) needRefresh = true;
        if (updateGoaliePull(s)) needRefresh = true;
      }
      // Re-evaluate on-ice fatigue every 15 seconds so long shifts hurt.
      if (needRefresh || gameT % 15 === 0) refreshBoth();

      if (lastWasRebound) {
        const s = lastWasRebound;
        lastWasRebound = null;
        const r = shotAttempt(s, true);
        if (r === 'goal') {
          if (overtime) return;
          refreshBoth();
          faceoff();
        } else if (r === 'stoppage') faceoff();
        continue;
      }

      // One event per second at most: pick which (if any) happens.
      const hA = attemptRate(home);
      const aA = attemptRate(away);
      const hP = (T.penaltiesPer60 / 3600) * (overtime ? 0.5 : 1);
      const injR = T.injuries.skatersPerTeamGame / 3600;
      const gInjR = T.injuries.goaliesPerTeamGame / 3600;
      const aP = hP;
      const hitR = T.hitsPer60 / 3600;
      const stopR = T.randomStoppagesPer60 / 3600;
      const fightR = overtime ? 0 : T.fightsPerGame / 3600;
      const total = hA + aA + hP + aP + 2 * hitR + stopR + fightR + 2 * injR + 2 * gInjR;
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
          if (overtime) return;
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
      const winner = runShootout(rng, league, home.team, away.team, gp[home.goalie].gq, gp[away.goalie].gq);
      (winner === 'home' ? home : away).line.goals++;
    }
  }

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

function runShootout(rng: Rng, league: League, home: Team, away: Team, homeGq: number, awayGq: number): 'home' | 'away' {
  const shooters = (t: Team) =>
    t.lines.forwards
      .flat()
      .map((id) => league.players[id])
      .sort((a, b) => b.skater!.shooting + b.skater!.handling - (a.skater!.shooting + a.skater!.handling));
  const hs = shooters(home);
  const as = shooters(away);
  const pScore = (id: string, gq: number) => {
    const s = league.players[id].skater!;
    return clamp(0.32 + ((s.shooting + s.handling) / 2 - 78) * 0.008 - (gq - 76) * 0.008, 0.12, 0.6);
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
