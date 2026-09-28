# Hockey GM — Phase 1: sim-core

A multiplayer hockey management game. This package is the **simulation core**, a pure
TypeScript engine with no UI and no server. The web app and multiplayer server (Phase 2)
will both import it.

## Quick start

```bash
npm install
npm run demo          # generate a league, sim a season, print standings/leaders/box score
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
  schedule.ts   82-game NHL-format schedule (41 home / 41 away for every team)
  game.ts       second-by-second game sim (all tuning constants in TUNING)
  league.ts     advanceDays(), season stats, standings with NHL tiebreakers
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
- **Overtime and shootout:** 5-minute 3v3 sudden death, then a shootout.

### Calibration (8 seasons, ~10,500 games)

27 of 28 league-wide stats land within tolerance of recent NHL averages. That covers
goals, shots, save %, PP %, OT and shootout rates, home win %, hits, blocks, PIM, team
point spread, ice time and goalie ranges. The one gap is the single-season points
leader: about 119 against a recent NHL average of about 139. The generator doesn't yet
create "generational" all-around superstars.

## Next up

- **Phase 1 remainder:** fatigue and energy, injuries, superstar generation, playoffs.
- **Phase 2:** Postgres schema, Fastify + tRPC API, Supabase auth, league-advance
  worker (commissioner button plus cron with ready-up), React UI for standings,
  rosters, box scores and the lines editor.
