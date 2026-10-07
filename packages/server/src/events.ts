/**
 * Live updates. Browsers hold one open connection per league (server-sent
 * events) and are told when something changed, instead of asking every few
 * seconds. The messages are tiny and say only that there is news: clients
 * fetch what they show through the usual, permission-checked requests.
 *
 *  - `changed`: the league was saved (a sim step, a trade, a pick, a signing),
 *    or its members changed (someone joined, claimed a team, readied up).
 *  - `sim`: progress of the sim in flight (what `sim.status` returns).
 *  - `deleted`: the commissioner deleted the league (the last message its listeners get).
 */
export type LeagueEvent = { type: 'changed' } | { type: 'sim'; job: unknown } | { type: 'deleted' };

type Listener = (e: LeagueEvent) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(leagueId: string, fn: Listener): () => void {
  let set = listeners.get(leagueId);
  if (!set) listeners.set(leagueId, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (!set!.size) listeners.delete(leagueId);
  };
}

export function publish(leagueId: string, e: LeagueEvent) {
  for (const fn of listeners.get(leagueId) ?? []) {
    try {
      fn(e);
    } catch {
      /* a closed connection: it unsubscribes itself */
    }
  }
}

export const watching = (leagueId: string) => listeners.get(leagueId)?.size ?? 0;
