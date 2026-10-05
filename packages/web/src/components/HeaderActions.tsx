import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague } from '../pages/LeagueLayout';
import { useTRPC } from '../trpc';
import { useSim, type Target } from '../sim';
import { dayLabel } from '../format';
import { cx } from './ui';

const STAGE: Record<string, string> = { draft: 'Entry draft', 're-sign': 'Re-signing week', 'free-agency': 'Free agency', 'training-camp': 'Training camp' };

/** Live progress of the league's sim, shown to everyone. */
export function SimProgress() {
  const L = useLeague();
  const sim = useSim();
  const j = sim.job;
  if (!j || j.status !== 'running') return null;
  const where = j.phase === 'offseason' ? (j.stage ? STAGE[j.stage] : 'Season review') : dayLabel(j.season, j.day);
  return (
    <div className="mx-auto w-full max-w-[2560px] px-4 pb-2 lg:px-6">
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-blueline/50 bg-blueline/10 px-2.5 py-1 text-xs text-blue-100" role="status" aria-live="polite">
      <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-blue-300 border-t-transparent" />
      <span className="min-w-0 truncate">
        <span className="font-semibold text-white">Simming to {j.label}</span>
        <span className="tabular"> · {where}</span>
        {j.games > 0 && <span className="tabular text-blue-200"> · {j.games} games</span>}
        {j.startedBy && <span className="text-blue-300"> · by {j.startedBy}</span>}
      </span>
      <span className="ml-auto h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-rink-700" title={`${Math.round(j.progress * 100)}%`}>
        <span className="block h-1.5 rounded-full bg-blueline transition-all" style={{ width: `${Math.round(j.progress * 100)}%` }} />
      </span>
      {L.canAdvance && (
        <button
          onClick={sim.cancel}
          disabled={sim.cancelling}
          className="shrink-0 rounded px-1.5 py-0.5 font-semibold text-blue-100 hover:bg-white/10 disabled:opacity-60"
          title="Stop after the current day; everything simmed so far is kept"
        >
          {sim.cancelling ? 'Stopping…' : 'Cancel'}
        </button>
      )}
    </div>
    </div>
  );
}

/**
 * Always-visible controls in the top bar: your Ready toggle, and for the
 * commissioner and co-commissioners, advancing the league.
 */
