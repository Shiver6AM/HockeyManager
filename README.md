# Hockey GM

A multiplayer hockey management game. Each friend manages a team in a 32-team league,
and the other teams are run by AI. The simulation is deep: a second-by-second game
engine, fatigue, injuries, NHL-format playoffs and awards. Leagues also run for
decades: players develop and age, stars retire, and every summer brings a draft,
re-signings and free agency.

![Dashboard](docs/screenshots/dashboard.png)

## Quick start

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**, create an account, and create a league. To invite
friends, share the invite code from the **League** tab. Each of them creates an account,
joins with the code and picks a team.

- The API runs on port 3001, and Vite proxies `/trpc` to it.
- Data is stored in an embedded Postgres (PGlite) under `./.data/pglite`, so there's
  nothing to install. Delete that folder to start fresh.
- Requires Node 20+.

To play with friends before anything is deployed, run it on your machine and share it
through a tunnel (e.g. `npx localtunnel --port 5173` or Tailscale).

### Other commands

```bash
npm test              # 45 tests: sim determinism, playoffs, injuries, offseason, and the full multiplayer API flow
npm run typecheck     # all three packages
npm run demo          # sim a season in the terminal: box score, standings, injuries, bracket, awards
npm run calibrate 8   # sim 8 seasons and compare league stats to real NHL figures
npm run dynasty 10    # one league for 10 seasons: talent, scoring and ages should stay stable
```

### Moving to Supabase (or any hosted Postgres)

Set `DATABASE_URL` to the connection string and start the server. Migrations run
automatically at startup; they're plain SQL in `packages/server/src/schema.ts`.

```bash
DATABASE_URL="postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres" npm run dev
```

## How it's built

```
packages/
  sim-core/   pure TypeScript simulation, no I/O (runs in Node or a browser)
  server/     Fastify + tRPC API, auth, league storage, advance engine and scheduler
  web/        React + Vite + TanStack Query + Tailwind
tools/        calibration + terminal demo
```

| Layer | Choice | Notes |
|---|---|---|
| Simulation | `@hockey-gm/sim-core` | Deterministic: every game's seed comes from the league seed + season + game id |
| API | Fastify + tRPC 11 | End-to-end types: the web app imports the server's router type |
| Database | PGlite locally, Postgres/Supabase later | A thin SQL layer (`db.ts`) runs the same queries on both |
| Auth | Username + password (scrypt), server sessions in an httpOnly cookie | Can be swapped for Supabase Auth later; only `userFromToken` needs to change |
| Scheduling | `croner`, one cron job per scheduled league | Recreated from the DB at startup |

**Storage model.** The live league (players, teams, schedule, stats) is one JSONB
document with a version number; every write is an optimistic-concurrency update inside
a transaction that holds a row lock. Box scores make up about 85% of a season's data, so
they're moved to their own table after each advance and loaded only when someone opens a
game. Membership, ready flags and the advance audit log are ordinary tables.

**Hidden information.** Potential, personality, injury-proneness and consistency never
leave the server. Scouting will reveal estimates of them in a later phase.

## Multiplayer

### Advancing the league

Pick one of two modes on the **League** tab (commissioner only):

- **Commissioner:** the commissioner presses *Sim 1 day / 1 week / to playoffs / to end
  of season*. Good for live sessions together.
- **On a schedule:** a cron schedule in the league's time zone (presets include
  "every night at 11 PM"), a number of days per tick, and optionally **advance early
  when every manager is ready**. The commissioner can still force an advance at any time.

Every advance, whatever triggered it, goes through the same code path: take a lock,
simulate, save the state and box scores, clear ready flags, and write to the audit log
(*League → Advance history*). Because each game has its own seed, simming 7 days one at a
time produces exactly the same league as simming a week at once. The tests check this.

### Managing your team

- **Roster:** ratings, season stats, contracts and injury status.
- **Lines editor:** 4 forward lines, 3 D pairs, starter/backup goalie, 2 PP units and
  2 PK units. It warns you when a player is listed twice or an injured player is dressed,
  and when you swap someone out, their power-play and penalty-kill spots go to the
  replacement.
- **Assistant coach** (on by default): rebuilds your lines before every game, taking
  injured players out and putting returning players back in. Saving your own lines hands
  control back to you. If you're managing lines yourself, the dashboard warns you when a
  better healthy player is sitting out.

![Lines editor](docs/screenshots/lines.png)

## Seasons that never end: the career loop

When the final ends, the league enters the offseason. Each stage waits for managers
unless the commissioner or the schedule moves on, and nobody can stall the league:
anyone who hasn't acted gets sensible defaults.

