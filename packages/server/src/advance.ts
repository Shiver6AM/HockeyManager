/**
 * Moving leagues forward in time.
 *
 * There are three triggers, and all of them go through `advanceLeague`:
 *  - the commissioner presses a button ("commissioner:<userId>"),
 *  - the league's cron schedule fires ("schedule"),
 *  - every human manager readies up in a scheduled league that allows early
 *    advances ("all-ready").
 *
 * Each advance runs in one transaction: lock the league row, simulate,
 * write the new state and box scores, clear ready flags, log it. A per-league
 * in-process lock also keeps two triggers from queueing duplicate work.
 */
import {
  advanceDays,
  ensureLeagueLife,
  newsFromTransactions,
  offseasonStep,
  onTheClock,
  tradeDeadline,
  type AdvanceMode,
  type AdvanceResult,
  type League,
  type ScheduledGame,
} from '@hockey-gm/sim-core';
import { TRPCError } from '@trpc/server';
import { Cron } from 'croner';
import type { Db, Queryable } from './db';
import { deliver, deliverAll, humanTeams, type Notice } from './notify';
import { extractBoxScores, loadForUpdate, saveLeague } from './state';

export type AdvanceTarget = { days: number } | { to: 'playoffs' | 'end-of-season' | 'next-season' | 'trade-deadline' | 'free-agency' };

export interface AdvanceSummary {
  fromDay: number;
  toDay: number;
  games: number;
  phase: string;
  phaseChanges: string[];
}

const running = new Map<string, Promise<unknown>>();

