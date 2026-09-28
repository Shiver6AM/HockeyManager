import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLeague } from '../pages/LeagueLayout';
import { useTRPC } from '../trpc';
import { cx } from './ui';

type Target = { days: number } | { to: 'playoffs' | 'end-of-season' | 'next-season' | 'trade-deadline' | 'free-agency' };

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
  const advance = useMutation(trpc.sim.advance.mutationOptions({ onSuccess: refresh }));
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
    advance.mutate({ leagueId: L.id, target });
  };
  const resignWeek = offseason && L.offseasonStage === 're-sign' && L.resignDay !== null;
  const beforeFa = offseason && (!L.offseasonStage || L.offseasonStage === 'draft' || L.offseasonStage === 're-sign');
  const primary: { label: string; target: Target } = offseason
    ? { label: resignWeek ? (L.resignDay! < L.resignDays ? `Next day (${L.resignDay}/${L.resignDays})` : 'Open free agency') : 'Next stage', target: { days: 1 } }
    : { label: 'Sim 1 day', target: { days: 1 } };
  const deadlineAhead = L.daysToDeadline !== null && L.daysToDeadline > 0;
  const more: Array<{ label: string; target: Target }> = offseason
    ? [
        ...(beforeFa ? [{ label: 'Sim to free agency', target: { to: 'free-agency' } as Target }] : []),
        { label: 'Advance to next season', target: { to: 'next-season' } },
      ]
    : [
        { label: 'Sim 1 week', target: { days: 7 } },
        ...(deadlineAhead ? [{ label: `Sim to trade deadline (${L.daysToDeadline}d)`, target: { to: 'trade-deadline' } as Target }] : []),
        ...(L.phase === 'regular-season' ? [{ label: 'Sim to playoffs', target: { to: 'playoffs' } as Target }] : []),
        { label: 'Sim to end of season', target: { to: 'end-of-season' } },
      ];
  const err = (advance.error ?? ready.error)?.message;

  const deadlineChip =
    L.daysToDeadline !== null && L.daysToDeadline >= 0 && L.daysToDeadline <= 21 ? (
      <span
        className={cx('rounded px-2 py-1 text-[11px] font-semibold whitespace-nowrap', L.daysToDeadline <= 3 ? 'bg-goal/20 text-red-200' : 'bg-rink-800 text-ice-300')}
        title="Trades close after the deadline day until the season ends"
      >
        {L.daysToDeadline === 0 ? 'Trade deadline today' : `Deadline in ${L.daysToDeadline}d`}
      </span>
    ) : null;
  return (
    <div className="flex items-center gap-2">
      {deadlineChip}
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
            disabled={advance.isPending}
            className="rounded-l-lg bg-blueline px-3 py-1.5 text-sm font-bold whitespace-nowrap text-white shadow hover:bg-blue-500 disabled:opacity-60"
            title={L.isCoCommissioner ? 'Co-commissioner: advance the league' : 'Advance the league'}
          >
            {advance.isPending ? 'Simulating…' : `▶ ${primary.label}`}
          </button>
          <button
            onClick={() => setMenu((m) => !m)}
            disabled={advance.isPending}
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
