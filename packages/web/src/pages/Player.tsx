import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Rating, Spinner, TeamChip, TeamLink } from '../components/ui';
import { gaa, money, signed, svPct, toi } from '../format';
import { useTRPC } from '../trpc';
import { useLeague } from './LeagueLayout';

const SKATER_RATINGS: Array<[string, string]> = [
  ['skating', 'Skating'], ['shooting', 'Shooting'], ['passing', 'Passing'], ['handling', 'Puck handling'], ['offIQ', 'Offensive IQ'],
  ['defIQ', 'Defensive IQ'], ['checking', 'Checking'], ['faceoffs', 'Faceoffs'], ['discipline', 'Discipline'], ['endurance', 'Endurance'],
];
const GOALIE_RATINGS: Array<[string, string]> = [['reflexes', 'Reflexes'], ['positioning', 'Positioning'], ['rebounds', 'Rebound control'], ['mental', 'Mental']];

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
                  Drafted {d.draft.season}, round {d.draft.round} (#{d.draft.overall}) by {d.draft.team?.city}
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
            Contract: <span className="text-white">{money(p.contract.salary)}</span> × {p.contract.yearsLeft} more season{p.contract.yearsLeft > 1 ? 's' : ''} ·{' '}
            {p.contract.kind === 'ELC' ? 'entry-level' : 'standard'} · becomes {p.contract.expiresAs}
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
                    <span className="tabular text-white">{ratings[k]}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-rink-700">
                    <div className="h-1.5 rounded-full bg-blueline" style={{ width: `${ratings[k]}%` }} />
                  </div>
                </li>
              ))}
            </ul>
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
          <Card title={`Career · ${totals.gp} GP${isG ? ` · ${totals.w} W · ${totals.so} SO` : ` · ${totals.g} G · ${totals.a} A · ${totals.g + totals.a} P`}`}>
            {d.career.length === 0 ? (
              <Empty>No NHL games yet.</Empty>
            ) : (
              <div className="-m-4 overflow-x-auto">
                <table className="table">
                  <thead>
                    {isG ? (
                      <tr>
                        <th>Season</th><th>Team</th><th className="num">Age</th><th className="num">OVR</th><th className="num">GP</th><th className="num">W</th>
                        <th className="num">L</th><th className="num">OTL</th><th className="num">SV%</th><th className="num">GAA</th><th className="num">SO</th><th className="num">Playoffs</th>
                      </tr>
                    ) : (
                      <tr>
                        <th>Season</th><th>Team</th><th className="num">Age</th><th className="num">OVR</th><th className="num">GP</th><th className="num">G</th>
                        <th className="num">A</th><th className="num">P</th><th className="num">+/-</th><th className="num">PIM</th><th className="num">TOI</th><th className="num">Playoffs</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {d.career.map((c) => (
                      <tr key={c.season}>
                        <td className="tabular">
                          {c.season}-{String(c.season + 1).slice(2)}
                        </td>
                        <td>{c.team ? <TeamChip team={c.team} size="sm" /> : <span className="text-ice-500">—</span>}</td>
                        <td className="num">{c.age}</td>
                        <td className="num">{c.overall}</td>
                        {isG ? (
                          <>
                            <td className="num">{c.goalie?.gp ?? 0}</td>
                            <td className="num">{c.goalie?.w ?? 0}</td>
                            <td className="num">{c.goalie?.l ?? 0}</td>
                            <td className="num">{c.goalie?.otl ?? 0}</td>
                            <td className="num">{c.goalie ? svPct(c.goalie.sa, c.goalie.ga) : '—'}</td>
                            <td className="num">{c.goalie ? gaa(c.goalie.ga, c.goalie.toi) : '—'}</td>
                            <td className="num">{c.goalie?.so ?? 0}</td>
                            <td className="num text-ice-400">{c.playoffGoalie ? `${c.playoffGoalie.w}-${c.playoffGoalie.l}` : ''}</td>
                          </>
                        ) : (
                          <>
                            <td className="num">{c.skater?.gp ?? 0}</td>
                            <td className="num">{c.skater?.g ?? 0}</td>
                            <td className="num">{c.skater?.a ?? 0}</td>
                            <td className="num font-semibold text-white">{c.skater ? c.skater.g + c.skater.a : 0}</td>
                            <td className="num">{c.skater ? signed(c.skater.pm) : 0}</td>
                            <td className="num">{c.skater?.pim ?? 0}</td>
                            <td className="num">{c.skater?.gp ? toi(c.skater.toi, c.skater.gp) : '—'}</td>
                            <td className="num text-ice-400">{c.playoffSkater ? `${c.playoffSkater.gp} GP, ${c.playoffSkater.g + c.playoffSkater.a} P` : ''}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