/** Serialize work per league inside this process. */
async function withLeagueLock<T>(leagueId: string, fn: () => Promise<T>): Promise<T> {
  const prev = running.get(leagueId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  running.set(leagueId, next);
  try {
    return await next;
  } finally {
    if (running.get(leagueId) === next) running.delete(leagueId);
  }
}

/** Thrown by changes attempted while the league is simming. */
export class SimBusyError extends TRPCError {
  constructor() {
    super({ code: 'CONFLICT', message: 'The league is simming right now. Try again when it finishes.' });
  }
}

export interface SimJob {
  id: string;
  leagueId: string;
  target: AdvanceTarget;
  label: string;
  triggeredBy: string;
  startedBy: string | null;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'done' | 'cancelled' | 'failed';
  error: string | null;
  cancel: boolean;
  /** Where the sim is now. */
  season: number;
  day: number;
  phase: string;
  stage: string | null;
  /** Days (or offseason steps) done, and roughly how many the target needs. */
  done: number;
  total: number;
  games: number;
  fromDay: number;
  toDay: number;
  phaseChanges: string[];
}

const jobs = new Map<string, SimJob>();
let jobCounter = 0;

/** The league's current (or most recent) sim job. */
export function simJob(leagueId: string): SimJob | null {
  return jobs.get(leagueId) ?? null;
}
export function isSimming(leagueId: string): boolean {
  return jobs.get(leagueId)?.status === 'running';
}
export function cancelSim(leagueId: string): boolean {
  const j = jobs.get(leagueId);
  if (!j || j.status !== 'running') return false;
  j.cancel = true;
  return true;
}

function targetLabel(t: AdvanceTarget, offseason: boolean): string {
  if ('days' in t) return offseason ? (t.days === 1 ? 'next step' : `${t.days} steps`) : t.days === 1 ? '1 day' : `${t.days} days`;
  return { playoffs: 'the playoffs', 'end-of-season': 'the end of the season', 'next-season': 'next season', 'trade-deadline': 'the trade deadline', 'free-agency': 'free agency' }[t.to];
}

function estimateTotal(L: League, t: AdvanceTarget, triggeredBy: string): number {
  const last = L.schedule.reduce((m, g) => Math.max(m, g.day), 0);
  const left = L.phase === 'regular-season' ? Math.max(0, last - L.day + 1) : 0;
  const playoffs = L.phase === 'offseason' ? 0 : L.phase === 'playoffs' ? 40 : 60;
  if ('days' in t) return L.phase === 'offseason' && !triggeredBy.startsWith('commissioner') ? 1 : t.days;
  switch (t.to) {
    case 'playoffs':
      return left;
    case 'trade-deadline':
      return Math.max(1, tradeDeadline(L) - L.day);
    case 'end-of-season':
      return left + playoffs;
    case 'free-agency':
      return 9;
    case 'next-season':
      return left + playoffs + 16;
  }
}

/** Has the job reached its target? */
function reached(L: League, t: AdvanceTarget, j: SimJob, triggeredBy: string, startPhase: string): boolean {
  if ('days' in t) {
    const n = startPhase === 'offseason' && !triggeredBy.startsWith('commissioner') ? 1 : t.days;
    // Days never carry over into the offseason.
    return j.done >= n || (startPhase !== 'offseason' && L.phase === 'offseason') || (startPhase === 'offseason' && L.phase !== 'offseason');
  }
  switch (t.to) {
    case 'playoffs':
      return L.phase !== 'regular-season';
    case 'trade-deadline':
      return L.phase !== 'regular-season' || L.day >= tradeDeadline(L);
    case 'end-of-season':
      return L.phase === 'offseason';
    case 'free-agency':
      return L.phase !== 'offseason' || (!!L.offseason && !['fantasy-draft', 'draft', 're-sign'].includes(L.offseason.stage));
    case 'next-season':
      return startPhase === 'offseason' ? L.phase === 'regular-season' : j.phaseChanges.includes('offseason') && L.phase === 'regular-season';
  }
}

function checkTarget(L: League, t: AdvanceTarget) {
  if (L.phase === 'offseason') {
    if ('to' in t && t.to !== 'next-season' && t.to !== 'free-agency') throw new Error('The season is over. Advance through the offseason instead.');
    if ('to' in t && t.to === 'free-agency' && L.offseason && !['fantasy-draft', 'draft', 're-sign'].includes(L.offseason.stage)) throw new Error('Free agency is already open');
    return;
  }
  if ('to' in t && t.to === 'free-agency') throw new Error('Free agency opens in the offseason');
  if ('to' in t && t.to === 'trade-deadline') {
    if (L.phase !== 'regular-season') throw new Error('The trade deadline is during the regular season');
    const d = tradeDeadline(L);
    if (L.day >= d) throw new Error(L.day === d ? 'It is already deadline day' : 'The trade deadline has passed');
  }
}

/**
 * Start advancing a league in the background. The sim runs one day (or one
 * offseason step) at a time, yielding to the server in between so it never
 * hangs, saving progress every couple of seconds, and stopping early if
 * cancelled. Everyone in the league sees the job's progress.
 */
export async function startAdvance(
  db: Db,
  leagueId: string,
  target: AdvanceTarget,
  triggeredBy: string,
  opts: { startedBy?: string | null; onDone?: (j: SimJob) => void } = {},
): Promise<{ job: SimJob; finished: Promise<SimJob> }> {
  if (isSimming(leagueId)) throw new Error('The league is already simming');
  const first = await db.tx(async (q) => loadForUpdate(q, leagueId));
  const L = first.league;
  ensureLeagueLife(L);
  checkTarget(L, target);
  const job: SimJob = {
    id: `sim${++jobCounter}`,
    leagueId,
    target,
    label: targetLabel(target, L.phase === 'offseason'),
    triggeredBy,
    startedBy: opts.startedBy ?? null,
    startedAt: Date.now(),
    finishedAt: null,
    status: 'running',
    error: null,
    cancel: false,
    season: L.season,
    day: L.day,
    phase: L.phase,
    stage: L.offseason?.stage ?? null,
    done: 0,
    total: Math.max(1, estimateTotal(L, target, triggeredBy)),
    games: 0,
    fromDay: L.day,
    toDay: L.day,
    phaseChanges: [],
  };
  jobs.set(leagueId, job);
  const finished = runJob(db, job, L, first.version, triggeredBy).then(
    () => job,
    (e) => {
      job.status = 'failed';
      job.error = (e as Error).message;
      job.finishedAt = Date.now();
      return job;
    },
  );
  void finished.then((j) => opts.onDone?.(j));
  return { job, finished };
}

/** Progress is shown from memory; the league is saved at phase changes and every few seconds. */
const SAVE_EVERY_MS = 6000;
const yieldToServer = () => new Promise<void>((r) => setImmediate(r));

async function runJob(db: Db, job: SimJob, L: League, version: number, triggeredBy: string) {
  const startPhase = L.phase;
  const before = snapshotForNotices(L);
  const all: AdvanceResult = { fromDay: L.day, toDay: L.day, games: [], phaseChanges: [] };
  let pending: ScheduledGame[] = [];
  let lastSave = Date.now();
  const persist = async (final: boolean) => {
    await withLeagueLock(job.leagueId, () =>
      db.tx(async (q) => {
        await extractBoxScores(q, L, pending);
        pending = [];
        version = await saveLeague(q, job.leagueId, L, version);
        if (final) {
          const notices = advanceNotices(L, before, all);
          await q.query('update league_members set ready = false where league_id = $1', [job.leagueId]);
          await deliver(q, job.leagueId, notices.team);
          for (const text of notices.all) await deliverAll(q, job.leagueId, 'offseason', text, '/');
          await q.query(
            'insert into advance_log (league_id, triggered_by, from_day, to_day, games, phase_changes) values ($1, $2, $3, $4, $5, $6)',
            [job.leagueId, triggeredBy, all.fromDay, all.toDay, all.games.length, JSON.stringify(all.phaseChanges)],
          );
        }
      }),
    );
    lastSave = Date.now();
  };
  try {
    while (!reached(L, job.target, job, triggeredBy, startPhase) && !job.cancel) {
      const seasonBefore = L.season;
      const phaseBefore = L.phase;
      if (L.phase === 'offseason') {
        const step = offseasonStep(L, { force: true });
        all.phaseChanges.push(step.to as never);
      } else {
        const r = advanceDays(L, 1);
        all.games.push(...r.games);
        pending.push(...r.games);
        all.phaseChanges.push(...r.phaseChanges);
        job.games += r.games.length;
      }
      job.done++;
      job.day = L.day;
      job.season = L.season;
      job.phase = L.phase;
      job.stage = L.offseason?.stage ?? null;
      job.phaseChanges = all.phaseChanges as string[];
      if (job.done >= job.total) job.total = job.done + 1;
      // Save at phase changes (box scores are filed under the season they were played in) and every few seconds.
      if (L.phase !== phaseBefore || L.season !== seasonBefore || Date.now() - lastSave > SAVE_EVERY_MS) await persist(false);
      await yieldToServer();
    }
    newsFromTransactions(L);
    all.toDay = L.day;
    job.toDay = L.day;
    await persist(true);
    job.status = job.cancel ? 'cancelled' : 'done';
  } finally {
    job.finishedAt = Date.now();
  }
}

/** Advance and wait for it to finish (scheduled ticks, ready-ups, tests). */
export async function advanceLeague(db: Db, leagueId: string, target: AdvanceTarget, triggeredBy: string): Promise<AdvanceSummary> {
  const { finished } = await startAdvance(db, leagueId, target, triggeredBy);
  const j = await finished;
  if (j.status === 'failed') throw new Error(j.error ?? 'The sim failed');
  return summaryOf(j);
}

export function summaryOf(j: SimJob): AdvanceSummary {
  return { fromDay: j.fromDay, toDay: j.toDay, games: j.games, phase: j.phase, phaseChanges: j.phaseChanges };
}

/**
 * Apply a small change to the league document (claim a team, edit lines,
 * change settings) under the same lock and transaction discipline as advances.
 */
// ---------------------------------------------------------------------------
// Notifications produced by an advance
// ---------------------------------------------------------------------------

interface Before {
  clock: string | null;
  faLog: number;
  bids: Record<string, string[]>;
  tx: number;
  pendingSheets: Set<string>;
  /** Answer count per player, to spot new answers to offers. */
  answers: Record<string, string>;
}

function snapshotForNotices(L: League): Before {
  const pick = onTheClock(L);
  const bids: Record<string, string[]> = {};
  for (const [teamId, b] of Object.entries(L.offseason?.bids ?? {})) {
    if (L.teams[teamId]?.controller.kind === 'human') bids[teamId] = Object.keys(b);
  }
  const pendingSheets = new Set(Object.entries(L.offseason?.rfa ?? {}).filter(([, c]) => c.status === 'unsigned' && c.sheet).map(([id]) => id));
  const answers = Object.fromEntries(Object.entries(L.offseason?.responses ?? {}).map(([id, r]) => [id, `${r.day}:${r.result}`]));
  return { clock: pick ? `${pick.overall}:${pick.teamId}` : null, faLog: L.offseason?.faLog?.length ?? 0, bids, tx: L.transactions.length, pendingSheets, answers };
}

const STAGE_TEXT: Record<string, string> = {
  playoffs: 'The regular season is over. The playoffs are set!',
  offseason: 'The season is over. Check the final standings and awards before the offseason begins.',
  draft: 'The offseason has begun: players developed over the summer, and the entry draft is open.',
  're-sign': 'The draft is complete. The re-signing window is open: decide on your expiring players.',
  'training-camp': 'Free agency is over. Training camp is open: promote prospects and trim to 23.',
  'regular-season': 'A new season has begun!',
};

export function advanceNotices(L: League, before: Before, res: AdvanceResult): { team: Notice[]; all: string[] } {
  const team: Notice[] = [];
  const all: string[] = [];
  // Your results.
  for (const teamId of humanTeams(L)) {
    let w = 0, l = 0, o = 0;
    for (const g of res.games) {
      if (g.home !== teamId && g.away !== teamId) continue;
      const mine = g.home === teamId ? g.result!.homeScore : g.result!.awayScore;
      const theirs = g.home === teamId ? g.result!.awayScore : g.result!.homeScore;
      if (mine > theirs) w++;
      else if (g.result!.overtime && !g.seriesId) o++;
      else l++;
    }
    if (w + l + o) team.push({ teamId, kind: 'advance', text: `Your team went ${w}-${l}${o ? `-${o}` : ''} in the latest games.`, link: `/team/${teamId}` });
  }
  // Phase and stage changes.
  let faRound = 0;
  for (const change of res.phaseChanges as string[]) {
    if (change === 'free-agency') {
      faRound++;
      all.push(faRound === 1 && !before.faLog ? 'Free agency is open: place your sealed bids.' : `A free-agency bidding round has been resolved.`);
    } else if (STAGE_TEXT[change]) all.push(STAGE_TEXT[change]);
  }
  if (res.phaseChanges.includes('offseason' as never) && L.playoffs?.champion) {
    const c = L.teams[L.playoffs.champion];
    all.push(`${c.city} ${c.name} are the champions!`);
  }
  // Draft clock.
  const pick = onTheClock(L);
  if (pick && L.teams[pick.teamId].controller.kind === 'human' && `${pick.overall}:${pick.teamId}` !== before.clock) {
    team.push({ teamId: pick.teamId, kind: 'draft', text: `You're on the clock: round ${pick.round}, pick #${pick.overall}.`, link: '/draft' });
  }
  // Answers to contract offers made during the re-signing week.
  for (const [id, r] of Object.entries(L.offseason?.responses ?? {})) {
    if (before.answers[id] === `${r.day}:${r.result}` || L.teams[r.teamId]?.controller.kind !== 'human') continue;
    team.push({ teamId: r.teamId, kind: 'offseason', text: r.message, link: '/re-sign' });
  }
  // Free-agency results for managers who bid.
  const log = L.offseason?.faLog ?? [];
  for (const r of log.slice(before.faLog)) {
    const p = L.players[r.playerId];
    const who = p ? `${p.firstName} ${p.lastName}` : r.playerId;
    if (L.teams[r.teamId].controller.kind === 'human') team.push({ teamId: r.teamId, kind: 'free-agency', text: `${who} accepted your offer.`, link: '/free-agents' });
    for (const [teamId, ids] of Object.entries(before.bids)) {
      if (teamId !== r.teamId && ids.includes(r.playerId)) {
        team.push({ teamId, kind: 'free-agency', text: `${who} signed with ${L.teams[r.teamId].city} instead.`, link: '/free-agents' });
      }
    }
  }
  // Restricted free agents: offer sheets waiting on you, and results of sheets and hearings.
  const isHuman = (id?: string) => !!id && L.teams[id]?.controller.kind === 'human';
  const name = (id: string) => (L.players[id] ? `${L.players[id].firstName} ${L.players[id].lastName}` : id);
  for (const [id, c] of Object.entries(L.offseason?.rfa ?? {})) {
    if (c.status === 'unsigned' && c.sheet && !before.pendingSheets.has(id) && isHuman(c.teamId)) {
      const o = c.sheet.offer;
      team.push({
        teamId: c.teamId,
        kind: 'free-agency',
        text: `${name(id)} signed an offer sheet with ${L.teams[c.sheet.fromTeam].city} (${o.years} yr × $${(o.salary / 1e6).toFixed(2)}M). Match or decline before the next advance.`,
        link: '/re-sign',
      });
    }
  }
  for (const t of L.transactions.slice(Math.min(before.tx, L.transactions.length))) {
    const c = L.offseason?.rfa?.[t.playerId];
    if (t.type === 'offer-sheet' && c) {
      for (const teamId of new Set([c.teamId, c.sheet?.fromTeam])) if (isHuman(teamId)) team.push({ teamId: teamId!, kind: 'free-agency', text: t.note, link: '/free-agents' });
    }
    if ((t.type === 'arbitration' || (t.type === 'departure' && c)) && isHuman(t.teamId)) team.push({ teamId: t.teamId, kind: 'free-agency', text: t.note, link: '/re-sign' });
  }
  return { team, all };
}

export function mutateLeague<T>(db: Db, leagueId: string, fn: (league: League, q: Queryable) => Promise<T> | T): Promise<T> {
  if (isSimming(leagueId)) return Promise.reject(new SimBusyError());
  return withLeagueLock(leagueId, () =>
    db.tx(async (q) => {
      const { league, version } = await loadForUpdate(q, leagueId);
      const out = await fn(league, q);
      newsFromTransactions(league); // trades, signings and releases made between advances
      await saveLeague(q, leagueId, league, version);
      return out;
    }),
  );
}

/** True when every human-managed team's manager has readied up. */
export async function allHumansReady(db: Db, leagueId: string): Promise<boolean> {
  const rows = await db.query<{ total: string; ready: string }>(
    `select count(*) as total, count(*) filter (where ready) as ready
     from league_members where league_id = $1 and team_id is not null`,
    [leagueId],
  );
  const total = Number(rows[0].total);
  return total > 0 && Number(rows[0].ready) === total;
}

/**
 * Keeps one cron job per scheduled league. Call `sync(leagueId)` whenever a
 * league's advance settings change.
 */
export class Scheduler {
  private jobs = new Map<string, Cron>();
  constructor(
    private db: Db,
    private log: (msg: string) => void = () => {},
  ) {}

  async start() {
    const rows = await this.db.query<{ id: string; next_advance_at: Date | null }>(
      `select id, next_advance_at from leagues where advance->>'mode' = 'scheduled'`,
    );
    for (const r of rows) {
      // The server was down or asleep when this league was due: catch up once
      // (not once per missed tick, so a long outage doesn't sim weeks at once).
      if (r.next_advance_at && new Date(r.next_advance_at).getTime() < Date.now()) {
        try {
          const adv = (await this.db.query<{ advance: AdvanceMode }>('select advance from leagues where id = $1', [r.id]))[0]?.advance;
          if (adv?.mode === 'scheduled') {
            const res = await advanceLeague(this.db, r.id, { days: adv.daysPerTick }, 'schedule');
            this.log(`[schedule] ${r.id}: caught up a missed advance, day ${res.fromDay} -> ${res.toDay}`);
          }
        } catch (e) {
          this.log(`[schedule] ${r.id}: catch-up failed: ${(e as Error).message}`);
        }
      }
      await this.sync(r.id);
    }
  }

  stop() {
    for (const j of this.jobs.values()) j.stop();
    this.jobs.clear();
  }

  async sync(leagueId: string) {
    this.jobs.get(leagueId)?.stop();
    this.jobs.delete(leagueId);
    const rows = await this.db.query<{ advance: AdvanceMode }>('select advance from leagues where id = $1', [leagueId]);
    const adv = rows[0]?.advance;
    if (!adv || adv.mode !== 'scheduled') {
      await this.db.query('update leagues set next_advance_at = null where id = $1', [leagueId]);
      return;
    }
    const job = new Cron(adv.cron, { timezone: adv.timezone, protect: true }, async () => {
      try {
        const r = await advanceLeague(this.db, leagueId, { days: adv.daysPerTick }, 'schedule');
        this.log(`[schedule] ${leagueId}: day ${r.fromDay} -> ${r.toDay} (${r.games} games)`);
      } catch (e) {
        this.log(`[schedule] ${leagueId}: ${(e as Error).message}`);
      } finally {
        await this.recordNext(leagueId);
      }
    });
    this.jobs.set(leagueId, job);
    await this.recordNext(leagueId);
  }

  nextRun(leagueId: string): Date | null {
    return this.jobs.get(leagueId)?.nextRun() ?? null;
  }

  private async recordNext(leagueId: string) {
    await this.db.query('update leagues set next_advance_at = $1 where id = $2', [this.nextRun(leagueId), leagueId]);
  }
}

/** Validate a cron expression without scheduling it. */
export function describeCron(expr: string, timezone: string): Date | null {
  const c = new Cron(expr, { timezone, paused: true });
  const next = c.nextRun();
  c.stop();
  return next;
}
