/**
 * Start the API server.
 *
 *   DATABASE_URL  postgres://...  -> real Postgres (e.g. Supabase)
 *                 a folder path    -> embedded PGlite stored there
 *                 (unset)          -> embedded PGlite in ./.data/pglite
 *   PORT          default 3001
 *   PG_POOL_MAX   Postgres connections (default 5)
 *   DATABASE_CA_CERT  optional PEM to verify the database's TLS certificate
 *   WEB_DIST      built web app to serve (default ../web/dist, if built)
 */
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { createDb } from './db';

// A .env at the repo root (git-ignored) is loaded if present; real environment variables win.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_URL ?? './.data/pglite';
if (!/^postgres/.test(url) && url !== 'memory://') mkdirSync(url, { recursive: true });
const db = await createDb(url);
// In production the built web app (packages/web/dist) is served from here too.
const webDist = process.env.WEB_DIST ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
const { app, scheduler } = await buildApp({ db, logger: true, webDist });
await scheduler.start();
const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`Database: ${db.kind === 'pglite' ? `PGlite at ${url}` : `Postgres at ${new URL(url).host}`}`);

const shutdown = async () => {
  scheduler.stop();
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
