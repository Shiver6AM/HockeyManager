import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, cx, Spinner, TeamLink } from '../components/ui';
import { signed } from '../format';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';
import { useSort } from '../sort';

type Row = Outputs['data']['standings'][number];
type View = 'division' | 'wild card' | 'conference' | 'league';

export function StandingsPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const st = useQuery(trpc.data.standings.queryOptions({ leagueId: L.id }));
  const [view, setView] = useState<View>('division');
  if (!st.data) return <Spinner />;
  const rows = st.data;

  const groups: Array<[string, Row[], number | null]> = [];
  if (view === 'league') groups.push(['League', rows, null]);
  else if (view === 'wild card') {
    // Per conference: each division's top three, then the wild-card race (the line falls after WC2).
    for (const conf of [...new Set(rows.map((r) => r.team.conference))].sort()) {
      const inConf = rows.filter((r) => r.team.conference === conf);
      for (const div of [...new Set(inConf.map((r) => r.team.division))].sort()) {
        groups.push([`${conf} · ${div}`, inConf.filter((r) => r.team.division === div && r.wildCard === null), null]);
      }
      groups.push([`${conf}ern Conference · Wild card`, inConf.filter((r) => r.wildCard !== null), 2]);
    }
  } else {
    const key = (r: Row) => (view === 'division' ? `${r.team.conference} · ${r.team.division}` : `${r.team.conference}ern Conference`);
    for (const r of rows) {
      const k = key(r);
      let g = groups.find((x) => x[0] === k);
      if (!g) groups.push((g = [k, [], null]));
      g[1].push(r);
    }
    groups.sort((a, b) => a[0].localeCompare(b[0]));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Standings</h1>
        <div className="flex rounded-lg bg-rink-800 p-1 text-sm">
          {(['division', 'wild card', 'conference', 'league'] as View[]).map((v) => (
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
        Playoff format: the top three in each division plus two <Seed label="WC1" /> wild cards per conference.{' '}
        <Seed label="M1" /> = division seed. Click any column to sort. Ties broken by points %, regulation wins, ROW, wins, goal differential.
      </p>
      <div className={cx('grid gap-4', view !== 'league' && view !== 'conference' && 'xl:grid-cols-2')}>
        {groups.map(([name, list, cutAfter]) => (
          <StandingsTable key={name} name={name} list={list} cutAfter={cutAfter} leagueId={L.id} myTeamId={L.myTeamId} />
        ))}
      </div>
    </div>
  );
}

function Seed({ label }: { label: string }) {
  if (!label) return null;
  const wc = label.startsWith('WC');
  return (
    <span className={cx('rounded px-1 py-0.5 text-[10px] font-bold', wc ? 'bg-warn/20 text-warn' : 'bg-win/20 text-win')} title={wc ? 'Wild card' : 'Division seed'}>
      {label}
    </span>
  );
}

function StandingsTable({ name, list, cutAfter, leagueId, myTeamId }: { name: string; list: Row[]; cutAfter: number | null; leagueId: string; myTeamId: string | null }) {
  const { sorted, Th, sortKey } = useSort(
    list,
    {
      rank: (r) => -r.rank,
      team: (r) => `${r.team.city} ${r.team.name}`,
      gp: (r) => r.gp,
      w: (r) => r.w,
      l: (r) => r.l,
      otl: (r) => r.otl,
      pts: (r) => r.pts,
      pct: (r) => r.pointsPct,
      rw: (r) => r.rw,
      gf: (r) => r.gf,
      ga: (r) => r.ga,
      diff: (r) => r.gf - r.ga,
      l10: (r) => r.last10,
      strk: (r) => r.streak,
    },
    { key: 'rank' },
  );
  const natural = sortKey === 'rank';
  return (
    <Card title={name}>
      <div className="-m-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <Th k="rank" className="w-8">#</Th>
              <Th k="team">Team</Th>
              <Th k="gp" className="num">GP</Th>
              <Th k="w" className="num">W</Th>
              <Th k="l" className="num">L</Th>
              <Th k="otl" className="num">OTL</Th>
              <Th k="pts" className="num">PTS</Th>
              <Th k="pct" className="num">P%</Th>
              <Th k="rw" className="num">RW</Th>
              <Th k="gf" className="num">GF</Th>
              <Th k="ga" className="num">GA</Th>
              <Th k="diff" className="num">DIFF</Th>
              <Th k="l10">L10</Th>
              <Th k="strk">STRK</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr
                key={r.teamId}
                className={cx(myTeamId === r.teamId && 'bg-blueline/10', natural && cutAfter !== null && i === cutAfter && 'border-t-2 border-dashed border-goal/60')}
              >
                <td className="tabular text-ice-500">
                  <span className={cx('mr-1 inline-block h-1.5 w-1.5 rounded-full', r.inPlayoffSpot ? 'bg-win' : 'bg-transparent')} />
                  {i + 1}
                </td>
                <td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <TeamLink leagueId={leagueId} team={r.team} full />
                    <Seed label={r.seed} />
                  </span>
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
  );
}
