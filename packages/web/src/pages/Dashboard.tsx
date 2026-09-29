import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { GameCard } from '../components/GameCard';
import { Badge, Button, Card, cx, Empty, ErrorBox, TeamChip, TeamLink } from '../components/ui';
import { dayLabel, timeUntil } from '../format';
import { useTRPC } from '../trpc';
import { useLeague } from './LeagueLayout';
import { useSim } from '../sim';
import { NewsItemRow } from './News';
import { OffseasonPanel, SummerNews } from './Offseason';
import { TeamTag } from '../components/TeamTag';

export function Dashboard() {
  const L = useLeague();
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {L.champion && <ChampionBanner />}
        {L.fantasy && (
          <Link
            to={`/league/${L.id}/fantasy`}
            className="block rounded-xl border border-blueline/50 bg-blueline/10 p-4 hover:bg-blueline/15"
          >
            <p className="font-display text-lg font-semibold tracking-wide text-white uppercase">Fantasy draft</p>
            <p className="text-sm text-ice-300">
              {!L.fantasy.started
                ? 'Every player is in the pool. Claim a team, then the commissioner starts the draft.'
                : L.fantasy.onClock === L.myTeamId
                  ? "You're on the clock!"
                  : `Pick ${L.fantasy.current + 1} of ${L.fantasy.total}.`}{' '}
              <span className="text-blue-300">Go to the draft →</span>
            </p>
          </Link>
        )}
        {L.freshStart && !L.fantasy && L.phase === 'offseason' && L.offseasonStage && (
          <div className="rounded-xl border border-rink-600 bg-rink-900 p-4 text-sm text-ice-300">
            <p className="font-display text-lg font-semibold tracking-wide text-white uppercase">A new league</p>
            {L.offseasonStage === 're-sign'
              ? 'The league opens the week before free agency. The draft just happened: re-sign the players you want to keep, then bid on free agents.'
              : L.offseasonStage === 'draft'
                ? 'The league opens on draft day. Claim a team; the commissioner starts the draft from the Draft page.'
                : 'The league opens in the offseason.'}
          </div>
        )}
        {L.phase === 'offseason' ? (
          <>
            <OffseasonPanel />
            <SummerNews />
          </>
        ) : (
          <>
            <TodayAndYesterday />
            <AdvancePanel />
          </>
        )}
      </div>
      <div className="space-y-5">
        <MyTeamCard />
        <LeadersMini />
        <NewsFeed />
      </div>
    </div>
  );
}

function ChampionBanner() {
  const L = useLeague();
  const c = L.champion!;
  return (
    <div
      className="flex items-center gap-4 rounded-xl border border-warn/40 p-5"
      style={{ background: `linear-gradient(120deg, ${c.colors[0]}55, #0b1220 70%)` }}
    >
      <TeamChip team={c} size="lg" />
      <div>
        <p className="text-xs font-semibold tracking-widest text-warn uppercase">
          {L.season}-{String(L.season + 1).slice(2)} Champions
        </p>
        <p className="font-display text-2xl font-semibold text-white uppercase">
          {c.city} {c.name}
        </p>
      </div>
    </div>
  );
}

