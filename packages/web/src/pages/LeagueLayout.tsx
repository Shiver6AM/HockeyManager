import { useLeagueEvents, useLive } from '../live';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { HeaderActions, SimProgress } from '../components/HeaderActions';
import { NotificationBell } from '../components/NotificationBell';
import { Badge, cx, ErrorBox, Spinner, TeamChip } from '../components/ui';
import { dayLabel, PHASE_LABEL } from '../format';
import { useTRPC, type Outputs } from '../trpc';

type Overview = Outputs['leagues']['overview'];
const LeagueCtx = createContext<Overview | null>(null);

/** Current league overview; refreshed every few seconds so advances by others show up. */
export function useLeague(): Overview {
  const v = useContext(LeagueCtx);
  if (!v) throw new Error('useLeague outside LeagueLayout');
  return v;
}

/** A team by id (every team is in the overview), for logos and names. */
export function useTeamById() {
  const L = useLeague();
  const byId = new Map(L.teams.map((t) => [t.id, t]));
  return (id: string | null | undefined) => (id ? byId.get(id) : undefined);
}

export function LeagueLayout() {
  const { leagueId = '' } = useParams();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const isLive = useLive();
  // (With live updates on, the timer is only a safety net.)
  const ov = useQuery({ ...trpc.leagues.overview.queryOptions({ leagueId }), refetchInterval: isLive ? 30_000 : 4_000 });
  // Whenever the league changes (someone sims, trades, signs…), refresh every view on
  // screen: nobody should have to reload the page to see a co-commissioner's sim.
  const seen = useRef<number | null>(null);
  const overviewKey = trpc.leagues.overview.queryKey({ leagueId });
  useEffect(() => {
    const v = ov.data?.version;
    if (v === undefined) return;
    if (seen.current !== null && seen.current !== v) {
      void qc.invalidateQueries({ predicate: (q) => JSON.stringify(q.queryKey) !== JSON.stringify(overviewKey) });
    }
    seen.current = v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ov.data?.version, leagueId]);
  // Pushed from the server: the league changed (refresh the overview; a new version
  // refreshes everything else, above), or a sim made progress.
  const refreshSoon = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLeagueEvents(leagueId, (e) => {
    if (e.type === 'sim') {
      qc.setQueryData(trpc.sim.status.queryKey({ leagueId }), e.job as never);
      return;
    }
    // ('hello' on every (re)connect: catch up on anything missed.)
    if (refreshSoon.current) return;
    refreshSoon.current = setTimeout(() => {
      refreshSoon.current = null;
      void qc.invalidateQueries({ queryKey: overviewKey });
      if (e.type === 'hello') void qc.invalidateQueries({ queryKey: trpc.sim.status.queryKey({ leagueId }) });
    }, 120);
  });
  if (ov.isLoading) return <Spinner />;
  if (ov.error) return <div className="p-6"><ErrorBox error={ov.error} /></div>;
  const L = ov.data!;
  const myTeam = L.members.find((m) => m.teamId === L.myTeamId)?.team;

  const tabs: Array<[string, string]> = [
    ['', 'Home'],
    ...(L.myTeamId ? ([[`team/${L.myTeamId}`, 'My Team']] as Array<[string, string]>) : []),
    ...(L.fantasy ? ([['fantasy', 'Fantasy draft']] as Array<[string, string]>) : []),
    ...(L.phase === 'offseason' && !L.fantasy
      ? ([
          ['draft', 'Draft'],
          ['re-sign', 'Re-sign'],
        ] as Array<[string, string]>)
      : []),
    ...(L.myTeamId && L.phase !== 'offseason' ? ([['scouting', 'Scouting']] as Array<[string, string]>) : []),
    ['standings', 'Standings'],
    ['calendar', 'Calendar'],
    ['scores', 'Scores'],
    ['stats', 'Stats'],
    ...(L.phase !== 'regular-season' && !L.freshStart ? ([['playoffs', 'Playoffs']] as Array<[string, string]>) : []),
    ['free-agents', 'Free agents'],
    ...(L.phase !== 'offseason' || L.offseasonStage === 'training-camp' ? ([['waivers', 'Waivers']] as Array<[string, string]>) : []),
    ...(L.myTeamId ? ([['trades', 'Trades']] as Array<[string, string]>) : []),
    ['news', 'News'],
    ['teams', 'Teams'],
    ['history', 'History'],
    ['settings', 'League'],
  ];

  return (
    <LeagueCtx.Provider value={L}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-rink-700 bg-rink-950/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[2560px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:px-6">
            <Link to="/" className="font-display text-lg font-semibold tracking-wider whitespace-nowrap text-white uppercase hover:text-ice-300">
              Hockey GM
            </Link>
            <span className="text-rink-500">/</span>
            <span className="min-w-0 truncate font-semibold text-ice-100">{L.name}</span>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-3 text-xs text-ice-400">
              <HeaderActions />
              <span className="hidden sm:inline">
                {dayLabel(L.season, L.day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              <Badge tone={L.phase === 'playoffs' ? 'bad' : L.phase === 'offseason' ? 'neutral' : 'info'}>{L.stageLabel ?? PHASE_LABEL[L.phase]}</Badge>
              {myTeam && <TeamChip team={myTeam} size="sm" />}
              <NotificationBell leagueId={leagueId} />
            </div>
          </div>
          <SimProgress />
          <nav className="mx-auto flex w-full max-w-[2560px] gap-1 overflow-x-auto px-3 lg:px-5">
            {tabs.map(([to, label]) => (
              <NavLink
                key={to}
                title={to === 'trades' && L.tradeOffers.length ? `${L.tradeOffers.length} trade offer${L.tradeOffers.length > 1 ? 's' : ''} waiting for your answer` : undefined}
                to={to ? `/league/${leagueId}/${to}` : `/league/${leagueId}`}
                end={to === ''}
                className={({ isActive }) =>
                  cx(
                    'border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap transition',
                    isActive ? 'border-goal text-white' : 'border-transparent text-ice-400 hover:text-ice-100',
                  )
                }
              >
                {label}
                {to === 'trades' && L.tradeOffers.length > 0 && (
                  <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-warn px-1.5 text-[11px] leading-5 font-bold text-rink-950">{L.tradeOffers.length}</span>
                )}
              </NavLink>
            ))}
          </nav>
          <TradeOfferBar L={L} />
        </header>
        <main className="mx-auto w-full max-w-[2560px] min-w-0 px-4 py-6 lg:px-6">
          <BackButton leagueId={leagueId} />
          <Outlet />
        </main>
      </div>
    </LeagueCtx.Provider>
  );
}

/**
 * A strip under the navigation on every page while a trade offer is waiting
 * for your answer, so an offer can't go by unnoticed.
 */
function TradeOfferBar({ L }: { L: Overview }) {
  const { pathname } = useLocation();
  const offers = L.tradeOffers;
  if (!offers.length) return null;
  const onTrades = pathname.replace(/\/$/, '').endsWith('/trades');
  const first = offers[0];
  const soonest = offers.map((o) => o.daysLeft).filter((d): d is number => d !== null).sort((a, b) => a - b)[0];
  return (
    <div className="border-t border-warn/40 bg-warn/15" role="status">
      <div className="mx-auto flex w-full max-w-[2560px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm lg:px-6">
        <span className="rounded bg-warn px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-rink-950 uppercase">
          {offers.length === 1 ? 'Trade offer' : `${offers.length} trade offers`}
        </span>
        {offers.length === 1 ? (
          <span className="flex min-w-0 items-center gap-2 text-ice-100">
            <TeamChip team={first.from} size="sm" />
            <span>
              <span className="font-semibold text-white">{first.from.city}</span> {first.fromAi ? 'called' : 'sent an offer'}: you get{' '}
              <span className="font-semibold text-white">{first.youGet.join(', ') || 'nothing'}</span> for <span className="font-semibold text-white">{first.youGive.join(', ') || 'nothing'}</span>.
            </span>
          </span>
        ) : (
          <span className="min-w-0 text-ice-100">
            From <span className="font-semibold text-white">{offers.map((o) => o.from.city).join(', ')}</span>.
          </span>
        )}
        {soonest !== undefined && (
          <span className={cx('whitespace-nowrap', soonest <= 2 ? 'font-semibold text-red-200' : 'text-ice-300')}>
            {offers.length > 1 ? 'First one expires ' : 'Expires '}
            {soonest === 1 ? 'when the next day is played' : `in ${soonest} days`}.
          </span>
        )}
        {!onTrades && (
          <Link to={`/league/${L.id}/trades`} className="ml-auto rounded-md bg-warn px-3 py-1 text-xs font-bold whitespace-nowrap text-rink-950 hover:brightness-110">
            Review {offers.length === 1 ? 'offer' : 'offers'}
          </Link>
        )}
      </div>
    </div>
  );
}

/** "← Back" (history back, or league home if this was the first page opened); "← All leagues" on the league home. */
function BackButton({ leagueId }: { leagueId: string }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const home = `/league/${leagueId}`;
  const cls = 'mb-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-ice-400 hover:bg-rink-800 hover:text-white';
  if (pathname.replace(/\/$/, '') === home)
    return (
      <Link to="/" className={cls}>
        <span aria-hidden>←</span> All leagues
      </Link>
    );
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  return (
    <button
      onClick={() => (canGoBack ? navigate(-1) : navigate(home))}
      className={cls}
    >
      <span aria-hidden>←</span> {canGoBack ? 'Back' : 'League home'}
    </button>
  );
}
