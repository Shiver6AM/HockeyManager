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
npm test              # 236 tests: sim determinism, start points and fantasy drafts, commissioner sliders, farm teams, scouting and fog of war, background sims, coaching systems, chemistry, skills coaches, the re-signing week, retirement, playoffs, offseason, contracts, trades, league life and the multiplayer API
npm run typecheck     # all three packages
npm run demo          # sim a season in the terminal: box score, standings, injuries, bracket, awards
npm run calibrate     # sim 10 seasons and compare league stats to real NHL figures
npm run dynasty 10    # one league for 10 seasons: talent, scoring and ages should stay stable
```

### Deploying (Supabase + a Node host)

See **[DEPLOY.md](DEPLOY.md)**. In short: the database is Supabase, the game server runs
on any always-on Node host (a Render Blueprint is included in `render.yaml`), and one
process serves the API, the scheduler and the web app. Set `DATABASE_URL` to Supabase's
**Session pooler** connection string; tables are created automatically on startup, with
row-level security so Supabase's public API can't read them.

```bash
npm run build                                   # build the web app
NODE_ENV=production DATABASE_URL="postgresql://…pooler.supabase.com:5432/postgres" npm start
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

### Starting a league

When you create a league you pick where it begins:

- **Offseason: the week before free agency** (default). The entry draft has just
  happened; managers claim teams, re-sign the players they want to keep, then bid in
  free agency.
- **Offseason: the entry draft.** Claim teams, set draft lists, and the commissioner
  starts the draft from the Draft page.
- **Opening night.** Rosters are set and the 82-game season starts right away.

Offseason starts are fresh: nobody has played yet, so there's no development or
retirement pass and no season's books to close. The draft order runs from the weakest
roster to the strongest (with the lottery), and the draft class has played a junior
season that every team's scouts have watched.

**Fantasy draft** (optional): every signed player goes into one pool and the 32 teams
draft new rosters, 23 rounds, snake order. Players keep their contracts, so the cap
matters, and every roster must end up able to dress 12 F, 6 D and 2 G. Managers claim
teams, the commissioner starts the draft, AI teams pick automatically, and managers pick
when they're on the clock (or let the AI pick for them, wish list first). The pool is
exactly as big as the draft (736 players: 64 goalies, 224 defensemen), so a spare at one
position is a player another team never gets: a team that already has its 2 goalies (or
6 defensemen, or 12 forwards) can't take another while the ones left are all needed by
teams that are still short. A manager on the clock can always pick someone; if the rules
would leave him nobody, they give way. Afterwards farm
teams are stocked, leftovers become free agents, and the league moves on to the chosen
start point.

### Commissioner sliders

*League → Simulation sliders* has multipliers on key parts of the sim, 1.0× being the
calibrated default: injury frequency and length, scoring, penalties, fighting, home-ice
advantage, night-to-night randomness, young-player development, veteran decline, the
skills-coaching effect, retirements and AI trade activity. All at 1.0× gives exactly the
default simulation.

### Advancing the league

Pick one of two modes on the **League** tab (commissioner only):

- **Commissioner:** the commissioner presses *Sim 1 day / 1 week / to the trade deadline /
  to end of regular season / through the playoffs* (in the offseason: *next day / sim to free agency / next
  season*). Good for live sessions together.
- **Co-commissioners:** the commissioner can let other managers advance the league too
  (*League → Members → Co-commish*). Settings and membership stay commissioner-only.
- **On a schedule:** a cron schedule in the league's time zone (presets include
  "every night at 11 PM"), a number of days per tick, and optionally **advance early
  when every manager is ready**. The commissioner can still force an advance at any time.

**Deleting a league:** the commissioner (not co-commissioners) can delete the league from the League page by typing its name. It goes for every member, with its box scores, advance log and notifications, and can't be undone; download the league data first for a copy. It is refused while the league is simming. Anyone with the league open is sent back to their list of leagues.

Your **Ready** toggle (with the count of ready managers) and, if you can advance, the
**Sim 1 day ▾** button sit in the top bar on every screen. The home page shows today's
games and the most recent results.

The badge in the top bar says exactly where the league is: *Opening night*, *Regular
season · deadline in 3d*, *Conference finals*, *Draft lottery*, *Pre-draft*, *Entry draft ·
pick 25 of 224*, *Re-signing window · day 2 of 7*, *Free agency · day 4 of 10*,
*Pre-season · training camp*.

