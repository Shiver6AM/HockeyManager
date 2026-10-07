import { TraitList } from '../components/Traits';
import { ColumnChart, LineChart } from '../components/Charts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Rating, Spinner, TeamChip, TeamLink } from '../components/ui';
import { dayLabel, gaa, ht, money, signed, svPct, toi } from '../format';
import { useSort } from '../sort';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

const SKATER_RATINGS: Array<[string, string]> = [
  ['skating', 'Skating'],
  ['shooting', 'Shooting'],
  ['passing', 'Passing'],
  ['handling', 'Puck handling'],
  ['offIQ', 'Offensive IQ'],
  ['defIQ', 'Defensive IQ'],
  ['checking', 'Checking'],
  ['faceoffs', 'Faceoffs'],
  ['discipline', 'Discipline'],
  ['endurance', 'Endurance'],
];
const GOALIE_RATINGS: Array<[string, string]> = [
  ['reflexes', 'Reflexes'],
  ['positioning', 'Positioning'],
  ['rebounds', 'Rebound control'],
  ['mental', 'Mental'],
];

export function PlayerPage() {
  const L = useLeague();
  const { playerId = '' } = useParams();
  const trpc = useTRPC();
  const q = useQuery(trpc.data.player.queryOptions({ leagueId: L.id, playerId }));
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Spinner />;
  const d = q.data;
  const p = d.player;
  const name = p?.name ?? d.retired!.name;
  const pos = p?.pos ?? d.retired!.pos;
  const isG = pos === 'G';
  const ratings = p ? ((isG ? p.goalie : p.skater) as unknown as Record<string, number>) : null;
  const gained = Object.fromEntries((d.training?.gains ?? []).map((g) => [g.skill, g.points])) as Record<string, number>;
  const trainedRole = (d.training?.roleTraining ?? {}) as Record<string, number>;
  const totals = d.career.reduce(
    (t, c) => {
      if (c.skater) {
        t.gp += c.skater.gp;
        t.g += c.skater.g;
        t.a += c.skater.a;
      }
      if (c.goalie) {
        t.gp += c.goalie.gp;
        t.w += c.goalie.w;
        t.so += c.goalie.so;
      }
      return t;
    },
    { gp: 0, g: 0, a: 0, w: 0, so: 0 },
  );

  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border border-rink-700 bg-rink-900 p-5"
        style={d.team ? { background: `linear-gradient(120deg, ${d.team.colors[0]}40, #0b1220 65%)` } : undefined}
      >
        <div className="flex flex-wrap items-center gap-5">
          {d.team ? (
            <Link to={`/league/${L.id}/team/${d.team.id}`} title={`${d.team.city} ${d.team.name}`}>
              <TeamChip team={d.team} size="xl" />
            </Link>
          ) : (
            d.draft?.team && <TeamChip team={d.draft.team} size="xl" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-semibold tracking-wide text-white uppercase">{name}</h1>
            <p className="text-sm text-ice-300">
              {pos}
              {p && p.altPos.length > 0 && <span title="Other positions he can play"> (also {p.altPos.join(', ')})</span>}
              {p && ` · Age ${p.age} · ${ht(p.height)}, ${p.weight} lb · Shoots ${p.shoots} · ${p.nationality} · ${p.archetype}`}
              {d.retired && ` · Retired after ${d.retired.retiredAfter}-${String(d.retired.retiredAfter + 1).slice(2)} · Peak ${d.retired.peakOverall} OVR`}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ice-400">
              {d.team && <TeamLink leagueId={L.id} team={d.team} full />}
              {d.isProspect && <Badge tone="info">Prospect</Badge>}
              {p?.injury && <Badge tone="bad">{p.injury.type} · ~{p.injury.daysLeft}d</Badge>}
              {d.draft && (
                <span>
                  Drafted {d.draft.season}, round {d.draft.round} (#
                  {d.draft.overall}) by{' '}
                  {d.draft.team ? (
                    <Link to={`/league/${L.id}/team/${d.draft.team.id}`} className="inline-flex items-center gap-1 align-middle hover:underline">
                      <TeamChip team={d.draft.team} size="sm" />
                      {d.draft.team.city}
                    </Link>
                  ) : (
                    '—'
                  )}
                </span>
              )}
            </p>
          </div>
          {p && (
            <div className="flex gap-3 text-center">
              <div className="rounded-lg bg-rink-850 px-4 py-2">
                <p className="text-[11px] font-semibold tracking-wider text-ice-500 uppercase">Overall</p>
                <p className="font-display text-3xl">
                  <Rating value={p.overall} />
                </p>
              </div>
              <div className="rounded-lg bg-rink-850 px-4 py-2" title="How much he gets out of skills coaching">
                <p className="text-[11px] font-semibold tracking-wider text-ice-500 uppercase">Coachability</p>
                <p className="font-display text-3xl text-ice-50">{p.coachability}</p>
                <p className="text-[11px] text-ice-400">{p.coachabilityLabel}</p>
              </div>
              {d.scouting && (
                <div className="rounded-lg bg-rink-850 px-4 py-2">
                  <p className="text-[11px] font-semibold tracking-wider text-ice-500 uppercase">Scouts</p>
                  <p className="font-display text-3xl text-blue-300">{d.scouting.grade}</p>
                  <p className="text-[11px] text-ice-400">{d.scouting.projection}</p>
                </div>
              )}
            </div>
          )}
        </div>
        {p?.contract && (
          <p className="mt-3 text-sm text-ice-300">
            Contract: <span className="text-white">{money(p.contract.salary)}</span> × {p.contract.yearsLeft} more season
            {p.contract.yearsLeft > 1 ? 's' : ''} · {p.contract.kind === 'ELC' ? 'entry-level' : 'standard'} ·{' '}
            {p.twoWay ? `two-way (${money(p.minorSalary ?? 0)} in the AHL)` : 'one-way'} · becomes {p.contract.expiresAs}
          </p>
        )}
        {d.myOffer && (
          <p className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1 text-sm text-warn">
            <span className="font-semibold">
              {d.myOffer.kind === 'free-agent' ? 'Your offer' : d.myOffer.kind === 'offer-sheet' ? 'Your offer sheet' : 'Your offer sent'}:
            </span>
            <span className="text-white">
              {money(d.myOffer.offer.salary)} × {d.myOffer.offer.years} yr{d.myOffer.offer.years === 1 ? '' : 's'}
            </span>
            <span className="text-ice-300">· {d.myOffer.status}</span>
          </p>
        )}
        {!d.myOffer && d.myAnswer && d.myAnswer.result !== 'accept' && d.myAnswer.result !== 'considering' && (
          <p className="mt-2 rounded-md border border-rink-600 bg-rink-850 px-2.5 py-1 text-sm text-ice-200">
            <span className="font-semibold">{d.myAnswer.result === 'counter' ? 'He countered' : 'Offer turned down'}:</span> {d.myAnswer.message}
          </p>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {ratings && (
          <Card title="Ratings">
            {p && p.traits.length > 0 && (
              <div className="mb-4 border-b border-rink-700 pb-4">
                <p className="mb-2 text-[11px] font-semibold tracking-wider text-ice-500 uppercase">Traits</p>
                <TraitList traits={p.traits} />
              </div>
            )}
            <ul className="space-y-2">
              {(isG ? GOALIE_RATINGS : SKATER_RATINGS).map(([k, label]) => (
                <li key={k} className="text-sm">
                  <div className="flex justify-between">
                    <span className="text-ice-300">{label}</span>
                    <span className="tabular text-white">
                      {gained[k] ? <span className="mr-1.5 text-[11px] text-win" title="From skills coaching this season">+{gained[k]}</span> : null}
                      {ratings[k]}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-rink-700">
                    <div className="h-1.5 rounded-full bg-blueline" style={{ width: `${ratings[k]}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            {d.roles && (
              <>
                <p className="mt-5 mb-2 text-xs font-semibold tracking-wider text-ice-500 uppercase">Role skills</p>
                <ul className="space-y-1.5">
                  {[...d.roles]
                    .sort((a, b) => b.value - a.value)
                    .map((r) => {
                      const t = Math.max(0, Math.min(1, (r.value - 55) / 35));
                      return (
                        <li key={r.id} className="text-sm" title={r.help}>
                          <div className="flex justify-between">
                            <span className="text-ice-300">{r.label}</span>
                            <span className="tabular text-white">
                              {trainedRole[r.id] ? (
                                <span className="mr-1.5 text-[11px] text-win" title="Added by skills coaching">
                                  +{trainedRole[r.id]}
                                </span>
                              ) : null}
                              {r.value}
                            </span>
                          </div>
                          <div className="mt-0.5 h-1.5 rounded-full bg-rink-700">
                            <div
                              className="h-1.5 rounded-full"
                              style={{
                                width: `${r.value}%`,
                                background: `hsl(142 ${Math.round(12 + 58 * t)}% ${Math.round(80 - 35 * t)}%)`,
                              }}
                            />
                          </div>
                        </li>
                      );
                    })}
                </ul>
                <p className="mt-2 text-[11px] text-ice-500">
                  How well he suits specific jobs: from his ratings and his {d.player?.archetype.toLowerCase()} style.
                </p>
              </>
            )}
          </Card>
        )}
        <div className="space-y-5 lg:col-span-2">
          {d.awards.length > 0 && (
            <Card title="Awards">
              <div className="flex flex-wrap gap-2">
                {d.awards.map((a) => (
                  <Badge key={`${a.season}${a.award}`} tone="warn">
                    {a.season}-{String(a.season + 1).slice(2)} {a.award}
                  </Badge>
                ))}
              </div>
            </Card>
          )}
          {d.training && (d.training.current || d.training.gains.length > 0) && (
            <Card title="Skills coaching">
              {d.training.current ? (
                <div className="text-sm">
                  <p className="text-ice-300">
                    Working with <span className="font-semibold text-white">{d.training.current.coach}</span> on{' '}
                    <span className="font-semibold text-white">{d.training.current.label}</span>
                    <span className="text-ice-400"> · about +{d.training.current.seasonPace} per full season at this pace</span>
                  </p>
                  <div className="mt-2 h-1.5 rounded-full bg-rink-700" title="Progress toward his next point">
                    <div className="h-1.5 rounded-full bg-win" style={{ width: `${Math.round(d.training.current.progress * 100)}%` }} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ice-400">Not working with a skills coach right now.</p>
              )}
              {d.training.gains.length > 0 && (
                <p className="mt-3 flex flex-wrap gap-1.5 text-sm">
                  <span className="text-ice-400">This season:</span>
                  {d.training.gains.map((g) => (
                    <Badge key={g.skill} tone="good">
                      +{g.points} {g.label}
                    </Badge>
                  ))}
                </p>
              )}
            </Card>
          )}
          {p && <InjuryHistory injuries={d.injuries} since={d.injuriesSince} />}
          <CareerCharts career={d.career} isG={isG} />
          <Card title={`Career · ${totals.gp} GP${isG ? ` · ${totals.w} W · ${totals.so} SO` : ` · ${totals.g} G · ${totals.a} A · ${totals.g + totals.a} P`}`}>
            {d.career.length === 0 ? <Empty>No games yet.</Empty> : <CareerTables career={d.career} isG={isG} />}
          </Card>
        </div>
      </div>
    </div>
  );
}

type CareerRow = import('../trpc').Outputs['data']['player']['career'][number];

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}` : '—');

/** Every season: NHL rows with the full stat line, junior/AHL rows for his prospect years, and career totals. */
function CareerTables({ career, isG }: { career: CareerRow[]; isG: boolean }) {
  const L = useLeague();
  const [which, setWhich] = useState<'regular' | 'playoffs'>('regular');
  const rows = which === 'regular' ? career : career.filter((c) => c.playoffSkater || c.playoffGoalie);
  const sk = (c: CareerRow) => (which === 'regular' ? c.skater : c.playoffSkater);
  const gl = (c: CareerRow) => (which === 'regular' ? c.goalie : c.playoffGoalie);
  const teamCell = (c: CareerRow) =>
    c.team ? (
      <Link to={`/league/${L.id}/team/${c.team.id}`} className="inline-flex items-center gap-1.5 hover:underline">
        <TeamChip team={c.team} size="sm" />
        {c.team.abbr}
      </Link>
    ) : c.minor ? (
      <span className="text-ice-400" title={c.org ? `${c.org.city} prospect` : undefined}>
        {c.minor.league}
        {c.org ? ` · ${c.org.abbr}` : ''}
      </span>
    ) : (
      <span className="text-ice-500">—</span>
    );
  // Career totals (NHL only).
  const nhl = career.map((c) => (isG ? gl(c) : sk(c))).filter(Boolean);
  const sum = (k: string) => nhl.reduce((s, x) => s + ((x as unknown as Record<string, number>)[k] ?? 0), 0);
  const dash = <td className="num text-ice-600">—</td>;
  type R = Record<string, number | undefined>;
  const line = (c: CareerRow): R | null => {
    const nhlLine = isG ? gl(c) : sk(c);
    if (nhlLine) return nhlLine as unknown as R;
    return which === 'regular' && c.minor ? (c.minor as unknown as R) : null;
  };
  const f = (k: string) => (c: CareerRow) => line(c)?.[k] ?? null;
  const cols: Record<string, (c: CareerRow) => number | string | null> = {
    season: (c) => c.season * 10 + (sk(c) || gl(c) ? 1 : 0),
    team: (c) => c.team?.abbr ?? c.minor?.league ?? null,
    age: (c) => c.age,
    ovr: (c) => c.overall,
    gp: f('gp'),
    gs: f('gs'),
    g: f('g'),
    a: f('a'),
    p: (c) => (line(c) ? (line(c)!.g ?? 0) + (line(c)!.a ?? 0) : null),
    pm: f('pm'),
    pim: f('pim'),
    ppg: f('ppg'),
    ppa: f('ppa'),
    shg: f('shg'),
    gwg: f('gwg'),
    sog: f('sog'),
    spct: (c) => (line(c)?.sog ? (line(c)!.g ?? 0) / line(c)!.sog! : null),
    hits: f('hits'),
    blk: f('blk'),
    fo: (c) => (line(c)?.fow || line(c)?.fol ? (line(c)!.fow ?? 0) / ((line(c)!.fow ?? 0) + (line(c)!.fol ?? 0)) : null),
    toi: (c) => (line(c)?.toi && line(c)?.gp ? line(c)!.toi! / line(c)!.gp! : null),
    w: f('w'),
    l: f('l'),
    otl: f('otl'),
    sa: f('sa'),
    ga: f('ga'),
    sv: (c) => (line(c)?.sa ? 1 - (line(c)!.ga ?? 0) / line(c)!.sa! : null),
    gaa: (c) => (line(c)?.gp ? -((line(c)!.ga ?? 0) / line(c)!.gp!) : null),
    so: f('so'),
  };
  const { sorted, Th } = useSort(rows, cols, { key: 'season', dir: 'asc' }, isG ? 'career-g' : 'career-s');
  const SK: [string, string][] = [['gp', 'GP'], ['g', 'G'], ['a', 'A'], ['p', 'P'], ['pm', '+/-'], ['pim', 'PIM'], ['ppg', 'PPG'], ['ppa', 'PPA'], ['shg', 'SHG'], ['gwg', 'GWG'], ['sog', 'SOG'], ['spct', 'S%'], ['hits', 'HIT'], ['blk', 'BLK'], ['fo', 'FO%'], ['toi', 'TOI']];
  const GK: [string, string][] = [['gp', 'GP'], ['gs', 'GS'], ['w', 'W'], ['l', 'L'], ['otl', 'OTL'], ['sa', 'SA'], ['ga', 'GA'], ['sv', 'SV%'], ['gaa', 'GAA'], ['so', 'SO']];
  return (
    <>
      <div className="-mt-1 mb-3 flex gap-1 text-xs">
        {(['regular', 'playoffs'] as const).map((w) => (
          <button
            key={w}
            onClick={() => setWhich(w)}
            className={`rounded-md px-2.5 py-1 font-semibold ${which === w ? 'bg-rink-600 text-white' : 'text-ice-400 hover:text-ice-100'}`}
          >
            {w === 'regular' ? 'Regular season' : 'Playoffs'}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty>No playoff games yet.</Empty>
      ) : (
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="table text-xs">
            <thead>
              <tr>
                <Th k="season">Season</Th>
                <Th k="team">Team</Th>
                <Th k="age" className="num">Age</Th>
                <Th k="ovr" className="num">OVR</Th>
                {(isG ? GK : SK).map(([k, label]) => (
                  <Th key={k} k={k} className="num">
                    {label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const minor = which === 'regular' && !sk(c) && !gl(c) ? c.minor : null;
                const s = sk(c);
                const g = gl(c);
                return (
                  <tr key={`${c.season}-${minor ? 'm' : 'n'}`} className={minor ? 'text-ice-400' : undefined}>
                    <td className="tabular">
                      {c.season}-{String(c.season + 1).slice(2)}
                    </td>
                    <td className="whitespace-nowrap">{teamCell(c)}</td>
                    <td className="num">{c.age}</td>
                    <td className="num">{c.overall}</td>
                    {isG ? (
                      minor ? (
                        <>
                          <td className="num">{minor.gp}</td>
                          {dash}
                          <td className="num">{minor.w ?? 0}</td>
                          <td className="num">{minor.l ?? 0}</td>
                          {dash}
                          <td className="num">{minor.sa ?? 0}</td>
                          <td className="num">{minor.ga ?? 0}</td>
                          <td className="num">{minor.sa ? svPct(minor.sa, minor.ga ?? 0) : '—'}</td>
                          <td className="num">{minor.gp ? ((minor.ga ?? 0) / minor.gp).toFixed(2) : '—'}</td>
                          <td className="num">{minor.so ?? 0}</td>
                        </>
                      ) : (
                        <>
                          <td className="num">{g?.gp ?? 0}</td>
                          <td className="num">{g?.gs ?? 0}</td>
                          <td className="num">{g?.w ?? 0}</td>
                          <td className="num">{g?.l ?? 0}</td>
                          <td className="num">{g?.otl ?? 0}</td>
                          <td className="num">{g?.sa ?? 0}</td>
                          <td className="num">{g?.ga ?? 0}</td>
                          <td className="num">{g ? svPct(g.sa, g.ga) : '—'}</td>
                          <td className="num">{g ? gaa(g.ga, g.toi) : '—'}</td>
                          <td className="num">{g?.so ?? 0}</td>
                        </>
                      )
                    ) : minor ? (
                      <>
                        <td className="num">{minor.gp}</td>
                        <td className="num">{minor.g}</td>
                        <td className="num">{minor.a}</td>
                        <td className="num font-semibold">{minor.g + minor.a}</td>
                        <td className="num">{signed(minor.pm)}</td>
                        <td className="num">{minor.pim}</td>
                        {dash}{dash}{dash}{dash}{dash}{dash}{dash}{dash}{dash}{dash}
                      </>
                    ) : (
                      <>
                        <td className="num">{s?.gp ?? 0}</td>
                        <td className="num">{s?.g ?? 0}</td>
                        <td className="num">{s?.a ?? 0}</td>
                        <td className="num font-semibold text-white">{s ? s.g + s.a : 0}</td>
                        <td className="num">{s ? signed(s.pm) : 0}</td>
                        <td className="num">{s?.pim ?? 0}</td>
                        <td className="num">{s?.ppg ?? 0}</td>
                        <td className="num">{s?.ppa ?? 0}</td>
                        <td className="num">{s?.shg ?? 0}</td>
                        <td className="num">{s?.gwg ?? 0}</td>
                        <td className="num">{s?.sog ?? 0}</td>
                        <td className="num">{s ? pct(s.g, s.sog) : '—'}</td>
                        <td className="num">{s?.hits ?? 0}</td>
                        <td className="num">{s?.blk ?? 0}</td>
                        <td className="num">{s ? pct(s.fow, s.fow + s.fol) : '—'}</td>
                        <td className="num">{s?.gp ? toi(s.toi, s.gp) : '—'}</td>
                      </>
                    )}
                  </tr>
                );
              })}
              {nhl.length > 0 && (
                <tr className="border-t-2 border-rink-600 font-semibold text-white">
                  <td colSpan={4}>NHL totals</td>
                  {isG ? (
                    <>
                      <td className="num">{sum('gp')}</td>
                      <td className="num">{sum('gs')}</td>
                      <td className="num">{sum('w')}</td>
                      <td className="num">{sum('l')}</td>
                      <td className="num">{sum('otl')}</td>
                      <td className="num">{sum('sa')}</td>
                      <td className="num">{sum('ga')}</td>
                      <td className="num">{svPct(sum('sa'), sum('ga'))}</td>
                      <td className="num">{gaa(sum('ga'), sum('toi'))}</td>
                      <td className="num">{sum('so')}</td>
                    </>
                  ) : (
                    <>
                      <td className="num">{sum('gp')}</td>
                      <td className="num">{sum('g')}</td>
                      <td className="num">{sum('a')}</td>
                      <td className="num">{sum('g') + sum('a')}</td>
                      <td className="num">{signed(sum('pm'))}</td>
                      <td className="num">{sum('pim')}</td>
                      <td className="num">{sum('ppg')}</td>
                      <td className="num">{sum('ppa')}</td>
                      <td className="num">{sum('shg')}</td>
                      <td className="num">{sum('gwg')}</td>
                      <td className="num">{sum('sog')}</td>
                      <td className="num">{pct(sum('g'), sum('sog'))}</td>
                      <td className="num">{sum('hits')}</td>
                      <td className="num">{sum('blk')}</td>
                      <td className="num">{pct(sum('fow'), sum('fow') + sum('fol'))}</td>
                      <td className="num">{sum('gp') ? toi(sum('toi'), sum('gp')) : '—'}</td>
                    </>
                  )}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Season-by-season production and rating, once there's more than one season to compare. */
function CareerCharts({ career, isG }: { career: Outputs['data']['player']['career']; isG: boolean }) {
  const nhl = career.filter((c) => (isG ? c.goalie?.gp : c.skater?.gp));
  const bySeason = new Map<number, (typeof nhl)[number][]>();
  for (const c of nhl) bySeason.set(c.season, [...(bySeason.get(c.season) ?? []), c]);
  const seasons = [...bySeason.keys()].sort((a, b) => a - b);
  if (seasons.length < 2) return null;
  const label = (y: number) => `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
  const sum = (y: number, f: (c: (typeof nhl)[number]) => number) => bySeason.get(y)!.reduce((s, c) => s + f(c), 0);
  const overallOf = (y: number) => Math.max(...bySeason.get(y)!.map((c) => c.overall || 0));
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title={isG ? 'Save percentage by season' : 'Points by season'}>
        {isG ? (
          <LineChart
            x={seasons.map(label)}
            series={[{ name: 'Save %', values: seasons.map((y) => { const sa = sum(y, (c) => c.goalie?.sa ?? 0); return sa ? 1 - sum(y, (c) => c.goalie?.ga ?? 0) / sa : null; }) }]}
            fmt={(v) => v.toFixed(3).replace(/^0/, '')}
            endLabels={false}
          />
        ) : (
          <ColumnChart
            data={seasons.map((y) => {
              const g = sum(y, (c) => c.skater?.g ?? 0);
              const a = sum(y, (c) => c.skater?.a ?? 0);
              return { label: label(y), value: g + a, sub: `${g} G, ${a} A in ${sum(y, (c) => c.skater?.gp ?? 0)} GP` };
            })}
            valueName="Points"
          />
        )}
      </Card>
      <Card title="Overall rating by season">
        <LineChart x={seasons.map(label)} series={[{ name: 'Overall', values: seasons.map((y) => overallOf(y) || null) }]} fmt={(v) => String(Math.round(v))} endLabels={false} />
      </Card>
    </div>
  );
}

const SEVERITY: Record<string, { label: string; tone: 'neutral' | 'warn' | 'bad' }> = {
  'day-to-day': { label: 'Day to day', tone: 'neutral' },
  'short-term': { label: 'Short term', tone: 'neutral' },
  'medium-term': { label: 'Medium term', tone: 'warn' },
  'long-term': { label: 'Long term', tone: 'bad' },
  'season-ending': { label: 'Season ending', tone: 'bad' },
};

/** Every injury on his record, newest first. */
function InjuryHistory({ injuries, since }: { injuries: Outputs['data']['player']['injuries']; since: Outputs['data']['player']['injuriesSince'] }) {
  const days = injuries.reduce((s, x) => s + x.days, 0);
  const seasons = new Set(injuries.map((x) => x.season)).size;
  const from = since ? dayLabel(since.season, since.day, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  return (
    <Card
      title="Injury history"
      action={
        injuries.length > 0 ? (
          <span className="text-xs text-ice-400">
            {injuries.length} {injuries.length === 1 ? 'injury' : 'injuries'} · about {days} days out · {seasons} {seasons === 1 ? 'season' : 'seasons'}
          </span>
        ) : undefined
      }
    >
      {injuries.length === 0 ? (
        <p className="text-sm text-ice-400">No injuries on record{from ? ` since ${from}` : ''}.</p>
      ) : (
        <>
          <table className="table text-sm">
            <thead>
              <tr>
                <th className="text-left">Date</th>
                <th className="text-left">Injury</th>
                <th className="text-left">Severity</th>
                <th className="text-right">Time out</th>
              </tr>
            </thead>
            <tbody>
              {injuries.map((x) => (
                <tr key={`${x.season}:${x.day}`}>
                  <td className="whitespace-nowrap text-ice-300">{dayLabel(x.season, x.day, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td>
                    {x.type} {x.current && <Badge tone="bad">Out now</Badge>}
                  </td>
                  <td>
                    <Badge tone={SEVERITY[x.severity]?.tone ?? 'neutral'}>{SEVERITY[x.severity]?.label ?? x.severity}</Badge>
                  </td>
                  <td className="tabular text-right whitespace-nowrap">
                    about {x.days} {x.days === 1 ? 'day' : 'days'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {from && <p className="mt-2 text-[11px] text-ice-500">Injuries are on record from {from}. Time out is the estimate when he was hurt.</p>}
        </>
      )}
    </Card>
  );
}