function AdvancePanel() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  const sim = useSim();
  const ready = useMutation(trpc.sim.setReady.mutationOptions({ onSuccess: refresh }));
  const managers = L.members.filter((m) => m.teamId);
  const readyCount = managers.filter((m) => m.ready).length;
  const scheduled = L.advance.mode === 'scheduled' ? L.advance : null;
  const over = L.phase === 'offseason';

  return (
    <Card
      title="League calendar"
      action={<Badge tone={scheduled ? 'info' : 'neutral'}>{scheduled ? 'Scheduled advance' : 'Commissioner advance'}</Badge>}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-3xl font-semibold text-white">{dayLabel(L.season, L.day, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <p className="mt-1 text-sm text-ice-400">
            {L.phase === 'playoffs'
                ? 'Playoffs are underway.'
                : `${L.gamesToday} games today · regular season ends ${dayLabel(L.season, L.lastRegularDay, { month: 'short', day: 'numeric' })}`}
          </p>
          {scheduled && !over && (
            <p className="mt-1 text-sm text-ice-300">
              Next advance ({scheduled.daysPerTick} day
              {scheduled.daysPerTick > 1 ? 's' : ''}) in <span className="font-semibold text-white">{timeUntil(L.nextAdvanceAt) ?? '—'}</span>
              {scheduled.advanceEarlyWhenAllReady && ' · or as soon as every manager is ready'}
            </p>
          )}
        </div>
        {L.myTeamId && !over && (
          <Button
            variant={L.myReady ? 'secondary' : 'primary'}
            onClick={() => ready.mutate({ leagueId: L.id, ready: !L.myReady })}
            disabled={ready.isPending}
            className="min-w-32"
          >
            {L.myReady ? '✓ Ready — undo' : "I'm ready"}
          </Button>
        )}
      </div>

      {managers.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold tracking-wider text-ice-400 uppercase">
            Managers ready: {readyCount}/{managers.length}
          </p>
          <div className="flex flex-wrap gap-2">
            {managers.map((m) => (
              <span
                key={m.userId}
                className={cx(
                  'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs',
                  m.ready ? 'border-win/40 bg-win/10 text-win' : 'border-rink-600 text-ice-400',
                )}
              >
                {m.team && <TeamChip team={m.team} size="sm" />}
                {m.displayName}
                <span>{m.ready ? '✓' : '…'}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {L.canAdvance && !over && (
        <div className="mt-5 border-t border-rink-700 pt-4">
          <p className="mb-2 text-xs font-semibold tracking-wider text-ice-400 uppercase">
            {L.isCommissioner ? 'Commissioner' : 'Co-commissioner'}: advance the league
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => sim.start({ days: 1 })} disabled={sim.running || sim.starting}>
              Sim 1 day
            </Button>
            <Button variant="secondary" onClick={() => sim.start({ days: 7 })} disabled={sim.running || sim.starting}>
              Sim 1 week
            </Button>
            {L.daysToDeadline !== null && L.daysToDeadline > 0 && (
              <Button variant="secondary" onClick={() => sim.start({ to: 'trade-deadline' })} disabled={sim.running || sim.starting}>
                Sim to trade deadline
              </Button>
            )}
            {L.phase === 'regular-season' && (
              <Button variant="secondary" onClick={() => sim.start({ to: 'playoffs' })} disabled={sim.running || sim.starting}>
                Sim to playoffs
              </Button>
            )}
            <Button variant="ghost" onClick={() => sim.start({ to: 'end-of-season' })} disabled={sim.running || sim.starting}>
              Sim to end of season
            </Button>
          </div>
          {sim.running && <p className="mt-2 text-sm text-ice-400">Simming… follow along in the top bar, or cancel there.</p>}
          {sim.job && !sim.running && (
            <p className="mt-2 text-sm text-ice-300">
              {sim.job.status === 'cancelled' ? 'Stopped early: ' : sim.job.status === 'failed' ? `The sim failed: ${sim.job.error}. ` : ''}
              {sim.job.games} games simmed{sim.job.startedBy ? ` (started by ${sim.job.startedBy})` : ''}.
            </p>
          )}
          <div className="mt-2">
            <ErrorBox error={sim.startError ?? ready.error} />
          </div>
        </div>
      )}
      {!L.canAdvance && <ErrorBox error={ready.error} />}
    </Card>
  );
}

/** Today's games (what's next) and yesterday's results, at the top of the home page. */
function TodayAndYesterday() {
  const { leagueId = '' } = useParams();
  const L = useLeague();
  const trpc = useTRPC();
  const today = useQuery(trpc.data.day.queryOptions({ leagueId, day: L.day }));
  const yesterday = useQuery(trpc.data.day.queryOptions({ leagueId })); // latest day with results
  const upcoming = (today.data?.games ?? []).filter((g) => !g.played);
  const mine = (gs: typeof upcoming) =>
    [...gs].sort((a, b) => Number(b.home.id === L.myTeamId || b.away.id === L.myTeamId) - Number(a.home.id === L.myTeamId || a.away.id === L.myTeamId));
  const results = yesterday.data && yesterday.data.day < L.day ? yesterday.data : null;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title={`Today · ${dayLabel(L.season, L.day)}`}>
        {upcoming.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {mine(upcoming).map((g) => (
              <GameCard key={g.id} leagueId={leagueId} game={g} highlight={L.myTeamId} />
            ))}
          </div>
        ) : (
          <Empty>No games today.</Empty>
        )}
      </Card>
      <Card
        title={results ? `Results · ${dayLabel(L.season, results.day)}` : 'Results'}
        action={
          <Link to={`/league/${leagueId}/scores`} className="text-xs font-semibold text-blue-300 hover:underline">
            All scores →
          </Link>
        }
      >
        {results?.games.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {mine(results.games).map((g) => (
              <GameCard key={g.id} leagueId={leagueId} game={g} highlight={L.myTeamId} />
            ))}
          </div>
        ) : (
          <Empty>No games played yet.</Empty>
        )}
      </Card>
    </div>
  );
}