export function HeaderActions() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  const ready = useMutation(trpc.sim.setReady.mutationOptions({ onSuccess: refresh }));
  const sim = useSim();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const managers = L.members.filter((m) => m.teamId);
  const readyCount = managers.filter((m) => m.ready).length;
  const offseason = L.phase === 'offseason';
  const go = (target: Target) => {
    setMenu(false);
    sim.start(target);
  };
  const busy = sim.running || sim.starting;
  const resignWeek = offseason && L.offseasonStage === 're-sign' && L.resignDay !== null;
  const beforeFa = offseason && (!L.offseasonStage || L.offseasonStage === 'draft' || L.offseasonStage === 're-sign');
  const faDays = offseason && L.offseasonStage === 'free-agency' && L.faDay !== null;
  const primary: { label: string; target: Target } = offseason
    ? {
        label: resignWeek
          ? L.resignDay! < L.resignDays
            ? `Next day (${L.resignDay}/${L.resignDays})`
            : 'Open free agency'
          : faDays
            ? L.faDay! < L.faDays
              ? `Next day (FA ${L.faDay}/${L.faDays})`
              : 'Close free agency'
            : 'Next stage',
        target: { days: 1 },
      }
    : { label: 'Sim 1 day', target: { days: 1 } };
  const deadlineAhead = L.daysToDeadline !== null && L.daysToDeadline > 0;
  const more: Array<{ label: string; target: Target }> = offseason
    ? [
        ...(beforeFa ? [{ label: 'Sim to free agency', target: { to: 'free-agency' } as Target }] : []),
        ...(beforeFa || faDays ? [{ label: 'Sim to end of free agency', target: { to: 'training-camp' } as Target }] : []),
        { label: 'Advance to next season', target: { to: 'next-season' } },
      ]
    : [
        { label: 'Sim 1 week', target: { days: 7 } },
        ...(deadlineAhead ? [{ label: `Sim to trade deadline (${L.daysToDeadline}d)`, target: { to: 'trade-deadline' } as Target }] : []),
        ...(L.phase === 'regular-season' ? [{ label: 'Sim to end of regular season', target: { to: 'playoffs' } as Target }] : []),
        { label: L.phase === 'regular-season' ? 'Sim through the playoffs' : 'Sim to end of playoffs', target: { to: 'end-of-season' } },
      ];
  const err = (sim.startError ?? ready.error)?.message;

  const deadlineChip =
    L.daysToDeadline !== null && L.daysToDeadline >= 0 && L.daysToDeadline <= 21 ? (
      <span
        className={cx('rounded px-2 py-1 text-[11px] font-semibold whitespace-nowrap', L.daysToDeadline <= 3 ? 'bg-goal/20 text-red-200' : 'bg-rink-800 text-ice-300')}
        title="Trades close after the deadline day until the season ends"
      >
        {L.daysToDeadline === 0 ? 'Trade deadline today' : `Deadline in ${L.daysToDeadline}d`}
      </span>
    ) : null;
  const cast = L.simcast;
  const inSeason = L.phase === 'regular-season' || L.phase === 'playoffs';
  const simcastButton = cast ? (
    <Link
      to={`/league/${L.id}/simcast`}
      title={cast.live ? `${cast.host} is simcasting ${cast.away.city} at ${cast.home.city}. The league can't sim until it ends.` : 'The simcast is over'}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold whitespace-nowrap shadow transition',
        cast.live ? 'bg-goal text-white hover:brightness-110' : 'bg-rink-800 text-ice-200 ring-1 ring-rink-600 hover:bg-rink-700',
      )}
    >
      {cast.live && <span className="h-2 w-2 animate-pulse rounded-full bg-white" />}
      {cast.live ? 'Join simcast' : 'Simcast final'}
      <span className="rounded bg-black/20 px-1 text-[11px] font-semibold">
        {cast.away.abbr} @ {cast.home.abbr}
      </span>
    </Link>
  ) : inSeason ? (
    <Link
      to={`/league/${L.id}/simcast`}
      title="Watch one of the next game day's games play by play"
      className="inline-flex items-center gap-1.5 rounded-lg bg-rink-800 px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-ice-100 ring-1 ring-rink-600 transition hover:bg-rink-700"
    >
      📺 Simcast
    </Link>
  ) : null;
  const castBlocks = !!cast?.live;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {deadlineChip}
      {simcastButton}
      {L.myTeamId && (
        <button
          onClick={() => ready.mutate({ leagueId: L.id, ready: !L.myReady })}
          disabled={ready.isPending}
          title={L.myReady ? 'You are ready. Click to undo.' : 'Tell the league you are done for this advance'}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold whitespace-nowrap shadow transition',
            L.myReady ? 'bg-win/20 text-win ring-1 ring-win/50 hover:bg-win/30' : 'bg-warn text-rink-950 hover:brightness-110',
          )}
        >
          {L.myReady ? '✓ Ready' : "I'm ready"}
          {managers.length > 1 && (
            <span className="rounded bg-black/20 px-1 text-[11px] font-semibold">
              {readyCount}/{managers.length}
            </span>
          )}
        </button>
      )}
      {L.canAdvance && (
        <div className="relative flex" ref={ref}>
          <button
            onClick={() => go(primary.target)}
            disabled={busy || castBlocks}
            className="rounded-l-lg bg-blueline px-3 py-1.5 text-sm font-bold whitespace-nowrap text-white shadow hover:bg-blue-500 disabled:opacity-60"
            title={castBlocks ? 'A game is being simcast: the league can sim once it ends' : sim.running ? 'The league is simming' : L.isCoCommissioner ? 'Co-commissioner: advance the league' : 'Advance the league'}
          >
            {sim.running ? 'Simming…' : `▶ ${primary.label}`}
          </button>
          <button
            onClick={() => setMenu((m) => !m)}
            disabled={busy || castBlocks}
            aria-label="More advance options"
            className="rounded-r-lg border-l border-white/20 bg-blueline px-2 py-1.5 text-sm text-white shadow hover:bg-blue-500 disabled:opacity-60"
          >
            ▾
          </button>
          {menu && (
            <div className="absolute top-full right-0 z-30 mt-1 w-52 overflow-hidden rounded-lg border border-rink-600 bg-rink-900 shadow-xl shadow-black/50">
              {more.map((m) => (
                <button key={m.label} onClick={() => go(m.target)} className="block w-full px-3 py-2 text-left text-sm text-ice-100 hover:bg-rink-800">
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {err && (
        <span className="max-w-48 truncate text-xs text-red-300" title={err}>
          {err}
        </span>
      )}
    </div>
  );
}
