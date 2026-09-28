import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, Spinner, TeamChip, TeamLink } from '../components/ui';
import { useTRPC } from '../trpc';
import { useLeague } from './LeagueLayout';

export function HistoryPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const q = useQuery(trpc.life.history.queryOptions({ leagueId: L.id }));
  if (!q.data) return <Spinner />;
  const h = q.data;
  const player = (id: string, name: string) => (
    <Link to={`/league/${L.id}/player/${id}`} className="hover:text-white hover:underline">
      {name}
    </Link>
  );
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card title="Champions">
          {h.seasons.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Season</th>
                    <th>Champion</th>
                    <th>Runner-up</th>
                    <th>MVP</th>
                  </tr>
                </thead>
                <tbody>
                  {h.seasons.map((s) => (
                    <tr key={s.season}>
                      <td className="tabular">
                        {s.season}–{String((s.season + 1) % 100).padStart(2, '0')}
                      </td>
                      <td>{s.champion ? <TeamLink leagueId={L.id} team={s.champion} full /> : '—'}</td>
                      <td>{s.runnerUp ? <TeamLink leagueId={L.id} team={s.runnerUp} /> : '—'}</td>
                      <td>{s.mvp?.playerId && s.mvpName ? player(s.mvp.playerId, s.mvpName) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No seasons completed yet. Champions are recorded when a final ends.</Empty>
          )}
        </Card>
        <Card title="Hall of Fame">
          {h.hallOfFame.length ? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {h.hallOfFame.map((f) => (
                <li key={f.playerId} className="flex gap-3 rounded-lg border border-rink-700 bg-rink-950/50 p-3">
                  {f.team ? <TeamChip team={f.team} /> : <span className="text-xl">🏛️</span>}
                  <div className="min-w-0">
                    <p className="font-semibold text-white">
                      {player(f.playerId, f.name)} <Badge>{f.pos}</Badge>
                    </p>
                    <p className="text-xs text-ice-400">
                      Class of {f.inducted} · {f.summary}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No inductees yet. Great players are considered when they retire.</Empty>
          )}
        </Card>
      </div>
      <div className="space-y-5">
        {h.titles.length > 0 && (
          <Card title="Titles">
            <ul className="space-y-1.5 text-sm">
              {h.titles.map((t) => (
                <li key={t.team.id} className="flex justify-between">
                  <TeamLink leagueId={L.id} team={t.team} />
                  <span className="tabular">{'🏆'.repeat(Math.min(t.titles, 5))}{t.titles > 5 ? ` ×${t.titles}` : ''}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {(
          [
            ['points', 'All-time points'],
            ['goals', 'All-time goals'],
            ['wins', 'All-time goalie wins'],
          ] as const
        ).map(([k, title]) => (
          <Card key={k} title={title}>
            {h.leaders[k].length ? (
              <ol className="space-y-1 text-sm">
                {h.leaders[k].map((x, i) => (
                  <li key={x.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      <span className="tabular mr-2 text-ice-500">{i + 1}.</span>
                      {player(x.id, x.name)} {!x.active && <span className="text-[11px] text-ice-500">(ret.)</span>}
                    </span>
                    <span className="tabular font-semibold">{x.value}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>No games yet.</Empty>
            )}
          </Card>
        ))}
        <p className="text-xs text-ice-500">All-time totals count games played in this league.</p>
      </div>
    </div>
  );
}
