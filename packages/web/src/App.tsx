import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from './components/ui';
import { BoxScorePage } from './pages/BoxScore';
import { Dashboard } from './pages/Dashboard';
import { LeagueLayout } from './pages/LeagueLayout';
import { LeaguesPage } from './pages/Leagues';
import { LeagueSettings } from './pages/LeagueSettings';
import { LoginPage } from './pages/Login';
import { PlayoffsPage } from './pages/Playoffs';
import { ScoresPage } from './pages/Scores';
import { StandingsPage } from './pages/Standings';
import { StatsPage } from './pages/Stats';
import { TeamPage } from './pages/Team';
import { TeamsPage } from './pages/Teams';
import { useTRPC } from './trpc';

export function App() {
  const trpc = useTRPC();
  const me = useQuery(trpc.auth.me.queryOptions());
  if (me.isLoading) return <Spinner />;
  if (!me.data) return <LoginPage />;
  return (
    <Routes>
      <Route path="/" element={<LeaguesPage />} />
      <Route path="/league/:leagueId" element={<LeagueLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="standings" element={<StandingsPage />} />
        <Route path="scores" element={<ScoresPage />} />
        <Route path="game/:gameId" element={<BoxScorePage />} />
        <Route path="team/:teamId" element={<TeamPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="playoffs" element={<PlayoffsPage />} />
        <Route path="settings" element={<LeagueSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
