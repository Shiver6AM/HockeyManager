/**
 * Generate a league, simulate a full season, and print standings, leaders
 * and a sample box score.
 *
 *   npm run demo -- [seed]
 */
import { advanceDays, advanceToEnd, generateLeague, overall, standings } from '../packages/sim-core/src/index';

const seed = Number(process.argv[2] ?? 2026);
const L = generateLeague({ seed, humans: { HAL: 'you' } });
const name = (id: string) => {
  const p = L.players[id];
  return `${p.firstName[0]}. ${p.lastName}`;
};
const team = (id: string) => L.teams[id];

// Play one day first so we can show a real box score from opening night.
advanceDays(L, 1);
const opener = L.schedule.find((g) => g.result)!;
const r = opener.result!;
const b = r.box;
console.log(`\n=== Opening night: ${team(opener.away).city} ${r.awayScore} @ ${team(opener.home).city} ${r.homeScore}${r.shootout ? ' (SO)' : r.overtime ? ' (OT)' : ''} ===`);
console.log(`Shots: ${opener.away} ${b.away.shots} - ${opener.home} ${b.home.shots}   PP: ${opener.away} ${b.away.ppGoals}/${b.away.ppOpps}, ${opener.home} ${b.home.ppGoals}/${b.home.ppOpps}`);
for (const g of b.goals) {
  const per = g.period === 4 ? 'OT' : `P${g.period}`;
  const t = `${Math.floor(g.time / 60)}:${String(g.time % 60).padStart(2, '0')}`;
  const ast = g.assists.length ? ` (${g.assists.map(name).join(', ')})` : ' (unassisted)';
  console.log(`  ${per} ${t.padStart(5)}  ${g.teamId.padEnd(4)} ${name(g.scorer)}${ast}${g.strength !== 'EV' ? ` [${g.strength}]` : ''}`);
}
console.log(`  Stars: ${b.stars.map(name).join(', ')}`);

advanceToEnd(L);
const st = standings(L);
console.log(`\n=== ${L.name} ${L.season}-${String(L.season + 1).slice(2)} final standings ===`);
const divisions = [...new Set(Object.values(L.teams).map((t) => `${t.conference}|${t.division}`))];
for (const d of divisions) {
  const [conf, div] = d.split('|');
  console.log(`\n${conf} - ${div}`);
  console.log('Team'.padEnd(28) + 'GP  W   L   OTL PTS  GF  GA  STRK');
  for (const row of st.filter((s) => team(s.teamId).division === div)) {
    const t = team(row.teamId);
    const tag = t.controller.kind === 'human' ? ' *' : '';
    console.log(
      `${(t.city + ' ' + t.name + tag).padEnd(28)}${String(row.gp).padEnd(4)}${String(row.w).padEnd(4)}${String(row.l).padEnd(4)}${String(row.otl).padEnd(4)}${String(row.pts).padEnd(5)}${String(row.gf).padEnd(4)}${String(row.ga).padEnd(4)}${row.streak}`,
    );
  }
}
console.log('\n* = human-managed');

const sk = Object.entries(L.skaterStats);
console.log('\n=== Scoring leaders ===');
console.log('Player'.padEnd(22) + 'Team Pos OVR  GP   G    A    PTS  +/-  SOG  TOI');
for (const [id, s] of sk.sort((a, b) => b[1].g + b[1].a - (a[1].g + a[1].a) || b[1].g - a[1].g).slice(0, 15)) {
  const p = L.players[id];
  const toi = s.toi / s.gp / 60;
  console.log(
    `${name(id).padEnd(22)}${p.teamId!.padEnd(5)}${p.pos.padEnd(4)}${String(overall(p)).padEnd(5)}${String(s.gp).padEnd(5)}${String(s.g).padEnd(5)}${String(s.a).padEnd(5)}${String(s.g + s.a).padEnd(5)}${String(s.pm).padEnd(5)}${String(s.sog).padEnd(5)}${Math.floor(toi)}:${String(Math.round((toi % 1) * 60)).padStart(2, '0')}`,
  );
}

console.log('\n=== Goalies (min 40 GP) ===');
console.log('Player'.padEnd(22) + 'Team GP  W   L   OTL SV%    GAA   SO');
const gs = Object.entries(L.goalieStats).filter(([, g]) => g.gp >= 40);
for (const [id, g] of gs.sort((a, b) => (1 - b[1].ga / b[1].sa) - (1 - a[1].ga / a[1].sa)).slice(0, 10)) {
  const p = L.players[id];
  const sv = (1 - g.ga / g.sa).toFixed(3).slice(1);
  const gaa = ((g.ga * 3600) / g.toi).toFixed(2);
  console.log(`${name(id).padEnd(22)}${p.teamId!.padEnd(5)}${String(g.gp).padEnd(4)}${String(g.w).padEnd(4)}${String(g.l).padEnd(4)}${String(g.otl).padEnd(4)}${sv.padEnd(7)}${gaa.padEnd(6)}${g.so}`);
}
