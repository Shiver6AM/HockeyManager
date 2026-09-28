import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, cx, Empty, Spinner } from '../components/ui';
import { signed } from '../format';
import { useTRPC } from '../trpc';
import { useLeague } from './LeagueLayout';

export function StatsPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const [playoffs, setPlayoffs] = useState(L.phase === 'playoffs');
  const q = useQuery(trpc.data.leaders.queryOptions({ leagueId: L.id, playoffs }));
  const awards = useQuery(trpc.data.awards.queryOptions({ leagueId: L.id }));
  const fmt = (v: number, f: string, label: string) =>
    f === 'pct' ? v.toFixed(3).replace(/^0/, '') : f === 'dec' ? v.toFixed(2) : label === 'Plus/Minus' ? signed(v) : String(v);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">League leaders</h1>
        {L.phase !== 'regular-season' && (
          <div className="flex rounded-lg bg-rink-800 p-1 text-sm">
            {[false, true].map((po) => (
              <button
                key={String(po)}
                onClick={() => setPlayoffs(po)}
                className={cx('rounded-md px-3 py-1 font-semibold', playoffs === po ? 'bg-rink-600 text-white' : 'text-ice-400')}
              >
                {po ? 'Playoffs' : 'Regular season'}
              </button>
            ))}
          </div>
        )}
      </div>

      {awards.data && awards.data.current.length > 0 && (
        <Card title="Awards">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {awards.data.current.map((a) => (
              <div key={a.award} className="rounded-lg bg-rink-850 p-3">
                <p className="text-xs font-semibold tracking-wider text-warn uppercase">{a.award}</p>
                <p className="font-semibold text-white">
                  {a.playerId ? (
                    <Link to={`/league/${L.id}/player/${a.playerId}`} className="hover:underline">
                      {a.playerName}
                    </Link>
                  ) : (
                    <Link to={`/league/${L.id}/team/${a.team.id}`} className="hover:underline">{`${a.team.city} ${a.team.name}`}</Link>
                  )}
                </p>
                <p className="text-xs text-ice-400">
                  {a.team.abbr} · {a.note}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!q.data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {q.data.skaters.map((cat) => (
              <LeaderCard key={cat.label} title={cat.label} rows={cat.rows} fmt={(v) => fmt(v, cat.fmt, cat.label)} />
            ))}
          </div>
          <h2 className="pt-2 font-display text-lg font-semibold tracking-wide text-ice-300 uppercase">
            Goalies <span className="text-xs text-ice-500 normal-case">(min. {q.data.minGoalieGp} GP)</span>
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {q.data.goalies.map((cat) => (
              <LeaderCard key={cat.label} title={cat.label} rows={cat.rows} fmt={(v) => fmt(v, cat.fmt, cat.label)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LeaderCard({
  title,
  rows,
  fmt,
}: {
  title: string;
  rows: Array<{ id: string; name: string; pos: string; teamId: string | null; gp: number; value: number }>;
  fmt: (v: number) => string;
}) {
  const L = useLeague();
  return (
    <Card title={title}>
      {rows.length ? (
        <ol className="space-y-1.5 text-sm">
          {rows.map((r, i) => (
            <li key={r.id} className={cx('flex items-center gap-2', i === 0 && 'text-white')}>
              <span className="w-5 text-ice-500">{i + 1}</span>
              <Link to={`/league/${L.id}/player/${r.id}`} className={cx('flex-1 truncate hover:underline', i === 0 && 'font-semibold')}>
                {r.name}
              </Link>
              <span className="w-8 text-xs text-ice-500">{r.pos}</span>
              <span className="w-9 text-xs text-ice-400">{r.teamId}</span>
              <span className="tabular w-12 text-right font-semibold">{fmt(r.value)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <Empty>No stats yet.</Empty>
      )}
    </Card>
  );
}
