import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, cx, Empty, ErrorBox, TeamChip } from '../components/ui';
import { useTRPC } from '../trpc';
import { useLeague } from './LeagueLayout';
import { useSim } from '../sim';
import { TeamTag } from '../components/TeamTag';

const STAGES = [
  { id: 'review', label: 'Season review' },
  { id: 'draft', label: 'Entry draft' },
  { id: 're-sign', label: 'Re-signing week' },
  { id: 'free-agency', label: 'Free agency' },
  { id: 'training-camp', label: 'Training camp' },
];

const STAGE_HELP: Record<string, { what: string; link?: [string, string] }> = {
  review: {
    what: 'The season is over. Final standings, stats and awards stay as they are until the league moves on. Then players age and develop, veterans retire, and the draft opens.',
    link: ['stats', 'See final stats & awards'],
  },
  draft: {
    what: 'First the lottery for the teams that missed the playoffs, then teams take turns picking from this year’s class of 18-year-olds. Every pick has a 3-minute clock (AI teams take 90 seconds to 3 minutes); if yours runs out, your draft list (or your scouts’ top choice) is used. The commissioner can skip ahead to the next manager’s pick. Trades are open throughout, including this year’s unused picks.',
    link: ['draft', 'Go to the draft room'],
  },
  're-sign': {
    what: 'A week to re-sign your own pending free agents (UFAs and RFAs) before anyone else can talk to them. Each day moves the week along; offers you make are answered by the player’s agent the next day. Anyone without a deal or a qualifying offer becomes a free agent when the week ends.',
    link: ['re-sign', 'Review expiring contracts'],
  },
  'free-agency': {
    what: 'Sign free agents at their asking price, first come first served. When the stage ends, AI teams fill their rosters and unsigned players lower their asks.',
    link: ['free-agents', 'Browse free agents'],
  },
  'training-camp': {
    what: 'Promote prospects who are ready and trim your roster to 23. If you’re still over when camp ends, your lowest-rated players are sent down or released.',
    link: ['team', 'Manage roster & prospects'],
  },
};

export function OffseasonPanel() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const os = useQuery(trpc.offseason.overview.queryOptions({ leagueId: L.id }));
  const refresh = () => qc.invalidateQueries();
  const sim = useSim();
  const ready = useMutation(trpc.sim.setReady.mutationOptions({ onSuccess: refresh }));
  if (os.isLoading) return null;
  const o = os.data;
  const stage = o?.stage ?? 'review';
  const season = o?.season ?? L.season;
  const idx = STAGES.findIndex((s) => s.id === stage);
  const help = STAGE_HELP[stage];
  const linkTo = help.link?.[0] === 'team' ? `team/${L.myTeamId}` : help.link?.[0];
  const managers = L.members.filter((m) => m.teamId);

  return (
    <Card title={`${season}-${String(season + 1).slice(2)} offseason`} action={<Badge tone="warn">Offseason</Badge>}>
      <ol className="mb-5 grid grid-cols-3 gap-1 text-center text-[11px] font-semibold tracking-wide uppercase sm:grid-cols-6">
        {[...STAGES, { id: 'season', label: `${season + 1}-${String(season + 2).slice(2)} season` }].map((s, i) => (
          <li
            key={s.id}
            className={cx(
              'rounded-md px-1 py-2',
              i < idx ? 'bg-win/10 text-win' : i === idx ? 'bg-blueline text-white' : 'bg-rink-800 text-ice-500',
            )}
          >
            {i < idx ? '✓ ' : ''}
            {s.label}
          </li>
        ))}
      </ol>

      <p className="text-sm text-ice-300">{help.what}</p>

      {o?.stage === 'draft' && !o.draft.lotteryHeld && (
        <p className="mt-3 rounded-lg border border-blueline/40 bg-blueline/10 px-3 py-2 text-sm text-ice-100">
          The draft lottery comes first.{' '}
          <Link to={`/league/${L.id}/draft`} className="font-semibold text-white hover:underline">
            Go to the draft room
          </Link>{' '}
          to see the odds{L.canAdvance ? ' and hold the draw' : ''}.
        </p>
      )}
      {o?.stage === 'draft' && o.draft.lotteryHeld && o.draft.onTheClock && (
        <div className={cx('mt-3 flex items-center gap-3 rounded-lg border p-3', o.draft.onTheClock.isMe ? 'border-goal bg-goal/10' : 'border-rink-600')}>
          <TeamChip team={o.draft.onTheClock.team} />
          <p className="text-sm">
            <span className="font-semibold text-white">
              {o.draft.onTheClock.isMe ? (
                "You're on the clock!"
              ) : (
                <>
                  <Link to={`/league/${L.id}/team/${o.draft.onTheClock.team.id}`} className="hover:underline">
                    {o.draft.onTheClock.team.city}
                  </Link>{' '}
                  is on the clock
                </>
              )}
            </span>{' '}
            <span className="text-ice-400">
              Round {o.draft.onTheClock.round}, pick #{o.draft.onTheClock.overall} of {o.draft.total}
            </span>
          </p>
        </div>
      )}
      {o?.stage === 're-sign' && L.myTeamId && o.myUndecided > 0 && (
        <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          You haven’t decided on {o.myUndecided} expiring player{o.myUndecided > 1 ? 's' : ''}. Undecided players leave in free agency.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {help.link && (L.myTeamId || stage === 'review') && (
          <Link to={`/league/${L.id}/${linkTo}`}>
            <Button>{help.link[1]}</Button>
          </Link>
        )}
        {L.myTeamId && (
          <Button variant="secondary" onClick={() => ready.mutate({ leagueId: L.id, ready: !L.myReady })} disabled={ready.isPending}>
            {L.myReady ? '✓ Ready — undo' : "I'm done with this stage"}
          </Button>
        )}
        {managers.length > 0 && (
          <span className="text-xs text-ice-400">
            Ready: {managers.filter((m) => m.ready).length}/{managers.length}
          </span>
        )}
      </div>

      {L.canAdvance && (
        <div className="mt-5 border-t border-rink-700 pt-4">
          <p className="mb-2 text-xs font-semibold tracking-wider text-ice-400 uppercase">{L.isCommissioner ? 'Commissioner' : 'Co-commissioner'}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => sim.start({ days: 1 })} disabled={sim.running || sim.starting}>
              {stage === 'review'
                ? 'Begin the offseason'
                : stage === 'draft'
                  ? o?.draft.lotteryHeld === false
                    ? 'Sim the lottery'
                    : 'Sim the whole draft'
                  : stage === 'training-camp'
                    ? 'Start the new season'
                    : stage === 're-sign' && L.resignDay !== null
                      ? L.resignDay < L.resignDays
                        ? `Next day (${L.resignDay}/${L.resignDays})`
                        : 'Open free agency'
                      : stage === 'free-agency' && L.faDay !== null
                        ? L.faDay < L.faDays
                          ? `Next day (FA ${L.faDay}/${L.faDays})`
                          : 'Close free agency'
                        : 'Next stage'}
            </Button>
            {(stage === 'review' || stage === 'draft' || stage === 're-sign') && (
              <Button variant="secondary" onClick={() => sim.start({ to: 'free-agency' })} disabled={sim.running || sim.starting}>
                Sim to free agency
              </Button>
            )}
            {stage === 'free-agency' && (
              <Button variant="secondary" onClick={() => sim.start({ to: 'training-camp' })} disabled={sim.running || sim.starting}>
                Sim to end of free agency
              </Button>
            )}
            <Button variant="ghost" onClick={() => sim.start({ to: 'next-season' })} disabled={sim.running || sim.starting}>
              Skip to next season
            </Button>
          </div>
          <p className="mt-2 text-xs text-ice-500">Moving on never waits for managers: anyone who hasn’t acted gets sensible defaults.</p>
        </div>
      )}
      <div className="mt-2">
        <ErrorBox error={sim.startError ?? ready.error} />
      </div>
    </Card>
  );
}

