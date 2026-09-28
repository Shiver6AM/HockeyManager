/**
 * Calibration harness: simulate several full seasons and compare league-wide
 * stats to real NHL norms (roughly 2022-25 averages; leader and best-team
 * targets are the mean of the 2022-23, 2023-24 and 2024-25 seasons).
 *
 *   npm run calibrate -- [seasons=5]
 */
import { advanceToEndOfSeason, generateLeague, overall, standings, type League } from '../packages/sim-core/src/index';

interface Target {
  label: string;
  nhl: number;
  tol: number; // acceptable absolute deviation
  fmt?: (x: number) => string;
  get: (m: Metrics) => number;
}

interface Metrics {
  teamGames: number;
  games: number;
  goals: number;
  enGoals: number;
  shots: number;
  attempts: number;
  ppOpps: number;
  ppGoals: number;
  shGoals: number;
  hits: number;
  blocks: number;
  pim: number;
  ot: number;
  so: number;
  homeWins: number;
  assists: number;
  savesNonEN: number;
  shotsAgainstNonEN: number;
  ptsMax: number[];
  ptsMin: number[];
  ptsSd: number[];
  topPoints: number[];
  topGoals: number[];
  topAssists: number[];
  topDToi: number[];
  topFToi: number[];
  topShutouts: number[];
  topFoPct: number[];
  bestSvPct: number[];
  worstSvPct: number[];
  top100Pts: number[];
  injuries: number;
  manGamesLost: number;
  teamSeasons: number;
  seriesGames: number;
  series: number;
  playoffGames: number;
  playoffOT: number;
  backupStarts: number;
  goalieStarts: number;
}

const f2 = (x: number) => x.toFixed(2);
const f1 = (x: number) => x.toFixed(1);
const f3 = (x: number) => x.toFixed(3);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

const TARGETS: Target[] = [
  { label: 'Goals / team / game', nhl: 3.05, tol: 0.15, fmt: f2, get: (m) => (m.goals - m.so) / m.teamGames },
  { label: 'Shots on goal / team / game', nhl: 28.8, tol: 1.2, fmt: f1, get: (m) => m.shots / m.teamGames },
  { label: 'Shot attempts / team / game', nhl: 57, tol: 4, fmt: f1, get: (m) => m.attempts / m.teamGames },
  { label: 'League save % (non-EN)', nhl: 0.901, tol: 0.004, fmt: f3, get: (m) => m.savesNonEN / m.shotsAgainstNonEN },
  { label: 'Power plays / team / game', nhl: 3.0, tol: 0.35, fmt: f2, get: (m) => m.ppOpps / m.teamGames },
  { label: 'Power-play %', nhl: 0.21, tol: 0.02, fmt: pct, get: (m) => m.ppGoals / m.ppOpps },
  { label: 'Short-handed goals / team / game', nhl: 0.07, tol: 0.04, fmt: f2, get: (m) => m.shGoals / m.teamGames },
  { label: 'Empty-net goals / game', nhl: 0.24, tol: 0.08, fmt: f2, get: (m) => m.enGoals / m.games },
  { label: 'Assists per goal', nhl: 1.7, tol: 0.08, fmt: f2, get: (m) => m.assists / (m.goals - m.so) },
  { label: 'Hits / team / game', nhl: 22, tol: 3, fmt: f1, get: (m) => m.hits / m.teamGames },
  { label: 'Blocked shots / team / game', nhl: 14, tol: 2, fmt: f1, get: (m) => m.blocks / m.teamGames },
  { label: 'PIM / team / game', nhl: 7.5, tol: 1.5, fmt: f1, get: (m) => m.pim / m.teamGames },
  { label: 'Games to overtime', nhl: 0.23, tol: 0.03, fmt: pct, get: (m) => m.ot / m.games },
  { label: 'Games to shootout', nhl: 0.075, tol: 0.025, fmt: pct, get: (m) => m.so / m.games },
  { label: 'Home win %', nhl: 0.54, tol: 0.02, fmt: pct, get: (m) => m.homeWins / m.games },
  { label: 'Best team points', nhl: 122, tol: 10, fmt: f1, get: (m) => mean(m.ptsMax) },
  { label: 'Worst team points', nhl: 58, tol: 8, fmt: f1, get: (m) => mean(m.ptsMin) },
  { label: 'Team points std. dev.', nhl: 14, tol: 3, fmt: f1, get: (m) => mean(m.ptsSd) },
  { label: 'Points leader', nhl: 139, tol: 15, fmt: f1, get: (m) => mean(m.topPoints) },
  { label: 'Goals leader', nhl: 62, tol: 8, fmt: f1, get: (m) => mean(m.topGoals) },
  { label: 'Assists leader', nhl: 91, tol: 12, fmt: f1, get: (m) => mean(m.topAssists) },
  { label: '100-point players', nhl: 6, tol: 3, fmt: f1, get: (m) => mean(m.top100Pts) },
  { label: 'Top defenseman TOI (min)', nhl: 25.5, tol: 1.5, fmt: f1, get: (m) => mean(m.topDToi) },
  { label: 'Top forward TOI (min)', nhl: 22, tol: 1.5, fmt: f1, get: (m) => mean(m.topFToi) },
  { label: 'Shutouts leader', nhl: 7, tol: 3, fmt: f1, get: (m) => mean(m.topShutouts) },
  { label: 'Best faceoff % (min 500)', nhl: 0.6, tol: 0.03, fmt: pct, get: (m) => mean(m.topFoPct) },
  { label: 'Injuries / team / season', nhl: 25, tol: 8, fmt: f1, get: (m) => m.injuries / m.teamSeasons },
  { label: 'Man-games lost / team (approx.)', nhl: 260, tol: 90, fmt: f1, get: (m) => m.manGamesLost / m.teamSeasons },
  { label: 'Starts by backup goalies', nhl: 0.3, tol: 0.08, fmt: pct, get: (m) => m.backupStarts / m.goalieStarts },
  { label: 'Games per playoff series', nhl: 5.8, tol: 0.4, fmt: f2, get: (m) => m.seriesGames / m.series },
  { label: 'Playoff games to overtime', nhl: 0.22, tol: 0.06, fmt: pct, get: (m) => m.playoffOT / m.playoffGames },
  { label: 'Best goalie save % (min 40 GP)', nhl: 0.922, tol: 0.008, fmt: f3, get: (m) => mean(m.bestSvPct) },
  { label: 'Worst goalie save % (min 40 GP)', nhl: 0.885, tol: 0.008, fmt: f3, get: (m) => mean(m.worstSvPct) },
];

