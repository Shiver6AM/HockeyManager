# Deploying Hockey GM (Supabase + a Node host)

The game has two parts in production:

- **Database: Supabase.** All leagues, users and box scores live in Postgres.
- **Game server: any Node host** (Render is set up in `render.yaml`; Railway or
  Fly.io work the same way). One process runs the API, the league scheduler and
  serves the web app. It has to be a long-running server, not serverless
  functions, because scheduled leagues advance on a timer.

The server creates and upgrades its own tables on startup (`packages/server/src/schema.ts`),
so there is nothing to run in Supabase's SQL editor.

## 1. Get the Supabase connection string

1. Supabase dashboard → your project → **Connect** (top bar).
2. Under **Connection string**, choose **Session pooler**. (The "Direct connection"
   is IPv6-only on most plans and many hosts, Render included, can't reach it.)
3. Copy the URI. It looks like
   `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`
4. Replace `[YOUR-PASSWORD]` with your database password (Project Settings →
   Database → reset it if you don't have it). Keep this string secret: don't
   commit it or paste it anywhere public.

The server connects over TLS automatically. To also verify Supabase's certificate,
download it (Project Settings → Database → SSL configuration) and set its contents
as `DATABASE_CA_CERT`.

## 2. Deploy the server (Render)

1. Merge the work into `main` (or change `branch:` in `render.yaml`).
2. Render → **New → Blueprint** → connect `Shiver6AM/HockeyManager`. Render reads
   `render.yaml`.
3. When asked, paste the Supabase string as `DATABASE_URL`.
4. Deploy. The first start creates the tables; `/health` should return
   `{"ok":true,"db":"postgres"}`.
5. Open the `…onrender.com` URL, create an account and a league, and share the
   invite code with your friends.

Any other Node host uses the same settings:

| Setting | Value |
| --- | --- |
| Node | 22+ |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check | `/health` |
| Environment | `NODE_ENV=production`, `DATABASE_URL=<session pooler URI>` |
| Optional | `PG_POOL_MAX` (default 5), `DATABASE_CA_CERT`, `PORT` (hosts set it) |

## 3. Things to know

- **Always-on vs. free tiers.** Scheduled leagues need the server awake at tick time.
  Render's free plan sleeps after 15 idle minutes; if a tick is missed while asleep,
  the server catches up with one advance when it wakes. For scheduled leagues use an
  always-on plan (Render Starter). Commissioner-advanced leagues are fine on free.
- **Supabase free projects pause** after a week without activity. Restore them from the
  dashboard; nothing is lost.
- **Security.** Every table has row-level security enabled with no policies, so
  Supabase's public REST API (the anon key) can't read anything. Only the game server,
  which connects as the database owner, can. Passwords are hashed with scrypt.
- **The Supabase ↔ GitHub integration** only acts on a `supabase/` folder in the repo,
  which this project doesn't use (the server migrates itself). You can leave it
  connected; it has nothing to do.
- **Local development** is unchanged: without `DATABASE_URL`, `npm run dev` uses the
  embedded database in `./.data`. To develop against Supabase, put the URI in
  `DATABASE_URL` (never commit it).
- **Backups.** Supabase takes daily backups on paid plans. On the free plan, export with
  `pg_dump "<connection string>" > backup.sql` if you want your own.
