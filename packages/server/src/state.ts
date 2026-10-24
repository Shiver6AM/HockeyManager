/**
 * Loading and saving the league document.
 *
 * The server keeps each league it has touched in memory, keyed by (league id,
 * version): the parsed document for reads, and its JSON text for writes. The
 * database is asked for the document itself only when the server doesn't have
 * the current version (after a restart, or if something else wrote it). Every
 * other read or change costs a one-row version check, so browsing and small
 * changes don't pull megabytes out of a hosted database each time.
 */
import type { BoxScore, League, ScheduledGame } from '@hockey-gm/sim-core';
import { pack, unpack } from './codec';
import type { Queryable } from './db';

/**
 * The document as two JSON texts: everything that changes day to day, and the
 * league's archive (career lines and retired players). The archive grows every
 * season and changes only in the summer, so it's stored apart (`archive_z`) and
 * written only when it has changed, instead of with every save.
 */
function split(league: League): { hot: string; cold: string } {
  const { careerStats, retired, ...rest } = league;
  return { hot: JSON.stringify(rest), cold: JSON.stringify({ careerStats, retired }) };
}

/** Two JSON objects' texts as one ({…a} + {…b}: the second's keys win). */
function joinJson(a: string, b: string | null): string {
  if (!b || b === '{}') return a;
  if (a === '{}') return b;
  return `${a.slice(0, -1)},${b.slice(1)}`;
}

interface CacheEntry {
  version: number;
  /** For reads. Callers must not change it. */
  league: League;
  /** The document exactly as saved: changes start from a fresh parse of this, never from the shared object. */
  json: string;
  /**
   * The version before this one, kept until this one is known to be committed.
   * A read that lands while the save's transaction is still open (or after it
   * rolled back) is answered from here instead of downloading the document.
   */
  prev?: { version: number; json: string; league?: League; cold?: string };
  /** The archive's JSON as last written (unknown after loading an older row: then it is written on the next save). */
  cold?: string;
}

const cache = new Map<string, CacheEntry>();
const CACHE_MAX = 20;

export interface LeagueRow {
  id: string;
  name: string;
  commissioner_id: string;
  invite_code: string;
  seed: string;
  advance: League['settings']['advance'];
  version: number;
  next_advance_at: Date | null;
}

export async function leagueMeta(db: Queryable, id: string): Promise<LeagueRow | null> {
  const rows = await db.query<LeagueRow>(
    'select id, name, commissioner_id, invite_code, seed, advance, version, next_advance_at from leagues where id = $1',
    [id],
  );
  return rows[0] ?? null;
}

/**
 * How the document is stored: gzipped in `state_z`, with a small readable
 * summary left in `state` (so the table still says something in a database
 * browser). Use the commissioner's "Download league data" for the full JSON.
 */
function summaryOf(league: League, json: string): string {
  return JSON.stringify({
    compressed: true,
    note: 'The league is stored gzipped in state_z. Download the full JSON from the League page (commissioner).',
    season: league.season,
    day: league.day,
    phase: league.phase,
    stage: league.offseason?.stage ?? null,
    teams: Object.keys(league.teams).length,
    players: Object.keys(league.players).length,
    jsonBytes: Buffer.byteLength(json),
  });
}

export async function packState(league: League): Promise<{ summary: string; z: Buffer; archive: Buffer }> {
  const { hot, cold } = split(league);
  return { summary: summaryOf(league, joinJson(hot, cold)), z: await pack(hot), archive: await pack(cold) };
}

/** The document from the database (as text, parsed by the caller once). */
async function fetchState(db: Queryable, id: string): Promise<{ json: string; version: number; cold?: string }> {
  // (Leagues saved before compression have no state_z: their JSON is still in `state`. Before the
  // archive was split off, it was inside state_z and archive_z is empty.)
  const rows = await db.query<{ state_z: Uint8Array | null; archive_z: Uint8Array | null; state: string | null; version: number }>(
    'select state_z, archive_z, case when state_z is null then state::text end as state, version from leagues where id = $1',
    [id],
  );
  if (!rows[0]) throw new Error('League not found');
  const { state_z, archive_z, state, version } = rows[0];
  if (!state_z) return { json: state!, version };
  const hot = unpack(state_z);
  const cold = archive_z ? unpack(archive_z) : undefined;
  return { json: joinJson(hot, cold ?? null), version, cold };
}

/** The saved document as JSON text (for the commissioner's download). */
export async function readLeagueJson(db: Queryable, id: string): Promise<string> {
  await readLeague(db, id);
  return cache.get(id)!.json;
}

/** Read-only view of the league. Callers must not mutate the result. */
export async function readLeague(db: Queryable, id: string): Promise<League> {
  const meta = await db.query<{ version: number }>('select version from leagues where id = $1', [id]);
  if (!meta[0]) throw new Error('League not found');
  const hit = cache.get(id);
  if (hit && hit.version === meta[0].version) {
    delete hit.prev; // (that save is committed)
    return hit.league;
  }
  // A save in flight (its transaction hasn't committed yet): the version before it is the one to show.
  if (hit?.prev && hit.prev.version === meta[0].version) return (hit.prev.league ??= JSON.parse(hit.prev.json) as League);
  const { json, version, cold } = await fetchState(db, id);
  const league = JSON.parse(json) as League;
  remember(id, version, league, json, cold);
  return league;
}

