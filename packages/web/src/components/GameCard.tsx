import { Link } from 'react-router-dom';
import type { Outputs } from '../trpc';
import { cx, TeamChip } from './ui';

type Game = Outputs['data']['day']['games'][number];

export function GameCard({ leagueId, game, highlight }: { leagueId: string; game: Game; highlight?: string | null }) {
  const suffix = game.shootout ? 'SO' : game.overtime ? 'OT' : 'Final';
  const row = (side: 'away' | 'home') => {
    const t = game[side];
    const score = side === 'home' ? game.homeScore : game.awayScore;
    const other = side === 'home' ? game.awayScore : game.homeScore;
    const won = game.played && score! > other!;
    return (
      <div className={cx('flex items-center gap-2', game.played && !won && 'opacity-60')}>
        <TeamChip team={t} size="sm" />
        <span className={cx('flex-1 truncate text-sm', highlight === t.id && 'font-semibold text-white')}>
          {t.city} <span className="text-ice-400">{t.name}</span>
        </span>
        <span className={cx('tabular font-display text-lg', won ? 'text-white' : 'text-ice-300')}>{game.played ? score : ''}</span>
      </div>
    );
  };
  const body = (
    <>
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold tracking-wider text-ice-500 uppercase">
        <span>{game.seriesId ? `Game ${game.gameNumber}` : game.played ? suffix : 'Scheduled'}</span>
        {game.seriesId && game.played && <span>{suffix}</span>}
      </div>
      <div className="space-y-1">
        {row('away')}
        {row('home')}
      </div>
    </>
  );
  const cls = 'block rounded-lg border border-rink-700 bg-rink-850 p-3 transition';
  return game.played ? (
    <Link to={`/league/${leagueId}/game/${game.id}`} className={cx(cls, 'hover:border-rink-500 hover:bg-rink-800')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
