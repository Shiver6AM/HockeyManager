import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, cx, Empty, ErrorBox, TeamChip } from '../components/ui';
import { dayLabel, timeUntil } from '../format';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

type Advance = Outputs['leagues']['overview']['advance'];

const PRESETS: Array<{ label: string; cron: string; days: number }> = [
  { label: 'Every night at 11 PM (1 day)', cron: '0 23 * * *', days: 1 },
  { label: 'Twice a day, 9 AM & 9 PM (1 day)', cron: '0 9,21 * * *', days: 1 },
  { label: 'Every weeknight at 10 PM (2 days)', cron: '0 22 * * 1-5', days: 2 },
  { label: 'Sundays at 8 PM (7 days)', cron: '0 20 * * 0', days: 7 },
];

export function LeagueSettings() {
  const L = useLeague();
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <AdvanceSettings />
        <TradeSettings />
        <SimSliders />
        <Card title="Invite managers">
          <p className="text-sm text-ice-300">Share this code. Friends create an account, choose “Join a league”, and pick a team.</p>
          <p className="mt-3 inline-block rounded-lg border border-dashed border-rink-500 bg-rink-850 px-4 py-2 font-mono text-2xl tracking-[0.3em] text-white">
            {L.inviteCode}
          </p>
        </Card>
      </div>
      <div className="space-y-5">
        <Members />
        <AdvanceLog />
        <History />
      </div>
    </div>
  );
}

