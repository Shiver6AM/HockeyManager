import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, cx, Spinner, TeamLink } from '../components/ui';
import { signed } from '../format';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

type Row = Outputs['data']['standings'][number];
type View = 'division' | 'conference' | 'league';

export function StandingsPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const st = useQuery(trpc.data.standings.queryOptions({ leagueId: L.id }));
  const [view, setView] = useState<View>('division');
  if (!st.data) return <Spinner />;
  const rows = st.data;

  const groups: Array<[string, Row[]]> = [];
  if (view === 'league') groups.push(['League', rows]);
  else {
    const key = (r: Row) => (view === 'division' ? `${r.team.conference} · ${r.team.division}` : `${r.team.conference}ern Conference`);
    for (const r of rows) {
      const k = key(r);
      let g = groups.find((x) => x[0] === k);
      if (!g) groups.push((g = [k, []]));
      g[1].push(r);
    }
    groups.sort((a, b) => a[0].localeCompare(b[0]));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Standings</h1>
        <div className="flex rounded-lg bg-rink-800 p-1 text-sm">
          {(['division', 'conference', 'league'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cx('rounded-md px-3 py-1 font-semibold capitalize', view === v ? 'bg-rink-600 text-white' : 'text-ice-400')}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-ice-400">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-win" /> currently in a playoff spot (top 3 per division + 2 wild cards per
        conference). Ties broken by points %, regulation wins, ROW, wins, goal differential.
      </p>
      <div className={cx('grid gap-4', view === 'division' && 'xl:grid-cols-2')}>
        {groups.map(([name, list]) => (
          <Card key={name} title={name}>
            <div className="-m-4 overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-8">#</th>
                    <th>Team</th>
                    <th className="num">GP</th>
                    <th className="num">W</th>
                    <th className="num">L</th>
                    <th className="num">OTL</th>
                    <th className="num">PTS</th>
                    <th className="num">P%</th>
                    <th className="num">RW</th>
                    <th className="num">GF</th>
                    <th className="num">GA</th>
                    <th className="num">DIFF</th>
                    <th>L10</th>
                    <th>STRK</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r, i) => (
                    <tr key={r.teamId} className={cx(L.myTeamId === r.teamId && 'bg-blueline/10')}>
                      <td className="tabular text-ice-500">
                        <span className={cx('mr-1 inline-block h-1.5 w-1.5 rounded-full', r.inPlayoffSpot ? 'bg-win' : 'bg-transparent')} />
                        {i + 1}
                      </td>
                      <td>
                        <TeamLink leagueId={L.id} team={r.team} full />
                      </td>
                      <td className="num">{r.gp}</td>
                      <td className="num">{r.w}</td>
                      <td className="num">{r.l}</td>
                      <td className="num">{r.otl}</td>
                      <td className="num font-semibold text-white">{r.pts}</td>
                      <td className="num">{r.pointsPct.toFixed(3).replace(/^0/, '')}</td>
                      <td className="num">{r.rw}</td>
                      <td className="num">{r.gf}</td>
                      <td className="num">{r.ga}</td>
                      <td className={cx('num', r.gf - r.ga > 0 ? 'text-win' : r.gf - r.ga < 0 ? 'text-red-300' : '')}>{signed(r.gf - r.ga)}</td>
                      <td className="tabular">{r.last10 || '—'}</td>
                      <td className="tabular">{r.streak || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
