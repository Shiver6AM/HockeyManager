/**
 * Loading and saving the league document.
 *
 * Reads go through a small in-memory cache keyed by (league id, version), so
 * browsing standings doesn't re-parse ~2 MB of JSON on every request. Any
 * write bumps the version, which invalidates the cache entry.
 */
import type { BoxScore, League, ScheduledGame } from '@hockey-gm/sim-core';
import type { Queryable } from './db';

interface CacheEntry {
  version: number;
  league: League;
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

/** Read-only view of the league. Callers must not mutate the result. */
export async function readLeague(db: Queryable, id: string): Promise<League> {
  const meta = await db.query<{ version: number }>('select version from leagues where id = $1', [id]);
  if (!meta[0]) throw new Error('League not found');
  const hit = cache.get(id);
  if (hit && hit.version === meta[0].version) return hit.league;
  const rows = await db.query<{ state: League | string; version: number }>('select state, version from leagues where id = $1', [id]);
  const league = typeof rows[0].state === 'string' ? (JSON.parse(rows[0].state) as League) : rows[0].state;
  remember(id, rows[0].version, league);
  return league;
}

/** Load for modification inside a transaction, locking the row. */
export async function loadForUpdate(q: Queryable, id: string): Promise<{ league: League; version: number }> {
  const rows = await q.query<{ state: League | string; version: number }>(
    'select state, version from leagues where id = $1 for update',
    [id],
  );
  if (!rows[0]) throw new Error('League not found');
  const league = typeof rows[0].state === 'string' ? (JSON.parse(rows[0].state) as League) : rows[0].state;
  return { league, version: rows[0].version };
}

export async function saveLeague(q: Queryable, id: string, league: League, prevVersion: number): Promise<number> {
  const next = prevVersion + 1;
  const res = await q.query<{ version: number }>(
    'update leagues set state = $1, version = $2, updated_at = now() where id = $3 and version = $4 returning version',
    [JSON.stringify(league), next, id, prevVersion],
  );
  if (!res[0]) throw new Error('League was modified concurrently; try again');
  remember(id, next, league);
  return next;
}

function remember(id: string, version: number, league: League) {
  cache.delete(id);
  cache.set(id, { version, league });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

/**
 * Move box scores out of the league document into their own rows.
 * The simulation only needs final scores after a game is played.
 */
export async function extractBoxScores(q: Queryable, league: League, games: ScheduledGame[]) {
  for (const g of games) {
    if (!g.result?.box) continue;
    await q.query(
      'insert into box_scores (league_id, season, game_id, box) values ($1, $2, $3, $4) on conflict do nothing',
      [league.id, league.season, g.id, JSON.stringify(g.result.box)],
    );
    (g.result as { box: BoxScore | null }).box = null;
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