export function SummerNews() {
  const L = useLeague();
  const trpc = useTRPC();
  const os = useQuery(trpc.offseason.overview.queryOptions({ leagueId: L.id }));
  const o = os.data;
  if (!o || o.fresh) return null;
  const row = (x: (typeof o.risers)[number]) => (
    <li key={x.id} className="flex items-center gap-2 text-sm">
      <Link to={`/league/${L.id}/player/${x.id}`} className="flex-1 truncate hover:underline">
        {x.name}
      </Link>
      <span className="text-xs text-ice-500">
        <TeamTag id={x.teamId} /> · {x.age}
      </span>
      <span className="tabular w-16 text-right text-ice-300">
        {x.before} → <span className="text-white">{x.after}</span>
      </span>
      <span className={cx('tabular w-8 text-right font-semibold', x.delta > 0 ? 'text-win' : 'text-red-300')}>
        {x.delta > 0 ? `+${x.delta}` : x.delta}
      </span>
    </li>
  );
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card title="Summer development">
        <p className="mb-2 text-xs font-semibold tracking-wider text-win uppercase">Biggest jumps</p>
        <ul className="space-y-1">{o.risers.map(row)}</ul>
        <p className="mt-4 mb-2 text-xs font-semibold tracking-wider text-red-300 uppercase">Biggest drops</p>
        <ul className="space-y-1">{o.fallers.map(row)}</ul>
      </Card>
      <Card title="Retirements">
        {o.retired.length ? (
          <ul className="space-y-1.5 text-sm">
            {o.retired.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                {r.team ? <TeamChip team={r.team} size="sm" /> : <span className="w-5" />}
                <Link to={`/league/${L.id}/player/${r.id}`} className="flex-1 truncate hover:underline">
                  {r.name} <span className="text-ice-500">{r.pos}</span>
                </Link>
                <span className="text-xs text-ice-400">
                  {r.seasons} season{r.seasons === 1 ? '' : 's'}{r.pos !== 'G' ? ` · ${r.points} pts` : ''} · peak {r.peakOverall}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No notable retirements.</Empty>
        )}
        {o.draft.lottery.length > 0 && !(o.draft.lotteryShow && Date.now() < o.draft.lotteryShow.startedAt + o.draft.lotteryShow.length) && (
          <>
            <p className="mt-4 mb-2 text-xs font-semibold tracking-wider text-ice-400 uppercase">Draft lottery</p>
            {o.draft.lottery.map((x) => (
              <p key={x.team.id} className="flex items-center gap-2 text-sm">
                <TeamChip team={x.team} size="sm" />{' '}
                <Link to={`/league/${L.id}/team/${x.team.id}`} className="hover:underline">
                  {x.team.city}
                </Link>{' '}
                jumps from #{x.from} to <span className="font-semibold text-white">#{x.to}</span>
              </p>
            ))}
          </>
        )}
      </Card>
    </div>
  );
}
