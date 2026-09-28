import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
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

export function LeagueLayout() {
  const { leagueId = '' } = useParams();
  const trpc = useTRPC();
  const ov = useQuery({ ...trpc.leagues.overview.queryOptions({ leagueId }), refetchInterval: 5_000 });
  if (ov.isLoading) return <Spinner />;
  if (ov.error) return <div className="p-6"><ErrorBox error={ov.error} /></div>;
  const L = ov.data!;
  const myTeam = L.members.find((m) => m.teamId === L.myTeamId)?.team;

  const tabs: Array<[string, string]> = [
    ['', 'Home'],
    ...(L.myTeamId ? ([[`team/${L.myTeamId}`, 'My Team']] as Array<[string, string]>) : []),
    ...(L.phase === 'offseason'
      ? ([
          ['draft', 'Draft'],
          ['re-sign', 'Re-sign'],
        ] as Array<[string, string]>)
      : []),
    ['standings', 'Standings'],
    ['scores', 'Scores'],
    ['stats', 'Stats'],
    ...(L.phase !== 'regular-season' ? ([['playoffs', 'Playoffs']] as Array<[string, string]>) : []),
    ['free-agents', 'Free agents'],
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
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5">
            <Link to="/" className="font-display text-lg font-semibold tracking-wider whitespace-nowrap text-white uppercase hover:text-ice-300">
              Hockey GM
            </Link>
            <span className="text-rink-500">/</span>
            <span className="truncate font-semibold text-ice-100">{L.name}</span>
            <div className="ml-auto flex items-center gap-3 text-xs text-ice-400">
              <span className="hidden sm:inline">
                {dayLabel(L.season, L.day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              <Badge tone={L.phase === 'playoffs' ? 'bad' : L.phase === 'offseason' ? 'neutral' : 'info'}>{PHASE_LABEL[L.phase]}</Badge>
              {myTeam && <TeamChip team={myTeam} size="sm" />}
              <NotificationBell leagueId={leagueId} />
            </div>
          </div>
          <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3">
            {tabs.map(([to, label]) => (
              <NavLink
                key={to}
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
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-7xl min-w-0 px-4 py-6">
          <BackButton leagueId={leagueId} />
          <Outlet />
        </main>
      </div>
    </LeagueCtx.Provider>
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
