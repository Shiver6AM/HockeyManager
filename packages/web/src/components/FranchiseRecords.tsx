import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague } from '../pages/LeagueLayout';
import { gaa, signed, svPct } from '../format';
import { useSort } from '../sort';
import { useTRPC, type Outputs } from '../trpc';
import { Badge, Card, cx, Empty, Spinner } from './ui';

type Records = Outputs['data']['franchiseRecords'];
const yrs = (from: number, to: number) => (from === to ? `${from}-${String(from + 1).slice(2)}` : `${from}–${String(to + 1).slice(2)}`);

/** A team's all-time records: career leaders with the club and its best single seasons. */
export function FranchiseRecords({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.data.franchiseRecords.queryOptions({ leagueId, teamId }));
  if (!q.data) return <Spinner />;
  const r = q.data;
  if (!r.skaters.length) return <Card><Empty>No games played for this franchise yet.</Empty></Card>;
  const top = (key: 'p' | 'g' | 'a' | 'gp') => [...r.skaters].sort((a, b) => b.t[key] - a.t[key]).slice(0, 5);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Top title="Points" rows={top('p')} value={(x) => x.t.p} />
        <Top title="Goals" rows={top('g')} value={(x) => x.t.g} />
        <Top title="Assists" rows={top('a')} value={(x) => x.t.a} />
        <Top title="Games played" rows={top('gp')} value={(x) => x.t.gp} />
      </div>
      <CareerTable rows={r.skaters} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Best single seasons">
          <SeasonList rows={r.bestSeasons} />
        </Card>
        <Card title="Goaltending leaders">
          <GoalieList rows={r.goalies} best={r.bestGoalieSeasons} />
        </Card>
      </div>
    </div>
  );
}

function PlayerLink({ id, name, current, active }: { id: string; name: string; current?: boolean; active?: boolean }) {
  const L = useLeague();
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Link to={`/league/${L.id}/player/${id}`} className="truncate hover:underline">
        {name}
      </Link>
      {current ? <Badge tone="good">Now</Badge> : active === false ? <span className="text-[10px] text-ice-500 uppercase">Ret.</span> : null}
    </span>
  );
}