function AdvanceSettings() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Advance['mode']>(L.advance.mode);
  const current = L.advance.mode === 'scheduled' ? L.advance : null;
  const [cron, setCron] = useState(current?.cron ?? PRESETS[0].cron);
  const [days, setDays] = useState(current?.daysPerTick ?? 1);
  const [tz, setTz] = useState(current?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [early, setEarly] = useState(current?.advanceEarlyWhenAllReady ?? true);
  useEffect(() => setMode(L.advance.mode), [L.advance.mode]);
  const update = useMutation(trpc.leagues.updateAdvance.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const editable = L.isCommissioner;

  return (
    <Card title="How the league advances">
      <div className="grid gap-2 sm:grid-cols-2">
        {(['commissioner', 'scheduled'] as const).map((m) => (
          <button
            key={m}
            disabled={!editable}
            onClick={() => setMode(m)}
            className={cx(
              'rounded-lg border p-3 text-left transition disabled:cursor-default',
              mode === m ? 'border-blueline bg-blueline/10' : 'border-rink-600 hover:border-rink-500',
            )}
          >
            <p className="font-semibold text-white">{m === 'commissioner' ? 'Commissioner' : 'On a schedule'}</p>
            <p className="mt-0.5 text-xs text-ice-400">
              {m === 'commissioner'
                ? 'The commissioner sims when the group is ready. Good for live sessions together.'
                : 'Sims automatically at set times, so nobody has to press the button. Good for a league that runs all week.'}
            </p>
          </button>
        ))}
      </div>

      {mode === 'scheduled' && (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold tracking-wide text-ice-400 uppercase">Preset</span>
            <select
              className="slot"
              disabled={!editable}
              value={PRESETS.find((p) => p.cron === cron && p.days === days)?.label ?? ''}
              onChange={(e) => {
                const p = PRESETS.find((x) => x.label === e.target.value);
                if (p) {
                  setCron(p.cron);
                  setDays(p.days);
                }
              }}
            >
              <option value="">Custom</option>
              {PRESETS.map((p) => (
                <option key={p.label}>{p.label}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-2 block">
              <span className="mb-1 block text-xs font-semibold tracking-wide text-ice-400 uppercase">Cron schedule</span>
              <input
                className="slot font-mono"
                value={cron}
                disabled={!editable}
                onChange={(e) => setCron(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold tracking-wide text-ice-400 uppercase">Days / tick</span>
              <input
                type="number"
                min={1}
                max={14}
                className="slot"
                value={days}
                disabled={!editable}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold tracking-wide text-ice-400 uppercase">Time zone</span>
            <input className="slot" value={tz} disabled={!editable} onChange={(e) => setTz(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm text-ice-200">
            <input type="checkbox" checked={early} disabled={!editable} onChange={(e) => setEarly(e.target.checked)} />
            Advance early as soon as every manager is ready
          </label>
        </div>
      )}

      {current && L.nextAdvanceAt && (
        <p className="mt-3 text-sm text-ice-300">
          Next scheduled advance: <span className="text-white">{new Date(L.nextAdvanceAt).toLocaleString()}</span> ({timeUntil(L.nextAdvanceAt)})
        </p>
      )}

      {editable ? (
        <div className="mt-4 space-y-2">
          <Button
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                leagueId: L.id,
                advance:
                  mode === 'commissioner'
                    ? { mode: 'commissioner' }
                    : { mode: 'scheduled', cron, timezone: tz, daysPerTick: days, advanceEarlyWhenAllReady: early },
              })
            }
          >
            Save advance settings
          </Button>
          <ErrorBox error={update.error} />
          {update.isSuccess && <p className="text-sm text-win">Saved.</p>}
        </div>
      ) : (
        <p className="mt-3 text-xs text-ice-500">Only the commissioner can change these settings.</p>
      )}
    </Card>
  );
}

function TradeSettings() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const status = useQuery(trpc.trades.status.queryOptions({ leagueId: L.id }));
  const set = useMutation(trpc.trades.setReview.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  if (!status.data) return null;
  return (
    <Card title="Trades">
      <p className="text-sm text-ice-300">
        Deadline: day {status.data.deadlineDay + 1} of the regular season. Trades are frozen from then through the playoffs and during the draft.
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm text-ice-200">
        <input
          type="checkbox"
          disabled={!L.isCommissioner || set.isPending}
          checked={status.data.review === 'commissioner'}
          onChange={(e) => set.mutate({ leagueId: L.id, review: e.target.checked ? 'commissioner' : 'none' })}
        />
        Commissioner must approve trades involving a manager (anti-collusion)
      </label>
      <ErrorBox error={set.error} />
    </Card>
  );
}

function Members() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const release = useMutation(
    trpc.leagues.releaseTeam.mutationOptions({
      onSuccess: () => qc.invalidateQueries(),
    }),
  );
  const co = useMutation(
    trpc.leagues.setCoCommissioner.mutationOptions({
      onSuccess: () => qc.invalidateQueries(),
    }),
  );
  return (
    <Card title={`Members (${L.members.length})`}>
      {L.isCommissioner && (
        <p className="mb-2 text-xs text-ice-400">Co-commissioners can advance the league. League settings and trade approvals stay with you.</p>
      )}
      <ul className="divide-y divide-rink-700/60">
        {L.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 py-2 text-sm">
            {m.team ? <TeamChip team={m.team} size="sm" /> : <span className="h-5 w-5" />}
            <span className="flex-1 text-ice-100">
              {m.displayName} {m.userId === L.commissionerId && <Badge tone="info">Commissioner</Badge>}
              {m.coCommissioner && <Badge tone="good">Co-commissioner</Badge>}
            </span>
            {L.isCommissioner && m.userId !== L.commissionerId && (
              <label className="flex items-center gap-1.5 text-xs text-ice-300" title="Can advance the league">
                <input
                  type="checkbox"
                  checked={m.coCommissioner}
                  disabled={co.isPending}
                  onChange={(e) =>
                    co.mutate({
                      leagueId: L.id,
                      userId: m.userId,
                      value: e.target.checked,
                    })
                  }
                />
                Co-commish
              </label>
            )}
            <span className="text-ice-400">
              {m.team ? <Link to={`/league/${L.id}/team/${m.team.id}`} className="hover:underline">{`${m.team.city} ${m.team.name}`}</Link> : 'No team'}
            </span>
            {m.team && (m.userId === L.members.find((x) => x.teamId === L.myTeamId)?.userId || L.isCommissioner) && (
              <Button
                variant="ghost"
                className="px-2 py-0.5 text-xs"
                onClick={() => {
                  if (confirm(`Release ${m.team!.city}? The AI will take over the team.`)) release.mutate({ leagueId: L.id, userId: m.userId });
                }}
              >
                Release
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ErrorBox error={release.error ?? co.error} />
    </Card>
  );
}

function AdvanceLog() {
  const L = useLeague();
  const trpc = useTRPC();
  const log = useQuery(trpc.sim.log.queryOptions({ leagueId: L.id }));
  return (
    <Card title="Advance history">
      {log.data?.length ? (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
          {log.data.map((r) => (
            <li key={r.id} className="flex gap-2">
              <span className="w-32 shrink-0 text-xs text-ice-500">{new Date(r.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
              <span className="text-ice-300">
                <span className="text-ice-100">{r.by}</span>:{' '}
                {dayLabel(L.season, r.fromDay, {
                  month: 'short',
                  day: 'numeric',
                })}{' '}
                →{' '}
                {dayLabel(L.season, r.toDay, {
                  month: 'short',
                  day: 'numeric',
                })}
                , {r.games} games
                {r.phaseChanges.length > 0 && ` · ${r.phaseChanges.join(', ')}`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No advances yet.</Empty>
      )}
    </Card>
  );
}

function History() {
  const L = useLeague();
  const trpc = useTRPC();
  const awards = useQuery(trpc.data.awards.queryOptions({ leagueId: L.id }));
  if (!awards.data?.history.length) return null;
  return (
    <Card title="League history">
      {awards.data.history.map((h) => (
        <div key={h.season} className="text-sm">
          <p className="font-semibold text-white">
            {h.season}-{String(h.season + 1).slice(2)}:{' '}
            {h.champion ? <Link to={`/league/${L.id}/team/${h.champion.id}`} className="hover:underline">{`${h.champion.city} ${h.champion.name}`}</Link> : '—'}
          </p>
          <p className="text-ice-400">
            Runner-up:{' '}
            {h.runnerUp ? <Link to={`/league/${L.id}/team/${h.runnerUp.id}`} className="hover:underline">{`${h.runnerUp.city} ${h.runnerUp.name}`}</Link> : '—'}
          </p>
        </div>
      ))}
    </Card>
  );
}

/** Advanced: commissioner sliders on key simulation variables. */
function SimSliders() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery(trpc.leagues.simSettings.queryOptions({ leagueId: L.id }));
  const save = useMutation(trpc.leagues.updateSimSettings.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  if (!q.data) return null;
  const values = draft ?? Object.fromEntries(q.data.sliders.map((s) => [s.key, s.value]));
  const changed = q.data.sliders.filter((s) => values[s.key] !== 1).length;
  const dirty = !!draft && q.data.sliders.some((s) => draft[s.key] !== s.value);
  const groups = [...new Set(q.data.sliders.map((s) => s.group))];
  const edit = q.data.canEdit;
  return (
    <Card title="Simulation sliders (advanced)" action={changed ? <span className="text-xs text-warn">{changed} changed from default</span> : undefined}>
      <p className="-mt-1 mb-3 text-xs text-ice-400">
        Multipliers on key parts of the simulation. 1.0× is the default, tuned to play like the NHL. Changes apply from the next day simmed (development,
        decline and retirements each summer).{!edit && ' Only the commissioner can change these.'}
      </p>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g}>
            <h4 className="mb-1.5 text-[11px] font-semibold tracking-wider text-ice-500 uppercase">{g}</h4>
            <div className="space-y-2.5">
              {q.data.sliders
                .filter((s) => s.group === g)
                .map((s) => {
                  const v = values[s.key];
                  return (
                    <label key={s.key} className="block" title={s.help}>
                      <span className="flex items-baseline justify-between text-sm">
                        <span className="text-ice-100">{s.label}</span>
                        <span className={cx('tabular text-xs font-semibold', v === 1 ? 'text-ice-400' : 'text-warn')}>
                          {v === 0 ? 'Off' : `${v.toFixed(2).replace(/0$/, '')}×`}
                        </span>
                      </span>
                      <input
                        type="range"
                        className="w-full accent-blue-500"
                        min={s.min}
                        max={s.max}
                        step={s.step}
                        value={v}
                        disabled={!edit}
                        onChange={(e) => setDraft({ ...values, [s.key]: Number(e.target.value) })}
                      />
                      <span className="block text-[11px] text-ice-500">{s.help}</span>
                    </label>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      {edit && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate({ leagueId: L.id, sim: values }, { onSuccess: () => setDraft(null) })}>
            {save.isPending ? 'Saving…' : 'Save sliders'}
          </Button>
          <Button variant="ghost" disabled={!changed && !dirty} onClick={() => setDraft(Object.fromEntries(q.data!.sliders.map((s) => [s.key, 1])))}>
            Reset to defaults
          </Button>
          {save.isSuccess && !dirty && <span className="text-xs text-win">Saved</span>}
          <ErrorBox error={save.error} />
        </div>
      )}
    </Card>
  );
}
