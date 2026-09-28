/**
 * Season awards, decided from results (never from hidden ratings).
 * Regular-season awards are handed out when the regular season ends; the
 * playoff MVP when the final ends.
 */
import type { AwardWinner, GoalieSeasonStats, League, PlayerId, SkaterSeasonStats, StandingsRow } from './types';

const fmtSv = (x: number) => x.toFixed(3).replace(/^0/, '');

function leagueSvPct(stats: Record<PlayerId, GoalieSeasonStats>): number {
  let sa = 0, ga = 0;
  for (const g of Object.values(stats)) {
    sa += g.sa;
    ga += g.ga;
  }
  return sa ? 1 - ga / sa : 0.9;
}

/** Goals saved above an average goalie facing the same shots. */
function gsaa(g: GoalieSeasonStats, lgSv: number): number {
  return g.sa - g.ga - g.sa * lgSv;
}

function best<T>(items: T[], score: (t: T) => number): T | undefined {
  let top: T | undefined;
  let topScore = -Infinity;
  for (const it of items) {
    const s = score(it);
    if (s > topScore) {
      topScore = s;
      top = it;
    }
  }
  return top;
}

export function regularSeasonAwards(league: League, st: StandingsRow[]): Record<string, AwardWinner> {
  const awards: Record<string, AwardWinner> = {};
  const P = league.players;
  const team = (id: PlayerId) => P[id].teamId ?? '';
  const sk = Object.entries(league.skaterStats) as [PlayerId, SkaterSeasonStats][];
  const gs = Object.entries(league.goalieStats) as [PlayerId, GoalieSeasonStats][];
  const lgSv = leagueSvPct(league.goalieStats);
  const pts = (s: SkaterSeasonStats) => s.g + s.a;
  const teamPct = new Map(st.map((r) => [r.teamId, r.pointsPct]));

  const top = st[0];
  awards["Presidents' Trophy"] = { playerId: null, teamId: top.teamId, note: `${top.pts} PTS (${top.w}-${top.l}-${top.otl})` };

  const artRoss = best(sk, ([, s]) => pts(s) + s.g / 1000);
  if (artRoss) awards['Art Ross Trophy'] = { playerId: artRoss[0], teamId: team(artRoss[0]), note: `${pts(artRoss[1])} PTS (${artRoss[1].g} G, ${artRoss[1].a} A)` };

  const richard = best(sk, ([, s]) => s.g + pts(s) / 1000);
  if (richard) awards['Rocket Richard Trophy'] = { playerId: richard[0], teamId: team(richard[0]), note: `${richard[1].g} G` };

  // Hart: production plus impact, weighted by how good the team was.
  const hartSk = best(
    sk.filter(([, s]) => s.gp >= 60),
    ([id, s]) => (pts(s) + 0.3 * s.pm) * (0.8 + 0.4 * (teamPct.get(team(id)) ?? 0.5)),
  );
  const hartG = best(
    gs.filter(([, g]) => g.gp >= 45),
    ([id, g]) => (gsaa(g, lgSv) * 3.2 + g.w) * (0.8 + 0.4 * (teamPct.get(team(id)) ?? 0.5)),
  );
  if (hartSk) {
    const s = hartSk[1];
    const skScore = (pts(s) + 0.3 * s.pm) * (0.8 + 0.4 * (teamPct.get(team(hartSk[0])) ?? 0.5));
    const g = hartG?.[1];
    const gScore = g ? (gsaa(g, lgSv) * 3.2 + g.w) * (0.8 + 0.4 * (teamPct.get(team(hartG![0])) ?? 0.5)) : -Infinity;
    awards['Hart Trophy'] =
      gScore > skScore && hartG
        ? { playerId: hartG[0], teamId: team(hartG[0]), note: `${g!.w} W, ${fmtSv(1 - g!.ga / g!.sa)} SV%` }
        : { playerId: hartSk[0], teamId: team(hartSk[0]), note: `${pts(s)} PTS, ${s.pm >= 0 ? '+' : ''}${s.pm}` };
  }

  const vez = best(gs.filter(([, g]) => g.gp >= 40), ([, g]) => gsaa(g, lgSv));
  if (vez) {
    const g = vez[1];
    awards['Vezina Trophy'] = {
      playerId: vez[0],
      teamId: team(vez[0]),
      note: `${fmtSv(1 - g.ga / g.sa)} SV%, ${((g.ga * 3600) / g.toi).toFixed(2)} GAA, ${g.so} SO`,
    };
  }

  const norris = best(
    sk.filter(([id, s]) => P[id].pos === 'D' && s.gp >= 60),
    ([, s]) => pts(s) + 0.4 * s.pm + 2 * (s.toi / s.gp / 60 - 20) + 0.05 * s.blk,
  );
  if (norris) awards['Norris Trophy'] = { playerId: norris[0], teamId: team(norris[0]), note: `${pts(norris[1])} PTS, ${(norris[1].toi / norris[1].gp / 60).toFixed(1)} TOI/GP` };

  const selke = best(
    sk.filter(([id, s]) => P[id].pos !== 'D' && s.gp >= 60),
    ([, s]) => s.pm + 0.06 * s.blk + 0.03 * (s.fow - s.fol) + 3 * s.shg + 0.15 * pts(s),
  );
  if (selke) awards['Selke Trophy'] = { playerId: selke[0], teamId: team(selke[0]), note: `${selke[1].pm >= 0 ? '+' : ''}${selke[1].pm}, ${selke[1].blk} BLK` };

  // Rookie: no earlier season with 25+ skater games (or 10+ goalie games), age 26 or younger.
  const isRookie = (id: PlayerId) =>
    league.season - P[id].birthYear <= 26 &&
    !(league.careerStats?.[id] ?? []).some((c) => c.season < league.season && ((c.skater?.gp ?? 0) >= 25 || (c.goalie?.gp ?? 0) >= 10));
  const calderSk = best(sk.filter(([id, s]) => isRookie(id) && s.gp >= 40), ([, s]) => pts(s) + 0.2 * s.pm);
  const calderG = best(gs.filter(([id, g]) => isRookie(id) && g.gp >= 25), ([, g]) => gsaa(g, lgSv) * 3 + g.w);
  const cSk = calderSk ? pts(calderSk[1]) + 0.2 * calderSk[1].pm : -Infinity;
  const cG = calderG ? gsaa(calderG[1], lgSv) * 3 + calderG[1].w : -Infinity;
  if (calderSk || calderG) {
    awards['Calder Trophy'] =
      cG > cSk
        ? { playerId: calderG![0], teamId: team(calderG![0]), note: `${calderG![1].w} W, ${fmtSv(1 - calderG![1].ga / calderG![1].sa)} SV%` }
        : { playerId: calderSk![0], teamId: team(calderSk![0]), note: `${pts(calderSk![1])} PTS` };
  }
  return awards;
}

