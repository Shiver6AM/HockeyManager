/**
 * Long-run stability check: one league played for many seasons, offseasons
 * included. Talent, ages, scoring and rosters should stay in realistic ranges
 * rather than drifting over the decades.
 *
 *   npm run dynasty -- [seasons=10] [seed=99]
 */
import {
  advanceToEndOfSeason,
  advanceToNextSeason,
  age,
  generateLeague,
  overall,
  standings,
  type League,
} from '../packages/sim-core/src/index';

const seasons = Number(process.argv[2] ?? 10);
const seed = Number(process.argv[3] ?? 99);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

interface Row {
  season: number;
  gpg: number;
  svPct: number;
  best: number;
  worst: number;
  leader: string;
  talent: number;
  n80: number;
  n90: number;
  age: number;
  retired: number;
  drafted1st: string;
  champ: string;
  rosterMin: number;
  rosterMax: number;
  mb: number;
}

function snapshot(L: League): Omit<Row, 'retired' | 'rosterMin' | 'rosterMax' | 'mb'> {
  let goals = 0;
  let games = 0;
  let sa = 0;
  let ga = 0;
  for (const g of L.schedule) {
    if (!g.result) continue;
    games++;
    goals += g.result.homeScore + g.result.awayScore - (g.result.shootout ? 1 : 0);
  }
  for (const s of Object.values(L.goalieStats)) {
    sa += s.sa;
    ga += s.ga;
  }
  const st = standings(L);
  const sk = Object.entries(L.skaterStats);
  const [lid, ls] = sk.reduce((a, b) => (b[1].g + b[1].a > a[1].g + a[1].a ? b : a));
  const rostered = Object.values(L.players).filter((p) => p.teamId);
  const ovrs = rostered.map(overall);
  const first = L.offseason?.draft.picks[0];
  const fp = first?.playerId ? L.players[first.playerId] : null;
  return {
    season: L.season,
    gpg: goals / games / 2,
    svPct: 1 - ga / sa,
    best: st[0].pts,
    worst: st[st.length - 1].pts,
    leader: `${L.players[lid]?.lastName ?? '?'} ${ls.g + ls.a}`,
    talent: mean(ovrs),
    n80: ovrs.filter((o) => o >= 80).length,
    n90: ovrs.filter((o) => o >= 90).length,
    age: mean(rostered.map((p) => age(p, L.season))),
    drafted1st: fp ? `${fp.lastName} (${fp.pos}) → ${first!.teamId}` : '—',
    champ: L.playoffs?.champion ?? '—',
  };
}

const L = generateLeague({ seed });
const rows: Row[] = [];
const t0 = Date.now();
for (let i = 0; i < seasons; i++) {
  advanceToEndOfSeason(L);
  const snap = snapshot(L);
  const retired = Object.values(L.retired ?? {}).filter((r) => r.retiredAfter === L.season).length;
  advanceToNextSeason(L);
  const sizes = Object.values(L.teams).map((t) => t.roster.length);
  rows.push({ ...snap, retired, rosterMin: Math.min(...sizes), rosterMax: Math.max(...sizes), mb: JSON.stringify(L).length / 1e6 });
}

const header = ['Season', 'G/GP', 'SV%', 'Best', 'Worst', 'Points leader', 'Talent', '80+', '90+', 'Age', 'Ret.', 'Champ', '#1 pick', 'Rosters', 'Save'];
const w = [8, 6, 6, 5, 6, 18, 7, 5, 5, 6, 5, 6, 26, 8, 6];
console.log(header.map((h, i) => h.padEnd(w[i])).join(''));
for (const r of rows) {
  const cells = [
    `${r.season}`, r.gpg.toFixed(2), r.svPct.toFixed(3).slice(1), `${r.best}`, `${r.worst}`, r.leader, r.talent.toFixed(1), `${r.n80}`, `${r.n90}`,
    r.age.toFixed(1), `${r.retired}`, r.champ, r.drafted1st, `${r.rosterMin}-${r.rosterMax}`, `${r.mb.toFixed(1)}MB`,
  ];
  console.log(cells.map((c, i) => c.padEnd(w[i])).join(''));
}
const talent = rows.map((r) => r.talent);
console.log(`\n${seasons} seasons in ${((Date.now() - t0) / 1000).toFixed(0)}s. Talent range ${Math.min(...talent).toFixed(1)}–${Math.max(...talent).toFixed(1)}; goals/game ${Math.min(...rows.map((r) => r.gpg)).toFixed(2)}–${Math.max(...rows.map((r) => r.gpg)).toFixed(2)}.`);
const champs = new Set(rows.map((r) => r.champ));
console.log(`${champs.size} different champions.`);
