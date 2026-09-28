import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { GameCard } from '../components/GameCard';
import { Button, Card, Empty, Spinner } from '../components/ui';
import { dayLabel } from '../format';
import { useTRPC } from '../trpc';
import { useLeague } from './LeagueLayout';

export function ScoresPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const [params, setParams] = useSearchParams();
  const day = params.get('day') ? Number(params.get('day')) : undefined;
  const q = useQuery(trpc.data.day.queryOptions({ leagueId: L.id, day }));
  const go = (d: number | null) => d !== null && setParams({ day: String(d) });
  const d = q.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Scores &amp; schedule</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={d?.prevDay == null} onClick={() => go(d!.prevDay)}>
            ← Prev
          </Button>
          <span className="min-w-44 text-center font-semibold text-white">
            {d ? dayLabel(L.season, d.day, { weekday: 'long', month: 'short', day: 'numeric' }) : '…'}
          </span>
          <Button variant="secondary" disabled={d?.nextDay == null} onClick={() => go(d!.nextDay)}>
            Next →
          </Button>
          <Button variant="ghost" onClick={() => setParams({})}>
            Latest
          </Button>
        </div>
      </div>
      {!d ? (
        <Spinner />
      ) : (
        <Card>
          {d.games.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {d.games.map((g) => (
                <GameCard key={g.id} leagueId={L.id} game={g} highlight={L.myTeamId} />
              ))}
            </div>
          ) : (
            <Empty>No games on this day.</Empty>
          )}
        </Card>
      )}
    </div>
  );
}
