/**
 * NHL-format playoffs: 16 teams (top 3 in each division plus 2 wild cards
 * per conference), best-of-seven series with 2-2-1-1-1 home ice, games every
 * other day, and a rest day between rounds.
 */
import type { League, PlayoffSeries, Playoffs, StandingsRow, TeamId } from './types';

/** Home team for games 1–7 (true = higher seed at home). */
export const HOME_PATTERN = [true, true, false, false, true, false, true];
export const WINS_NEEDED = 4;

function series(id: string, round: number, conference: string | null, a: TeamId, b: TeamId, rank: Map<TeamId, number>): PlayoffSeries {
  const [high, low] = rank.get(a)! <= rank.get(b)! ? [a, b] : [b, a];
  return { id, round, conference, high, low, highWins: 0, lowWins: 0, games: [], winner: null };
}

export function seedPlayoffs(league: League, st: StandingsRow[], startDay: number): Playoffs {
  const rank = new Map(st.map((r, i) => [r.teamId, i]));
  const conferences = [...new Set(Object.values(league.teams).map((t) => t.conference))].sort();
  const round1: PlayoffSeries[] = [];
  for (const conf of conferences) {
    const confRows = st.filter((r) => league.teams[r.teamId].conference === conf);
    const divisions = [...new Set(confRows.map((r) => league.teams[r.teamId].division))];
    const divTop = divisions.map((d) => confRows.filter((r) => league.teams[r.teamId].division === d).slice(0, 3).map((r) => r.teamId));
    const qualified = new Set(divTop.flat());
    const wildCards = confRows.filter((r) => !qualified.has(r.teamId)).slice(0, 2).map((r) => r.teamId);
    // The better division winner plays the second wild card.
    divTop.sort((a, b) => rank.get(a[0])! - rank.get(b[0])!);
    const [A, B] = divTop;
    const [wc1, wc2] = wildCards;
    let n = 0;
    round1.push(series(`R1-${conf}-${++n}`, 1, conf, A[0], wc2, rank));
    round1.push(series(`R1-${conf}-${++n}`, 1, conf, A[1], A[2], rank));
    round1.push(series(`R1-${conf}-${++n}`, 1, conf, B[0], wc1, rank));
    round1.push(series(`R1-${conf}-${++n}`, 1, conf, B[1], B[2], rank));
  }
  return { rounds: [round1], roundStartDay: startDay, champion: null };
}

/** Build the next round from the finished one, preserving bracket order. */
export function nextRound(league: League, po: Playoffs, st: StandingsRow[]): PlayoffSeries[] | null {
  const rank = new Map(st.map((r, i) => [r.teamId, i]));
  const prev = po.rounds[po.rounds.length - 1];
  const round = prev[0].round + 1;
  if (prev.length === 1) return null; // the final just ended
  const out: PlayoffSeries[] = [];
  if (prev.length === 2) {
    // Conference champions meet in the final.
    out.push(series(`R${round}-Final`, round, null, prev[0].winner!, prev[1].winner!, rank));
    return out;
  }
  for (let i = 0; i < prev.length; i += 2) {
    const conf = prev[i].conference;
    out.push(series(`R${round}-${conf}-${i / 2 + 1}`, round, conf, prev[i].winner!, prev[i + 1].winner!, rank));
  }
  return out;
}

export function currentRound(po: Playoffs): PlayoffSeries[] {
  return po.rounds[po.rounds.length - 1];
}

export const ROUND_NAMES = ['First Round', 'Second Round', 'Conference Final', 'Final'];