export function collect(leagues: League[]): Metrics {
  const m: Metrics = {
    teamGames: 0, games: 0, goals: 0, enGoals: 0, shots: 0, attempts: 0, ppOpps: 0, ppGoals: 0, shGoals: 0,
    hits: 0, blocks: 0, pim: 0, ot: 0, so: 0, homeWins: 0, assists: 0, savesNonEN: 0, shotsAgainstNonEN: 0,
    ptsMax: [], ptsMin: [], ptsSd: [], topPoints: [], topGoals: [], topAssists: [], topDToi: [], topFToi: [],
    topShutouts: [], topFoPct: [], bestSvPct: [], worstSvPct: [], top100Pts: [],
    injuries: 0, manGamesLost: 0, teamSeasons: 0, seriesGames: 0, series: 0, playoffGames: 0, playoffOT: 0,
    backupStarts: 0, goalieStarts: 0,
  };
  for (const L of leagues) {
    for (const g of L.schedule) {
      const r = g.result;
      if (!r) continue;
      const b = r.box;
      m.games++;
      m.teamGames += 2;
      m.goals += r.homeScore + r.awayScore;
      if (r.overtime) m.ot++;
      if (r.shootout) m.so++;
      if (r.homeScore > r.awayScore) m.homeWins++;
      for (const side of [b.home, b.away]) {
        m.shots += side.shots;
        m.attempts += side.attempts;
        m.ppOpps += side.ppOpps;
        m.ppGoals += side.ppGoals;
        m.hits += side.hits;
        m.blocks += side.blocks;
        m.pim += side.pim;
      }
      for (const goal of b.goals) {
        m.assists += goal.assists.length;
        if (goal.strength === 'EN') m.enGoals++;
        if (goal.strength === 'SH') m.shGoals++;
      }
      for (const gl of Object.values(b.goalies)) {
        m.savesNonEN += gl.sa - gl.ga;
        m.shotsAgainstNonEN += gl.sa;
      }
    }
    // Injuries and man-games lost (regular season only).
    m.teamSeasons += Object.keys(L.teams).length;
    const teamDays = new Map<string, number[]>();
    for (const g of L.schedule) {
      for (const t of [g.home, g.away]) {
        if (!teamDays.has(t)) teamDays.set(t, []);
        teamDays.get(t)!.push(g.day);
      }
    }
    const regEnd = Math.max(...L.schedule.map((g) => g.day));
    for (const tx of L.transactions) {
      if (tx.type !== 'injury' || tx.day > regEnd) continue;
      m.injuries++;
      const back = L.transactions.find((r) => r.type === 'return' && r.playerId === tx.playerId && r.day > tx.day);
      const until = back ? back.day : Infinity;
      m.manGamesLost += (teamDays.get(tx.teamId) ?? []).filter((d) => d > tx.day && d < until).length;
    }
    // Backup starts: starts by each team's goalie with fewer starts.
    const starts = new Map<string, number[]>();
    for (const [id, g] of Object.entries(L.goalieStats)) {
      const t = L.players[id].teamId!;
      if (!starts.has(t)) starts.set(t, []);
      starts.get(t)!.push(g.gs);
    }
    for (const list of starts.values()) {
      list.sort((a, b) => b - a);
      m.goalieStarts += list.reduce((a, b) => a + b, 0);
      m.backupStarts += list.slice(1).reduce((a, b) => a + b, 0);
    }
    for (const round of L.playoffs?.rounds ?? []) {
      for (const s of round) {
        m.series++;
        m.seriesGames += s.games.length;
        m.playoffGames += s.games.length;
        m.playoffOT += s.games.filter((g) => g.result!.overtime).length;
      }
    }

    const st = standings(L);
    const pts = st.map((s) => s.pts);
    m.ptsMax.push(Math.max(...pts));
    m.ptsMin.push(Math.min(...pts));
    const mu = mean(pts);
    m.ptsSd.push(Math.sqrt(mean(pts.map((p) => (p - mu) ** 2))));

    const sk = Object.entries(L.skaterStats);
    m.topPoints.push(Math.max(...sk.map(([, s]) => s.g + s.a)));
    m.topGoals.push(Math.max(...sk.map(([, s]) => s.g)));
    m.topAssists.push(Math.max(...sk.map(([, s]) => s.a)));
    m.top100Pts.push(sk.filter(([, s]) => s.g + s.a >= 100).length);
    const toi = (pos: (p: string) => boolean) =>
      Math.max(...sk.filter(([id, s]) => pos(L.players[id].pos) && s.gp >= 40).map(([, s]) => s.toi / s.gp / 60));
    m.topDToi.push(toi((p) => p === 'D'));
    m.topFToi.push(toi((p) => p !== 'D'));
    m.topFoPct.push(Math.max(...sk.filter(([, s]) => s.fow + s.fol >= 500).map(([, s]) => s.fow / (s.fow + s.fol))));
    const gs = Object.values(L.goalieStats);
    m.topShutouts.push(Math.max(...gs.map((g) => g.so)));
    const sv = gs.filter((g) => g.gp >= 40).map((g) => 1 - g.ga / g.sa);
    m.bestSvPct.push(Math.max(...sv));
    m.worstSvPct.push(Math.min(...sv));
  }
  return m;
}

