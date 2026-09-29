import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, cx, Empty, Spinner, TeamChip } from '../components/ui';
import { gaa, signed, svPct, toi } from '../format';
import { useSort } from '../sort';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague, useTeamById } from './LeagueLayout';

type View = 'season' | 'all';
type Scope = 'nhl' | 'prospects' | 'undrafted';
const seasonLabel = (y: number) => `${y}-${String(y + 1).slice(2)}`;

function Segmented<T extends string | boolean>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap rounded-lg bg-rink-800 p-1 text-sm">
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={cx('rounded-md px-3 py-1 font-semibold whitespace-nowrap', value === v ? 'bg-rink-600 text-white' : 'text-ice-400 hover:text-ice-200')}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function StatsPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const [view, setView] = useState<View>('season');
  const [scope, setScope] = useState<Scope>('nhl');
  const [playoffs, setPlayoffs] = useState(L.phase === 'playoffs');
  const [season, setSeason] = useState<number>(L.season);
  const nhl = view === 'all' || scope === 'nhl';
  const q = useQuery({
    ...trpc.data.leaders.queryOptions({ leagueId: L.id, playoffs, season: view === 'all' ? 'all' : season === L.season ? undefined : season }),
    placeholderData: (prev) => prev,
    enabled: nhl,
  });
  const minor = useQuery({
    ...trpc.data.minorLeaders.queryOptions({ leagueId: L.id, scope: scope === 'undrafted' ? 'undrafted' : 'prospects', season }),
    placeholderData: (prev) => prev,
    enabled: !nhl,
  });
  const seasons = useQuery({ ...trpc.data.leaders.queryOptions({ leagueId: L.id }), select: (d) => d.seasons, enabled: !nhl });
  const seasonList = (nhl ? q.data?.seasons : seasons.data) ?? [L.season];
  const awards = useQuery(trpc.data.awards.queryOptions({ leagueId: L.id }));
  const fmt = (v: number, f: string, label: string) =>
    f === 'pct' ? v.toFixed(3).replace(/^0/, '') : f === 'dec' ? v.toFixed(2) : label === 'Plus/Minus' ? signed(v) : String(v);
  const idx = seasonList.indexOf(season);
  const showPlayoffToggle = nhl && (view === 'all' || L.phase !== 'regular-season' || season !== L.season);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">League stats</h1>
        <span className="ml-auto" />
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            ['season', 'Season leaders'],
            ['all', 'All-time leaders'],
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rink-700 bg-rink-900/60 p-3">
        {view === 'season' ? (
          <>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-xs font-semibold tracking-wider text-ice-500 uppercase">Season</span>
              <button
                className="rounded-md bg-rink-800 px-2.5 py-1 text-ice-300 hover:bg-rink-700 disabled:opacity-30"
                aria-label="Previous season"
                disabled={idx < 0 || idx >= seasonList.length - 1}
                onClick={() => setSeason(seasonList[idx + 1])}
              >
                ‹
              </button>
              <select className="slot w-auto" aria-label="Season" value={String(season)} onChange={(e) => setSeason(Number(e.target.value))}>
                {seasonList.map((y) => (
                  <option key={y} value={y}>
                    {seasonLabel(y)}
                    {y === L.season ? ' (current)' : ''}
                  </option>
                ))}
              </select>
              <button className="rounded-md bg-rink-800 px-2.5 py-1 text-ice-300 hover:bg-rink-700 disabled:opacity-30" aria-label="Next season" disabled={idx <= 0} onClick={() => setSeason(seasonList[idx - 1])}>
                ›
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tracking-wider text-ice-500 uppercase">Players</span>
              <Segmented
                label="Players"
                value={scope}
                onChange={setScope}
                options={[
                  ['nhl', 'NHL'],
                  ['prospects', 'Top 100 prospects'],
                  ['undrafted', 'Top 100 undrafted'],
                ]}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-ice-400">Career totals across every season in this league, retired players included.</p>
        )}
        {showPlayoffToggle && (
          <div className="ml-auto">
            <Segmented
              label="Season type"
              value={playoffs}
              onChange={setPlayoffs}
              options={[
                [false, 'Regular season'],
                [true, 'Playoffs'],
              ]}
            />
          </div>
        )}
      </div>

      {view === 'season' && season === L.season && scope === 'nhl' && awards.data && awards.data.current.length > 0 && (
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

      {!nhl ? (
        !minor.data ? (
          <Spinner />
        ) : (
          <>
            <MinorSkaterTable key={`${scope}-${season}`} rows={minor.data.skaters} scope={scope as 'prospects' | 'undrafted'} season={season} />
            <MinorGoalieTable rows={minor.data.goalies} />
          </>
        )
      ) : !q.data ? (
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
          <SkaterStatsTable rows={q.data.allSkaters} allTime={view === 'all'} />
          <GoalieStatsTable rows={q.data.allGoalies} allTime={view === 'all'} />
        </>
      )}
    </div>
  );
}