**Team logos.** Every franchise has its own original mark, drawn in SVG in its colors and
built division by division rather than from one template: free-standing marks (Halifax's
wave, London's helm, Atlanta's phoenix), roundels and crests that carry the city
(Quebec, Kingston, Regina), letter monograms with a symbol built in (Moncton's clawed W,
Rochester's starred A, Omaha's lanced O), wordmark-led logos (Hamilton's arched FORGE,
Providence's script), and badges where the name calls for one (Spokane, Austin). Each has
a simpler secondary mark for small sizes, and a light outer contour so dark marks read on
dark backgrounds. See them all at */logos* (linked from the Teams page).

**Ratings over time.** On your roster, prospects and contracts, each overall is tinted
green or red with the change since the end of last season (▲3, ▼1).

**Pending free agents.** Before free agency opens (the draft and the re-signing week), the
Free agents page lists every player around the league whose contract is running out and
who hasn't re-signed, with his ask and whether his team is expected to let him go.

**Fold-away cards.** Information you need only now and then (offer-sheet RFAs, player
placement, draft lottery results, Central Scouting's final list, pending free agents)
sits in cards you can collapse; each remembers how you left it.

**Calendar.** A month-by-month calendar of the season: every game day's matchups (click a
day to see them all), your team's games and results at a glance, and the key dates
(opening night, a week to the deadline, the trade deadline, the last day of the season, the
playoffs, each round as it starts), followed by the offseason stages in order. Advancers can
**sim to any date**: it stops the morning of that day, before its games.

**Simcast.** Any manager can watch one of the next game day's games live (📺 *Simcast* in
the top bar): a rink with every shot where it was taken (goals, saves, misses and blocks
in each team's color), the home team's logo at center ice, a scoreboard and a running
play-by-play. Whoever started it (or a commissioner) can change the speed (1× to 30×),
pause, skip a period or intermission, or skip to the final. Everyone else in the league
gets a **Join simcast** button next to *Ready* and *Sim*. While a simcast is on, the league
can't sim; the game is played out when the simcast starts and the day's sim uses that
exact result. The rink and the play-by-play follow the period being played (pick another
period or *All*), a bar shows any **power play with its time left** (or 4 on 4) and an
**empty net** when a goalie is pulled, and a **box score** fills in as the game goes (goals,
assists, shots, hits, blocks, PIM and goalie saves), with ice time and plus-minus at the
final.

Every advance, whatever triggered it, goes through the same code path: take a lock,
simulate, save the state and box scores, clear ready flags, and write to the audit log
(*League → Advance history*). Because each game has its own seed, simming 7 days one at a
time produces exactly the same league as simming a week at once. The tests check this.

Advances from the browser run as **background jobs** on the server, one day at a time,
so a long sim never hangs a request. Every manager in the league sees a progress bar under
the header ("Simming to the trade deadline · Jan 14 · 412 games · by Jon"), the sim
buttons are disabled for everyone while it runs (so co-commissioners can't start a
second one), and changes to the league are refused until it finishes. Every open page
refreshes itself whenever the league changes (a sim, a trade, a signing), so nobody has
to reload the playoffs or standings while a co-commissioner sims. The playoffs page is a
bracket: the West on the left and the East on the right, working in to the Final in the
middle. Advancers can
**cancel**: the days already simmed are kept. Progress is saved every few seconds.

### Managing your team

- **Roster:** position, potential (a chip shaded grey to green), a trade-value bar,
  ratings, stats, contracts and injury status, in separate columns. Stats can be shown
  for this season, any past season or career totals. Every table in the game sorts by
  every column.
- **Farm team:** each club has an AHL affiliate. Teams hold up to **50 contracts**, and
  at most **23 healthy players** are on the NHL roster (injured players don't count).
  Send players down and call them up yourself; when someone is hurt, the replacement
  comes up from the farm instead of a free agent being signed, and when he's healthy the
  weakest extra player goes back down. Only the part of a buried salary above $1.15M
  counts against the cap. AI teams promote farm players who outgrow the AHL.
- **Roster moves tool:** the "Roster moves" button on your team page lists the NHL roster
  and the farm side by side. Tick players to send down or call up and a preview shows the
  healthy roster by position against the 23-man limit, the change in cap hit, cap space
  afterwards, and who would need waivers, before you make every move at once.
- **Injury call-ups go back down:** if the assistant coach runs your lines (and for every
  AI team), the call-up who covered for an injured player is sent back down when the
  regular returns, as long as the call-up is the weaker player.
- **Waivers:** from training camp through the regular season, a player who isn't
  waiver-exempt goes on waivers for a day before reaching the farm, and any team can
  claim him (taking on his contract). If several do, the team with the worst record gets
  him. Exempt: 22 and under, under 80 NHL games, under 160 games at 24 or younger, or
  recalled in the last 30 days. The **Waivers** page lists who's available, your claim
  priority and recent claims; AI teams claim clear upgrades they can afford.
- **Contracts tab:** every player's cap hit season by season for seven seasons (current
  deal, agreed extensions, then UFA/RFA), the cap outlook for each season (committed,
  dead cap, space), each player's interest in re-signing (team success, role, loyalty,
  ambition, age), and Extend / Release (buyout) buttons.
