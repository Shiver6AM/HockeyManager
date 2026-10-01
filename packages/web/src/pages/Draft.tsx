import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, CollapsibleCard, cx, Empty, ErrorBox, Rating, Spinner, TeamChip } from '../components/ui';
import { useTRPC } from '../trpc';
import { ClassTable, CssRankings, GRADE_TONE } from '../components/ClassTable';
import { DraftClockBar, DraftLottery, useDraftOverview, useServerNow } from '../components/DraftRoom';
import { useLeague } from './LeagueLayout';


export function DraftPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const board = useQuery({ ...trpc.offseason.draftBoard.queryOptions({ leagueId: L.id }), refetchInterval: 2500 });
  const ov = useDraftOverview(L.id);
  const now = useServerNow(ov.data?.draft.clock?.serverNow, ov.dataUpdatedAt);
  const pick = useMutation(trpc.offseason.makePick.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const saveList = useMutation(trpc.offseason.setDraftList.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const [round, setRound] = useState<number | null>(null);
  const b = board.data;
  const byId = useMemo(() => new Map(b?.available.map((p) => [p.id, p]) ?? []), [b]);
  if (board.isLoading) return <Spinner />;
  if (!b) return <Card><Empty>There's no draft right now. It happens at the start of the offseason.</Empty></Card>;

  const clock = b.picks[b.current];
  const done = b.current >= b.picks.length;
  const mine = !!clock && clock.teamId === b.myTeamId;
  const inDraftStage = L.phase === 'offseason' && ov.data?.stage === 'draft';
  const d = ov.data?.draft;
  const lotteryLive = !!d?.lotteryShow && now < d.lotteryShow.startedAt + d.lotteryShow.length;
  const canPick = mine && inDraftStage && !!d?.lotteryHeld && !lotteryLive;
  const shownRound = round ?? (clock?.round ?? 1);
  const list = b.myList;
  const setList = (ids: string[]) => saveList.mutate({ leagueId: L.id, playerIds: ids });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">{b.season} Entry Draft</h1>
        {done && <Badge tone="good">Draft complete</Badge>}
      </div>
      <ErrorBox error={pick.error ?? saveList.error} />
      {d && inDraftStage && <DraftLottery leagueId={L.id} draft={d} canAdvance={!!L.canAdvance} now={now} />}
      {d && inDraftStage && !done && !lotteryLive && (
        <DraftClockBar
          leagueId={L.id}
          draft={d}
          canAdvance={!!L.canAdvance}
          now={now}
          mine={mine}
          onClockTeam={
            clock && (
              <div className="flex items-center gap-3">
                <TeamChip team={clock.team} />
                <div className="text-sm">
                  <p className="font-semibold text-white">{mine ? "You're on the clock" : `${clock.team.city} ${clock.team.name}`}</p>
                  <p className="text-ice-400">
                    Round {clock.round} · Pick #{clock.overall}
                    {clock.originalTeamId !== clock.teamId && ` · via ${clock.originalTeamId}`}
                  </p>
                </div>
              </div>
            )
          }
        />
      )}
      {!done && inDraftStage && (
        <p className="text-xs text-ice-400">
          Trades stay open all draft long, picks included: <Link to={`/league/${L.id}/trades`} className="text-ice-200 hover:underline">make a deal</Link>{' '}
          while the clock runs. If you run out of time, you get the top player on your list (or your scouts' pick).
        </p>
      )}

      <CollapsibleCard id="draft-css" title="Central Scouting final rankings" summary="The consensus top of the class" defaultOpen>
        <CssRankings players={b.available} leagueId={L.id} edition="Final" top={16} />
      </CollapsibleCard>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-5">
          <Card
            title={`Available prospects (${b.available.length})`}
          >
            <p className="-mt-1 mb-3 text-xs text-ice-400">
              What you know depends on where <span className="text-ice-200">your</span> scouts went this season: prospects in regions you scouted show a
              grade, a projection and how confident your scouts are; the rest are just names and stat lines. Other teams saw things differently.
            </p>
            <ClassTable
              players={b.available}
              leagueId={L.id}
              storageKey="draft-board"
              action={(p) =>
                canPick ? (
                  <Button className="px-2 py-0.5 text-xs" onClick={() => pick.mutate({ leagueId: L.id, playerId: p.id })} disabled={pick.isPending}>
                    Draft
                  </Button>
                ) : (
                  b.myTeamId &&
                  !done &&
                  !list.includes(p.id) && (
                    <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => setList([...list, p.id])}>
                      + List
                    </Button>
                  )
                )
              }
            />
          </Card>
        </div>

        <div className="space-y-5">
          {b.myTeamId && !done && (
            <Card title="My draft list">
              <p className="mb-2 text-xs text-ice-400">If the league moves on while you're on the clock, you get the first available player on this list.</p>
              {list.length ? (
                <ol className="space-y-1 text-sm">
                  {list.map((id, i) => {
                    const p = byId.get(id);
                    if (!p) return null;
                    const move = (d: number) => {
                      const next = [...list];
                      const j = i + d;
                      if (j < 0 || j >= next.length) return;
                      [next[i], next[j]] = [next[j], next[i]];
                      setList(next);
                    };
                    return (
                      <li key={id} className="flex items-center gap-2">
                        <span className="w-5 text-ice-500">{i + 1}</span>
                        <Link to={`/league/${L.id}/player/${id}`} className="flex-1 truncate hover:underline">
                          {p.name} <span className="text-xs text-ice-500">{p.pos}</span>
                        </Link>
                        <span className={cx('font-display', p.grade ? GRADE_TONE[p.grade[0]] : 'text-ice-600')}>{p.grade ?? '?'}</span>
                        <button className="px-1 text-ice-400 hover:text-white" onClick={() => move(-1)} aria-label="Move up">
                          ↑
                        </button>
                        <button className="px-1 text-ice-400 hover:text-white" onClick={() => move(1)} aria-label="Move down">
                          ↓
                        </button>
                        <button className="px-1 text-ice-400 hover:text-red-300" onClick={() => setList(list.filter((x) => x !== id))} aria-label="Remove">
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <Empty>Add prospects with “+ List”.</Empty>
              )}
            </Card>
          )}
          <Card
            title="Draft order"
            action={
              <select className="slot w-auto py-0.5 text-xs" value={shownRound} onChange={(e) => setRound(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7].map((r) => (
                  <option key={r} value={r}>
                    Round {r}
                  </option>
                ))}
              </select>
            }
          >
            <ol className="max-h-[32rem] space-y-1 overflow-y-auto text-sm">
              {b.picks
                .filter((p) => p.round === shownRound)
                .map((p) => (
                  <li
                    key={p.overall}
                    className={cx(
                      'flex items-center gap-2 rounded px-1 py-0.5',
                      p.overall - 1 === b.current && 'bg-blueline/15',
                      p.teamId === b.myTeamId && 'font-semibold',
                    )}
                  >
                    <span className="tabular w-8 text-ice-500">{p.overall}</span>
                    <TeamChip team={p.team} size="sm" />
                    <span className="flex-1 truncate">
                      {p.player ? (
                        <Link to={`/league/${L.id}/player/${p.player.id}`} className="hover:underline">
                          {p.player.name} <span className="text-xs text-ice-500">{p.player.pos}</span>
                        </Link>
                      ) : (
                        <span className="text-ice-500">{p.overall - 1 === b.current ? 'On the clock' : '—'}</span>
                      )}
                    </span>
                    {!p.player && b.myTeamId && p.teamId !== b.myTeamId && !done && (
                      <Link
                        to={`/league/${L.id}/trades?with=${p.teamId}&get=${encodeURIComponent(`pick:${b.season}:${p.round}:${p.originalTeamId}`)}`}
                        className="shrink-0 rounded px-1.5 text-[11px] font-semibold text-blue-300 hover:bg-blueline/20 hover:text-white"
                        title={`Open a trade with ${p.team.city} with this pick in it`}
                      >
                        Trade for
                      </Link>
                    )}
                  </li>
                ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
