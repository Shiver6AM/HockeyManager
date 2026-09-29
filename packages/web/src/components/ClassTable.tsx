/**
 * The draft class as your scouts see it: where each prospect plays, his stats
 * this season, and (only where you've scouted) a projection with how confident
 * your scouts are. Every column sorts.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ht, svPct } from '../format';
import { useSort } from '../sort';
import type { Outputs } from '../trpc';
import { cx, Rating } from './ui';

export type ClassPlayer = NonNullable<Outputs['life']['draftClass']>['players'][number];

export const GRADE_TONE: Record<string, string> = { A: 'text-win', B: 'text-blue-300', C: 'text-ice-200', D: 'text-ice-400', F: 'text-ice-500' };

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="inline-flex items-center gap-1.5" title={`Scouting confidence ${pct}%`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-rink-700">
        <span className={cx('block h-1.5 rounded-full', pct >= 70 ? 'bg-win' : pct >= 35 ? 'bg-blueline' : 'bg-warn')} style={{ width: `${Math.max(3, pct)}%` }} />
      </span>
      <span className="tabular w-8 text-right text-[11px] text-ice-400">{pct}%</span>
    </span>
  );
}

const pts = (p: ClassPlayer) => (p.stats ? p.stats.g + p.stats.a : null);

/** ▲3 / ▼2 since Central Scouting's previous update. */
export function CssMove({ css }: { css: ClassPlayer['css'] }) {
  if (!css || css.prevRank === null) return null;
  const d = css.prevRank - css.rank;
  if (d === 0) return <span className="text-[10px] text-ice-600">–</span>;
  return (
    <span className={cx('tabular text-[10px] font-semibold', d > 0 ? 'text-win' : 'text-red-300')} title={`Was #${css.prevRank} in the previous update`}>
      {d > 0 ? '▲' : '▼'}
      {Math.abs(d)}
    </span>
  );
}

