/**
 * Team finances and owners.
 *
 * Revenue: gate (attendance × ticket price, driven by market size, winning and
 * star power), a league-wide media share, and sponsorship scaled by market.
 * Playoff home games are extra gate. Expenses: player salaries, staff and
 * operations. Every owner has a goal for the season and a confidence meter
 * that moves with results.
 */
import { contenderScore } from './negotiation';
import { overall } from './ratings';
import { staffPayroll } from './staff';
import type { League, OwnerGoal, StandingsRow, Team, TeamFinances } from './types';
import { payroll } from './contracts';

export const ARENA_CAPACITY = 18_000;
export const FINANCE = {
  mediaPerSeason: 60_000_000,
  sponsorshipBase: 35_000_000,
  operationsPerSeason: 45_000_000,
  ticketBase: 88,
  regularSeasonGames: 82,
};

/** Market sizes for the built-in franchises (1.0 = average). */
export const MARKETS: Record<string, number> = {
  HOU: 1.5, ATL: 1.35, SD: 1.3, BAL: 1.25, CLE: 1.2, CIN: 1.15, KC: 1.15, MIL: 1.1, POR: 1.15, SAC: 1.1, AUS: 1.3, OKC: 1.0,
  MEM: 1.0, OMA: 0.95, ABQ: 0.95, BHM: 0.95, PRV: 1.0, HFD: 1.0, ROC: 0.95, HER: 0.85, QUE: 1.05, HAL: 0.95, HAM: 1.05,
  LDN: 0.9, KGN: 0.8, MON: 0.8, TBY: 0.75, SAS: 0.8, REG: 0.8, VIC: 0.9, SPO: 0.85, KAM: 0.7,
};

export const OWNER_GOAL_LABEL: Record<OwnerGoal, string> = {
  'win-now': 'Contend for the championship',
  'make-playoffs': 'Make the playoffs',
  'develop-youth': 'Develop young talent',
  'turn-profit': 'Turn a profit',
};

export function newFinances(season: number): TeamFinances {
  return { season, homeGames: 0, attendance: 0, gate: 0, media: 0, sponsorship: 0, playoffGate: 0, salaries: 0, staff: 0, operations: 0, gp: 0, pts: 0 };
}

export function initFinances(league: League) {
  for (const t of Object.values(league.teams)) {
    t.market ??= MARKETS[t.id] ?? 1;
    t.finances = newFinances(league.season);
    t.financeHistory = [];
    t.cash = 0;
    t.owner = { goal: 'make-playoffs', confidence: 60, lastReview: null };
  }
  setOwnerGoals(league);
}

export function revenue(f: TeamFinances) {
  return f.gate + f.media + f.sponsorship + f.playoffGate;
}
export function expenses(f: TeamFinances) {
  return f.salaries + f.staff + f.operations;
}

/** Fans' appetite for a home game: 0.4 … 1.0 of capacity. */
export function demand(league: League, team: Team): number {
  const f = team.finances!;
  const pct = f.gp ? f.pts / (2 * f.gp) : 0.5;
  const star = team.roster.some((id) => league.players[id] && overall(league.players[id]) >= 88) ? 0.05 : 0;
  const lastChamp = league.history.at(-1)?.champion === team.id ? 0.08 : 0;
  const m = team.market ?? 1;
  return Math.min(1, Math.max(0.45, 0.86 + 0.15 * (m - 1) + 0.6 * (pct - 0.5) + star + lastChamp));
}

export function ticketPrice(team: Team, playoff: boolean): number {
  return FINANCE.ticketBase * Math.sqrt(team.market ?? 1) * (playoff ? 1.6 : 1);
}