function Top({ title, rows, value }: { title: string; rows: Records['skaters']; value: (x: Records['skaters'][number]) => number }) {
  return (
    <Card title={title}>
      <ol className="space-y-1.5 text-sm">
        {rows.map((x, i) => (
          <li key={x.id} className={cx('flex items-center gap-2', i === 0 && 'font-semibold text-white')}>
            <span className="w-4 text-ice-500">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <PlayerLink id={x.id} name={x.name} current={x.current} active={x.active} />
            </span>
            <span className="tabular">{value(x)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function CareerTable({ rows }: { rows: Records['skaters'] }) {
  const [n, setN] = useState(25);
  const { sorted, Th } = useSort(
    rows,
    {
      name: (r) => r.name.split(' ').slice(-1)[0],
      pos: (r) => r.pos,
      yrs: (r) => r.from,
      seasons: (r) => r.t.seasons,
      gp: (r) => r.t.gp,
      g: (r) => r.t.g,
      a: (r) => r.t.a,
      p: (r) => r.t.p,
      ppg: (r) => (r.t.gp ? r.t.p / r.t.gp : 0),
      pm: (r) => r.t.pm,
      pim: (r) => r.t.pim,
      ppgoals: (r) => r.t.ppg,
      gwg: (r) => r.t.gwg,
    },
    { key: 'p' },
    'franchise-skaters',
  );
  return (
    <Card title="All-time scoring leaders">
      <div className="-mx-4 -mb-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="num">#</th>
              <Th k="name">Player</Th>
              <Th k="pos">Pos</Th>
              <Th k="yrs">Years</Th>
              <Th k="seasons" className="num" title="Seasons with the team">Seas.</Th>
              <Th k="gp" className="num">GP</Th>
              <Th k="g" className="num">G</Th>
              <Th k="a" className="num">A</Th>
              <Th k="p" className="num">P</Th>
              <Th k="ppg" className="num" title="Points per game">P/GP</Th>
              <Th k="pm" className="num">+/-</Th>
              <Th k="pim" className="num">PIM</Th>
              <Th k="ppgoals" className="num" title="Power-play goals">PPG</Th>
              <Th k="gwg" className="num" title="Game-winning goals">GWG</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, n).map((r, i) => (
              <tr key={r.id}>
                <td className="num text-ice-500">{i + 1}</td>
                <td className="whitespace-nowrap text-ice-50">
                  <PlayerLink id={r.id} name={r.name} current={r.current} active={r.active} />
                </td>
                <td className="text-ice-400">{r.pos}</td>
                <td className="text-xs whitespace-nowrap text-ice-400">{yrs(r.from, r.to)}</td>
                <td className="num">{r.t.seasons}</td>
                <td className="num">{r.t.gp}</td>
                <td className="num">{r.t.g}</td>
                <td className="num">{r.t.a}</td>
                <td className="num font-semibold text-white">{r.t.p}</td>
                <td className="num">{r.t.gp ? (r.t.p / r.t.gp).toFixed(2) : '—'}</td>
                <td className="num">{signed(r.t.pm)}</td>
                <td className="num">{r.t.pim}</td>
                <td className="num">{r.t.ppg}</td>
                <td className="num">{r.t.gwg}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > n && (
          <button className="w-full py-2 text-sm text-blue-300 hover:underline" onClick={() => setN(n + 25)}>
            Show more ({sorted.length - n} left)
          </button>
        )}
      </div>
    </Card>
  );
}

function SeasonList({ rows }: { rows: Records['bestSeasons'] }) {
  return (
    <table className="table -mx-4 -mb-4">
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Player</th>
          <th>Season</th>
          <th className="num">GP</th>
          <th className="num">G</th>
          <th className="num">A</th>
          <th className="num">P</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.id}-${r.season}`}>
            <td className="num text-ice-500">{i + 1}</td>
            <td className="whitespace-nowrap text-ice-50">
              <PlayerLink id={r.id} name={r.name} />
            </td>
            <td className="text-xs text-ice-400">{yrs(r.season, r.season)}</td>
            <td className="num">{r.gp}</td>
            <td className="num">{r.g}</td>
            <td className="num">{r.a}</td>
            <td className="num font-semibold text-white">{r.p}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GoalieList({ rows, best }: { rows: Records['goalies']; best: Records['bestGoalieSeasons'] }) {
  if (!rows.length) return <Empty>No goalie has played for this team yet.</Empty>;
  return (
    <div className="space-y-4">
      <table className="table -mx-4">
        <thead>
          <tr>
            <th>Goalie</th>
            <th>Years</th>
            <th className="num">GP</th>
            <th className="num">W</th>
            <th className="num">SV%</th>
            <th className="num">GAA</th>
            <th className="num">SO</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-ice-50">
                <PlayerLink id={r.id} name={r.name} current={r.current} active={r.active} />
              </td>
              <td className="text-xs whitespace-nowrap text-ice-400">{yrs(r.from, r.to)}</td>
              <td className="num">{r.t.gp}</td>
              <td className="num font-semibold text-white">{r.t.w}</td>
              <td className="num">{svPct(r.t.sa, r.t.ga)}</td>
              <td className="num">{gaa(r.t.ga, r.t.toi)}</td>
              <td className="num">{r.t.so}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <p className="mb-1 text-xs font-semibold tracking-wider text-ice-500 uppercase">Most wins in a season</p>
        <ul className="space-y-1 text-sm">
          {best.map((b) => (
            <li key={`${b.id}-${b.season}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <PlayerLink id={b.id} name={b.name} />
              </span>
              <span className="text-xs text-ice-400">{yrs(b.season, b.season)}</span>
              <span className="tabular w-28 text-right whitespace-nowrap">
                {b.w} W · {b.sv !== null ? b.sv.toFixed(3).replace(/^0/, '') : '—'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