| Stage | What happens | What you do |
|---|---|---|
| **Season review** | Nothing changes yet, so final stats and awards can be browsed | Look around |
| **Entry draft** | A new class of ~260 teenagers and an NHL-style lottery (two draws, max 10-spot jump); 7 rounds | Pick when you're on the clock, or rank a **draft list** that's used if you're away |
| **Re-sign** | Players age and develop over the summer, veterans retire, contracts expire | Re-sign or let go each expiring player at his asking price |
| **Free agency** | AI teams fill their rosters; unsigned players lower their asks each round | Sign free agents at their asking price, first come first served |
| **Training camp** | AI teams promote ready prospects and cut to 23 | Promote prospects, send down, release |
| **New season** | Career stats archived, new schedule, cap grows 2.5% | — |

- **Development:** young players close part of the gap to their hidden potential each
  year, faster with real NHL ice time. Veterans decline from about 30, speed first
  and hockey sense last, and goalies peak later. Breakouts and busts happen.
- **Scouting:** potential is never shown. Your scouts give draft prospects and young
  players a grade (A+ … F) and a projection ("Top-six / top-four"). Every team's scouts
  make different, repeatable errors.
- **Prospects:** draft picks develop outside the 23-man roster and the cap. Promoting
  one signs a 3-year entry-level deal. Unsigned prospects are released at 23.
- **Careers:** every player has a career page with season-by-season stats, draft
  info, awards and ratings. Retired players keep their pages.
- **Long-run balance:** each summer ratings are nudged back toward the league's
  original talent mean and spread, so there's no inflation or deflation over decades.
  Without this, the game-sim calibration would drift. In a 10-season test, talent
  stayed within 68.7–69.6, goals per game within 2.85–3.08, and 8 different teams won.

## The simulation

Each second, each team can generate a shot attempt, penalty, hit, fight, injury or
stoppage, with rates driven by the skaters on the ice:

- **Shot attempts** depend on on-ice offense against the opposing defense, the
  strength state (5v5, 5v4, 4v4, 3v3 OT, 6v5 with the goalie pulled…), home ice and
  score effects. Each attempt is blocked, missed or on goal. The chance of a goal
  combines the shooter, his teammates' playmaking and the goalie. Saves can produce
  rebounds.
- **Deployment:** shifts rotate toward target ice-time shares, PP and PK units take
  over on penalties, trailing teams pull the goalie late, and a struggling starter gets
  pulled.
- **Fatigue:** players lose energy on the ice and recover on the bench at rates set by
  their endurance. Teams on the second night of a back-to-back start tired and usually
  start the backup goalie.
- **Injuries:** players get hurt mid-game (more often if injury-prone). There are five
  severity tiers, from day-to-day to season-ending, and players heal one day at a time.
  A team that can't dress a full lineup makes an emergency call-up.
- **Overtime:** in the regular season, 5 minutes of 3v3 sudden death and then a
  shootout. In the playoffs, full-strength 20-minute sudden-death periods.
- **Season flow:** an 82-game regular season, then awards (Hart, Art Ross, Richard,
  Vezina, Norris, Selke, Calder, Presidents') → a 16-team best-of-seven playoff with
  2-2-1-1-1 home ice → the Conn Smythe → a history record.

**Calibration:** all 33 league-wide checks land within tolerance of recent NHL figures.
They cover scoring, shots, save %, special teams, OT and shootouts, home ice, parity,
scoring leaders, ice time, goalie ranges, injuries, backup usage, series length and
playoff OT rate. Some targets are approximate.

<img src="docs/screenshots/boxscore.png" width="49%"> <img src="docs/screenshots/playoffs.png" width="49%">

## Known limitations

- One server process: the scheduler and the per-league lock live in memory. Running
  several API instances would need a Postgres advisory lock and a single scheduler.
- A full-season "sim to end" takes a few seconds and blocks the API while it runs.
  It should move to a worker thread before the game is hosted.
- Live updates use 5-second polling. Supabase Realtime can replace it later.
- Contracts use fixed asking prices, and free agency is first come first served.
  Real negotiation and blind bidding are Phase 4.
- The league document grows about 0.3 MB per season of history (careers, retirees).

## Roadmap

- **Phase 4, contracts and free agency:** cap rules, RFA/UFA, AI player negotiation
  driven by personality, blind-bid free agency rounds.
- **Phase 5, trades:** human-to-human proposals, AI trade valuation, approval/veto rules.
- **Phase 6, league life:** scouting fog of war, staff, finances, news, notifications.