/** Book one game: gate for the home team; a game's worth of costs for both (regular season). */
export function bookGame(league: League, home: Team, away: Team, homePts: number, awayPts: number, playoff: boolean) {
  for (const t of [home, away]) t.finances ??= newFinances(league.season);
  const hf = home.finances!;
  const att = Math.round(ARENA_CAPACITY * demand(league, home));
  const gate = att * ticketPrice(home, playoff);
  if (playoff) hf.playoffGate += gate;
  else {
    hf.homeGames++;
    hf.attendance += att;
    hf.gate += gate;
  }
  if (!playoff) {
    const n = FINANCE.regularSeasonGames;
    for (const [t, pts] of [
      [home, homePts],
      [away, awayPts],
    ] as const) {
      const f = t.finances!;
      f.gp++;
      f.pts += pts;
      f.media += FINANCE.mediaPerSeason / n;
      f.sponsorship += (FINANCE.sponsorshipBase * (t.market ?? 1)) / n;
      f.salaries += payroll(league, t) / n;
      f.staff += staffPayroll(t) / n;
      f.operations += FINANCE.operationsPerSeason / n;
    }
  }
}

/** Close the books at the end of a season (called at rollover). */
export function closeBooks(league: League) {
  for (const t of Object.values(league.teams)) {
    const f = t.finances ?? newFinances(league.season);
    t.cash = (t.cash ?? 0) + revenue(f) - expenses(f);
    (t.financeHistory ??= []).push(f);
    if (t.financeHistory.length > 20) t.financeHistory.shift();
    t.finances = newFinances(league.season + 1);
  }
}

/** Owners set a goal for the coming season based on where the team stands. */
export function setOwnerGoals(league: League) {
  const ranked = Object.values(league.teams).sort((a, b) => contenderScore(league, b.id) - contenderScore(league, a.id));
  ranked.forEach((t, i) => {
    t.owner ??= { goal: 'make-playoffs', confidence: 60, lastReview: null };
    const lastProfit = t.financeHistory?.length ? revenue(t.financeHistory.at(-1)!) - expenses(t.financeHistory.at(-1)!) : 0;
    t.owner.goal = lastProfit < -10_000_000 && (t.market ?? 1) < 0.9 ? 'turn-profit' : i < 8 ? 'win-now' : i < 20 ? 'make-playoffs' : 'develop-youth';
  });
}

/**
 * Owners review the season when the final ends. Returns the review text for
 * each team (used for news on human-run teams).
 */
export function ownerReviews(league: League, st: StandingsRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  const playoffTeams = new Set(league.playoffs?.rounds[0]?.flatMap((s) => [s.high, s.low]) ?? []);
  const champion = league.playoffs?.champion;
  const deepRun = new Set(league.playoffs?.rounds[2]?.flatMap((s) => [s.high, s.low]) ?? []);
  for (const t of Object.values(league.teams)) {
    const o = (t.owner ??= { goal: 'make-playoffs', confidence: 60, lastReview: null });
    const f = t.finances ?? newFinances(league.season);
    const profit = revenue(f) - expenses(f);
    const youngMinutes = t.roster.filter((id) => league.players[id] && league.season - league.players[id].birthYear <= 23).length;
    const met =
      o.goal === 'win-now' ? deepRun.has(t.id) || champion === t.id
      : o.goal === 'make-playoffs' ? playoffTeams.has(t.id)
      : o.goal === 'develop-youth' ? youngMinutes >= 6
      : profit > 0;
    let d = met ? 15 : -15;
    if (champion === t.id) d += 20;
    else if (playoffTeams.has(t.id)) d += 4;
    d += profit > 0 ? 3 : -3;
    o.confidence = Math.max(0, Math.min(100, o.confidence + d));
    const row = st.find((r) => r.teamId === t.id);
    o.lastReview = met
      ? `Goal met (${OWNER_GOAL_LABEL[o.goal].toLowerCase()}). ${o.confidence >= 75 ? 'The owner is thrilled.' : 'The owner is pleased.'}`
      : `Goal missed (${OWNER_GOAL_LABEL[o.goal].toLowerCase()}${row ? `, ${row.pts} pts` : ''}). ${o.confidence < 30 ? 'The owner is running out of patience.' : 'The owner expects better.'}`;
    out[t.id] = o.lastReview;
  }
  return out;
}
