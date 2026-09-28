import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Rating, Spinner, TeamChip, TeamLink } from '../components/ui';
import { gaa, money, signed, svPct, toi } from '../format';
import { useTRPC } from '../trpc';
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
      <Card>
        <div className="flex flex-wrap items-center gap-5">
          {d.team && <TeamChip team={d.team} size="lg" />}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-semibold tracking-wide text-white uppercase">{name}</h1>
            <p className="text-sm text-ice-300">
              {pos}
              {p && ` · Age ${p.age} · Shoots ${p.shoots} · ${p.nationality} · ${p.archetype}`}
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
                    <Link to={`/league/${L.id}/team/${d.draft.team.id}`} className="hover:underline">
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
            {p.contract.yearsLeft > 1 ? 's' : ''} · {p.contract.kind === 'ELC' ? 'entry-level' : 'standard'} · becomes {p.contract.expiresAs}
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {ratings && (
          <Card title="Ratings">
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
              {isG ? (
                <tr>
                  <th>Season</th><th>Team</th><th className="num">Age</th><th className="num">OVR</th><th className="num">GP</th><th className="num">GS</th>
                  <th className="num">W</th><th className="num">L</th><th className="num">OTL</th><th className="num">SA</th><th className="num">GA</th>
                  <th className="num">SV%</th><th className="num">GAA</th><th className="num">SO</th>
                </tr>
              ) : (
                <tr>
                  <th>Season</th><th>Team</th><th className="num">Age</th><th className="num">OVR</th><th className="num">GP</th><th className="num">G</th>
                  <th className="num">A</th><th className="num">P</th><th className="num">+/-</th><th className="num">PIM</th><th className="num">PPG</th>
                  <th className="num">PPA</th><th className="num">SHG</th><th className="num">GWG</th><th className="num">SOG</th><th className="num">S%</th>
                  <th className="num">HIT</th><th className="num">BLK</th><th className="num">FO%</th><th className="num">TOI</th>
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((c) => {
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
