/**
 * Live updates. One open connection per league tab (server-sent events): the
 * server says when the league changed and how a running sim is going, so pages
 * refresh at once instead of asking every few seconds. If the connection
 * can't be made (or drops), pages fall back to asking on a timer, as before.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';

export type LeagueEvent = { type: 'hello' } | { type: 'changed' } | { type: 'sim'; job: unknown } | { type: 'deleted' };

let live = false;
const watchers = new Set<() => void>();
function setLive(v: boolean) {
  if (live === v) return;
  live = v;
  watchers.forEach((f) => f());
}

/** True while the live connection is up. */
export function useLive(): boolean {
  return useSyncExternalStore(
    (f) => {
      watchers.add(f);
      return () => watchers.delete(f);
    },
    () => live,
  );
}

/** How often to ask on a timer: rarely while live updates are flowing, at the old rate otherwise. */
export function usePollInterval(whenOffline: number, whenLive: number | false = 30_000): number | false {
  return useLive() ? whenLive : whenOffline;
}

export function useLeagueEvents(leagueId: string, onEvent: (e: LeagueEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!leagueId || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/leagues/${leagueId}/events`, { withCredentials: true });
    es.onopen = () => setLive(true);
    // (The browser reconnects by itself; until it does, pages poll.)
    es.onerror = () => setLive(false);
    es.onmessage = (m) => {
      try {
        handler.current(JSON.parse(m.data) as LeagueEvent);
      } catch {
        /* not ours */
      }
    };
    return () => {
      es.close();
      setLive(false);
    };
  }, [leagueId]);
}
