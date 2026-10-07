import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify from 'fastify';
import { Scheduler } from './advance';
import { userFromToken } from './auth';
import type { Db } from './db';
import { subscribe } from './events';
import { leagueMeta, readLeague, readLeagueJson } from './state';
import { authRouter } from './routers/auth';
import { dataRouter } from './routers/data';
import { leaguesRouter } from './routers/leagues';
import { lifeRouter } from './routers/life';
import { offseasonRouter } from './routers/offseason';
import { simRouter } from './routers/sim';
import { tradesRouter } from './routers/trades';
import { simcastRouter } from './routers/simcast';
import { router, type Context } from './trpc';

export const appRouter = router({
  auth: authRouter,
  leagues: leaguesRouter,
  sim: simRouter,
  data: dataRouter,
  offseason: offseasonRouter,
  trades: tradesRouter,
  simcast: simcastRouter,
  life: lifeRouter,
});
export type AppRouter = typeof appRouter;

export const SESSION_COOKIE = 'hgm_session';

export async function buildApp(opts: { db: Db; scheduler?: Scheduler; logger?: boolean; webDist?: string }) {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: true,
    // The browser batches a page's queries into one request whose path lists them all
    // ("/trpc/sim.status,life.notifications,trades.assets,…"). The default limit of 100
    // characters turned busy pages' first request away (414), to be retried piecemeal.
    routerOptions: { maxParamLength: 5000 },
  });
  const scheduler = opts.scheduler ?? new Scheduler(opts.db, (m) => app.log.info(m));
  await app.register(cookie);
  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      async createContext({ req, res }): Promise<Context> {
        const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
        const token = bearer || req.cookies[SESSION_COOKIE] || null;
        return {
          db: opts.db,
          scheduler,
          user: await userFromToken(opts.db, token ?? undefined),
          sessionToken: token,
          setSession(t) {
            if (t) res.setCookie(SESSION_COOKIE, t, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 3600 });
            else res.clearCookie(SESSION_COOKIE, { path: '/' });
          },
        };
      },
    } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
  });
  app.get('/health', async () => ({ ok: true, db: opts.db.kind }));
  // Live updates: one open connection per browser tab, told when the league changes (see events.ts).
  app.get<{ Params: { id: string } }>('/api/leagues/:id/events', async (req, reply) => {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const user = await userFromToken(opts.db, bearer || req.cookies[SESSION_COOKIE] || undefined);
    if (!user) return reply.code(401).send({ error: 'Sign in first' });
    const member = await opts.db.query('select 1 from league_members where league_id = $1 and user_id = $2', [req.params.id, user.id]);
    if (!member[0]) return reply.code(403).send({ error: 'You are not in this league' });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // (proxies: don't hold messages back)
    });
    res.write('retry: 3000\n\n');
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ type: 'hello' });
    let open = true;
    const close = () => {
      if (!open) return;
      open = false;
      clearInterval(ping);
      unsubscribe();
    };
    const unsubscribe = subscribe(req.params.id, (e) => {
      if (!open) return;
      send(e);
      if (e.type === 'deleted') {
        // Nothing more will ever be said about this league: stop listening, then hang up.
        close();
        res.end();
      }
    });
    // A comment line now and then keeps idle connections from being closed along the way.
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', close);
  });
  // Commissioner: download the whole league as a JSON file (it's stored compressed, so this is the way to look inside).
  app.get<{ Params: { id: string } }>('/api/leagues/:id/export', async (req, reply) => {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const user = await userFromToken(opts.db, bearer || req.cookies[SESSION_COOKIE] || undefined);
    if (!user) return reply.code(401).send({ error: 'Sign in first' });
    const meta = await leagueMeta(opts.db, req.params.id);
    if (!meta) return reply.code(404).send({ error: 'No such league' });
    if (meta.commissioner_id !== user.id) return reply.code(403).send({ error: 'Only the commissioner can download the league data' });
    const json = await readLeagueJson(opts.db, meta.id);
    const L = await readLeague(opts.db, meta.id);
    const file = `${meta.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'league'}-${L.season}-day-${L.day}.json`;
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Encoding', 'gzip')
      .header('Content-Disposition', `attachment; filename="${file}"`)
      .header('Cache-Control', 'no-store')
      .send(gzipSync(json));
  });
  if (opts.webDist && existsSync(join(opts.webDist, 'index.html'))) {
    // Production: one service serves both the API and the built web app.
    await app.register(fastifyStatic, { root: opts.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/trpc')) return reply.sendFile('index.html'); // client-side routes
      return reply.code(404).send({ error: 'Not found' });
    });
  }
  return { app, scheduler };
}
