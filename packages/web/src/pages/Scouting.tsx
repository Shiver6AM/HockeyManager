import { useState } from 'react';
import { Link } from 'react-router-dom';
/**
 * Amateur scouting: send your area scouts to regions, watch your knowledge of
 * each region grow over the season, and browse next summer's draft class as
 * your scouts see it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClassTable, ConfidenceBar, CssRankings, type ClassPlayer } from '../components/ClassTable';
import { ScheduleEditor, ScheduleSummary, TargetPicker } from '../components/ScoutSchedule';
import { Badge, Button, Card, cx, Empty, ErrorBox, Spinner } from '../components/ui';
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

      <Scouts
        d={d}
        labels={labels}
        cls={cls.data?.players ?? []}
        followNote={cls.data ? cls.data.followNote : cls.isLoading ? 'Loading the draft class…' : 'Next season’s draft class takes the ice on opening night.'}
      />

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

function Scouts({ d, labels, cls, followNote }: { d: Data; labels: Record<string, string>; cls: ClassPlayer[]; followNote: string | null }) {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const done = { onSuccess: () => qc.invalidateQueries() };
  const assign = useMutation(trpc.life.assignScout.mutationOptions(done));
  const release = useMutation(trpc.life.releaseScout.mutationOptions(done));
  const hire = useMutation(trpc.life.hireScout.mutationOptions(done));
  const target = useMutation(trpc.life.assignScoutTargets.mutationOptions(done));
  const [picking, setPicking] = useState<Scout | null>(null);
  const [planning, setPlanning] = useState<Scout | null>(null);
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
            labels={labels}
            initial={picking.following ? { league: picking.following.league, ids: picking.following.players.map((p) => p.id) } : null}
            cls={cls}
            note={followNote}
            max={d.maxTargets}
            saving={target.isPending}
            error={target.error}
            onClose={() => setPicking(null)}
            onSave={(league, ids) =>
              target.mutate({ leagueId: L.id, scoutId: picking.id, league, playerIds: ids }, { onSuccess: () => setPicking(null) })
            }
          />
        )}
        {planning && d.planWindow && (
          <ScheduleEditor
            scout={planning}
            window={d.planWindow}
            labels={labels}
            cls={cls}
            followNote={followNote}
            maxLegs={d.maxLegs}
            maxTargets={d.maxTargets}
            onClose={() => setPlanning(null)}
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
                    {s.plan && <ScheduleSummary plan={s.plan} labels={labels} onEdit={d.isMine && d.planWindow ? () => setPlanning(s) : undefined} />}
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
                          title={s.plan ? 'Choosing an assignment here replaces his schedule' : 'Where he is scouting now'}
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
                        {d.planWindow && (
                          <Button variant="secondary" className="px-2 py-0.5 text-xs" onClick={() => setPlanning(s)}>
                            {s.plan ? 'Edit schedule' : 'Schedule…'}
                          </Button>
                        )}
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

