/**
 * In-app notifications: "you're on the clock", "trade offer received",
 * "your team went 2-1 this week", and so on. Stored per user; the web app
 * polls for the unread count.
 */
import type { League, TeamId } from '@hockey-gm/sim-core';
import type { Queryable } from './db';

export type NotificationKind = 'trade' | 'draft' | 'advance' | 'offseason' | 'free-agency' | 'commissioner';

export interface Notice {
  teamId?: TeamId;
  userId?: string;
  kind: NotificationKind;
  text: string;
  link?: string;
}

/** Deliver notices to team managers (by team) or users (by id). */
export async function deliver(q: Queryable, leagueId: string, notices: Notice[]) {
  if (!notices.length) return;
  const members = await q.query<{ user_id: string; team_id: string | null }>('select user_id, team_id from league_members where league_id = $1', [leagueId]);
  const byTeam = new Map(members.filter((m) => m.team_id).map((m) => [m.team_id!, m.user_id]));
  for (const n of notices) {
    const userId = n.userId ?? (n.teamId ? byTeam.get(n.teamId) : undefined);
    if (!userId) continue;
    await q.query('insert into notifications (user_id, league_id, kind, text, link) values ($1, $2, $3, $4, $5)', [userId, leagueId, n.kind, n.text, n.link ?? null]);
  }
}

/** Everyone in the league (e.g. "the draft is open"). */
export async function deliverAll(q: Queryable, leagueId: string, kind: NotificationKind, text: string, link?: string) {
  const members = await q.query<{ user_id: string }>('select user_id from league_members where league_id = $1', [leagueId]);
  await deliver(q, leagueId, members.map((m) => ({ userId: m.user_id, kind, text, link })));
}

export const humanTeams = (L: League) => Object.values(L.teams).filter((t) => t.controller.kind === 'human').map((t) => t.id);
