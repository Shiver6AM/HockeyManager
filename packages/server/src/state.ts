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
import { promisify } from 'node:util';
import { gunzipSync, gzip, gzipSync } from 'node:zlib';
import type { BoxScore, League, ScheduledGame } from '@hockey-gm/sim-core';
import type { Queryable } from './db';

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
  prev?: { version: number; json: string; league?: League };
}
const gzipAsync = promisify(gzip);
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

export function packState(league: League, json = JSON.stringify(league)): { summary: string; z: Buffer } {
  return { summary: summaryOf(league, json), z: gzipSync(json) };
}

/** The document from the database (as text, parsed by the caller once). */
async function fetchState(db: Queryable, id: string): Promise<{ json: string; version: number }> {
  // (Leagues saved before compression have no state_z: their JSON is still in `state`.)
  const rows = await db.query<{ state_z: Uint8Array | null; state: string | null; version: number }>(
    'select state_z, case when state_z is null then state::text end as state, version from leagues where id = $1',
    [id],
  );
  if (!rows[0]) throw new Error('League not found');
  const { state_z, state, version } = rows[0];
  return { json: state_z ? gunzipSync(Buffer.from(state_z)).toString('utf8') : state!, version };
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
  const { json, version } = await fetchState(db, id);
  const league = JSON.parse(json) as League;
  remember(id, version, league, json);
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
    cache.set(id, { version, league: hit.prev.league ?? (JSON.parse(json) as League), json });
    return { league: JSON.parse(json) as League, version };
  }
  // Not in memory (a restart), or out of date: fetch it once and keep it.
  const { json, version } = await fetchState(q, id);
  remember(id, version, JSON.parse(json) as League, json);
  return { league: JSON.parse(json) as League, version };
}

export async function saveLeague(q: Queryable, id: string, league: League, prevVersion: number): Promise<number> {
  const next = prevVersion + 1;
  const json = JSON.stringify(league);
  // (Compressed off the main thread, so a save doesn't hold up other requests.)
  const z = await gzipAsync(json);
  const res = await q.query<{ version: number }>(
    'update leagues set state = $1, state_z = $2, version = $3, updated_at = now() where id = $4 and version = $5 returning version',
    [summaryOf(league, json), z, next, id, prevVersion],
  );
  if (!res[0]) throw new Error('League was modified concurrently; try again');
  remember(id, next, league, json);
  return next;
}

function remember(id: string, version: number, league: League, json: string) {
  const old = cache.get(id);
  const prev = old && old.version === version - 1 ? { version: old.version, json: old.json } : undefined;
  cache.delete(id);
  cache.set(id, { version, league, json, prev });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
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
    const rows = chunk.map((g, j) => {
      params.push(league.id, league.season, g.id, JSON.stringify(g.result!.box));
      return `($${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, $${j * 4 + 4})`;
    });
    await q.query(`insert into box_scores (league_id, season, game_id, box) values ${rows.join(', ')} on conflict do nothing`, params);
    for (const g of chunk) (g.result as { box: BoxScore | null }).box = null;
  }
}

export async function readBoxScore(db: Queryable, leagueId: string, season: number, gameId: number): Promise<BoxScore | null> {
  const rows = await db.query<{ box: BoxScore | string }>(
    'select box from box_scores where league_id = $1 and season = $2 and game_id = $3',
    [leagueId, season, gameId],
  );
  if (!rows[0]) return null;
  return typeof rows[0].box === 'string' ? JSON.parse(rows[0].box) : rows[0].box;
}
