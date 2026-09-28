/**
 * Minimal database layer over two interchangeable Postgres drivers:
 *
 *  - PGlite (embedded Postgres in WASM), used locally, with nothing to install.
 *  - node-postgres, used when DATABASE_URL points at a real server (e.g. Supabase).
 *
 * Everything above this file speaks plain SQL through `Db`, so switching to
 * Supabase is just setting DATABASE_URL.
 */
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { MIGRATIONS } from './schema';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Run `fn` inside a transaction. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'pglite' | 'postgres';
}

export async function createDb(url?: string): Promise<Db> {
  const db = url && /^postgres(ql)?:\/\//.test(url) ? createPg(url) : await createPglite(url);
  await migrate(db);
  return db;
}

async function createPglite(dataDir?: string): Promise<Db> {
  // No dataDir (or "memory://") = in-memory database, used by tests.
  const lite = dataDir && dataDir !== 'memory://' ? new PGlite(dataDir) : new PGlite();
  await lite.waitReady;
  // PGlite is a single connection, so transactions must be serialized in-process.
  let chain: Promise<unknown> = Promise.resolve();
  const q: Queryable = {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await lite.query<T>(sql, params);
      return r.rows;
    },
  };
  return {
    kind: 'pglite',
    query: (sql, params) => {
      // Wait for any in-flight transaction so we never interleave with it.
      const run = chain.then(() => q.query(sql, params));
      return run as never;
    },
    tx<T>(fn: (q: Queryable) => Promise<T>) {
      const run = chain.then(() =>
        lite.transaction(async (t) =>
          fn({
            async query<R>(sql: string, params: unknown[] = []) {
              return (await t.query<R>(sql, params)).rows;
            },
          }),
        ),
      );
      chain = run.catch(() => undefined);
      return run;
    },
    close: () => lite.close(),
  };
}

function createPg(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return {
    kind: 'postgres',
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({
          async query<R>(sql: string, params: unknown[] = []) {
            return (await client.query(sql, params)).rows as R[];
          },
        });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function migrate(db: Db) {
  await db.query('create table if not exists _migrations (name text primary key, applied_at timestamptz default now())');
  const done = new Set((await db.query<{ name: string }>('select name from _migrations')).map((r) => r.name));
  for (const [name, sql] of MIGRATIONS) {
    if (done.has(name)) continue;
    await db.tx(async (q) => {
      for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await q.query(stmt);
      await q.query('insert into _migrations (name) values ($1)', [name]);
    });
  }
}
