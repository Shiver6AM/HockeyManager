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
  advanceToEndOfSeason,
  advanceToPlayoffs,
  type AdvanceMode,
  type AdvanceResult,
  type League,
} from '@hockey-gm/sim-core';
import { Cron } from 'croner';
import type { Db, Queryable } from './db';
import { extractBoxScores, loadForUpdate, saveLeague } from './state';

export type AdvanceTarget = { days: number } | { to: 'playoffs' | 'end-of-season' };

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

export function advanceLeague(db: Db, leagueId: string, target: AdvanceTarget, triggeredBy: string): Promise<AdvanceSummary> {
  return withLeagueLock(leagueId, () =>
    db.tx(async (q) => {
      const { league, version } = await loadForUpdate(q, leagueId);
      if (league.phase === 'offseason') throw new Error('The season is over. The offseason arrives in Phase 3.');
      let res: AdvanceResult;
      if ('days' in target) res = advanceDays(league, target.days);
      else if (target.to === 'playoffs') res = advanceToPlayoffs(league);
      else res = advanceToEndOfSeason(league);

      await extractBoxScores(q, league, res.games);
      await saveLeague(q, leagueId, league, version);
      await q.query('update league_members set ready = false where league_id = $1', [leagueId]);
      await q.query(
        'insert into advance_log (league_id, triggered_by, from_day, to_day, games, phase_changes) values ($1, $2, $3, $4, $5, $6)',
        [leagueId, triggeredBy, res.fromDay, res.toDay, res.games.length, JSON.stringify(res.phaseChanges)],
      );
      return { fromDay: res.fromDay, toDay: res.toDay, games: res.games.length, phase: league.phase, phaseChanges: res.phaseChanges };
    }),
  );
}

/**
 * Apply a small change to the league document (claim a team, edit lines,
 * change settings) under the same lock and transaction discipline as advances.
 */
export function mutateLeague<T>(db: Db, leagueId: string, fn: (league: League, q: Queryable) => Promise<T> | T): Promise<T> {
  return withLeagueLock(leagueId, () =>
    db.tx(async (q) => {
      const { league, version } = await loadForUpdate(q, leagueId);
      const out = await fn(league, q);
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
    const rows = await this.db.query<{ id: string }>(`select id from leagues where advance->>'mode' = 'scheduled'`);
    for (const r of rows) await this.sync(r.id);
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