export function playoffMvp(league: League, champion: string, runnerUp: string): AwardWinner | null {
  const P = league.players;
  const lgSv = leagueSvPct(league.playoffGoalieStats);
  const onFinalist = (id: PlayerId) => P[id].teamId === champion || P[id].teamId === runnerUp;
  const bonus = (id: PlayerId) => (P[id].teamId === champion ? 1.3 : 1);
  const sk = Object.entries(league.playoffSkaterStats).filter(([id]) => onFinalist(id));
  const gs = Object.entries(league.playoffGoalieStats).filter(([id]) => onFinalist(id));
  const skBest = best(sk, ([id, s]) => (s.g + s.a + 0.3 * s.pm) * bonus(id));
  const gBest = best(gs, ([id, g]) => (gsaa(g, lgSv) * 3 + g.w) * bonus(id));
  const skScore = skBest ? (skBest[1].g + skBest[1].a + 0.3 * skBest[1].pm) * bonus(skBest[0]) : -Infinity;
  const gScore = gBest ? (gsaa(gBest[1], lgSv) * 3 + gBest[1].w) * bonus(gBest[0]) : -Infinity;
  if (gScore > skScore && gBest) {
    const g = gBest[1];
    return { playerId: gBest[0], teamId: P[gBest[0]].teamId!, note: `${g.w} W, ${fmtSv(1 - g.ga / g.sa)} SV%` };
  }
  if (!skBest) return null;
  const s = skBest[1];
  return { playerId: skBest[0], teamId: P[skBest[0]].teamId!, note: `${s.g + s.a} PTS (${s.g} G, ${s.a} A)` };
}
