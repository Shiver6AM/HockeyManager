/**
 * In-app notifications: "you're on the clock", "trade offer received",
 * "your team went 2-1 this week", and so on. Stored per user; the web app
 * polls for the unread count.
 */
import { describeAsset, type League, type TeamId, type TradeAsset, type TradeProposal } from '@hockey-gm/sim-core';
import type { Queryable } from './db';

/** A player named in a notice or a story: his name in the text links to his page. */
export interface PlayerRef {
  id: string;
  name: string;
}

export type NotificationKind = 'trade' | 'draft' | 'advance' | 'offseason' | 'free-agency' | 'commissioner';

export interface Notice {
  teamId?: TeamId;
  userId?: string;
  kind: NotificationKind;
  text: string;
  link?: string;
  /** Players named in the text. */
  players?: PlayerRef[];
}

export const playerRef = (L: League, id: string): PlayerRef | null => {
  const p = L.players[id];
  return p ? { id, name: `${p.firstName} ${p.lastName}` } : null;
};

/** "A (C, 80), 2027 1st round (HAL)" */
export const assetList = (L: League, xs: TradeAsset[]) => (xs.length ? xs.map((a) => describeAsset(L, a)).join(', ') : 'nothing');

/** Every player in a trade, for linking. */
export function tradePlayers(L: League, t: Pick<TradeProposal, 'give' | 'get'>): PlayerRef[] {
  return [...t.give, ...t.get].flatMap((a) => (a.kind === 'player' ? [playerRef(L, a.id)] : [])).filter((x): x is PlayerRef => !!x);
}

/** Deliver notices to team managers (by team) or users (by id). */
export async function deliver(q: Queryable, leagueId: string, notices: Notice[]) {
  if (!notices.length) return;
  const members = await q.query<{ user_id: string; team_id: string | null }>('select user_id, team_id from league_members where league_id = $1', [leagueId]);
  const byTeam = new Map(members.filter((m) => m.team_id).map((m) => [m.team_id!, m.user_id]));
  for (const n of notices) {
    const userId = n.userId ?? (n.teamId ? byTeam.get(n.teamId) : undefined);
    if (!userId) continue;
    await q.query('insert into notifications (user_id, league_id, kind, text, link, refs) values ($1, $2, $3, $4, $5, $6)', [
      userId,
      leagueId,
      n.kind,
      n.text,
      n.link ?? null,
      n.players?.length ? JSON.stringify(n.players) : null,
    ]);
  }
}

/** Everyone in the league (e.g. "the draft is open"). */
export async function deliverAll(q: Queryable, leagueId: string, kind: NotificationKind, text: string, link?: string) {
  const members = await q.query<{ user_id: string }>('select user_id from league_members where league_id = $1', [leagueId]);
  await deliver(q, leagueId, members.map((m) => ({ userId: m.user_id, kind, text, link })));
}

export const humanTeams = (L: League) => Object.values(L.teams).filter((t) => t.controller.kind === 'human').map((t) => t.id);
