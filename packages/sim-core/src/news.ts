/**
 * League news and the Hall of Fame.
 *
 * Game-level stories (hat tricks, big nights, streaks, milestones) are written
 * as games are played. Everything else (trades, big signings, star injuries,
 * retirements, the #1 pick) is derived from the transaction log, so no code
 * path has to remember to "also post news".
 */
import { overall } from './ratings';
import type { BoxScore, HallOfFamer, League, NewsItem, NewsKind, Player, RetiredPlayer, ScheduledGame, TeamId } from './types';

const MAX_NEWS = 400;

function state(league: League) {
  return (league.newsState ??= { txCursor: league.transactions.length, streaks: {}, nextId: 1 });
}

export function addNews(league: League, kind: NewsKind, headline: string, teamIds: TeamId[] = [], playerIds: string[] = []) {
  const s = state(league);
  const item: NewsItem = { id: s.nextId++, season: league.season, day: league.day, kind, headline, teamIds, playerIds };
  (league.news ??= []).push(item);
  if (league.news.length > MAX_NEWS) league.news.splice(0, league.news.length - MAX_NEWS);
}

const name = (p: Player) => `${p.firstName} ${p.lastName}`;
const city = (league: League, id: TeamId) => league.teams[id]?.city ?? id;

/** Stories from one finished game. `before` = the scorers' season totals before this game. */
export function gameNews(league: League, g: ScheduledGame, box: BoxScore, playoff: boolean, before: Record<string, { g: number; pts: number }>) {
  const r = g.result!;
  for (const [id, l] of Object.entries(box.skaters)) {
    const p = league.players[id];
    if (!p) continue;
    const team = p.teamId ?? '';
    if (l.g >= 3) addNews(league, 'game', `${name(p)} scores ${l.g === 3 ? 'a hat trick' : `${l.g} goals`} for ${city(league, team)}${playoff ? ' in the playoffs' : ''}`, [team], [id]);
    else if (l.g + l.a >= 5) addNews(league, 'game', `${name(p)} piles up ${l.g + l.a} points for ${city(league, team)}`, [team], [id]);
    if (!playoff) {
      const b = before[id] ?? { g: 0, pts: 0 };
      const s = league.skaterStats[id];
      if (s && b.g < 50 && s.g >= 50) addNews(league, 'milestone', `${name(p)} hits 50 goals`, [team], [id]);
      if (s && b.pts < 100 && s.g + s.a >= 100) addNews(league, 'milestone', `${name(p)} reaches 100 points`, [team], [id]);
    }
  }
  if (playoff) {
    for (const [id, l] of Object.entries(box.goalies)) {
      if (l.ga === 0 && l.decision === 'W' && l.toi >= 3000) {
        const p = league.players[id];
        if (p) addNews(league, 'game', `${name(p)} posts a playoff shutout`, [p.teamId ?? ''], [id]);
      }
    }
    if (r.overtime) {
      const last = box.goals.at(-1);
      const p = last && league.players[last.scorer];
      if (p) addNews(league, 'game', `${name(p)} ends it in overtime for ${city(league, last!.teamId)}`, [last!.teamId], [p.id]);
    }
  }
  if (!playoff) {
    const st = state(league).streaks;
    const winner = r.homeScore > r.awayScore ? g.home : g.away;
    const loser = winner === g.home ? g.away : g.home;
    st[winner] = Math.max(0, st[winner] ?? 0) + 1;
    st[loser] = Math.min(0, st[loser] ?? 0) - 1;
    if (st[winner] >= 8 && st[winner] % 2 === 0) addNews(league, 'streak', `${city(league, winner)} win ${st[winner]} straight`, [winner]);
    if (st[loser] <= -8 && st[loser] % 2 === 0) addNews(league, 'streak', `${city(league, loser)} have lost ${-st[loser]} in a row`, [loser]);
  }
}

