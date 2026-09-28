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
  advanceToNextSeason,
  advanceToPlayoffs,
  ensureLeagueLife,
  newsFromTransactions,
  offseasonStep,
  onTheClock,
  type AdvanceMode,
  type AdvanceResult,
  type League,
} from '@hockey-gm/sim-core';
import { Cron } from 'croner';
import type { Db, Queryable } from './db';
import { deliver, deliverAll, humanTeams, type Notice } from './notify';
import { extractBoxScores, loadForUpdate, saveLeague } from './state';

export type AdvanceTarget = { days: number } | { to: 'playoffs' | 'end-of-season' | 'next-season' };

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
      ensureLeagueLife(league);
      const before = snapshotForNotices(league);
      let res: AdvanceResult;
      if (league.phase === 'offseason') {
        // In the offseason one "day" is one stage. Advances never wait on
        // humans: anyone who hasn't acted gets sensible defaults.
        if ('to' in target && target.to !== 'next-season') {
          throw new Error('The season is over. Advance through the offseason instead.');
        }
        const stages: string[] = [];
        // Scheduled ticks and ready-ups move one stage at a time so every manager gets a turn at each stage.
        const steps = 'days' in target ? (triggeredBy.startsWith('commissioner') ? target.days : 1) : Infinity;
        for (let i = 0; i < steps && league.phase === 'offseason'; i++) stages.push(offseasonStep(league, { force: true }).to);
        res = { fromDay: league.day, toDay: league.day, games: [], phaseChanges: stages as AdvanceResult['phaseChanges'] };
      } else if ('days' in target) res = advanceDays(league, target.days);
      else if (target.to === 'playoffs') res = advanceToPlayoffs(league);
      else if (target.to === 'end-of-season') res = advanceToEndOfSeason(league);
      else {
        res = advanceToEndOfSeason(league);
        const steps = advanceToNextSeason(league);
        res.phaseChanges.push(...steps.map((s) => s.to as never));
      }

      const notices = advanceNotices(league, before, res);
      await extractBoxScores(q, league, res.games);
      await saveLeague(q, leagueId, league, version);
      await q.query('update league_members set ready = false where league_id = $1', [leagueId]);
      await deliver(q, leagueId, notices.team);
      for (const text of notices.all) await deliverAll(q, leagueId, 'offseason', text, '/');
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
// ---------------------------------------------------------------------------
// Notifications produced by an advance
// ---------------------------------------------------------------------------

interface Before {
  clock: string | null;
  faLog: number;
  bids: Record<string, string[]>;
  tx: number;
  pendingSheets: Set<string>;
}

function snapshotForNotices(L: League): Before {
  const pick = onTheClock(L);
  const bids: Record<string, string[]> = {};
  for (const [teamId, b] of Object.entries(L.offseason?.bids ?? {})) {
    if (L.teams[teamId]?.controller.kind === 'human') bids[teamId] = Object.keys(b);
  }
  const pendingSheets = new Set(Object.entries(L.offseason?.rfa ?? {}).filter(([, c]) => c.status === 'unsigned' && c.sheet).map(([id]) => id));
  return { clock: pick ? `${pick.overall}:${pick.teamId}` : null, faLog: L.offseason?.faLog?.length ?? 0, bids, tx: L.transactions.length, pendingSheets };
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
