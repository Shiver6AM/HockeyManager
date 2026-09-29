import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, cx, Empty, Spinner } from '../components/ui';
import { gaa, signed, svPct, toi } from '../format';
import { useSort } from '../sort';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

export function StatsPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const [playoffs, setPlayoffs] = useState(L.phase === 'playoffs');
  const [season, setSeason] = useState<number | 'all'>(L.season);
  const q = useQuery({
    ...trpc.data.leaders.queryOptions({ leagueId: L.id, playoffs, season: season === L.season ? undefined : season }),
    placeholderData: (prev) => prev,
  });
  const awards = useQuery(trpc.data.awards.queryOptions({ leagueId: L.id }));
  const fmt = (v: number, f: string, label: string) =>
    f === 'pct' ? v.toFixed(3).replace(/^0/, '') : f === 'dec' ? v.toFixed(2) : label === 'Plus/Minus' ? signed(v) : String(v);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">League leaders</h1>
        <span className="ml-auto" />
        <select
          className="slot w-auto"
          aria-label="Season"
          value={String(season)}
          onChange={(e) => setSeason(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          {(q.data?.seasons ?? [L.season]).map((y) => (
            <option key={y} value={y}>
              {y === L.season ? 'This season' : `${y}-${String(y + 1).slice(2)}`}
            </option>
          ))}
          <option value="all">All time</option>
        </select>
        {(L.phase !== 'regular-season' || season !== L.season) && (
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
          <SkaterStatsTable rows={q.data.allSkaters} />
          <GoalieStatsTable rows={q.data.allGoalies} />
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

type Leaders = Outputs['data']['leaders'];
const PAGE = 50;

function NameCell({ r }: { r: { id: string; name: string } }) {
  const L = useLeague();
  return (
    <td className="whitespace-nowrap">
      <Link to={`/league/${L.id}/player/${r.id}`} className="text-ice-50 hover:underline">
        {r.name}
      </Link>
    </td>
  );
}

function SkaterStatsTable({ rows }: { rows: Leaders['allSkaters'] }) {
  const [pos, setPos] = useState('All');
  const [n, setN] = useState(PAGE);
  const filtered = rows.filter((r) => pos === 'All' || (pos === 'F' ? r.pos !== 'D' : r.pos === pos));
  const { sorted, Th } = useSort(
    filtered,
    {
      name: (r) => r.name.split(' ').slice(-1)[0],
      team: (r) => r.team,
      pos: (r) => r.pos,
      gp: (r) => r.gp,
      g: (r) => r.g,
      a: (r) => r.a,
      p: (r) => r.p,
      ppg: (r) => (r.gp ? r.p / r.gp : 0),
      pm: (r) => r.pm,
      pim: (r) => r.pim,
      ppgoals: (r) => r.ppg,
      ppp: (r) => r.ppp,
      shg: (r) => r.shg,
      gwg: (r) => r.gwg,
      sog: (r) => r.sog,
      shpct: (r) => (r.sog ? r.g / r.sog : null),
      hits: (r) => r.hits,
      blk: (r) => r.blk,
      fo: (r) => (r.fow + r.fol >= 20 ? r.fow / (r.fow + r.fol) : null),
      toi: (r) => (r.gp ? r.toi / r.gp : 0),
    },
    { key: 'p' },
    'stats-skaters',
  );
  return (
    <Card
      title={`All skaters (${filtered.length})`}
      action={
        <div className="flex rounded-md bg-rink-800 p-0.5 text-xs">
          {['All', 'F', 'D'].map((x) => (
            <button key={x} onClick={() => setPos(x)} className={cx('rounded px-2 py-0.5 font-semibold', pos === x ? 'bg-rink-600 text-white' : 'text-ice-400')}>
              {x}
            </button>
          ))}
        </div>
      }
    >
      <div className="-mx-4 -mb-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="num">#</th>
              <Th k="name">Player</Th>
              <Th k="team">Team</Th>
              <Th k="pos">Pos</Th>
              <Th k="gp" className="num">GP</Th>
              <Th k="g" className="num">G</Th>
              <Th k="a" className="num">A</Th>
              <Th k="p" className="num">P</Th>
              <Th k="ppg" className="num" title="Points per game">P/GP</Th>
              <Th k="pm" className="num">+/-</Th>
              <Th k="pim" className="num">PIM</Th>
              <Th k="ppgoals" className="num" title="Power-play goals">PPG</Th>
              <Th k="ppp" className="num" title="Power-play points">PPP</Th>
              <Th k="shg" className="num" title="Short-handed goals">SHG</Th>
              <Th k="gwg" className="num" title="Game-winning goals">GWG</Th>
              <Th k="sog" className="num">SOG</Th>
              <Th k="shpct" className="num" title="Shooting %">SH%</Th>
              <Th k="hits" className="num">Hits</Th>
              <Th k="blk" className="num">BLK</Th>
              <Th k="fo" className="num" title="Faceoff % (min. 20 draws)">FO%</Th>
              <Th k="toi" className="num" title="Time on ice per game">TOI</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, n).map((r, i) => (
              <tr key={r.id}>
                <td className="num text-ice-500">{i + 1}</td>
                <NameCell r={r} />
                <td className="text-xs text-ice-400">{r.team}</td>
                <td className="text-ice-400">{r.pos}</td>
                <td className="num">{r.gp}</td>
                <td className="num">{r.g}</td>
                <td className="num">{r.a}</td>
                <td className="num font-semibold text-white">{r.p}</td>
                <td className="num">{r.gp ? (r.p / r.gp).toFixed(2) : '—'}</td>
                <td className="num">{signed(r.pm)}</td>
                <td className="num">{r.pim}</td>
                <td className="num">{r.ppg}</td>
                <td className="num">{r.ppp}</td>
                <td className="num">{r.shg}</td>
                <td className="num">{r.gwg}</td>
                <td className="num">{r.sog}</td>
                <td className="num">{r.sog ? ((r.g / r.sog) * 100).toFixed(1) : '—'}</td>
                <td className="num">{r.hits}</td>
                <td className="num">{r.blk}</td>
                <td className="num">{r.fow + r.fol >= 20 ? ((r.fow / (r.fow + r.fol)) * 100).toFixed(1) : '—'}</td>
                <td className="num">{toi(r.toi, r.gp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > n && (
          <button className="w-full py-2 text-sm text-blue-300 hover:underline" onClick={() => setN(n + 100)}>
            Show more ({sorted.length - n} left)
          </button>
        )}
      </div>
    </Card>
  );
}

function GoalieStatsTable({ rows }: { rows: Leaders['allGoalies'] }) {
  const { sorted, Th } = useSort(
    rows,
    {
      name: (r) => r.name.split(' ').slice(-1)[0],
      team: (r) => r.team,
      gp: (r) => r.gp,
      gs: (r) => r.gs,
      w: (r) => r.w,
      l: (r) => r.l,
      otl: (r) => r.otl,
      sa: (r) => r.sa,
      ga: (r) => r.ga,
      sv: (r) => (r.sa ? 1 - r.ga / r.sa : null),
      gaa: (r) => (r.toi ? -(r.ga * 3600) / r.toi : null),
      so: (r) => r.so,
      toi: (r) => r.toi,
    },
    { key: 'w' },
    'stats-goalies',
  );
  return (
    <Card title={`All goalies (${rows.length})`}>
      <div className="-mx-4 -mb-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <Th k="name">Goalie</Th>
              <Th k="team">Team</Th>
              <Th k="gp" className="num">GP</Th>
              <Th k="gs" className="num">GS</Th>
              <Th k="w" className="num">W</Th>
              <Th k="l" className="num">L</Th>
              <Th k="otl" className="num">OTL</Th>
              <Th k="sa" className="num">SA</Th>
              <Th k="ga" className="num">GA</Th>
              <Th k="sv" className="num">SV%</Th>
              <Th k="gaa" className="num" title="Goals against average (sorted best first)">GAA</Th>
              <Th k="so" className="num">SO</Th>
              <Th k="toi" className="num">Minutes</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <NameCell r={r} />
                <td className="text-xs text-ice-400">{r.team}</td>
                <td className="num">{r.gp}</td>
                <td className="num">{r.gs}</td>
                <td className="num font-semibold text-white">{r.w}</td>
                <td className="num">{r.l}</td>
                <td className="num">{r.otl}</td>
                <td className="num">{r.sa}</td>
                <td className="num">{r.ga}</td>
                <td className="num">{svPct(r.sa, r.ga)}</td>
                <td className="num">{gaa(r.ga, r.toi)}</td>
                <td className="num">{r.so}</td>
                <td className="num">{Math.round(r.toi / 60)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
