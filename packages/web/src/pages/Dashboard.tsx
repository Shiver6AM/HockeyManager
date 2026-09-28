import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { GameCard } from '../components/GameCard';
import { Badge, Button, Card, cx, Empty, ErrorBox, TeamChip, TeamLink } from '../components/ui';
import { dayLabel, timeUntil } from '../format';
import { useTRPC } from '../trpc';
import { useLeague } from './LeagueLayout';

export function Dashboard() {
  const L = useLeague();
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {L.champion && <ChampionBanner />}
        <AdvancePanel />
        <LatestScores />
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
  const advance = useMutation(trpc.sim.advance.mutationOptions({ onSuccess: refresh }));
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
            {over
              ? 'The season is complete. Offseason (aging, draft, free agency) arrives in Phase 3.'
              : L.phase === 'playoffs'
                ? 'Playoffs are underway.'
                : `${L.gamesToday} games today · regular season ends ${dayLabel(L.season, L.lastRegularDay, { month: 'short', day: 'numeric' })}`}
          </p>
          {scheduled && !over && (
            <p className="mt-1 text-sm text-ice-300">
              Next advance ({scheduled.daysPerTick} day{scheduled.daysPerTick > 1 ? 's' : ''}) in{' '}
              <span className="font-semibold text-white">{timeUntil(L.nextAdvanceAt) ?? '—'}</span>
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

      {L.isCommissioner && !over && (
        <div className="mt-5 border-t border-rink-700 pt-4">
          <p className="mb-2 text-xs font-semibold tracking-wider text-ice-400 uppercase">Commissioner: advance the league</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => advance.mutate({ leagueId: L.id, target: { days: 1 } })} disabled={advance.isPending}>
              Sim 1 day
            </Button>
            <Button variant="secondary" onClick={() => advance.mutate({ leagueId: L.id, target: { days: 7 } })} disabled={advance.isPending}>
              Sim 1 week
            </Button>
            {L.phase === 'regular-season' && (
              <Button variant="secondary" onClick={() => advance.mutate({ leagueId: L.id, target: { to: 'playoffs' } })} disabled={advance.isPending}>
                Sim to playoffs
              </Button>
            )}
            <Button variant="ghost" onClick={() => advance.mutate({ leagueId: L.id, target: { to: 'end-of-season' } })} disabled={advance.isPending}>
              Sim to end of season
            </Button>
          </div>
          {advance.isPending && <p className="mt-2 text-sm text-ice-400">Simulating… long advances can take a few seconds.</p>}
          {advance.data && !advance.isPending && (
            <p className="mt-2 text-sm text-ice-300">
              Played {advance.data.games} games ({dayLabel(L.season, advance.data.fromDay, { month: 'short', day: 'numeric' })} →{' '}
              {dayLabel(L.season, advance.data.toDay, { month: 'short', day: 'numeric' })}).
              {advance.data.phaseChanges.includes('playoffs') && ' The playoffs are set!'}
              {advance.data.phaseChanges.includes('offseason') && ' The season is over!'}
            </p>
          )}
          <div className="mt-2">
            <ErrorBox error={advance.error ?? ready.error} />
          </div>
        </div>
      )}
      {!L.isCommissioner && <ErrorBox error={ready.error} />}
    </Card>
  );
}

function LatestScores() {
  const { leagueId = '' } = useParams();
  const L = useLeague();
  const trpc = useTRPC();
  const day = useQuery(trpc.data.day.queryOptions({ leagueId }));
  return (
    <Card
      title={day.data ? `Scores · ${dayLabel(L.season, day.data.day)}` : 'Scores'}
      action={
        <Link to={`/league/${leagueId}/scores`} className="text-xs font-semibold text-blue-300 hover:underline">
          All scores →
        </Link>
      }
    >
      {day.data?.games.length ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {day.data.games.map((g) => (
            <GameCard key={g.id} leagueId={leagueId} game={g} highlight={L.myTeamId} />
          ))}
        </div>
      ) : (
        <Empty>No games yet.</Empty>
      )}
    </Card>
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
            <>vs {t.upcoming[0].away.city}</>
          ) : (
            <>@ {t.upcoming[0].home.city}</>
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
              <span className="text-ice-100">{p.name}</span> <span className="text-ice-400">· {p.injury!.type}, ~{p.injury!.daysLeft}d</span>
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
              <span className="flex-1 truncate">{r.name}</span>
              <span className="text-xs text-ice-400">{r.teamId}</span>
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
  const tx = useQuery(trpc.data.transactions.queryOptions({ leagueId: L.id, limit: 12 }));
  const icon: Record<string, string> = { injury: '🩹', return: '✅', 'call-up': '⬆️', 'send-down': '⬇️' };
  return (
    <Card title="League news">
      {tx.data?.length ? (
        <ul className="space-y-2 text-sm">
          {tx.data.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden>{icon[t.type]}</span>
              <div className="min-w-0">
                <TeamLink leagueId={L.id} team={t.team} />
                <p className="text-ice-300">{t.note}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nothing yet. Injuries and roster moves will show up here.</Empty>
      )}
    </Card>
  );
}
