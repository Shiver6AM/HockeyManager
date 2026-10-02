import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cx } from './ui';
import { usePollInterval } from '../live';
import { useTRPC } from '../trpc';

const ICON: Record<string, string> = {
  advance: '🏒', draft: '🎓', 'free-agency': '✍️', trade: '🔁', commissioner: '⚖️', offseason: '📅', champion: '🏆', owner: '💼',
};

function ago(at: string | Date) {
  const m = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/** Bell with unread count; polls so notices from other managers' actions show up. */
export function NotificationBell({ leagueId }: { leagueId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // (New notices arrive with league changes, which refresh this through the live connection.)
  const q = useQuery({ ...trpc.life.notifications.queryOptions({ leagueId }), refetchInterval: usePollInterval(15_000, 120_000) });
  const mark = useMutation(trpc.life.markRead.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.life.notifications.queryKey() }) }));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const unread = q.data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-ice-300 hover:bg-rink-800 hover:text-white"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-goal px-1 text-center text-[10px] leading-4 font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-rink-700 bg-rink-900 shadow-xl shadow-black/50">
          <div className="flex items-center justify-between border-b border-rink-700 px-3 py-2">
            <span className="font-display text-xs font-semibold tracking-wider text-ice-300 uppercase">Notifications</span>
            {unread > 0 && (
              <button className="text-xs text-blue-300 hover:underline" onClick={() => mark.mutate({ leagueId })}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {q.data?.items.length ? (
              q.data.items.map((n) => (
                <li key={n.id}>
                  <button
                    className={cx('flex w-full gap-2 px-3 py-2 text-left text-sm hover:bg-rink-800', !n.read && 'bg-blueline/10')}
                    onClick={() => {
                      if (!n.read) mark.mutate({ id: n.id });
                      setOpen(false);
                      if (n.link) navigate(`/league/${leagueId}${n.link}`);
                    }}
                  >
                    <span aria-hidden>{ICON[n.kind] ?? '•'}</span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block', n.read ? 'text-ice-400' : 'text-ice-50')}>{n.text}</span>
                      <span className="text-[11px] text-ice-500">{ago(n.at)}</span>
                    </span>
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blueline" />}
                  </button>
                </li>
              ))
            ) : (
              <li className="px-3 py-6 text-center text-sm text-ice-500">Nothing yet.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