export function report(m: Metrics) {
  let ok = 0;
  const rows = TARGETS.map((t) => {
    const v = t.get(m);
    const fmt = t.fmt ?? f2;
    const good = Math.abs(v - t.nhl) <= t.tol;
    if (good) ok++;
    return { stat: t.label, sim: fmt(v), nhl: fmt(t.nhl), status: good ? 'OK' : v > t.nhl ? 'HIGH' : 'LOW' };
  });
  const w = [36, 10, 10, 6];
  console.log(['Stat', 'Sim', 'NHL', ''].map((h, i) => h.padEnd(w[i])).join(''));
  console.log('-'.repeat(62));
  for (const r of rows) console.log(r.stat.padEnd(w[0]) + r.sim.padEnd(w[1]) + r.nhl.padEnd(w[2]) + r.status);
  console.log('-'.repeat(62));
  console.log(`${ok}/${rows.length} within tolerance`);
  return { ok, total: rows.length, rows };
}

const isMain = process.argv[1]?.endsWith('calibrate.ts');
if (isMain) {
  const n = Number(process.argv[2] ?? 5);
  const leagues: League[] = [];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const L = generateLeague({ seed: 1000 + i });
    advanceToEndOfSeason(L);
    leagues.push(L);
  }
  const secs = (Date.now() - t0) / 1000;
  console.log(`Simulated ${n} seasons (${n * 1312} games) in ${secs.toFixed(1)}s\n`);
  report(collect(leagues));
  // Talent sanity: correlation between team overall and points.
  const L = leagues[0];
  const st = standings(L);
  const teamOvr = (id: string) => {
    const t = L.teams[id];
    const ids = [...t.lines.forwards.flat(), ...t.lines.defense.flat(), t.lines.goalies[0]];
    return mean(ids.map((p) => overall(L.players[p])));
  };
  const xs = st.map((s) => teamOvr(s.teamId));
  const ys = st.map((s) => s.pts);
  const mx = mean(xs), my = mean(ys);
  const cov = mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
  const r = cov / Math.sqrt(mean(xs.map((x) => (x - mx) ** 2)) * mean(ys.map((y) => (y - my) ** 2)));
  console.log(`\nTeam-talent vs points correlation (season 1): r = ${r.toFixed(2)}  (want ~0.6–0.8: talent matters, luck still exists)`);
}