/** Turn new transactions into headlines. Call after anything that logs transactions. */
export function newsFromTransactions(league: League) {
  const s = state(league);
  const txs = league.transactions;
  if (s.txCursor > txs.length) s.txCursor = txs.length; // log was trimmed
  const seenTrades = new Set<string>();
  for (let i = s.txCursor; i < txs.length; i++) {
    const t = txs[i];
    const p = league.players[t.playerId];
    switch (t.type) {
      case 'trade':
        if (!seenTrades.has(t.note)) {
          seenTrades.add(t.note);
          addNews(league, 'trade', t.note, [t.teamId], t.playerId ? [t.playerId] : []);
        }
        break;
      case 'signing':
      case 're-sign':
        if (p?.contract && p.contract.salary >= 6_000_000) {
          addNews(league, 'signing', `${city(league, t.teamId)}: ${t.note}`, [t.teamId], [t.playerId]);
        }
        break;
      case 'injury':
        if (p && overall(p) >= 80 && p.injury && p.injury.daysLeft >= 20) addNews(league, 'injury', `${city(league, t.teamId)} lose ${name(p)}: ${p.injury.type}, about ${Math.round(p.injury.daysLeft / 7)} weeks`, [t.teamId], [p.id]);
        break;
      case 'offer-sheet':
        addNews(league, 'signing', t.note, [t.teamId], [t.playerId]);
        break;
      case 'arbitration':
        if (p?.contract && p.contract.salary >= 4_000_000) addNews(league, 'signing', `${city(league, t.teamId)}: ${t.note}`, [t.teamId], [t.playerId]);
        break;
      case 'retirement': {
        const r = league.retired?.[t.playerId];
        if (r && r.peakOverall >= 80) addNews(league, 'retirement', t.note, [t.teamId], [t.playerId]);
        break;
      }
      case 'draft':
        if (t.note.startsWith('Round 1, #1:')) addNews(league, 'draft', `${city(league, t.teamId)} take ${t.note.replace('Round 1, #1: ', '')} first overall`, [t.teamId], [t.playerId]);
        break;
      default:
        break;
    }
  }
  s.txCursor = txs.length;
}

// ---------------------------------------------------------------------------
// Hall of Fame
// ---------------------------------------------------------------------------

export const HOF_THRESHOLD = 700;

export function hallOfFameScore(league: League, r: RetiredPlayer): number {
  const awards = league.history.reduce((n, h) => n + Object.values(h.awards).filter((w) => w.playerId === r.id).length, 0);
  const cups = league.history.filter((h) => h.champion && r.career.some((c) => c.season === h.season && c.teamId === h.champion)).length;
  const peak = Math.max(0, r.peakOverall - 84) * 60;
  let production =
    r.pos === 'G'
      ? r.career.reduce((s, c) => s + (c.goalie?.w ?? 0) * 2, 0)
      : r.career.reduce((s, c) => s + (c.skater ? c.skater.g + c.skater.a : 0), 0);
  // Players who were already veterans when the league began: credit the seasons
  // before the league existed, estimated from how good they were at their peak.
  const pro = Math.max(0, r.retiredAfter - r.birthYear - 19);
  const missing = Math.max(0, pro - r.career.length);
  const perSeason = r.pos === 'G' ? Math.max(0, r.peakOverall - 65) * 3 : Math.max(0, r.peakOverall - 60) * 2.2;
  production += missing * perSeason * 0.8;
  return production + awards * 150 + cups * 40 + peak;
}

export function considerForHallOfFame(league: League, r: RetiredPlayer) {
  const score = hallOfFameScore(league, r);
  if (score < HOF_THRESHOLD) return;
  const totals = r.career.reduce(
    (t, c) => ({ gp: t.gp + (c.skater?.gp ?? c.goalie?.gp ?? 0), pts: t.pts + (c.skater ? c.skater.g + c.skater.a : 0), w: t.w + (c.goalie?.w ?? 0) }),
    { gp: 0, pts: 0, w: 0 },
  );
  const hof: HallOfFamer = {
    playerId: r.id,
    name: r.name,
    pos: r.pos,
    inducted: league.season,
    seasons: r.career.length,
    lastTeamId: r.lastTeamId,
    summary: r.pos === 'G' ? `${totals.gp} GP, ${totals.w} wins, peak ${r.peakOverall} OVR` : `${totals.gp} GP, ${totals.pts} points, peak ${r.peakOverall} OVR`,
  };
  (league.hallOfFame ??= []).push(hof);
  addNews(league, 'hof', `${r.name} is inducted into the Hall of Fame`, r.lastTeamId ? [r.lastTeamId] : [], [r.id]);
}