- **Free agents:** filter by position, archetype, age, overall, potential, term and AAV
  wanted, points, games played and interest in your team; every variable has its own
  sortable column. In season, a signing with a full roster reports to the farm team.
- **Player details from the lines:** the ⓘ on any card opens his ratings, situational
  (special-teams role) skills and stats.
- **Lines editor (drag and drop):** 4 forward lines, 3 D pairs, starter/backup goalie,
  2 PP units and 2 PK units, plus an *Other situations* view: two 4-on-4 units, three
  3-on-3 overtime units, a 4-on-3 power play, a 3-man penalty kill, the 6-skater extra
  attacker and the shootout order. Every card shows position, overall, age, scouted
  potential and goals/assists. On special-unit spots the card is shaded from white (poor
  fit) to green (ideal) by the player's skill in that exact spot (net front, point, PK…). Drag a scratch onto a slot to dress him, drag between slots
  to swap, or drag a dressed skater onto a PP/PK spot. On a phone, tap one player and then
  tap where he goes. When you swap someone out, their power-play and penalty-kill spots go
  to the replacement, and the editor flags injured or out-of-position players.
- **Assistant coach** (on by default): rebuilds your lines before every game, taking
  injured players out and putting returning players back in. Saving your own lines hands
  control back to you. If you're managing lines yourself, the dashboard warns you when a
  better healthy player is sitting out.

- **Clickable everywhere:** any player or team name (box scores, leaders, standings,
  trades, draft, free agency, news…) opens that player's or team's page.
- **Trade screen memory:** selections and filters survive visiting a player's page and
  coming back.

![Lines editor](docs/screenshots/lines.png)

### Positions, placements and ice time

- **More than one position:** many centers can also play the wing, about half of all
  wingers can switch sides, some wingers take faceoffs, and the odd defenseman can move up
  (or forward drop back). Tables show every position he plays ("C/RW"). Playing someone
  where he doesn't play costs him a little (a winger at center, the wrong wing) or a lot
  (a defenseman up front), and the lines editor warns you.
- **Player placement:** keep the assistant coach running your lines and tell him where
  you want people: a line (1st to 4th, top pair to 3rd pair), a group (top six, top nine,
  bottom six, top four), a position for a forward (C, LW or RW), a starting goalie, or a
  healthy scratch. He builds the rest around it before every game, injuries included.
- **Ice time** (*Systems*): how even-strength minutes are spread: *Standard*, *Ride the
  top line*, *Top six*, *Top nine* or *Roll four lines* for forwards; *Standard*, *Lean on
  the top pair*, *Top four* or *Roll three pairs* for defense. Heavier use puts your best
  players out more but they tire late in games (fatigue is simulated shift by shift).

### Coaching systems

The **Systems** tab on your team page sets how you play. Each option shows how well your
best players *fit* it, the assistant coach's pick, and roughly what it's worth in **rating
points** for your players on the ice. What counts is how much better your roster suits one
option than the others, so there's no single best answer: build a roster of net-front
power forwards and *crash the net* pays; send snipers to crash and it costs you.

| Group | Options |
|---|---|
| Forecheck | Aggressive 2-1-2, balanced 1-2-2, neutral-zone trap 1-3-1 |
| Offensive zone | Cycle, crash the net, shoot from the point, rush/transition |
| Power play | Umbrella 1-2-2, 1-3-1, overload (each with its own named spots) |
| Penalty kill | Passive box, diamond, aggressive pressure |

Fits come from ten **role skills** on every skater (net front, bumper/slot, half wall,
one-timer, point, forecheck, transition, PK forward, PK defense, shootout). They're derived
from ratings and playing style, so power forwards are built for the net front and the
forecheck, snipers for the one-timer, playmakers for the half wall, offensive defensemen
for the point and shutdown defensemen for the kill. A small personal quirk keeps every
player a little different. Player pages show each role skill.

### Line chemistry and spots

- **Spots on special units:** on the power play, penalty kill, 4-on-4, 3-on-3 and 6-on-5,
  each player gains or loses a few rating points depending on how well the spot suits him
  compared with his other skills. Specialists shine in their spot and struggle out of it;
  all-rounders are fine anywhere. The lines editor shades each card and shows the bonus.
