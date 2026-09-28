import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify from 'fastify';
import { Scheduler } from './advance';
import { userFromToken } from './auth';
import type { Db } from './db';
import { authRouter } from './routers/auth';
import { dataRouter } from './routers/data';
import { leaguesRouter } from './routers/leagues';
import { lifeRouter } from './routers/life';
import { offseasonRouter } from './routers/offseason';
import { simRouter } from './routers/sim';
import { tradesRouter } from './routers/trades';
import { router, type Context } from './trpc';

export const appRouter = router({
  auth: authRouter,
  leagues: leaguesRouter,
  sim: simRouter,
  data: dataRouter,
  offseason: offseasonRouter,
  trades: tradesRouter,
  life: lifeRouter,
});
export type AppRouter = typeof appRouter;

export const SESSION_COOKIE = 'hgm_session';

export async function buildApp(opts: { db: Db; scheduler?: Scheduler; logger?: boolean; webDist?: string }) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024, trustProxy: true });
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
