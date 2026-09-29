import { useState } from 'react';
import { Link } from 'react-router-dom';
/**
 * Amateur scouting: send your area scouts to regions, watch your knowledge of
 * each region grow over the season, and browse next summer's draft class as
 * your scouts see it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClassTable, ConfidenceBar, CssRankings, type ClassPlayer } from '../components/ClassTable';
import { Badge, Button, Card, cx, Empty, ErrorBox, Modal, Spinner } from '../components/ui';
import { dayLabel, money } from '../format';
import { useSort } from '../sort';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

type Data = Outputs['life']['scouting'];
type Scout = Data['scouts'][number];

function topRegions(s: Scout, labels: Record<string, string>, n = 2) {
  return Object.entries(s.familiarity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([r, v]) => `${labels[r]} ${v}`)
    .join(' · ');
}

export function ScoutingPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const teamId = L.myTeamId;
  const q = useQuery({ ...trpc.life.scouting.queryOptions({ leagueId: L.id, teamId: teamId ?? '' }), enabled: !!teamId });
  const cls = useQuery(trpc.life.draftClass.queryOptions({ leagueId: L.id }));
  if (!teamId) return <Card><Empty>Manage a team to run a scouting staff.</Empty></Card>;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Spinner />;
  const d = q.data;
  const labels = Object.fromEntries(d.regions.map((r) => [r.id, r.label]));
  const here = (region: string) => d.scouts.filter((s) => s.region === region);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Scouting{d.draftSeason ? ` · ${d.draftSeason} draft class` : ''}</h1>
        <p className="text-sm text-ice-400">
          Next summer's draft class is playing now, in junior, college and European leagues. Send your area scouts where you want to know more: every day
          in a region builds your confidence in its prospects, faster for skilled scouts who know the area (and with a good head scout
          {d.headScout ? `: yours is rated ${d.headScout.rating}` : ''}). Prospects in regions you haven't scouted show no projection at all on draft day,
          and your projections sharpen as confidence grows. Knowledge resets each season with the new class.
        </p>
      </div>

      <Card title="Regions">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {d.regions.map((r) => (
            <div key={r.id} className="rounded-lg border border-rink-700 bg-rink-850 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-white">{r.label}</p>
                <span className="text-[11px] text-ice-500">{r.prospects} prospects</span>
              </div>
              <p className="text-[11px] text-ice-500">{r.leagues}</p>
              <div className="mt-2">{r.confidence !== null && <ConfidenceBar value={r.confidence} />}</div>
              <p className="mt-1 text-[11px] text-ice-400">
                {here(r.id).length ? here(r.id).map((s) => s.name).join(', ') : <span className="text-ice-600">No scout here</span>}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Scouts d={d} labels={labels} cls={cls.data?.players ?? []} />

      {cls.data && (
        <Card title={`Central Scouting rankings · ${cls.data.cssEdition}`}>
          <CssRankings
            players={cls.data.players}
            leagueId={L.id}
            edition={cls.data.cssEdition}
            updatedOn={cls.data.cssUpdate.day !== null ? dayLabel(L.season, cls.data.cssUpdate.day, { month: 'short', day: 'numeric' }) : null}
          />
        </Card>
      )}

      <Card title="Draft class">
        {cls.data ? <ClassTable players={cls.data.players} leagueId={L.id} storageKey="scouting-class" targeted={new Set(cls.data.targeted)} /> : cls.isLoading ? <Spinner /> : <Empty>No draft class right now.</Empty>}
      </Card>
    </div>
  );
}

function Scouts({ d, labels, cls }: { d: Data; labels: Record<string, string>; cls: ClassPlayer[] }) {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const done = { onSuccess: () => qc.invalidateQueries() };
  const assign = useMutation(trpc.life.assignScout.mutationOptions(done));
  const release = useMutation(trpc.life.releaseScout.mutationOptions(done));
  const hire = useMutation(trpc.life.hireScout.mutationOptions(done));
  const target = useMutation(trpc.life.assignScoutTargets.mutationOptions(done));
  const [picking, setPicking] = useState<Scout | null>(null);
  const full = d.scouts.length >= d.maxScouts;
  const regionIds = Object.keys(labels);
  const { sorted: pool, Th } = useSort(
    d.pool,
    {
      name: (s) => s.name.split(' ').slice(-1)[0],
      skill: (s) => s.skill,
      best: (s) => Math.max(...Object.values(s.familiarity)),
      salary: (s) => s.salary,
      yrs: (s) => s.yearsLeft,
      ...Object.fromEntries(regionIds.map((r) => [`r:${r}`, (s: Scout) => s.familiarity[r as keyof Scout['familiarity']]])),
    },
    { key: 'skill' },
    'scout-pool',
  );
  return (
    <div className="space-y-5">
      <div className="space-y-5">
        {picking && (
          <TargetPicker
            scout={picking}
            cls={cls}
            max={d.maxTargets}
            saving={target.isPending}
            error={target.error}
            onClose={() => setPicking(null)}
            onSave={(league, ids) =>
              target.mutate({ leagueId: L.id, scoutId: picking.id, league, playerIds: ids }, { onSuccess: () => setPicking(null) })
            }
          />
        )}
        <Card title={`Your scouts (${d.scouts.length}/${d.maxScouts})`} action={<span className="text-xs text-ice-400">Payroll {money(d.payroll)}</span>}>
          <ErrorBox error={assign.error ?? release.error} />
          {d.scouts.length === 0 ? (
            <Empty>No scouts. Hire one below.</Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {d.scouts.map((s) => {
                const settlement = Math.round((s.salary * Math.max(0, s.yearsLeft - 1)) / 2);
                return (
                  <div key={s.id} className="rounded-lg border border-rink-700 bg-rink-850 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-semibold text-white">{s.name}</p>
                      <span className="text-xs text-ice-400">
                        {money(s.salary)} · {s.yearsLeft} yr
                      </span>
                    </div>
                    <p className="text-xs text-ice-400">
                      Evaluation <span className={cx('font-semibold', s.skill >= 75 ? 'text-win' : s.skill >= 60 ? 'text-ice-100' : 'text-red-300')}>{s.skill}</span>
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                      {Object.entries(s.familiarity)
                        .sort((a, b) => b[1] - a[1])
                        .map(([r, v]) => (
                          <div key={r} className="flex items-center gap-1.5 text-[11px]">
                            <span className={cx('w-24 truncate', r === s.region ? 'font-semibold text-white' : 'text-ice-400')}>{labels[r]}</span>
                            <span className="h-1 flex-1 rounded-full bg-rink-700">
                              <span className={cx('block h-1 rounded-full', v >= 70 ? 'bg-win' : v >= 40 ? 'bg-blueline' : 'bg-rink-500')} style={{ width: `${v}%` }} />
                            </span>
                          </div>
                        ))}
                    </div>
                    {s.following && (
                      <div className="mt-2 rounded-md bg-rink-800/60 p-2">
                        <p className="mb-1 flex items-center justify-between text-[11px] text-ice-400">
                          <span>
                            Following {s.following.players.length} in the {s.following.league}
                          </span>
                          {d.isMine && (
                            <button className="text-blue-300 hover:underline" onClick={() => setPicking(s)}>
                              Edit
                            </button>
                          )}
                        </p>
                        <ul className="space-y-0.5">
                          {s.following.players.map((p) => (
                            <li key={p.id} className="flex items-center gap-1.5 text-[11px]">
                              <Link to={`/league/${L.id}/player/${p.id}`} className="min-w-0 flex-1 truncate text-ice-100 hover:underline">
                                {p.name} <span className="text-ice-500">{p.pos}</span>
                              </Link>
                              <ConfidenceBar value={p.confidence} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {d.isMine && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <select
                          className="slot w-auto py-0.5 text-xs"
                          value={s.assignment}
                          onChange={(e) =>
                            e.target.value === 'players' ? setPicking(s) : assign.mutate({ leagueId: L.id, scoutId: s.id, region: e.target.value as 'auto' })
                          }
                        >
                          <option value="players">Specific prospects…{s.following ? ` (${s.following.players.length} in the ${s.following.league})` : ''}</option>
                          <option value="auto">Auto (head scout decides){s.assignment === 'auto' && s.region ? `: ${labels[s.region]}` : ''}</option>
                          {Object.keys(labels).map((r) => (
                            <option key={r} value={r}>
                              {labels[r]} (knows it {s.familiarity[r as keyof typeof s.familiarity]})
                            </option>
                          ))}
                        </select>
                        {s.ratePerDay !== null && <span className="text-[11px] text-ice-500">+{s.ratePerDay}/day</span>}
                        <Button
                          variant="ghost"
                          className="ml-auto px-2 py-0.5 text-xs"
                          disabled={release.isPending}
                          onClick={() => release.mutate({ leagueId: L.id, scoutId: s.id })}
                        >
                          Let go{settlement ? ` (${money(settlement)})` : ''}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
      {d.isMine && (
        <Card title="Scouts available">
          {full && <p className="mb-2 text-xs text-warn">Your staff is full ({d.maxScouts}). Let a scout go to hire another.</p>}
          <ErrorBox error={hire.error} />
          <div className="-mx-4 max-h-[32rem] overflow-y-auto">
            <table className="table w-full text-xs">
              <thead className="sticky top-0 bg-rink-900">
                <tr>
                  <Th k="name">Scout</Th>
                  <Th k="skill" className="num">Eval</Th>
                  {regionIds.map((r) => (
                    <Th key={r} k={`r:${r}`} className="num" title={`Familiarity with ${labels[r]}`}>
                      {labels[r].replace('Quebec & Maritimes', 'Quebec').replace('Western Canada', 'W. Canada').replace('United States', 'USA').replace('Central Europe', 'C. Europe')}
                    </Th>
                  ))}
                  <Th k="salary" className="num">Salary</Th>
                  <Th k="yrs" className="num">Yrs</Th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pool.map((s) => (
                  <tr key={s.id}>
                    <td className="font-semibold text-ice-50">{s.name}</td>
                    <td className="num">{s.skill}</td>
                    {regionIds.map((r) => {
                      const v = s.familiarity[r as keyof Scout['familiarity']];
                      return (
                        <td key={r} className={cx('num', v >= 70 ? 'font-semibold text-win' : v >= 40 ? 'text-ice-100' : 'text-ice-500')}>
                          {v}
                        </td>
                      );
                    })}
                    <td className="num">{money(s.salary)}</td>
                    <td className="num">{s.yearsLeft}</td>
                    <td className="text-right">
                      <Button className="px-2 py-0.5 text-xs" disabled={full || hire.isPending} onClick={() => hire.mutate({ leagueId: L.id, scoutId: s.id })}>
                        Hire
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-ice-500">
            <Badge tone="info">Tip</Badge> A scout who knows a region learns it about twice as fast as one who doesn't.
          </p>
        </Card>
      )}
    </div>
  );
}

/** Pick up to 10 draft-eligible prospects in one league for a scout to follow. */
function TargetPicker({
  scout,
  cls,
  max,
  saving,
  error,
  onClose,
  onSave,
}: {
  scout: Scout;
  cls: ClassPlayer[];
  max: number;
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (league: string, ids: string[]) => void;
}) {
  const leagues = [...new Set(cls.map((p) => p.league))].sort();
  const [league, setLeague] = useState(scout.following?.league ?? leagues[0] ?? '');
  const [ids, setIds] = useState<string[]>(scout.following?.players.map((p) => p.id) ?? []);
  const inLeague = cls.filter((p) => p.league === league).sort((a, b) => (a.css?.rank ?? 999) - (b.css?.rank ?? 999));
  const toggle = (id: string) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= max ? ids : [...ids, id]);
  return (
    <Modal title={`${scout.name}: follow specific prospects`} onClose={onClose}>
      <p className="mb-3 text-sm text-ice-300">
        Send him to watch up to {max} prospects in one league. He learns about each of them much faster than he would covering a whole region (the fewer
        he follows, the faster), but nobody else in the region.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <select
          className="slot w-auto"
          value={league}
          onChange={(e) => {
            setLeague(e.target.value);
            setIds([]);
          }}
        >
          {leagues.map((l) => (
            <option key={l} value={l}>
              {l} ({cls.filter((p) => p.league === l).length} prospects)
            </option>
          ))}
        </select>
        <span className={cx('text-sm', ids.length >= max ? 'text-warn' : 'text-ice-400')}>
          {ids.length}/{max} chosen
        </span>
      </div>
      <div className="max-h-[26rem] overflow-y-auto rounded-lg border border-rink-700">
        <table className="table text-sm">
          <thead className="sticky top-0 bg-rink-900">
            <tr>
              <th />
              <th>Prospect</th>
              <th>Pos</th>
              <th>Club</th>
              <th className="num">GP</th>
              <th className="num">P</th>
              <th className="num" title="Central Scouting rank">CSS</th>
              <th>Your confidence</th>
            </tr>
          </thead>
          <tbody>
            {inLeague.map((p) => (
              <tr key={p.id} className={cx('cursor-pointer', ids.includes(p.id) && 'bg-blueline/10')} onClick={() => toggle(p.id)}>
                <td>
                  <input type="checkbox" checked={ids.includes(p.id)} readOnly disabled={!ids.includes(p.id) && ids.length >= max} />
                </td>
                <td className="whitespace-nowrap text-ice-50">{p.name}</td>
                <td className="text-ice-400">{p.pos}</td>
                <td className="text-xs text-ice-300">{p.club}</td>
                <td className="num">{p.stats?.gp ?? 0}</td>
                <td className="num">{p.pos === 'G' ? '—' : (p.stats?.g ?? 0) + (p.stats?.a ?? 0)}</td>
                <td className="num">{p.css?.rank ?? '—'}</td>
                <td>
                  <ConfidenceBar value={p.confidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorBox error={error} />
      <div className="mt-3 flex gap-2">
        <Button disabled={!ids.length || saving} onClick={() => onSave(league, ids)}>
          {saving ? 'Saving…' : `Follow ${ids.length} prospect${ids.length === 1 ? '' : 's'}`}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
