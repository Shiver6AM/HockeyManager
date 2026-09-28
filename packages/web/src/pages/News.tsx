import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, cx, Empty, Spinner, TeamChip } from '../components/ui';
import { dayLabel } from '../format';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

export const NEWS_ICON: Record<string, string> = {
  game: '🏒', milestone: '⭐', streak: '📈', trade: '🔁', signing: '✍️', injury: '🩹', award: '🏅', playoffs: '🏆',
  draft: '🎓', retirement: '🏁', hof: '🏛️', owner: '💼', staff: '📋',
};

const FILTERS: Array<[string, string, string[] | null]> = [
  ['all', 'All', null],
  ['games', 'On the ice', ['game', 'milestone', 'streak', 'playoffs']],
  ['moves', 'Moves', ['trade', 'signing', 'draft', 'staff']],
  ['injuries', 'Injuries', ['injury']],
  ['honors', 'Honors', ['award', 'hof', 'retirement', 'owner']],
];

type Item = Outputs['life']['news'][number];

export function NewsItemRow({ n, leagueId, compact }: { n: Item; leagueId: string; compact?: boolean }) {
  const player = n.playerIds[0];
  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="mt-0.5">{NEWS_ICON[n.kind] ?? '•'}</span>
      <div className="min-w-0 flex-1">
        <p className={cx('text-ice-100', compact ? 'text-sm' : '')}>
          {player ? (
            <Link to={`/league/${leagueId}/player/${player}`} className="hover:text-white hover:underline">
              {n.headline}
            </Link>
          ) : (
            n.headline
          )}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ice-500">
          {n.teams.slice(0, 2).map((t) => (
            <Link key={t.id} to={`/league/${leagueId}/team/${t.id}`}>
              <TeamChip team={t} size="sm" />
            </Link>
          ))}
          <span>{dayLabel(n.season, n.day, { month: 'short', day: 'numeric', year: compact ? undefined : 'numeric' })}</span>
        </p>
      </div>
    </li>
  );
}

export function NewsPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const [filter, setFilter] = useState('all');
  const [mine, setMine] = useState(false);
  const q = useQuery(trpc.life.news.queryOptions({ leagueId: L.id, limit: 200, teamId: mine && L.myTeamId ? L.myTeamId : undefined }));
  const kinds = FILTERS.find((f) => f[0] === filter)![2];
  const items = (q.data ?? []).filter((n) => !kinds || kinds.includes(n.kind));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-rink-900 p-1 text-sm">
          {FILTERS.map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} className={cx('rounded-md px-3 py-1 font-semibold', filter === k ? 'bg-rink-600 text-white' : 'text-ice-400 hover:text-ice-100')}>
              {label}
            </button>
          ))}
        </div>
        {L.myTeamId && (
          <label className="flex items-center gap-2 text-sm text-ice-300">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> My team only
          </label>
        )}
      </div>
      <Card title="League news">
        {q.isLoading ? <Spinner /> : items.length ? <ul className="space-y-3">{items.map((n) => <NewsItemRow key={n.id} n={n} leagueId={L.id} />)}</ul> : <Empty>No stories yet.</Empty>}
      </Card>
    </div>
  );
}
