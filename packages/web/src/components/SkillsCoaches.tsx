/**
 * Skills coaches: up to three per team, each working with up to five players on
 * one skill apiece, either picked by the coach (auto) or set by the manager.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { money } from '../format';
import { useSort } from '../sort';
import { useTRPC, type Outputs } from '../trpc';
import { Badge, Button, Card, cx, Empty, ErrorBox, Spinner } from './ui';

type Data = Outputs['life']['skillsCoaching'];
type Coach = Data['coaches'][number];
type PoolCoach = Data['pool'][number];
type Row = { playerId: string; skill: string };

const GROUP_TONE: Record<string, string> = { offense: 'bg-goal', defense: 'bg-blueline', skating: 'bg-win', goaltending: 'bg-warn' };

function RatingBars({ ratings, specialties, goalie }: { ratings: Record<string, number>; specialties: string[]; goalie?: boolean }) {
  return (
    <div className="space-y-1">
      {(goalie ? (['goaltending'] as const) : (['offense', 'defense', 'skating'] as const)).map((g) => {
        const r = ratings[g];
        const spec = specialties.includes(g);
        return (
          <div key={g} className="flex items-center gap-2 text-xs">
            <span className={cx('w-20 capitalize', spec ? 'font-semibold text-white' : 'text-ice-500')}>{g}</span>
            <div className="h-1.5 flex-1 rounded-full bg-rink-700">
              <div className={cx('h-1.5 rounded-full', spec ? GROUP_TONE[g] : 'bg-rink-500')} style={{ width: `${Math.max(4, ((r - 30) / 65) * 100)}%` }} />
            </div>
            <span className={cx('tabular w-6 text-right', spec ? 'text-white' : 'text-ice-500')}>{r}</span>
          </div>
        );
      })}
    </div>
  );
}

function Specialties({ list }: { list: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((g) => (
        <Badge key={g} tone={g === 'offense' ? 'bad' : g === 'defense' ? 'info' : g === 'goaltending' ? 'warn' : 'good'}>
          {g}
        </Badge>
      ))}
    </span>
  );
}

export function SkillsCoaches({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.life.skillsCoaching.queryOptions({ leagueId, teamId }));
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Spinner />;
  const d = q.data;
  return (
    <div className="space-y-5">
      <Card>
        <p className="text-sm text-ice-300">
          Skills coaches work with up to {d.maxPlayers} players each, on one skill apiece: a rating like shooting or skating, or a situational skill like net-front
          play or the penalty kill. Players improve a little every day of the season (a focused season can add several points to one skill), faster with a coach
          who's strong in that skill's group, for <span className="font-semibold text-white">coachable</span> and younger players, and for skills with room to
          grow. On <span className="font-semibold text-white">auto</span>, a coach picks the players who'd gain most and works on their weakest important skill.
        </p>
        <p className="mt-2 text-xs text-ice-400">
          {d.coaches.length}/{d.maxCoaches} coaches · payroll {money(d.payroll)} (outside the cap). Coaches with more specialties cost more.
        </p>
      </Card>
      <div className="grid gap-5 xl:grid-cols-3 lg:grid-cols-2">
        {d.coaches.map((c) => (
          <CoachCard key={c.id} c={c} d={d} leagueId={leagueId} />
        ))}
        {!d.coaches.length && <Empty>No skills coaches yet.</Empty>}
      </div>
      {d.isMine && <HirePool pool={d.pool} full={d.coaches.filter((c) => c.kind !== 'goalie').length >= d.maxCoaches} leagueId={leagueId} />}
    </div>
  );
}

function CoachCard({ c, d, leagueId }: { c: Coach; d: Data; leagueId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  const save = useMutation(trpc.life.setCoachPlan.mutationOptions({ onSuccess: refresh }));
  const release = useMutation(trpc.life.releaseSkillsCoach.mutationOptions({ onSuccess: refresh }));
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  // Re-seed the editor only when the saved plan itself changes (not on every refetch), and never mid-edit.
  const planSig = JSON.stringify([c.auto, c.assignments, c.auto ? c.working.map((w) => w.playerId) : null]);
  useEffect(() => {
    if (editing) return;
    setRows(c.auto ? c.working.map((w) => ({ playerId: w.playerId, skill: 'auto' })) : c.assignments.map((a) => ({ ...a })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSig, editing]);

  const takenElsewhere = new Set(d.coaches.filter((x) => x.id !== c.id).flatMap((x) => x.working.map((w) => w.playerId)));
  const byId = new Map(d.roster.map((p) => [p.id, p]));
  const skillLabel = Object.fromEntries(d.skills.map((s) => [s.id, s.label]));
  const settlement = Math.round((c.salary * Math.max(0, c.yearsLeft - 1)) / 2);

  const setAuto = (auto: boolean) => save.mutate({ leagueId, coachId: c.id, auto, assignments: auto ? [] : rows.filter((r) => r.playerId) });
  const saveRows = () => {
    save.mutate({ leagueId, coachId: c.id, auto: false, assignments: rows.filter((r) => r.playerId) }, { onSuccess: () => setEditing(false) });
  };

  return (
    <Card
      title={c.kind === 'goalie' ? `${c.name} · goalie coach` : c.name}
      action={
        <span className="text-right text-xs text-ice-400">
          {money(c.salary)} · {c.yearsLeft} yr
        </span>
      }
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <Specialties list={c.specialties} />
        {d.isMine && (
          <div className="flex rounded-lg bg-rink-800 p-0.5 text-xs">
            {(['auto', 'manual'] as const).map((m) => (
              <button
                key={m}
                disabled={save.isPending}
                onClick={() => (m === 'auto' ? setAuto(true) : (setEditing(true), c.auto && setRows(c.working.map((w) => ({ playerId: w.playerId, skill: w.skill })))))}
                className={cx('rounded-md px-2.5 py-1 font-semibold capitalize', (m === 'auto') === c.auto ? 'bg-rink-600 text-white' : 'text-ice-400 hover:text-ice-100')}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>
      <RatingBars ratings={c.ratings} specialties={c.specialties} goalie={c.kind === 'goalie'} />

      <p className="mt-4 mb-1.5 text-xs font-semibold tracking-wider text-ice-400 uppercase">Working with</p>
      {editing && d.isMine ? (
        <div className="space-y-2">
          {rows.map((r, i) => {
            const p = byId.get(r.playerId);
            const pace = p && r.skill !== 'auto' ? p.pace[c.id]?.[r.skill] : null;
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
                <select
                  className="slot min-w-0 text-xs"
                  value={r.playerId}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { playerId: e.target.value, skill: 'auto' } : x)))}
                >
                  <option value="">Choose a player…</option>
                  {d.roster
                    .filter((p) => (c.kind === 'goalie' ? p.pos === 'G' : true) && !takenElsewhere.has(p.id) && (p.id === r.playerId || !rows.some((x) => x.playerId === p.id)))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.pos} {p.overall}, {p.age}y, {p.coachabilityLabel.toLowerCase()})
                      </option>
                    ))}
                </select>
                <select
                  className="slot min-w-0 text-xs"
                  value={r.skill}
                  disabled={!p}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, skill: e.target.value } : x)))}
                >
                  <option value="auto">Auto: his weakest</option>
                  {p &&
                    (['offense', 'defense', 'skating', 'goaltending'] as const).map((g) => {
                      const opts = d.skills.filter((s) => s.group === g && p.skills[s.id] !== undefined);
                      if (!opts.length) return null;
                      return (
                        <optgroup key={g} label={`${g[0].toUpperCase()}${g.slice(1)} (coach ${c.ratings[g]})`}>
                          {opts.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label} {p.skills[s.id]} → +{p.pace[c.id]?.[s.id] ?? 0}/season
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                </select>
                <button className="px-1 text-ice-500 hover:text-red-300" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  ✕
                </button>
                {pace !== null && pace !== undefined && <span className="col-span-3 -mt-1 text-[11px] text-ice-400">About +{pace} {skillLabel[r.skill]} over a full season at this pace.</span>}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {rows.length < (c.kind === 'goalie' ? d.maxGoalies : d.maxPlayers) && (
              <Button variant="ghost" className="text-xs" onClick={() => setRows([...rows, { playerId: '', skill: 'auto' }])}>
                + Add player
              </Button>
            )}
            <Button className="text-xs" disabled={save.isPending} onClick={saveRows}>
              Save plan
            </Button>
            <Button variant="ghost" className="text-xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          <ErrorBox error={save.error} />
        </div>
      ) : c.working.length ? (
        <ul className="space-y-2">
          {c.working.map((w) => (
            <li key={w.playerId} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <Link to={`/league/${leagueId}/player/${w.playerId}`} className="truncate font-semibold text-ice-50 hover:underline">
                  {w.name}
                </Link>
                <span className="shrink-0 text-xs text-ice-400">
                  {w.label} <span className="tabular text-ice-100">{w.value}</span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1 flex-1 rounded-full bg-rink-700" title="Progress toward his next point">
                  <div className="h-1 rounded-full bg-win" style={{ width: `${Math.round(w.progress * 100)}%` }} />
                </div>
                <span className="tabular text-[11px] text-ice-500" title="Points per full season at the current pace">
                  +{w.seasonPace}/season
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ice-500">{c.auto ? 'Nobody to work with yet.' : 'No players assigned.'}</p>
      )}
      {!editing && d.isMine && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rink-700 pt-3">
          {!c.auto && (
            <Button variant="secondary" className="text-xs" onClick={() => setEditing(true)}>
              Edit plan
            </Button>
          )}
          <Button
            variant="ghost"
            className="text-xs"
            disabled={release.isPending}
            onClick={() => release.mutate({ leagueId, coachId: c.id })}
            title={settlement ? `Settlement: ${money(settlement)}` : 'No settlement owed'}
          >
            Let go{settlement ? ` (${money(settlement)} settlement)` : ''}
          </Button>
          <ErrorBox error={release.error ?? save.error} />
        </div>
      )}
    </Card>
  );
}

function HirePool({ pool, full, leagueId }: { pool: PoolCoach[]; full: boolean; leagueId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const hire = useMutation(trpc.life.hireSkillsCoach.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const [filter, setFilter] = useState<string>('all');
  const filteredPool = pool.filter((c) => (filter === 'all' ? true : filter === 'goalie' ? c.kind === 'goalie' : c.kind !== 'goalie' && (c.specialties as string[]).includes(filter)));
  const { sorted: shown, Th } = useSort(
    filteredPool,
    {
      name: (c) => c.name.split(' ').slice(-1)[0],
      spec: (c) => c.specialties.length,
      offense: (c) => c.ratings.offense,
      defense: (c) => c.ratings.defense,
      skating: (c) => c.ratings.skating,
      goaltending: (c) => c.ratings.goaltending ?? null,
      salary: (c) => c.salary,
      yrs: (c) => c.yearsLeft,
    },
    { key: 'salary' },
    'coach-pool',
  );
  return (
    <Card
      title="Available skills coaches"
      action={
        <select className="slot w-auto text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All specialties</option>
          <option value="offense">Offense</option>
          <option value="defense">Defense</option>
          <option value="skating">Skating</option>
          <option value="goalie">Goalie coaches</option>
        </select>
      }
    >
      {full && <p className="mb-3 text-sm text-warn">You have the maximum of three skills coaches. Let one go to hire someone new.</p>}
      <ErrorBox error={hire.error} />
      <div className="-m-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <Th k="name">Coach</Th>
              <Th k="spec" title="Number of specialties">Specialties</Th>
              <Th k="offense" className="num">OFF</Th>
              <Th k="defense" className="num">DEF</Th>
              <Th k="skating" className="num">SKT</Th>
              <Th k="goaltending" className="num">GLT</Th>
              <Th k="salary" className="num">Salary</Th>
              <Th k="yrs" className="num">Yrs</Th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id}>
                <td className="font-semibold text-ice-50">{c.name}</td>
                <td>
                  <Specialties list={c.specialties} />
                </td>
                {(['offense', 'defense', 'skating', 'goaltending'] as const).map((g) => (
                  <td key={g} className={cx('num', c.specialties.includes(g) ? 'font-semibold text-white' : 'text-ice-500')}>
                    {c.ratings[g]}
                  </td>
                ))}
                <td className="num">{money(c.salary)}</td>
                <td className="num">{c.yearsLeft}</td>
                <td className="text-right">
                  <Button
                    className="px-2 py-0.5 text-xs"
                    disabled={(full && c.kind !== 'goalie') || hire.isPending}
                    title={c.kind === 'goalie' ? 'Replaces your current goalie coach' : undefined}
                    onClick={() => hire.mutate({ leagueId, coachId: c.id })}
                  >
                    Hire
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
