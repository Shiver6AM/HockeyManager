import { WaiversPage } from './pages/Waivers';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from './components/ui';
import { BoxScorePage } from './pages/BoxScore';
import { DraftPage } from './pages/Draft';
import { ScoutingPage } from './pages/Scouting';
import { FreeAgentsPage } from './pages/FreeAgents';
import { HistoryPage } from './pages/History';
import { NewsPage } from './pages/News';
import { PlayerPage } from './pages/Player';
import { ResignPage } from './pages/Resign';
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
import { TradesPage } from './pages/Trades';
import { SimcastPage } from './pages/Simcast';
import { CalendarPage } from './pages/Calendar';
import { LogoGalleryPage } from './pages/LogoGallery';
import { useTRPC } from './trpc';
import { FantasyDraftPage } from './pages/FantasyDraft';

export function App() {
  const trpc = useTRPC();
  const me = useQuery(trpc.auth.me.queryOptions());
  if (me.isLoading) return <Spinner />;
  if (!me.data) return <LoginPage />;
  return (
    <Routes>
      <Route path="/" element={<LeaguesPage />} />
      <Route path="/logos" element={<LogoGalleryPage />} />
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
        <Route path="draft" element={<DraftPage />} />
        <Route path="fantasy" element={<FantasyDraftPage />} />
        <Route path="scouting" element={<ScoutingPage />} />
        <Route path="re-sign" element={<ResignPage />} />
        <Route path="free-agents" element={<FreeAgentsPage />} />
        <Route path="waivers" element={<WaiversPage />} />
        <Route path="player/:playerId" element={<PlayerPage />} />
        <Route path="trades" element={<TradesPage />} />
        <Route path="simcast" element={<SimcastPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="news" element={<NewsPage />} />
        <Route path="history" element={<HistoryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