export function ClassTable({
  players,
  leagueId,
  action,
  storageKey,
  maxRows = 150,
  targeted,
}: {
  players: ClassPlayer[];
  leagueId: string;
  action?: (p: ClassPlayer) => ReactNode;
  storageKey: string;
  maxRows?: number;
  /** Prospects your scouts are following (marked in the table). */
  targeted?: Set<string>;
}) {
  const [pos, setPos] = useState('All');
  const [region, setRegion] = useState('All');
  const [scoutedOnly, setScoutedOnly] = useState(false);
  const regions = [...new Map(players.map((p) => [p.region, p.regionLabel])).entries()];
  const filtered = players.filter(
    (p) =>
      (pos === 'All' || (pos === 'F' ? ['C', 'LW', 'RW'].includes(p.pos) : p.pos === pos)) &&
      (region === 'All' || p.region === region) &&
      (!scoutedOnly || p.scouted),
  );
  const { sorted, Th } = useSort(
    filtered,
    {
      name: (p) => p.lastName,
      pos: (p) => p.pos,
      age: (p) => p.age,
      ht: (p) => p.height,
      wt: (p) => p.weight,
      nat: (p) => p.nationality,
      league: (p) => p.league,
      club: (p) => p.club,
      gp: (p) => p.stats?.gp ?? null,
      g: (p) => (p.pos === 'G' ? (p.stats?.w ?? null) : (p.stats?.g ?? null)),
      a: (p) => (p.pos === 'G' ? (p.stats?.sa ? 1 - (p.stats.ga ?? 0) / p.stats.sa : null) : (p.stats?.a ?? null)),
      p: (p) => (p.pos === 'G' ? null : pts(p)),
      ppg: (p) => (p.stats?.gp && p.pos !== 'G' ? (pts(p) ?? 0) / p.stats.gp : null),
      ovr: (p) => p.overall,
      grade: (p) => (p.scouted ? p.scoutValue : null),
      css: (p) => (p.css ? -p.css.rank : null),
      conf: (p) => p.confidence,
      style: (p) => p.archetype,
    },
    { key: 'grade' },
    storageKey,
  );
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <div className="flex rounded-md bg-rink-800 p-0.5">
          {['All', 'F', 'D', 'G'].map((x) => (
            <button key={x} onClick={() => setPos(x)} className={cx('rounded px-2 py-0.5 font-semibold', pos === x ? 'bg-rink-600 text-white' : 'text-ice-400')}>
              {x}
            </button>
          ))}
        </div>
        <select className="slot !w-auto py-0.5 text-xs" value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="All">All regions</option>
          {regions.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-ice-300">
          <input type="checkbox" checked={scoutedOnly} onChange={(e) => setScoutedOnly(e.target.checked)} /> Scouted only
        </label>
        <span className="text-ice-500">
          {filtered.length} prospects · {filtered.filter((p) => p.scouted).length} scouted
        </span>
      </div>
      <div className="-mx-4 -mb-4 max-h-[40rem] overflow-auto">
        <table className="table">
          <thead className="sticky top-0 z-10 bg-rink-900">
            <tr>
              <Th k="name">Prospect</Th>
              <Th k="pos">Pos</Th>
              <Th k="age" className="num">Age</Th>
              <Th k="ht" className="num">Ht</Th>
              <Th k="wt" className="num">Wt</Th>
              <Th k="nat">Nat</Th>
              <Th k="league">League</Th>
              <Th k="club">Club</Th>
              <Th k="gp" className="num">GP</Th>
              <Th k="g" className="num" title="Goals (goalies: wins)">G</Th>
              <Th k="a" className="num" title="Assists (goalies: save %)">A</Th>
              <Th k="p" className="num">P</Th>
              <Th k="ppg" className="num" title="Points per game">P/GP</Th>
              <Th k="ovr" className="num" title="Current ability (only once scouted)">OVR</Th>
              <Th k="grade" className="num" title="Your scouts' read on his ceiling">Grade</Th>
              <Th k="css" className="num" title="Central Scouting consensus rank (and his rank on its North American or international list)">CSS</Th>
              <th>Projection</th>
              <Th k="conf">Confidence</Th>
              <Th k="style">Style</Th>
              {action && <th />}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, maxRows).map((p) => (
              <tr key={p.id} className={cx(!p.scouted && 'text-ice-400')}>
                <td className="whitespace-nowrap">
                  <Link to={`/league/${leagueId}/player/${p.id}`} className="text-ice-50 hover:underline">
                    {p.name}
                  </Link>
                  {targeted?.has(p.id) && (
                    <span className="ml-1.5 rounded bg-blueline/20 px-1 text-[10px] text-blue-200" title="One of your scouts is following him">
                      followed
                    </span>
                  )}
                </td>
                <td className="text-ice-400">{p.pos}</td>
                <td className="num">{p.age}</td>
                <td className="num whitespace-nowrap">{ht(p.height)}</td>
                <td className="num">{p.weight}</td>
                <td className="text-xs text-ice-400">{p.nationality}</td>
                <td className="text-xs whitespace-nowrap">{p.league}</td>
                <td className="text-xs whitespace-nowrap text-ice-300">{p.club}</td>
                <td className="num">{p.stats?.gp ?? 0}</td>
                {p.pos === 'G' ? (
                  <>
                    <td className="num">{p.stats?.w ?? 0}</td>
                    <td className="num">{p.stats?.sa ? svPct(p.stats.sa, p.stats.ga ?? 0) : '—'}</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                  </>
                ) : (
                  <>
                    <td className="num">{p.stats?.g ?? 0}</td>
                    <td className="num">{p.stats?.a ?? 0}</td>
                    <td className="num font-semibold text-white">{pts(p) ?? 0}</td>
                    <td className="num">{p.stats?.gp ? ((pts(p) ?? 0) / p.stats.gp).toFixed(2) : '—'}</td>
                  </>
                )}
                <td className="num">{p.overall !== null ? <Rating value={p.overall} /> : <span className="text-ice-600">?</span>}</td>
                <td className={cx('num font-display text-base', p.grade ? GRADE_TONE[p.grade[0]] : 'text-ice-600')}>{p.grade ?? '?'}</td>
                <td className="num whitespace-nowrap" title={p.css ? `Central Scouting: #${p.css.rank} overall · #${p.css.listRank} ${p.css.list}` : undefined}>
                  {p.css ? (
                    <>
                      <span className="font-semibold text-ice-50">{p.css.rank}</span>
                      <span className="ml-1 text-[10px] text-ice-500">
                        {p.css.list.startsWith('NA') ? 'NA' : 'INT'}
                        {p.css.list.endsWith('goalies') ? ' G' : ''} {p.css.listRank}
                      </span>{' '}
                      <CssMove css={p.css} />
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="text-xs whitespace-nowrap text-ice-300">{p.projection ?? <span className="text-ice-600">Unscouted</span>}</td>
                <td>
                  <ConfidenceBar value={p.confidence} />
                </td>
                <td className="text-xs whitespace-nowrap text-ice-400">{p.archetype}</td>
                {action && <td className="text-right">{action(p)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const CSS_LISTS = ['NA skaters', 'Intl skaters', 'NA goalies', 'Intl goalies'] as const;

/** Central Scouting's four lists, side by side. */
export function CssRankings({
  players,
  leagueId,
  edition,
  updatedOn,
  top = 32,
}: {
  players: ClassPlayer[];
  leagueId: string;
  edition?: string;
  /** When this update was published (a date label). */
  updatedOn?: string | null;
  top?: number;
}) {
  const [n, setN] = useState(top);
  const lists = CSS_LISTS.map((list) => ({
    list,
    rows: players
      .filter((p) => p.css?.list === list)
      .sort((a, b) => a.css!.listRank - b.css!.listRank)
      .slice(0, list.endsWith('goalies') ? Math.ceil(n / 3) : n),
  }));
  return (
    <div>
      <p className="-mt-1 mb-3 text-xs text-ice-400">
        The league's Central Scouting Service ranks every draft-eligible prospect, the same list for all 32 teams.{' '}
        {edition === 'Final'
          ? 'These are the final rankings.'
          : `It updates every two weeks through the season as prospects play and its scouts see more (${edition === 'Preliminary' ? 'this is the preliminary list' : `this is ${edition?.toLowerCase()}`}${updatedOn ? `, published ${updatedOn}` : ''}); the final list comes out after the season.`}{' '}
        Arrows show movement since the previous update. It sees every league but isn't perfect; your own scouts can know better where they've spent time.
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {lists.map(({ list, rows }) => (
          <div key={list} className="min-w-0">
            <h4 className="mb-1.5 text-[11px] font-semibold tracking-wider text-ice-500 uppercase">
              {list.replace('NA', 'North American').replace('Intl', 'International')}
            </h4>
            {rows.length === 0 ? (
              <p className="text-xs text-ice-600">None</p>
            ) : (
              <ol className="space-y-0.5 text-xs">
                {rows.map((p) => (
                  <li key={p.id} className="flex items-baseline gap-2">
                    <span className="tabular w-5 shrink-0 text-right text-ice-500">{p.css!.listRank}</span>
                    <span className="w-6 shrink-0 text-center">
                      <CssMove css={p.css} />
                    </span>
                    <Link to={`/league/${leagueId}/player/${p.id}`} className="min-w-0 flex-1 truncate text-ice-100 hover:underline" title={`${p.name} · ${p.pos} · ${p.league} (${p.club}) · #${p.css!.rank} overall`}>
                      {p.name}
                    </Link>
                    <span className="shrink-0 text-ice-500">{p.pos}</span>
                    <span className="w-16 shrink-0 truncate text-right text-ice-500">{p.league}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
      {n < 100 && (
        <button className="mt-3 text-xs text-blue-300 hover:underline" onClick={() => setN(n + 32)}>
          Show more
        </button>
      )}
    </div>
  );
}