/** Load for modification inside a transaction, locking the row. The result is the caller's own copy. */
export async function loadForUpdate(q: Queryable, id: string): Promise<{ league: League; version: number }> {
  const meta = await q.query<{ version: number }>('select version from leagues where id = $1 for update', [id]);
  if (!meta[0]) throw new Error('League not found');
  const hit = cache.get(id);
  if (hit && hit.version === meta[0].version) return { league: JSON.parse(hit.json) as League, version: hit.version };
  if (hit?.prev && hit.prev.version === meta[0].version) {
    // The last save was rolled back: the version before it is still the current one.
    const { json, version } = hit.prev;
    cache.set(id, { version, league: hit.prev.league ?? (JSON.parse(json) as League), json, cold: hit.prev.cold });
    return { league: JSON.parse(json) as League, version };
  }
  // Not in memory (a restart), or out of date: fetch it once and keep it.
  const { json, version, cold } = await fetchState(q, id);
  remember(id, version, JSON.parse(json) as League, json, cold);
  return { league: JSON.parse(json) as League, version };
}

export async function saveLeague(q: Queryable, id: string, league: League, prevVersion: number): Promise<number> {
  const { hot, cold } = split(league);
  const json = joinJson(hot, cold);
  const hit = cache.get(id);
  // Nothing changed (a no-op action): nothing to write.
  if (hit && hit.version === prevVersion && hit.json === json) return prevVersion;
  const next = prevVersion + 1;
  // (Compressed off the main thread, so a save doesn't hold up other requests.)
  const z = await pack(hot);
  // The archive goes over the wire only when it has changed (in the summer, mostly).
  const known = hit && hit.version === prevVersion ? hit.cold : undefined;
  const archive = known === cold ? null : await pack(cold);
  const res = archive
    ? await q.query<{ version: number }>(
        'update leagues set state = $1, state_z = $2, archive_z = $3, version = $4, updated_at = now() where id = $5 and version = $6 returning version',
        [summaryOf(league, json), z, archive, next, id, prevVersion],
      )
    : await q.query<{ version: number }>(
        'update leagues set state = $1, state_z = $2, version = $3, updated_at = now() where id = $4 and version = $5 returning version',
        [summaryOf(league, json), z, next, id, prevVersion],
      );
  if (!res[0]) throw new Error('League was modified concurrently; try again');
  remember(id, next, league, json, cold);
  return next;
}

function remember(id: string, version: number, league: League, json: string, cold?: string) {
  const old = cache.get(id);
  const prev = old && old.version === version - 1 ? { version: old.version, json: old.json, cold: old.cold } : undefined;
  cache.delete(id);
  cache.set(id, { version, league, json, prev, cold });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

/** Drop a league from memory (it was deleted). */
export function forgetLeague(id: string) {
  cache.delete(id);
}

/**
 * Move box scores out of the league document into their own rows.
 * The simulation only needs final scores after a game is played.
 */
export async function extractBoxScores(q: Queryable, league: League, games: ScheduledGame[]) {
  // Batched: one round trip per 40 games instead of one per game (it adds up
  // against a hosted database over a season of 1,312 games).
  const withBox = games.filter((g) => g.result?.box);
  for (let i = 0; i < withBox.length; i += 40) {
    const chunk = withBox.slice(i, i + 40);
    const params: unknown[] = [];
    // (Compressed: about a sixth of the JSON, and it's what goes over the wire.)
    const packed = await Promise.all(chunk.map((g) => pack(JSON.stringify(g.result!.box))));
    const rows = chunk.map((g, j) => {
      params.push(league.id, league.season, g.id, packed[j]);
      return `($${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, $${j * 4 + 4})`;
    });
    await q.query(`insert into box_scores (league_id, season, game_id, box_z) values ${rows.join(', ')} on conflict do nothing`, params);
    for (const g of chunk) (g.result as { box: BoxScore | null }).box = null;
  }
}

export async function readBoxScore(db: Queryable, leagueId: string, season: number, gameId: number): Promise<BoxScore | null> {
  const rows = await db.query<{ box: BoxScore | string | null; box_z: Uint8Array | null }>(
    'select box, box_z from box_scores where league_id = $1 and season = $2 and game_id = $3',
    [leagueId, season, gameId],
  );
  return rows[0] ? boxOf(rows[0]) : null;
}

/** A stored box score: compressed (box_z) or, written before that, JSON (box). */
export function boxOf(row: { box: BoxScore | string | null; box_z: Uint8Array | null }): BoxScore | null {
  if (row.box_z) return JSON.parse(unpack(row.box_z)) as BoxScore;
  if (row.box === null) return null;
  return typeof row.box === 'string' ? (JSON.parse(row.box) as BoxScore) : row.box;
}
