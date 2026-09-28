import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, cx, Empty, Spinner, TeamChip } from '../components/ui';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

type Series = NonNullable<Outputs['data']['playoffs']>['rounds'][number]['series'][number];

export function PlayoffsPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const q = useQuery(trpc.data.playoffs.queryOptions({ leagueId: L.id }));
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <Card><Empty>The playoffs haven't started yet.</Empty></Card>;
  const po = q.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Playoffs</h1>
        {po.champion && (
          <span className="inline-flex items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-3 py-1 text-sm text-warn">
            🏆 <TeamChip team={po.champion} size="sm" />{' '}
            <Link to={`/league/${L.id}/team/${po.champion.id}`} className="hover:underline">
              {po.champion.city} {po.champion.name}
            </Link>
          </span>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-4">
        {po.rounds.map((round) => (
          <div key={round.name}>
            <h2 className="mb-2 font-display text-sm font-semibold tracking-wider text-ice-400 uppercase">{round.name}</h2>
            <div className="space-y-3">
              {round.series.map((s) => (
                <SeriesCard key={s.id} s={s} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeriesCard({ s }: { s: Series }) {
  const L = useLeague();
  const status = s.winner
    ? `${s.winner === s.high.id ? s.high.abbr : s.low.abbr} wins ${Math.max(s.highWins, s.lowWins)}-${Math.min(s.highWins, s.lowWins)}`
    : s.highWins === s.lowWins
      ? s.highWins === 0
        ? 'Series starting'
        : `Series tied ${s.highWins}-${s.lowWins}`
      : `${s.highWins > s.lowWins ? s.high.abbr : s.low.abbr} leads ${Math.max(s.highWins, s.lowWins)}-${Math.min(s.highWins, s.lowWins)}`;
  const row = (t: Series['high'], wins: number) => (
    <div className={cx('flex items-center gap-2', s.winner && s.winner !== t.id && 'opacity-50')}>
      <TeamChip team={t} size="sm" />
      <Link to={`/league/${L.id}/team/${t.id}`} className={cx('flex-1 truncate text-sm hover:underline', L.myTeamId === t.id && 'font-semibold text-white')}>
        {t.city}
      </Link>
      <span className="tabular font-display text-lg text-white">{wins}</span>
    </div>
  );
  return (
    <div className="rounded-lg border border-rink-700 bg-rink-900 p-3">
      <div className="space-y-1">
        {row(s.high, s.highWins)}
        {row(s.low, s.lowWins)}
      </div>
      <p className="mt-2 text-xs text-ice-400">{status}</p>
      {s.games.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {s.games.map((g) => (
            <Link
              key={g.id}
              to={`/league/${L.id}/game/${g.id}`}
              className="tabular rounded bg-rink-800 px-1.5 py-0.5 text-[11px] text-ice-300 hover:bg-rink-700 hover:text-white"
              title={`Game ${g.gameNumber}`}
            >
              {g.away.abbr} {g.awayScore}-{g.homeScore} {g.home.abbr}
              {g.overtime ? ' OT' : ''}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
