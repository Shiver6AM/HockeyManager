/**
 * League sims run in the background on the server, one day at a time. Every
 * member polls the status, so everyone sees the days tick by and nobody starts
 * a second sim while one is running.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useLeague } from './pages/LeagueLayout';
import { useTRPC } from './trpc';

export type Target = { days: number } | { to: 'playoffs' | 'end-of-season' | 'next-season' | 'trade-deadline' | 'free-agency' | 'training-camp' };

export function useSim() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const status = useQuery({
    ...trpc.sim.status.queryOptions({ leagueId: L.id }),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 600 : 4000),
  });
  const statusKey = trpc.sim.status.queryKey({ leagueId: L.id });
  const start = useMutation(trpc.sim.advance.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: statusKey }) }));
  const cancel = useMutation(trpc.sim.cancel.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: statusKey }) }));
  const job = status.data ?? null;
  const running = job?.status === 'running';

  // While it runs, refresh what's on screen every few seconds (the server saves as it goes);
  // when it ends, refresh everything once.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      const t = setInterval(() => qc.invalidateQueries({ predicate: (q) => JSON.stringify(q.queryKey) !== JSON.stringify(statusKey) }), 3000);
      return () => clearInterval(t);
    }
    if (wasRunning.current) {
      wasRunning.current = false;
      void qc.invalidateQueries();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return {
    job,
    running,
    start: (target: Target) => start.mutate({ leagueId: L.id, target, background: true }),
    starting: start.isPending,
    startError: start.error,
    cancel: () => cancel.mutate({ leagueId: L.id }),
    cancelling: cancel.isPending || !!job?.cancelling,
  };
}
