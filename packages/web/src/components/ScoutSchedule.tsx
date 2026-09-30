/**
 * Scout schedules: a list of assignments (a region, the head scout's call, or
 * specific prospects), each for some weeks, run back to back through the season.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { dayLabel } from '../format';
import { useLeague } from '../pages/LeagueLayout';
import { useTRPC, type Outputs } from '../trpc';
import { ConfidenceBar, type ClassPlayer } from './ClassTable';
import { Button, cx, ErrorBox, Modal } from './ui';

type Data = Outputs['life']['scouting'];
type Scout = Data['scouts'][number];
type Plan = NonNullable<Scout['plan']>;
type Window = NonNullable<Data['planWindow']>;
type Assignment = Plan['legs'][number]['assignment'];
interface Leg {
  key: number;
  weeks: number;
  assignment: Assignment;
  targets?: { league: string; ids: string[]; names: string[] };
}

const short = (season: number, day: number) => dayLabel(season, day, { month: 'short', day: 'numeric' });

/** A scout's schedule, stop by stop, with the dates each covers. */
export function ScheduleSummary({ plan, labels, onEdit }: { plan: Plan; labels: Record<string, string>; onEdit?: () => void }) {
  const L = useLeague();
  const future = plan.season > L.season;
  return (
    <div className="mt-2 rounded-md bg-rink-800/60 p-2">
      <p className="mb-1 flex items-center justify-between text-[11px] text-ice-400">
        <span>{future ? `Schedule for ${plan.season}-${String(plan.season + 1).slice(2)}` : 'Schedule'}</span>
        {onEdit && (
          <button className="text-blue-300 hover:underline" onClick={onEdit}>
            Edit
          </button>
        )}
      </p>
      <ol className="space-y-0.5">
        {plan.legs.map((l, i) => {
          const last = i === plan.legs.length - 1;
          const now = plan.current === i;
          return (
            <li key={i} className={cx('flex items-center gap-1.5 text-[11px]', l.done ? 'text-ice-600 line-through' : now ? 'font-semibold text-white' : 'text-ice-300')}>
              <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', now ? 'bg-win' : l.done ? 'bg-rink-600' : 'bg-blueline')} />
              <span className="min-w-0 flex-1 truncate">
                {legName(l.assignment, labels, l.targets ? { league: l.targets.league, count: l.targets.players.length } : undefined)}
              </span>
              <span className="shrink-0 tabular text-ice-500">
                {short(plan.season, l.from)}–{last ? 'season end' : short(plan.season, l.to)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function legName(a: Assignment, labels: Record<string, string>, t?: { league: string; count: number }) {
  if (a === 'auto') return "Head scout's call";
  if (a === 'players') return t ? `${t.count} prospect${t.count === 1 ? '' : 's'} in the ${t.league}` : 'Specific prospects';
  return labels[a] ?? a;
}

let nextKey = 1;

/** Build a scout's schedule for the rest of the season (or next season, in the summer). */
export function ScheduleEditor({
  scout,
  window: w,
  labels,
  cls,
  maxLegs,
  maxTargets,
  onClose,
}: {
  scout: Scout;
  window: Window;
  labels: Record<string, string>;
  cls: ClassPlayer[];
  maxLegs: number;
  maxTargets: number;
  onClose: () => void;
}) {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const save = useMutation(trpc.life.setScoutPlan.mutationOptions({ onSuccess: async () => { await qc.invalidateQueries(); onClose(); } }));
  const clear = useMutation(trpc.life.clearScoutPlan.mutationOptions({ onSuccess: async () => { await qc.invalidateQueries(); onClose(); } }));
  const [legs, setLegs] = useState<Leg[]>(() => initialLegs(scout, w, L.day));
  const [picking, setPicking] = useState<number | null>(null);
  const total = legs.reduce((n, l) => n + l.weeks, 0);
  const left = w.weeks - total;
  const set = (key: number, patch: Partial<Leg>) => setLegs(legs.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= legs.length) return;
    const next = [...legs];
    [next[i], next[j]] = [next[j], next[i]];
    setLegs(next);
  };
  const add = () => setLegs([...legs, { key: nextKey++, weeks: Math.min(4, Math.max(1, left)), assignment: 'auto' }]);
  const missingTargets = legs.some((l) => l.assignment === 'players' && !l.targets);
  let day = w.startDay;
  const pickingLeg = legs.find((l) => l.key === picking);
  const seasonLabel = `${w.season}-${String(w.season + 1).slice(2)}`;

  if (pickingLeg)
    return (
      <TargetPicker
        scout={scout}
        initial={pickingLeg.targets ?? null}
        cls={cls}
        max={maxTargets}
        saving={false}
        error={null}
        saveLabel={(n) => `Use ${n} prospect${n === 1 ? '' : 's'}`}
        onClose={() => setPicking(null)}
        onSave={(league, ids) => {
          set(pickingLeg.key, { targets: { league, ids, names: ids.map((id) => cls.find((p) => p.id === id)?.name ?? id) } });
          setPicking(null);
        }}
      />
    );

  return (
    <Modal title={`${scout.name}: schedule`} onClose={onClose}>
      <p className="mb-3 text-sm text-ice-300">
        {w.nextSeason
          ? `Plan his travel for next season (${seasonLabel}): ${w.weeks} weeks of regular season. `
          : `Plan the rest of his season: ${w.weeks} week${w.weeks === 1 ? '' : 's'} left in the regular season, starting today. `}
        Each stop runs for the weeks you give it, one after another. The last one carries on to the end of the season (through the playoffs, until the
        draft).
        {w.nextSeason && " Next season's draft class isn't known yet, so following specific prospects has to wait until the season starts."}
      </p>
      <ol className="space-y-2">
        {legs.map((l, i) => {
          const from = day;
          day += l.weeks * 7;
          const last = i === legs.length - 1;
          return (
            <li key={l.key} className="rounded-lg border border-rink-700 bg-rink-850 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-5 text-center text-xs font-semibold text-ice-500">{i + 1}</span>
                <select
                  className="slot w-auto min-w-0 flex-1 py-1 text-sm"
                  aria-label={`Stop ${i + 1}`}
                  value={l.assignment}
                  onChange={(e) => {
                    const a = e.target.value as Assignment;
                    set(l.key, { assignment: a, targets: a === 'players' ? l.targets : undefined });
                    if (a === 'players' && !l.targets) setPicking(l.key);
                  }}
                >
                  <option value="auto">Head scout's call</option>
                  {Object.keys(labels).map((r) => (
                    <option key={r} value={r}>
                      {labels[r]} (knows it {scout.familiarity[r as keyof Scout['familiarity']]})
                    </option>
                  ))}
                  <option value="players" disabled={w.nextSeason}>
                    Specific prospects…
                  </option>
                </select>
                <div className="flex items-center gap-1" aria-label={`Weeks for stop ${i + 1}`}>
                  <button className="rounded bg-rink-800 px-2 py-1 text-sm text-ice-300 hover:bg-rink-700 disabled:opacity-30" disabled={l.weeks <= 1} onClick={() => set(l.key, { weeks: l.weeks - 1 })} aria-label="Fewer weeks">
                    −
                  </button>
                  <input
                    className="slot py-1 text-center text-sm"
                    style={{ width: "3.5rem" }}
                    inputMode="numeric"
                    value={l.weeks}
                    onChange={(e) => set(l.key, { weeks: Math.max(1, Math.min(w.weeks, Number(e.target.value.replace(/\D/g, '')) || 1)) })}
                  />
                  <button className="rounded bg-rink-800 px-2 py-1 text-sm text-ice-300 hover:bg-rink-700 disabled:opacity-30" disabled={left <= 0} onClick={() => set(l.key, { weeks: l.weeks + 1 })} aria-label="More weeks">
                    +
                  </button>
                  <span className="text-xs text-ice-400">wk</span>
                </div>
                <div className="ml-auto flex items-center gap-0.5">
                  <button className="rounded px-1.5 text-ice-400 hover:text-white disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    ↑
                  </button>
                  <button className="rounded px-1.5 text-ice-400 hover:text-white disabled:opacity-30" disabled={last} onClick={() => move(i, 1)} aria-label="Move down">
                    ↓
                  </button>
                  <button className="rounded px-1.5 text-ice-400 hover:text-red-300 disabled:opacity-30" disabled={legs.length === 1} onClick={() => setLegs(legs.filter((x) => x.key !== l.key))} aria-label="Remove">
                    ✕
                  </button>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-[11px] text-ice-500">
                <span>
                  Weeks {(from - w.startDay) / 7 + 1}–{(from - w.startDay) / 7 + l.weeks} · {short(w.season, from)} – {short(w.season, from + l.weeks * 7 - 1)}
                  {last && ' (then carries on to season end)'}
                </span>
                {l.assignment === 'players' && (
                  <button className="text-blue-300 hover:underline" onClick={() => setPicking(l.key)}>
                    {l.targets ? `${l.targets.ids.length} in the ${l.targets.league}: ${l.targets.names.slice(0, 3).join(', ')}${l.targets.names.length > 3 ? '…' : ''} (change)` : 'Choose prospects…'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs">
          <span className={cx(left < 0 ? 'text-red-300' : 'text-ice-400')}>
            {total} of {w.weeks} weeks planned{left > 0 ? ` · ${left} to go` : left < 0 ? ` · ${-left} too many` : ''}
          </span>
          <Button variant="secondary" className="px-2 py-1 text-xs" disabled={left <= 0 || legs.length >= maxLegs} onClick={add}>
            + Add a stop
          </Button>
        </div>
        <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-rink-700">
          {legs.map((l, i) => (
            <span key={l.key} className={cx('h-2 border-r border-rink-900', i % 2 ? 'bg-blueline/70' : 'bg-blueline')} style={{ width: `${(Math.min(l.weeks, w.weeks) / w.weeks) * 100}%` }} />
          ))}
        </div>
      </div>
      <ErrorBox error={save.error ?? clear.error} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={save.isPending || left < 0 || missingTargets}
          onClick={() =>
            save.mutate({
              leagueId: L.id,
              scoutId: scout.id,
              legs: legs.map((l) => ({ weeks: l.weeks, assignment: l.assignment, targets: l.assignment === 'players' && l.targets ? { league: l.targets.league, ids: l.targets.ids } : undefined })),
            })
          }
        >
          {save.isPending ? 'Saving…' : 'Save schedule'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {scout.plan && (
          <Button variant="ghost" className="ml-auto text-red-300" disabled={clear.isPending} onClick={() => clear.mutate({ leagueId: L.id, scoutId: scout.id })}>
            Clear schedule
          </Button>
        )}
      </div>
    </Modal>
  );
}

/** Start from what's still ahead on his current schedule, or from what he's doing now. */
function initialLegs(scout: Scout, w: Window, today: number): Leg[] {
  const p = scout.plan;
  if (p && p.season === w.season) {
    const ahead = p.legs.filter((l) => !l.done);
    const out = ahead.map((l) => ({
      key: nextKey++,
      weeks: w.nextSeason ? l.weeks : Math.max(1, Math.ceil((l.to + 1 - Math.max(today, l.from)) / 7)),
      assignment: l.assignment,
      targets: l.targets ? { league: l.targets.league, ids: l.targets.players.map((x) => x.id), names: l.targets.players.map((x) => x.name) } : undefined,
    }));
    // Trim to what's left of the season.
    let budget = w.weeks;
    return out.filter((l) => budget > 0).map((l) => { const weeks = Math.min(l.weeks, budget); budget -= weeks; return { ...l, weeks }; });
  }
  const a = w.nextSeason && scout.assignment === 'players' ? 'auto' : scout.assignment;
  return [
    {
      key: nextKey++,
      weeks: Math.min(4, w.weeks),
      assignment: a,
      targets: a === 'players' && scout.following ? { league: scout.following.league, ids: scout.following.players.map((x) => x.id), names: scout.following.players.map((x) => x.name) } : undefined,
    },
  ];
}

/** Pick up to 10 draft-eligible prospects in one league for a scout to follow. */
export function TargetPicker({
  scout,
  initial,
  saveLabel,
  cls,
  max,
  saving,
  error,
  onClose,
  onSave,
}: {
  scout: { name: string };
  /** Start from this league and these prospects. */
  initial?: { league: string; ids: string[] } | null;
  saveLabel?: (n: number) => string;
  cls: ClassPlayer[];
  max: number;
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (league: string, ids: string[]) => void;
}) {
  const leagues = [...new Set(cls.map((p) => p.league))].sort();
  const [league, setLeague] = useState(initial?.league ?? leagues[0] ?? '');
  const [ids, setIds] = useState<string[]>(initial?.ids ?? []);
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
          {saving ? 'Saving…' : saveLabel ? saveLabel(ids.length) : `Follow ${ids.length} prospect${ids.length === 1 ? '' : 's'}`}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
