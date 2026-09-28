/**
 * Start the API server.
 *
 *   DATABASE_URL  postgres://...  -> real Postgres (e.g. Supabase)
 *                 a folder path    -> embedded PGlite stored there
 *                 (unset)          -> embedded PGlite in ./.data/pglite
 *   PORT          default 3001
 */
import { mkdirSync } from 'node:fs';
import { buildApp } from './app';
import { createDb } from './db';

const url = process.env.DATABASE_URL ?? './.data/pglite';
if (!/^postgres/.test(url) && url !== 'memory://') mkdirSync(url, { recursive: true });
const db = await createDb(url);
const { app, scheduler } = await buildApp({ db, logger: true });
await scheduler.start();
const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`Database: ${db.kind === 'pglite' ? `PGlite at ${url}` : 'Postgres'}`);

const shutdown = async () => {
  scheduler.stop();
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
