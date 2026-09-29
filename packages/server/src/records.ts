/**
 * Career and franchise records, built from the players' season-by-season
 * career lines (active and retired) plus the season in progress.
 */
import { age, minorLeagueOf, type CareerLine, type GoalieSeasonStats, type League, type SkaterSeasonStats } from '@hockey-gm/sim-core';

export interface Career {
  id: string;
  name: string;
  pos: string;
  /** Still in the league (not retired). */
  active: boolean;
  /** Current team (active players). */
  teamId: string | null;
  lines: CareerLine[];
}

/** Every player's career, including the season in progress when it isn't archived yet. */
export function allCareers(L: League): Career[] {
  const out: Career[] = [];
  const liveSeason = L.phase !== 'offseason' || !L.offseason; // (archived when the offseason opens)
  for (const [id, lines] of Object.entries(L.careerStats ?? {})) {
    const p = L.players[id];
    if (!p) continue;
    out.push({ id, name: `${p.firstName} ${p.lastName}`, pos: p.pos, active: true, teamId: p.teamId, lines: [...lines] });
  }
  const byId = new Map(out.map((c) => [c.id, c]));
  if (liveSeason) {
    for (const p of Object.values(L.players)) {
      const sk = L.skaterStats[p.id];
      const gs = L.goalieStats[p.id];
      if (!sk && !gs) continue;
      let c = byId.get(p.id);
      if (!c) {
        c = { id: p.id, name: `${p.firstName} ${p.lastName}`, pos: p.pos, active: true, teamId: p.teamId, lines: [] };
        out.push(c);
        byId.set(p.id, c);
      }
      c.lines.push({
        season: L.season,
        teamId: p.teamId,
        age: age(p, L.season),
        overall: 0,
        skater: sk ?? null,
        goalie: gs ?? null,
        playoffSkater: L.playoffSkaterStats[p.id] ?? null,
        playoffGoalie: L.playoffGoalieStats[p.id] ?? null,
      });
    }
  }
  for (const r of Object.values(L.retired ?? {})) {
    if (byId.has(r.id)) continue;
    out.push({ id: r.id, name: r.name, pos: r.pos, active: false, teamId: null, lines: r.career });
  }
  return out;
}

export interface SkaterTotals {
  seasons: number;
  gp: number;
  g: number;
  a: number;
  p: number;
  pm: number;
  pim: number;
  ppg: number;
  gwg: number;
  sog: number;
}
export interface GoalieTotals {
  seasons: number;
  gp: number;
  w: number;
  so: number;
  sa: number;
  ga: number;
  toi: number;
}

function sumSkater(lines: Array<SkaterSeasonStats | null | undefined>): SkaterTotals | null {
  const xs = lines.filter((x): x is SkaterSeasonStats => !!x && x.gp > 0);
  if (!xs.length) return null;
  const t = { seasons: xs.length, gp: 0, g: 0, a: 0, p: 0, pm: 0, pim: 0, ppg: 0, gwg: 0, sog: 0 };
  for (const s of xs) {
    t.gp += s.gp;
    t.g += s.g;
    t.a += s.a;
    t.pm += s.pm;
    t.pim += s.pim;
    t.ppg += s.ppg;
    t.gwg += s.gwg ?? 0;
    t.sog += s.sog;
  }
  t.p = t.g + t.a;
  return t;
}
function sumGoalie(lines: Array<GoalieSeasonStats | null | undefined>): GoalieTotals | null {
  const xs = lines.filter((x): x is GoalieSeasonStats => !!x && x.gp > 0);
  if (!xs.length) return null;
  const t = { seasons: xs.length, gp: 0, w: 0, so: 0, sa: 0, ga: 0, toi: 0 };
  for (const g of xs) {
    t.gp += g.gp;
    t.w += g.w;
    t.so += g.so;
    t.sa += g.sa;
    t.ga += g.ga;
    t.toi += g.toi;
  }
  return t;
}

/** Regular-season totals for a set of career lines. */
export function totals(lines: CareerLine[]) {
  return { skater: sumSkater(lines.map((l) => l.skater)), goalie: sumGoalie(lines.map((l) => l.goalie)) };
}

