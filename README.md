# Hockey GM: sim-core

A multiplayer hockey management game. This package is the **simulation core**, a pure
TypeScript engine with no UI and no server. The web app and multiplayer server (Phase 2)
will both import it.

## Quick start

```bash
npm install
npm run demo          # sim a full season + playoffs: box score, standings, leaders, injuries, bracket, awards
npm run calibrate 8   # sim 8 seasons and compare league stats to real NHL averages
npm test              # determinism + consistency tests
```

Requires Node 20+.

## What's here

```
packages/sim-core/src
  types.ts      data model (players, teams, contracts, lines, league, box scores)
  rng.ts        seeded RNG + hierarchical seed derivation
  generate.ts   league / player generator (archetypes, hidden potential, contracts)
  names.ts      name pools + 32 fictional franchises in 4 divisions
  lines.ts      auto depth chart: 4 F lines, 3 D pairs, 2 PP units, 2 PK units
  roster.ts     game-day lineups around injuries, emergency call-ups / send-downs
  schedule.ts   82-game NHL-format schedule (41 home / 41 away for every team)
  game.ts       second-by-second game sim: fatigue, injuries, playoff OT (tuning in TUNING)
  playoffs.ts   16-team NHL bracket, best-of-7, 2-2-1-1-1 home ice
  awards.ts     Hart, Art Ross, Richard, Vezina, Norris, Selke, Calder, Presidents', Conn Smythe
  league.ts     advanceDays() day loop, stats, standings, playoffs, season history
tools/
  calibrate.ts  multi-season calibration report vs. NHL norms
  demo.ts       one-season showcase
```

## Multiplayer design decisions already built in

| Decision | How it's handled |
|---|---|
| Up to 5 humans now, more later | `team.controller` is `{kind:'ai'}` or `{kind:'human', userId}`. Any team can switch at any time. |
| Commissioner **or** scheduled advance | `settings.advance` holds either mode. The sim only exposes `advanceDays(league, n)`; the server decides *when* to call it. |
| Fairness between the two modes | Each game's seed comes from `league seed + season + game id`, so advancing 1 day ×7 gives exactly the same result as 7 days at once. This is covered by tests. |
| Auditable results | Any game can be replayed from its seed to settle disputes. |

## The game simulation

Each second, each team can generate a shot attempt, penalty, hit, fight or stoppage.
The rates depend on the skaters on the ice:

- **Attempt rate** comes from the on-ice offense against the opposing defense, the
  strength state (5v5, 5v4, 4v4, 3v3 OT, 6v5 with the goalie pulled…), home ice and
  score effects.
- **Each attempt** is either blocked, missed or on goal. A shot's goal probability
  combines the shooter's shooting, his teammates' playmaking against the defense, and
  the goalie. Saves can produce rebounds.
- **Line deployment:** shifts rotate toward target ice-time shares. PP and PK units
  take over when penalties change the strength. Trailing teams pull the goalie late.
  A struggling starter gets pulled.
- **Nightly form:** each player's form varies game to game according to their hidden
  `consistency` trait.
- **Overtime and shootout:** 5-minute 3v3 sudden death, then a shootout. Playoff
  overtime is full-strength 20-minute sudden-death periods, with no shootout.
- **Fatigue:** skaters lose energy on the ice and recover on the bench, faster or
  slower depending on endurance, and tired players play worse. Long shifts and
  short benches hurt. Teams on the second night of a back-to-back start tired and
  usually start their backup goalie.
- **Injuries:** players get hurt mid-game (more often if they're injury-prone) and
  leave the game. Injuries range from day-to-day to season-ending, and players heal
  day by day.
- **Game-day rosters:** AI teams rebuild their lines every game day. Human teams
  keep their own lines, with only injured players swapped for the best healthy
  scratch. A team that can't dress 12 F, 6 D and 2 G makes an emergency call-up;
  AI teams send call-ups back down when their regulars return.

### Season flow

Regular season → one rest day → playoffs (games every other day, a rest day
between rounds) → offseason. When the regular season ends, the league hands out
its awards and writes a record to `league.history`. `advanceDays` never skips
ahead: both advance modes walk through the same days in the same order, so they
end up with the same champion.

### Calibration (6 seasons with playoffs)

All 33 checks land within tolerance of recent NHL figures. They cover scoring, shots,
save %, special teams, OT and shootouts, home ice, team point spread, scoring leaders
(helped by two generational superstars per league), ice time, goalie ranges, injuries
and man-games lost, backup-goalie usage, series length and playoff OT rate. Some
targets (man-games lost, series length) are approximate.

## Next up

- **Phase 2:** Postgres schema, Fastify + tRPC API, Supabase auth, league-advance
  worker (commissioner button plus cron with ready-up), React UI for standings,
  rosters, box scores and the lines editor.
- **Phase 3 (career loop):** aging and development, retirement, draft, offseason rollover.