function MyTeamCard() {
  const L = useLeague();
  const trpc = useTRPC();
  const team = useQuery({ ...trpc.data.team.queryOptions({ leagueId: L.id, teamId: L.myTeamId ?? '' }), enabled: !!L.myTeamId });
  if (!L.myTeamId) {
    return (
      <Card title="Your team">
        <p className="mb-3 text-sm text-ice-300">You're not managing a team yet.</p>
        <Link to={`/league/${L.id}/teams`}>
          <Button>Pick a team</Button>
        </Link>
      </Card>
    );
  }
  const t = team.data;
  if (!t) return <Card title="Your team">…</Card>;
  const injured = t.players.filter((p) => p.injury);
  return (
    <Card title="Your team">
      <div className="flex items-center gap-3">
        <TeamChip team={t.team} size="lg" />
        <div>
          <Link to={`/league/${L.id}/team/${t.team.id}`} className="font-semibold text-white hover:underline">
            {t.team.city} {t.team.name}
          </Link>
          <p className="tabular text-sm text-ice-300">
            {t.record.w}-{t.record.l}-{t.record.otl} · {t.record.pts} pts · #{t.record.rank} overall
          </p>
        </div>
      </div>
      {t.upcoming[0] && (
        <p className="mt-3 text-sm text-ice-400">
          Next:{' '}
          {t.upcoming[0].home.id === t.team.id ? (
            <>
              vs{' '}
              <Link to={`/league/${L.id}/team/${t.upcoming[0].away.id}`} className="hover:underline">
                {t.upcoming[0].away.city}
              </Link>
            </>
          ) : (
            <>
              @{' '}
              <Link to={`/league/${L.id}/team/${t.upcoming[0].home.id}`} className="hover:underline">
                {t.upcoming[0].home.city}
              </Link>
            </>
          )}{' '}
          · {dayLabel(L.season, t.upcoming[0].day)}
        </p>
      )}
      {t.scratchWarnings.length > 0 && (
        <Link
          to={`/league/${L.id}/team/${t.team.id}`}
          className="mt-3 block rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn hover:bg-warn/15"
        >
          ⚠ {t.scratchWarnings.length} healthy player{t.scratchWarnings.length > 1 ? 's are' : ' is'} scratched ahead of weaker teammates. Review your lines →
        </Link>
      )}
      {injured.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-xs font-semibold tracking-wider text-ice-400 uppercase">Injured</p>
          {injured.map((p) => (
            <p key={p.id} className="text-sm">
              <Link to={`/league/${L.id}/player/${p.id}`} className="text-ice-100 hover:underline">
                {p.name}
              </Link>{' '}
              <span className="text-ice-400">
                · {p.injury!.type}, ~{p.injury!.daysLeft}d
              </span>
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

function LeadersMini() {
  const L = useLeague();
  const trpc = useTRPC();
  const leaders = useQuery(trpc.data.leaders.queryOptions({ leagueId: L.id, playoffs: L.phase !== 'regular-season' && L.phase !== 'offseason' }));
  const pts = leaders.data?.skaters[0];
  return (
    <Card
      title={L.phase === 'playoffs' ? 'Playoff points' : 'Points leaders'}
      action={
        <Link to={`/league/${L.id}/stats`} className="text-xs font-semibold text-blue-300 hover:underline">
          Stats →
        </Link>
      }
    >
      {pts?.rows.length ? (
        <ol className="space-y-1.5 text-sm">
          {pts.rows.slice(0, 5).map((r, i) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="w-4 text-ice-500">{i + 1}</span>
              <Link to={`/league/${L.id}/player/${r.id}`} className="flex-1 truncate hover:underline">
                {r.name}
              </Link>
              <TeamTag id={r.teamId} className="text-xs text-ice-400" />
              <span className="tabular w-8 text-right font-semibold text-white">{r.value}</span>
            </li>
          ))}
        </ol>
      ) : (
        <Empty>No games played yet.</Empty>
      )}
    </Card>
  );
}

function NewsFeed() {
  const L = useLeague();
  const trpc = useTRPC();
  const news = useQuery(trpc.life.news.queryOptions({ leagueId: L.id, limit: 10 }));
  return (
    <Card
      title="League news"
      action={
        <Link to={`/league/${L.id}/news`} className="text-xs text-blue-300 hover:underline">
          All news
        </Link>
      }
    >
      {news.data?.length ? (
        <ul className="space-y-3">
          {news.data.map((n) => (
            <NewsItemRow key={n.id} n={n} leagueId={L.id} compact />
          ))}
        </ul>
      ) : (
        <Empty>Nothing yet. Big games, trades, signings and injuries will show up here.</Empty>
      )}
    </Card>
  );
}