/** A team's records: career leaders with the club, and its best single seasons. */
export function franchiseRecords(L: League, teamId: string) {
  const careers = allCareers(L);
  const skaters: Array<{ id: string; name: string; pos: string; active: boolean; current: boolean; t: SkaterTotals; from: number; to: number }> = [];
  const goalies: Array<{ id: string; name: string; pos: string; active: boolean; current: boolean; t: GoalieTotals; from: number; to: number }> = [];
  const seasons: Array<{ id: string; name: string; pos: string; season: number; s: SkaterSeasonStats }> = [];
  const goalieSeasons: Array<{ id: string; name: string; season: number; g: GoalieSeasonStats }> = [];
  for (const c of careers) {
    const mine = c.lines.filter((l) => l.teamId === teamId && (l.skater?.gp || l.goalie?.gp));
    if (!mine.length) continue;
    const { skater, goalie } = totals(mine);
    const span = mine.map((l) => l.season);
    const base = { id: c.id, name: c.name, pos: c.pos, active: c.active, current: c.teamId === teamId, from: Math.min(...span), to: Math.max(...span) };
    if (skater) skaters.push({ ...base, t: skater });
    if (goalie) goalies.push({ ...base, t: goalie });
    for (const l of mine) {
      if (l.skater?.gp) seasons.push({ id: c.id, name: c.name, pos: c.pos, season: l.season, s: l.skater });
      if (l.goalie?.gp) goalieSeasons.push({ id: c.id, name: c.name, season: l.season, g: l.goalie });
    }
  }
  return {
    skaters: skaters.sort((a, b) => b.t.p - a.t.p || b.t.g - a.t.g).slice(0, 50),
    goalies: goalies.sort((a, b) => b.t.w - a.t.w).slice(0, 15),
    bestSeasons: seasons
      .sort((a, b) => b.s.g + b.s.a - (a.s.g + a.s.a) || b.s.g - a.s.g)
      .slice(0, 10)
      .map((x) => ({ id: x.id, name: x.name, pos: x.pos, season: x.season, gp: x.s.gp, g: x.s.g, a: x.s.a, p: x.s.g + x.s.a })),
    bestGoalieSeasons: goalieSeasons
      .sort((a, b) => b.g.w - a.g.w)
      .slice(0, 5)
      .map((x) => ({ id: x.id, name: x.name, season: x.season, gp: x.g.gp, w: x.g.w, so: x.g.so, sv: x.g.sa ? 1 - x.g.ga / x.g.sa : null })),
  };
}

/** Each team's all-time leading scorer. */
export function franchiseTopScorers(L: League): Record<string, { id: string; name: string; p: number; gp: number } | null> {
  const best: Record<string, { id: string; name: string; p: number; gp: number } | null> = Object.fromEntries(Object.keys(L.teams).map((t) => [t, null]));
  for (const c of allCareers(L)) {
    const byTeam = new Map<string, CareerLine[]>();
    for (const l of c.lines) if (l.teamId && l.skater?.gp) (byTeam.get(l.teamId) ?? byTeam.set(l.teamId, []).get(l.teamId)!).push(l);
    for (const [teamId, lines] of byTeam) {
      const t = totals(lines).skater;
      if (!t || !(teamId in best)) continue;
      if (!best[teamId] || t.p > best[teamId]!.p) best[teamId] = { id: c.id, name: c.name, p: t.p, gp: t.gp };
    }
  }
  return best;
}

/** Junior / college / European / AHL scorers: drafted prospects not in the NHL, or this year's undrafted class. */
export function minorLeaders(L: League, scope: 'prospects' | 'undrafted', season: number) {
  type Row = {
    id: string;
    name: string;
    pos: string;
    age: number;
    league: string;
    club: string | null;
    orgId: string | null;
    draft: string | null;
    gp: number;
    g: number;
    a: number;
    p: number;
    pim: number;
    w: number;
    sa: number;
    ga: number;
    so: number;
  };
  const rows: Row[] = [];
  const draftLabel = (d: { season: number; round: number; overall: number } | undefined) => (d ? `${d.season} R${d.round} #${d.overall}` : null);
  if (season === L.season && !(L.phase === 'offseason' && L.offseason)) {
    for (const p of Object.values(L.players)) {
      const s = L.prospectStats?.[p.id];
      if (!s || !s.gp) continue;
      const drafted = !!p.draft && (!!p.prospectOf || !!p.farm);
      const undrafted = !p.draft && !p.teamId && !p.prospectOf;
      if (scope === 'prospects' ? !drafted : !undrafted) continue;
      const m = minorLeagueOf(L, p);
      rows.push({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        pos: p.pos,
        age: age(p, season),
        league: s.league ?? m.league,
        club: s.team ?? m.team,
        orgId: p.prospectOf ?? p.teamId ?? null,
        draft: draftLabel(p.draft),
        gp: s.gp,
        g: s.g,
        a: s.a,
        p: s.g + s.a,
        pim: s.pim,
        w: s.w ?? 0,
        sa: s.sa ?? 0,
        ga: s.ga ?? 0,
        so: s.so ?? 0,
      });
    }
  } else {
    // Archived seasons: minor-league lines, split by whether he'd been drafted
    // before that season (a player picked the summer after it was still undrafted).
    for (const c of allCareers(L)) {
      const p = L.players[c.id];
      if (!p) continue;
      const d = p.draft ?? null;
      for (const l of c.lines) {
        const s = l.minor;
        if (l.season !== season || !s || !s.gp) continue;
        const draftedBefore = !!d && d.season < season;
        if (scope === 'prospects' ? !draftedBefore : draftedBefore || (!!l.skater?.gp || !!l.goalie?.gp)) continue;
        rows.push({
          id: c.id,
          name: c.name,
          pos: c.pos,
          age: l.age,
          league: s.league,
          club: s.team ?? null,
          orgId: l.orgId ?? null,
          draft: draftLabel(d ?? undefined),
          gp: s.gp,
          g: s.g,
          a: s.a,
          p: s.g + s.a,
          pim: s.pim,
          w: s.w ?? 0,
          sa: s.sa ?? 0,
          ga: s.ga ?? 0,
          so: s.so ?? 0,
        });
      }
    }
  }
  const skaters = rows.filter((r) => r.pos !== 'G').sort((a, b) => b.p - a.p || b.g - a.g || a.gp - b.gp).slice(0, 100);
  const goalies = rows.filter((r) => r.pos === 'G' && r.gp >= 5).sort((a, b) => b.w - a.w).slice(0, 30);
  return { skaters, goalies };
}
