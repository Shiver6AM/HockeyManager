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
      <Bracket po={po} />
      <details className="rounded-xl border border-rink-700 bg-rink-900 p-4">
        <summary className="cursor-pointer font-display text-sm font-semibold tracking-wider text-ice-300 uppercase">Every series, game by game</summary>
        <div className="mt-4 grid gap-4 lg:grid-cols-4">
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
      </details>
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

type Po = NonNullable<Outputs['data']['playoffs']>;

/** West on the left, East on the right, each working in toward the Final in the middle. */
function Bracket({ po }: { po: Po }) {
  const confs = [...new Set(po.rounds[0].series.map((s) => s.conference).filter(Boolean))] as string[];
  const west = confs.find((c) => /west/i.test(c)) ?? confs[1] ?? confs[0];
  const east = confs.find((c) => c !== west) ?? confs[0];
  // Series of a conference in each round (1-3), with empty slots for rounds not reached yet.
  const col = (conf: string, round: number): Array<Series | null> => {
    const want = [4, 2, 1][round - 1];
    const got = po.rounds[round - 1]?.series.filter((s) => s.conference === conf) ?? [];
    return Array.from({ length: want }, (_, i) => got[i] ?? null);
  };
  const final = po.rounds[3]?.series[0] ?? null;
  const columns: Array<{ key: string; title: string; items: Array<Series | null>; side: 'l' | 'r' | 'c' }> = [
    { key: 'w1', title: `${west} · Round 1`, items: col(west, 1), side: 'l' },
    { key: 'w2', title: 'Second round', items: col(west, 2), side: 'l' },
    { key: 'w3', title: `${west} final`, items: col(west, 3), side: 'l' },
    { key: 'f', title: 'Final', items: [final], side: 'c' },
    { key: 'e3', title: `${east} final`, items: col(east, 3), side: 'r' },
    { key: 'e2', title: 'Second round', items: col(east, 2), side: 'r' },
    { key: 'e1', title: `${east} · Round 1`, items: col(east, 1), side: 'r' },
  ];
  return (
    <div className="overflow-x-auto rounded-xl border border-rink-700 bg-rink-900 p-4">
      <div className="grid min-w-[1080px] grid-cols-7 gap-3">
        {columns.map((c) => (
          <div key={c.key} className="flex flex-col">
            <h2
              className={cx(
                'mb-2 truncate text-center font-display text-[11px] font-semibold tracking-wider uppercase',
                c.side === 'c' ? 'text-warn' : 'text-ice-400',
              )}
            >
              {c.title}
            </h2>
            <div className="flex h-[34rem] flex-col justify-around">
              {c.items.map((s, i) => (
                <div key={s?.id ?? `${c.key}-${i}`} className={cx('relative', c.side === 'c' && 'scale-110')}>
                  <BracketSlot s={s} side={c.side} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BracketSlot({ s, side }: { s: Series | null; side: 'l' | 'r' | 'c' }) {
  const L = useLeague();
  if (!s) {
    return (
      <div className="rounded-lg border border-dashed border-rink-700 px-2 py-3 text-center text-[11px] text-ice-600">TBD</div>
    );
  }
  const row = (t: Series['high'], wins: number) => {
    const out = s.winner && s.winner !== t.id;
    const won = s.winner === t.id;
    return (
      <Link
        to={`/league/${L.id}/team/${t.id}`}
        title={`${t.city} ${t.name}`}
        className={cx('flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-rink-800', out && 'opacity-40', side === 'r' && 'flex-row-reverse')}
      >
        <TeamChip team={t} size="sm" />
        <span className={cx('flex-1 truncate text-xs', side === 'r' && 'text-right', L.myTeamId === t.id ? 'font-semibold text-white' : 'text-ice-200', won && 'font-semibold text-white')}>
          {t.abbr}
        </span>
        <span className={cx('tabular font-display text-sm', won ? 'text-win' : 'text-white')}>{wins}</span>
      </Link>
    );
  };
  const last = s.games[s.games.length - 1];
  return (
    <div className={cx('rounded-lg border bg-rink-850 p-1.5', s.winner ? 'border-rink-600' : 'border-blueline/50', side === 'c' && 'border-warn/60 bg-warn/5')}>
      {row(s.high, s.highWins)}
      {row(s.low, s.lowWins)}
      {last && !s.winner && (
        <Link to={`/league/${L.id}/game/${last.id}`} className="mt-0.5 block text-center text-[10px] text-ice-500 hover:text-ice-200">
          G{last.gameNumber}: {last.away.abbr} {last.awayScore}-{last.homeScore} {last.home.abbr}
          {last.overtime ? ' OT' : ''}
        </Link>
      )}
    </div>
  );
}
