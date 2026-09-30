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
  const ov = useQuery({ ...trpc.leagues.overview.queryOptions({ leagueId }), refetchInterval: 4_000 });
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
        <main className="mx-auto w-full max-w-[2560px] min-w-0 px-4 py-6 lg:px-6">
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