- **Line chemistry:** forward lines want a playmaker, a finisher and a net-front or
  forechecking presence; pairs want a puck mover with a stay-at-home partner. Lines also
  **gel** over about 15 games together and lose it when they're broken up. Each line and
  pair shows a live chemistry chip as you move players around.

How much it all matters, measured over ~1,500 games per scenario for three teams (points
over 82 games; the coach's choices are the baseline):

| Change | Points (baseline 92) |
|---|---|
| Worst-fit system in every area | 80 |
| One poor choice (e.g. point shots for a roster built to cycle) | 87–89 |
| Lines upside down (4th line gets top minutes) | 82 |
| Same special-teams players, each in his worst spot | 89 |
| Forward lines regrouped for the best / worst style mix (same talent per line) | 94 / 91 |
| Every line brand new (no games together) | 86 |
| Every rating +3 (for scale) | 112 |

### Skills coaches

Each team can hire up to **three skills coaches** (*Coaching* tab). A coach is rated in
offense, defense and skating, with one to three **specialties** (more specialties cost
more). Each works with up to **five players**, on one skill apiece: a rating (shooting,
skating, defensive IQ…, or goaltending for goalies) or a situational skill (net front, point,
PK…). On **auto** he picks the players who'd gain most and works on their weakest important
skill in his specialties; on manual you choose players and skills, with the projected pace
shown for each.

Players improve a little every day of the season: never more than a point a week, but a
focused season can add several points to one skill (a typical assignment gains 2–5, a
coachable 20-year-old with an elite coach up to about 10). The rate depends on the coach's
rating in that skill's group, the player's **coachability** (a visible trait on his page),
his age and how much room the skill has left.
## Seasons that never end: the career loop

When the final ends, the league enters the offseason. Each stage waits for managers
unless the commissioner or the schedule moves on, and nobody can stall the league:
anyone who hasn't acted gets sensible defaults.

| Stage | What happens | What you do |
|---|---|---|
| **Season review** | Nothing changes yet, so final stats and awards can be browsed | Look around |
| **Entry draft** | A new class of ~260 teenagers and an NHL-style lottery (two draws, max 10-spot jump); 7 rounds on a **3-minute clock** per pick | The commissioner **sims the lottery** or runs it **live** (the odds table, then picks revealed from #16 up to #1 for everyone watching). Each pick gets 3 minutes; AI teams pick after 90 seconds to 3 minutes, and a manager who runs out of time gets his **draft list**'s (or scouts') top choice. The commissioner can pause, **skip to the next manager's pick**, or sim the rest. Trades stay open throughout, including this year's unused picks; a pick traded to an AI team while it's on the clock is made within a minute |
| **Re-signing week** | Seven days of exclusive talks with your own pending UFAs and RFAs. Offers are answered by the player's agent the next day (close calls can take an extra day); AI teams re-sign theirs through the week | Make offers, accept counters, qualify RFAs, or let players go |
| **Free agency** | Ten days of **sealed offers**: each free agent listens for 3–5 days from his first offer, then takes the best one or turns them all down; AI teams bid too | Make sealed offers; leftover players sign at their ask during camp |
| **Training camp** | AI teams promote ready prospects and cut to 23 | Promote prospects, send down, release |
| **New season** | Career stats archived, new schedule, cap grows 2.5% | — |

- **Development:** young players close part of the gap to their hidden potential each
  year, faster with real NHL ice time. Veterans decline from about 30, speed first
  and hockey sense last, and goalies peak later. Breakouts and busts happen.
- **During the season, not only in the summer:** half of a year's expected growth (and
  of a veteran's decline) arrives through the regular season, one rating point at a time,
  for everyone still playing: NHL rosters, farm teams, prospects and free agents. A
  20-year-old well short of his potential gains about two overall points between opening
  night and the last game. The summer delivers the rest, along with what depends on how
  the season went: the ice-time bonus or penalty, the random swing, breakouts and busts.
  A year adds up to what it did when it all happened in the summer
  (`DEV_TUNING.inSeasonShare`). This is separate from skills coaching, which still trains
  one chosen skill.
- **Playing styles set ceilings:** grinders and enforcers fill out the bottom of rosters
  and top out as good role players (capped potential); they are never top-5 talents in a
  draft class and rarely first-rounders. Snipers, playmakers and offensive defensemen are
  more common among the elite; stay-at-home defensemen less so.
- **Scouting:** potential is never shown. Your scouts give draft prospects and young
  players a grade (A+ … F) and a projection specific to his position ("First-line
  center", "Top-pair defenseman", "Starting goalie"…). Every team's scouts
  make different, repeatable errors.
- **Area scouts and fog of war:** next summer's draft class plays all season in real
  development leagues (WHL, OHL, QMJHL, USHL, NCAA, J20, SHL, Liiga, MHL, KHL, Czech
  Extraliga, Swiss NL, DEL…), grouped into eight regions. Each team employs up to four
  area scouts with an evaluation skill and a familiarity with each region; assign them
  to regions (or let the head scout decide). Every day in a region builds your
  confidence there, faster for skilled scouts who know the area. On the Scouting page
  and draft board, prospects from regions you haven't scouted show no ratings or
  projection, and projections sharpen as confidence grows. Knowledge resets each season.
- **Prospects:** unsigned draft picks keep playing with their junior, college or
  European club (shown on the Prospects tab), with stats that go into their career lines.
  Signing one gives him a 3-year entry-level deal. Unsigned prospects are released at 23.
- **Goalie coaches:** every team has a goalie coach who trains up to four goalies'
  reflexes, positioning, rebound control or mental game, alongside the skills coaches.
- **Watchlist:** star any draft-eligible prospect (Scouting page or draft board) and filter
  the class to your watchlist. It's saved with your team.
- **Central Scouting:** the league publishes consensus rankings of the draft class, the
  same for every team, split into North American and international skaters and goalies:
  a preliminary list in the fall, an update every two weeks through the season, and a
  final list after it. Each update reflects how prospects are producing, opinions drift
  rather than jump, and the guesswork shrinks as the season goes on. Arrows show each
  prospect's movement since the previous update, on the draft board and the Scouting page.
- **Following specific prospects:** instead of a region, a scout can follow up to 10
  prospects in one league. He learns about each of them much faster than regional
  coverage would (the fewer he follows, the faster), and they're marked in the class list.
- **Scout schedules:** plan each scout's season ahead as a list of stops. Each stop is a
  region, the head scout's call, or a set of specific prospects, and lasts a number of weeks.
  The stops run back to back, up to the weeks left in the regular season, and the last one
  carries on through the playoffs until the draft. You can reorder, resize or clear a
  schedule at any time. In the summer you can plan regions for next season. Picking an
  assignment directly replaces the schedule.
- **Sleepers:** every draft class hides a few late bloomers with modest numbers and
  modest reports but a real ceiling. Scouts and Central Scouting miss most of it while
  they're teenagers; they tend to go in the middle rounds, grow quickly from 19 to 23, and
  make the news when they break out.
- **Team logos:** every franchise has its own emblem in its colors, shown wherever the
  team appears (headers, standings, scores, stats, trades, player pages).
- **Height and weight:** every player has a frame that fits his style (enforcers and
  shutdown defensemen are big, speedsters smaller, butterfly goalies tall), and teenagers
  fill out into their early 20s. Shown on player pages and as sortable columns.
- **Standings:** division, wild-card, conference and league views, with seeds (M1…,
  WC1, WC2) and a cut line below the second wild card.
- **Retirement:** age sets the baseline (rare before 32, likely by the late 30s,
  certain at 44), but ability matters: a serviceable veteran keeps playing, and stars
  can go into their 40s, while fading players and unsigned veterans hang them up early.
  Now and then someone surprises everyone.
- **Careers:** every player has a career page with season-by-season stats (the full line:
  goals, assists, +/-, PIM, power-play and shorthanded points, game-winners, shots,
  shooting %, hits, blocks, faceoff % and TOI; goalies' starts, saves, GAA and shutouts),
  playoffs, junior/AHL seasons, NHL totals, draft info, awards and ratings. Retired players
  keep their pages.
- **Long-run balance:** each summer ratings are nudged back toward the league's
  original talent mean and spread, so there's no inflation or deflation over decades.
  Without this, the game-sim calibration would drift. In a 10-season test, talent
  stayed within 68.7–69.6, goals per game within 2.85–3.08, and 8 different teams won.

## Contracts

- **One-way and two-way deals:** a two-way contract pays a much smaller AHL salary
  whenever the player is on the farm (entry-level deals are always two-way). Every offer
  form lets you choose. Established NHL players dislike two-way offers: they want more
  money or counter with a one-way deal. Team finances pay the salaries actually earned.
- **Interest in your team (0–100):** each player rates every team on whether it can win
  (weighted by his ambition), the role he'd have, loyalty to his current or drafting team,
  market size (greedier players like the spotlight), the head coach (young players) and
  a recent title. You see the rating and the reasons (e.g. "▲▲ Would be a top player here",
  "▼ Small market"), never the hidden numbers.
- **Asks are per team:** interest sets what he asks *you* for. An interested player
  gives up to ~20% off and commits a year longer; an uninterested one wants up to 25% more
  and a shorter way out.
- **Money versus term:** each player weighs the two his own way. Greed sets how much money
  moves him; age and a personal appetite for security set how term does. Veterans pay more
  for a short deal and take less per year for extra years (up to three); young players
  resist being locked in long. The agent's estimate for every term from 1 to 8 years is
  shown (with a little noise), and a live **agent's read** meter reacts as you move the
  salary and years **sliders** (or type the numbers).
- **Negotiation:** he accepts, counters (at his preferred term, or yours if it barely
  matters to him), or, if you lowball him, gets annoyed and raises his price. You get
  three offers per player per window. The AI goes through the same function.
- **Qualifying offers:** to keep an RFA's rights, you tender a one-year qualifying offer
  priced in NHL-style tiers that scale with the cap: 110% of a low salary, 105% of a
  mid-range one (capped at the upper threshold), 100% above it. The Re-sign page shows
  each RFA's QO and his likely response (accept it, hold out for more, or file for
  arbitration with a rough award), and a **Qualify all** button. An RFA you don't qualify
  becomes an unrestricted free agent. AI teams (and your assistant GM) qualify anyone
  useful or young with upside, but not a player whose QO costs more than he's worth.
  The roster's Expiry column shows each expiring RFA's QO.
- **Restricted free agents:** a qualified RFA without a deal either accepts his QO on the
  spot, holds out, or (if he's 22+ or has three seasons in the league and is worth clearly
  more) files for arbitration. He stays yours on the QO meanwhile, and then:
  - **Offer sheets** (free agency): any other team can tender one. If he signs it, his team
    matches (he stays at those terms) or takes draft-pick compensation from the offering
    team's own picks, scaled by salary as a share of the cap (NHL-style tiers, from nothing
    under ~$1.7M up to four 1sts). Managers decide before the next advance; otherwise the
    assistant GM decides. AI teams tender them occasionally.
  - **Arbitration** (end of free agency): players worth clearly more than their qualifying
    offer file; the arbitrator awards a 1–2 year deal near market value. In training camp a
    team can walk away from an award of ~$4.5M or more, making him a UFA.
  - You can keep negotiating with your own unsigned RFA throughout.
- **Sealed-offer free agency:** managers in different time zones get the same shot.
  A free agent listens for 3–5 days from his first offer before deciding, and what
  counts is the best offer, not who clicked first. The Free agents page shows how many
  offers each player has and when he'll decide (the terms stay sealed). If nothing is
  good enough he turns them all down, comes back a little cheaper and listens again.
  Everyone with an offer decides on the last day. Teams under the salary floor overpay
  to reach it.
- **Extensions:** negotiate with players in the final year of their deal during
  the season. The new deal kicks in when the old one ends.
- **Leftover free agents:** after free agency (training camp and in season),
  **Sign** opens a negotiation; he signs on the spot when he accepts.
- **Buyouts:** releasing a player under contract costs two-thirds of the remaining
  money (one-third if he's under 26), spread over twice the remaining years as dead cap.
- **Pay scale:** salaries scale with the cap, which grows 2.5% a year. Typical
  payrolls sit between the floor and the cap.

## Trades

- **Salary retention:** the team sending a player can keep up to 50% of his salary on its
  own cap for the rest of his contract (at most three retained contracts per team). Pick
  the share next to him in the trade preview; the cap changes and what each side will carry
  are shown before you send it, and AI teams value the cheaper contract (or charge for
  keeping part of one).
- **Trade value:** every player and pick shows a league-wide value (a neutral front office's
  view: ability on a steep scale, upside by consensus scouting, age, contract, injuries),
  with each side's total in the preview. AI teams adjust it for their own scouting, needs
  and plans, and want a little extra.
- **Trade for a pick:** in the draft order, any unused pick has a *Trade for* link that
  opens the trade center with that pick already in the deal.
- **Trade partners** are listed in standings order with each team's record, points and
  owner's goal (Contend / Playoffs / Youth / Profit), and a **Standings & team goals**
  sidebar shows the same with each AI front office's posture (buying, balanced, selling);
  click a row to trade with that team.
- **Trade center:** pick a team and tick any number of players, prospects and draft picks
  on both sides. A **trade preview** at the top lists each side's assets (players by
  overall, then picks by round) with cap impact. Both sides are sortable tables (overall,
  position, type, age, AAV, years left, status after contract) with shared **filters**
  (position, player type, age range, years left, UFA/RFA/ELC, minimum overall, health,
  on-the-block, fits-their-needs). Picks in **five drafts** (this one plus four more) are
  tradeable, and the draft uses whoever owns each pick.
- **Trade deadline:** about three-quarters of the way through the season. The top bar
  counts down the last three weeks, the news marks the week before and deadline day, and
  *Sim to trade deadline* stops on deadline day so everyone can make last calls. Trades
  close after it until the season ends and reopen at the draft.
- **Trade block:** every team lists players and picks it's shopping and what it's looking
  for (a position, young players, prospects, picks, proven veterans, cap relief). Managers
  set their own; AI blocks follow strategy and roster (rebuilders shop veterans and want
  picks and youth; teams in the bottom third at a position need one). Your assets that fit
  the other team's needs are starred, and theirs that fit yours are too. AI teams value
  assets that fit their needs ~10% higher and are more willing to move what's on their
  block. A league-wide block view has one-click **Trade for**.
- **AI teams value assets from their own point of view.** Stars are worth far more
  than depth, young players carry scouted upside, age brings decline, and cheap good
  contracts are gold while overpaid ones hurt. Pending UFAs are rentals, and picks are
  valued by projected slot. Contenders pay for help now; rebuilders pay for youth and
  picks. What an AI receives is summed with diminishing weights, so three depth players
  never buy a star, and it wants to come out slightly ahead.
- **Feedback without the numbers:** an interest meter ("Close, but we'd need a little
  more"), and a **"What would they want?"** button that finds the cheapest addition
  (up to three assets) from your side that gets it done.
- **Human-to-human** proposals with accept/decline/withdraw. Proposals are voided if
  their assets move. An optional **commissioner review** holds trades involving managers
  until approved (anti-collusion).
- **Deadline:** trades freeze after ~78% of the regular season through the playoffs,
  and during the draft.
- **AI-to-AI trades:** contenders buy veterans and pending UFAs from rebuilding teams
  with prospects and picks, more often near the deadline, and at most two deals per team
  per season so nobody guts a roster.
- **AI teams call managers:** now and then an AI front office makes a manager an offer.
  A contender wants one of his veterans, a team saw a name on his trade block, or a
  seller has a player who would help him (and offers to keep half the salary if he can't
  fit it). A passive manager hears from someone about four to six times a season; one
  who uses his trade block or lists needs about twice as often, and calls triple in the
  week before the deadline. Every offer is one the AI team would accept itself and is
  within about 10% of even by the values on the trade screen, light or generous. An
  offer stands for 10 days (4 in the re-signing week and free agency), never past the
  deadline; a manager has at most two open, a team doesn't call the same manager twice
  in 10 days, and a player he said no about isn't raised again that season. The AI team
  backs out if the deal stops working for it (an injury, a signing).
- **Offers can't be missed:** while an offer is waiting, a strip under the navigation on
  every page says who called, what for and when it expires; the Trades tab shows a count;
  the notification bell gets a line (and another if the offer runs out). The trade center
  shows the GM's pitch with *Accept / Decline / Look closer* (which loads the deal into
  the builder with its values). Long sims don't stop for offers.

## League life

- **Front office:** every team has a head coach, head scout and head trainer, rated
  40–95. The coach speeds up young players' development (about −8% to +10%), the scout
  narrows the fog on prospects' potential, and the trainer shortens injuries (about
  +17% to −20%). An average staffer (65) is neutral. Replace anyone from the job market
  on your team's **Front office** tab (12 candidates per role, always including a few
  strong ones, with each one's effect shown); the outgoing staffer's settlement comes
  out of the budget. Staff are paid outside the salary cap. AI teams upgrade weak staff each summer.
- **Finances:** attendance and gate follow market size, winning, star power and last
  year's title. Media and sponsorship revenue, salaries (including dead cap), staff and
  operations are booked game by game, and playoff home games are pure upside. Books close
  each summer and profit or loss rolls into the team's cash.
- **Owners:** each owner sets a goal for the season (contend, make the playoffs, develop
  youth or turn a profit) and reviews you after the final. Confidence rises and falls with results.
- **News:** hat tricks, five-point nights, 50-goal and 100-point milestones, streaks,
  playoff shutouts and OT winners, awards, series clinches and champions, plus trades,
  big signings, long injuries to good players, notable retirements and the #1 pick,
  all drawn from the transaction log.
- **Notifications:** a bell in the header for things that need you: your results,
  trade proposals and replies, commissioner approvals, being on the clock in the draft,
  free-agency wins and losses, and offseason stage changes. They are stored per user,
  so they're waiting when you come back.
- **History:** champions and MVPs by season, title counts, the **Hall of Fame** (retired
  players are scored on production, awards, titles and peak, with credit for careers that
  began before the league existed) and all-time leaders.
- **Stats:** season leaders for any season played (step back with ‹ ›, and each past season shows
  the team a player was with then), plus all-time career leaders with an active-only filter.
  A Players filter switches to the **top 100 prospect scorers** (drafted, not in the NHL:
  junior, college, Europe, AHL) or the **top 100 undrafted scorers**, with league, club,
  rights holder and draft slot.
- **Franchise records:** every team page has a Records tab with the club's career
  scoring and goaltending leaders and its best single seasons; the Teams directory shows
  each franchise's all-time leading scorer.
- **Assistant GM:** if a manager never decides on an expiring player, the assistant GM
  handles him the way an AI team would, so an absent manager can't lose half a roster.
  An explicit "let go" is always respected.

<img src="docs/screenshots/front-office.png" width="49%"> <img src="docs/screenshots/history.png" width="49%">

## Traits

Rare badges in the spirit of NBA 2K, each in four tiers (Bronze, Silver, Gold, Hall of
Fame): Sniper, Playmaker, Clutch, Net-Front Presence, Power-Play Quarterback, Dangler,
Speedster, Faceoff Ace, Shot Blocker, Shutdown, Penalty Killer, Enforcer, Iron Man, Leader
and Shootout Artist for skaters; Brick Wall, Big-Game Goalie and Rebound Control for
goalies. Each nudges one part of the engine (a Sniper's shots go in more often, a Shot
Blocker blocks more, an Iron Man tires more slowly and gets hurt less...). A player earns a
trait when the ratings behind it are elite and he has a hidden knack for it. Traits are
re-checked every season, so they can be earned, upgraded or lost. About a quarter of NHL
players have one, and nobody has more than three (two for goalies). They show on the
roster, free-agent and waiver lists and, in full, on the player page. Effects are sized
so the season still calibrates against the NHL.

Hover (or tap) a trait chip anywhere for a card with its tier, what it does and its kind.

## Graphs

- **Team → Trends:** points pace against the conference's playoff line and the league
  average, 10-game rolling goals for and against, and goal differential game by game,
  with points, pace, gap to the playoff line and goal differential up top.
- **Standings:** every team's goals for vs goals against per game (yours highlighted),
  and points percentage by team.
- **Player page:** points (or save %) and overall rating by season, once he has two
  seasons.

All charts size to the screen and show values on hover.

## The simulation

Player names are generated from pools of about 400 first names and 8,000 surnames across
the hockey countries (English/Canadian, French-Canadian, Swedish, Finnish, Russian, Czech,
Slovak, German and more), built from name parts rather than lists of real players; famous
hockey surnames are left out.

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
- Live updates are pushed: each open league page holds one server-sent-events connection
  (`GET /api/leagues/:id/events`) and refetches when the server says the league changed
  (a sim step, a trade, a draft pick, a manager readying up). While the connection is up
  the browser only polls as a slow safety net (30 s); if it drops, the old polling
  (2–6 s) takes over until it reconnects. Events are kept in the server's memory, so
  this also assumes one server process.
- A simcast sends each viewer only the plays he doesn't have yet, and the box score only
  when something happened.
- Read-only pages that price many players at once (free agents, trade block, draft board,
  "what would they take?") share their intermediate results for the length of the request
  (`withMemo` in sim-core). Nothing is cached between requests.
- A lineup may dress an injured player only when the team has no healthy player left in
  that group (forwards, defense or goalies) to put in his place.
- The whole league is one JSON document, stored gzipped in `leagues.state_z` (about a
  seventh of its size on the wire); `leagues.state` keeps a small readable summary
  (season, day, phase, counts). The server keeps the current version in memory, so reads
  and small changes cost a one-row version check, and the document is fetched from the
  database only after a restart. To look inside a league or back it up, the commissioner
  downloads it as JSON from the League page (*League data*). The file includes what the
  game hides from managers (true potentials, every team's scouting).
- Simcasts and the draft clock run in the server's memory: a restart ends a simcast (its
  game result is kept) and the draft clock resumes the next time anyone opens the league.
- The league document grows about 0.5 MB per season of history (careers including junior/AHL seasons, retirees).

## Roadmap

- **Hosting:** sims moved to a worker thread,
  email or push for notifications.
- **Depth:** arena and ticket-price decisions,
  owners who fire GMs, and a minor-league affiliate with its own games.