type Minor = Outputs['data']['minorLeaders'];

function MinorSkaterTable({ rows, scope, season }: { rows: Minor['skaters']; scope: 'prospects' | 'undrafted'; season: number }) {
  const [pos, setPos] = useState('All');
  const filtered = rows.filter((r) => pos === 'All' || (pos === 'F' ? r.pos !== 'D' : r.pos === pos));
  const { sorted, Th } = useSort(
    filtered,
    {
      name: (r) => r.name.split(' ').slice(-1)[0],
      pos: (r) => r.pos,
      age: (r) => r.age,
      league: (r) => r.league,
      club: (r) => r.club ?? '',
      org: (r) => r.orgId ?? '',
      draft: (r) => r.draft ?? '',
      gp: (r) => r.gp,
      g: (r) => r.g,
      a: (r) => r.a,
      p: (r) => r.p,
      ppg: (r) => (r.gp ? r.p / r.gp : 0),
      pim: (r) => r.pim,
    },
    { key: 'p' },
    'stats-minor',
  );
  const title = scope === 'prospects' ? 'Top 100 prospect scorers' : 'Top 100 undrafted scorers';
  const note =
    scope === 'prospects'
      ? 'Drafted players outside the NHL: junior, college, Europe and the AHL.'
      : 'Players who hadn’t been drafted yet, in every league (junior, college, Europe).';
  return (
    <Card
      title={`${title} · ${seasonLabel(season)}`}
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
      <p className="-mt-1 mb-3 text-xs text-ice-500">{note}</p>
      {rows.length === 0 ? (
        <Empty>No games played yet for this group.</Empty>
      ) : (
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="num">#</th>
                <Th k="name">Player</Th>
                <Th k="pos">Pos</Th>
                <Th k="age" className="num">Age</Th>
                <Th k="league">League</Th>
                <Th k="club">Club</Th>
                {scope === 'prospects' && <Th k="org">Rights</Th>}
                {scope === 'prospects' && <Th k="draft">Drafted</Th>}
                <Th k="gp" className="num">GP</Th>
                <Th k="g" className="num">G</Th>
                <Th k="a" className="num">A</Th>
                <Th k="p" className="num">P</Th>
                <Th k="ppg" className="num" title="Points per game">P/GP</Th>
                <Th k="pim" className="num">PIM</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.id}>
                  <td className="num text-ice-500">{i + 1}</td>
                  <NameCell r={r} />
                  <td className="text-ice-400">{r.pos}</td>
                  <td className="num">{r.age}</td>
                  <td className="text-xs whitespace-nowrap text-ice-300">{r.league}</td>
                  <td className="text-xs whitespace-nowrap text-ice-400">{r.club ?? '—'}</td>
                  {scope === 'prospects' && (r.orgId ? <TeamCell abbr={r.orgId} /> : <td className="text-ice-500">—</td>)}
                  {scope === 'prospects' && <td className="text-xs whitespace-nowrap text-ice-400">{r.draft ?? '—'}</td>}
                  <td className="num">{r.gp}</td>
                  <td className="num">{r.g}</td>
                  <td className="num">{r.a}</td>
                  <td className="num font-semibold text-white">{r.p}</td>
                  <td className="num">{r.gp ? (r.p / r.gp).toFixed(2) : '—'}</td>
                  <td className="num">{r.pim}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function MinorGoalieTable({ rows }: { rows: Minor['goalies'] }) {
  const { sorted, Th } = useSort(
    rows,
    {
      name: (r) => r.name.split(' ').slice(-1)[0],
      league: (r) => r.league,
      club: (r) => r.club ?? '',
      gp: (r) => r.gp,
      w: (r) => r.w,
      sv: (r) => (r.sa ? 1 - r.ga / r.sa : null),
      so: (r) => r.so,
    },
    { key: 'w' },
    'stats-minor-goalies',
  );
  if (!rows.length) return null;
  return (
    <Card title={`Goalies (${rows.length}, min. 5 GP)`}>
      <div className="-mx-4 -mb-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <Th k="name">Goalie</Th>
              <Th k="league">League</Th>
              <Th k="club">Club</Th>
              <Th k="gp" className="num">GP</Th>
              <Th k="w" className="num">W</Th>
              <Th k="sv" className="num">SV%</Th>
              <Th k="so" className="num">SO</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <NameCell r={r} />
                <td className="text-xs whitespace-nowrap text-ice-300">{r.league}</td>
                <td className="text-xs whitespace-nowrap text-ice-400">{r.club ?? '—'}</td>
                <td className="num">{r.gp}</td>
                <td className="num font-semibold text-white">{r.w}</td>
                <td className="num">{svPct(r.sa, r.ga)}</td>
                <td className="num">{r.so}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
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
  const teamOf = useTeamById();
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
              <span className="flex w-12 items-center gap-1 text-xs text-ice-400">
                {teamOf(r.teamId) && <TeamChip team={teamOf(r.teamId)!} size="sm" />}
                {r.teamId}
              </span>
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

function ActiveToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-ice-400">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      Active only
    </label>
  );
}

function SkaterStatsTable({ rows, allTime }: { rows: Leaders['allSkaters']; allTime: boolean }) {
  const [pos, setPos] = useState('All');
  const [activeOnly, setActiveOnly] = useState(false);
  const [n, setN] = useState(PAGE);
  const filtered = rows.filter((r) => (pos === 'All' || (pos === 'F' ? r.pos !== 'D' : r.pos === pos)) && (!allTime || !activeOnly || r.active));
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
      title={`${allTime ? 'All-time skaters' : 'All skaters'} (${filtered.length})`}
      action={
        <div className="flex items-center gap-3">
        {allTime && <ActiveToggle value={activeOnly} onChange={setActiveOnly} />}
        <div className="flex rounded-md bg-rink-800 p-0.5 text-xs">
          {['All', 'F', 'D'].map((x) => (
            <button key={x} onClick={() => setPos(x)} className={cx('rounded px-2 py-0.5 font-semibold', pos === x ? 'bg-rink-600 text-white' : 'text-ice-400')}>
              {x}
            </button>
          ))}
        </div>
        </div>
      }
    >
      <div className="-mx-4 -mb-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="num">#</th>
              <Th k="name">Player</Th>
              <Th k="team">{allTime ? 'Now' : 'Team'}</Th>
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
                <TeamCell abbr={r.team} />
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

function GoalieStatsTable({ rows: all, allTime }: { rows: Leaders['allGoalies']; allTime: boolean }) {
  const [activeOnly, setActiveOnly] = useState(false);
  const rows = all.filter((r) => !allTime || !activeOnly || r.active);
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
    <Card title={`${allTime ? 'All-time goalies' : 'All goalies'} (${rows.length})`} action={allTime ? <ActiveToggle value={activeOnly} onChange={setActiveOnly} /> : undefined}>
      <div className="-mx-4 -mb-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <Th k="name">Goalie</Th>
              <Th k="team">{allTime ? 'Now' : 'Team'}</Th>
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
                <TeamCell abbr={r.team} />
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

function TeamCell({ abbr }: { abbr: string }) {
  const t = useTeamById()(abbr);
  return (
    <td className="text-xs whitespace-nowrap text-ice-400">
      <span className="inline-flex items-center gap-1.5">
        {t && <TeamChip team={t} size="sm" />}
        {abbr}
      </span>
    </td>
  );
}
