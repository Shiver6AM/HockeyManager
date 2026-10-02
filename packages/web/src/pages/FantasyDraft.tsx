/**
 * The fantasy draft for a new league: every signed player in one pool, 23
 * rounds, snake order. Each pick keeps the player's contract, so the cap
 * matters, and every roster has to end up able to dress 12 F, 6 D and 2 G.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlayerFilterBar, usePlayerFilters } from '../components/PlayerFilters';
import { Badge, Button, Card, cx, Empty, ErrorBox, PotentialBadge, Rating, Spinner, TeamChip } from '../components/ui';
import { ht, money } from '../format';
import { useSort } from '../sort';
import { usePollInterval } from '../live';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

type Board = NonNullable<Outputs['offseason']['fantasyBoard']>;
type Avail = Board['available'][number];

const THEN: Record<string, string> = {
  're-sign': 'the re-signing week (then free agency)',
  draft: 'the entry draft',
  season: 'training camp, then opening night',
};

export function FantasyDraftPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery({ ...trpc.offseason.fantasyBoard.queryOptions({ leagueId: L.id }), refetchInterval: usePollInterval(3000, false) });
  const done = { onSuccess: () => qc.invalidateQueries() };
  const pick = useMutation(trpc.offseason.fantasyPick.mutationOptions(done));
  const auto = useMutation(trpc.offseason.setFantasyAuto.mutationOptions(done));
  const proceed = useMutation(trpc.offseason.proceed.mutationOptions(done));
  const saveList = useMutation(trpc.offseason.setFantasyList.mutationOptions(done));
  if (q.isLoading) return <Spinner />;
  const b = q.data;
  if (!b) return <Card><Empty>This league didn't start with a fantasy draft.</Empty></Card>;
  const clock = b.onTheClock;
  const mine = !!clock?.isMe;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Fantasy draft</h1>
          <p className="text-sm text-ice-400">
            {b.rounds} rounds, snake order. Players keep their contracts, so watch the cap. Every roster needs at least 12 forwards, 6 defensemen and 2
            goalies. Afterwards farm teams are stocked, the rest become free agents, and the league moves on to {THEN[b.then]}.
          </p>
        </div>
        {b.done ? (
          <Badge tone="good">Draft complete</Badge>
        ) : (
          clock &&
          b.started && (
            <div className={cx('flex items-center gap-3 rounded-lg border px-3 py-2', mine ? 'border-goal bg-goal/10' : 'border-rink-600 bg-rink-900')}>
              <TeamChip team={clock.team} />
              <div className="text-sm">
                <p className="font-semibold text-white">{mine ? "You're on the clock" : `${clock.team.city} ${clock.team.name}`}</p>
                <p className="text-ice-400">
                  Round {clock.round} · Pick #{clock.overall} of {b.total}
                </p>
              </div>
            </div>
          )
        )}
      </div>
      <ErrorBox error={pick.error ?? auto.error ?? proceed.error ?? saveList.error} />

      {!b.started && (
        <Card>
          <p className="text-sm text-ice-200">
            The draft hasn't started. Managers: claim your team on the{' '}
            <Link to={`/league/${L.id}/teams`} className="text-blue-300 hover:underline">
              Teams
            </Link>{' '}
            page first. Once it starts, picks run automatically for AI teams and stop whenever a manager is on the clock.
          </p>
          {L.canAdvance && (
            <Button className="mt-3" disabled={proceed.isPending} onClick={() => proceed.mutate({ leagueId: L.id })}>
              {proceed.isPending ? 'Starting…' : 'Start the fantasy draft'}
            </Button>
          )}
        </Card>
      )}

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-5">
          <Available
            b={b}
            canPick={mine && b.started && !pick.isPending}
            onPick={(id) => pick.mutate({ leagueId: L.id, playerId: id })}
            onList={(id) => saveList.mutate({ leagueId: L.id, playerIds: [...b.myList, id] })}
          />
        </div>
        <div className="space-y-5">
          {b.me && (
            <Card title="Your roster">
              <div className="mb-3 grid grid-cols-4 gap-2 text-center text-xs">
                {(
                  [
                    ['F', 12],
                    ['D', 6],
                    ['G', 2],
                  ] as const
                ).map(([g, need]) => (
                  <div key={g} className="rounded-md bg-rink-850 px-2 py-1.5">
                    <p className={cx('tabular text-lg font-semibold', b.me!.counts[g] >= need ? 'text-win' : 'text-white')}>
                      {b.me!.counts[g]}
                      <span className="text-xs text-ice-500">/{need}</span>
                    </p>
                    <p className="text-ice-500">{g === 'F' ? 'Forwards' : g === 'D' ? 'Defense' : 'Goalies'}</p>
                  </div>
                ))}
                <div className="rounded-md bg-rink-850 px-2 py-1.5">
                  <p className="tabular text-lg font-semibold text-white">{b.me.picksLeft}</p>
                  <p className="text-ice-500">Picks left</p>
                </div>
              </div>
              <p className="mb-3 text-sm text-ice-300">
                Cap space <span className={cx('font-semibold', b.me.capRoom < 0 ? 'text-red-300' : 'text-win')}>{money(b.me.capRoom)}</span> · payroll{' '}
                {money(b.me.payroll)}
              </p>
              <label className="mb-3 flex items-start gap-2 text-sm text-ice-300">
                <input type="checkbox" className="mt-1" checked={b.auto} disabled={auto.isPending} onChange={(e) => auto.mutate({ leagueId: L.id, enabled: e.target.checked })} />
                <span>
                  Let the AI pick for me <span className="block text-xs text-ice-500">It takes your wish list first, then the best fit.</span>
                </span>
              </label>
              {b.me.roster.length ? (
                <ul className="space-y-1 text-sm">
                  {b.me.roster.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <span className="w-6 text-xs text-ice-500">{p.pos}</span>
                      <Link to={`/league/${L.id}/player/${p.id}`} className="flex-1 truncate text-ice-100 hover:underline">
                        {p.name}
                      </Link>
                      <Rating value={p.overall} />
                      <span className="tabular w-14 text-right text-xs text-ice-400">{p.contract ? money(p.contract.salary) : '—'}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No picks yet.</Empty>
              )}
            </Card>
          )}
          {b.me && (
            <Card title="Your wish list">
              {b.myList.length ? (
                <ol className="space-y-1 text-sm">
                  {b.myList.map((id, i) => {
                    const p = b.available.find((x) => x.id === id);
                    if (!p) return null;
                    return (
                      <li key={id} className="flex items-center gap-2">
                        <span className="w-5 text-ice-500">{i + 1}</span>
                        <span className="flex-1 truncate">
                          {p.name} <span className="text-xs text-ice-500">{p.pos}</span>
                        </span>
                        <Rating value={p.overall} />
                        <button className="px-1 text-ice-400 hover:text-red-300" onClick={() => saveList.mutate({ leagueId: L.id, playerIds: b.myList.filter((x) => x !== id) })}>
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <Empty>Add players with “+ List”. When you're picked for, your list comes first.</Empty>
              )}
            </Card>
          )}
          <Card title="Latest picks">
            {b.recent.length ? (
              <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto text-sm">
                {b.recent.map((p) => (
                  <li key={p.overall} className="flex items-center gap-2">
                    <span className="tabular w-8 text-xs text-ice-500">#{p.overall}</span>
                    <TeamChip team={p.team} size="sm" />
                    <Link to={`/league/${L.id}/player/${p.playerId}`} className="flex-1 truncate text-ice-100 hover:underline">
                      {p.name}
                    </Link>
                    <span className="text-xs text-ice-500">{p.pos}</span>
                    {p.ovr !== null && <Rating value={p.ovr} />}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No picks yet.</Empty>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Available({ b, canPick, onPick, onList }: { b: Board; canPick: boolean; onPick: (id: string) => void; onList: (id: string) => void }) {
  const L = useLeague();
  const { filters, setFilters, types, filtered } = usePlayerFilters(b.available);
  const [n, setN] = useState(100);
  const listed = useMemo(() => new Set(b.myList), [b.myList]);
  const { sorted, Th } = useSort(
    filtered,
    {
      name: (p: Avail) => p.lastName,
      pos: (p) => p.pos,
      age: (p) => p.age,
      ht: (p) => p.height,
      ovr: (p) => p.overall,
      pot: (p) => p.potentialValue,
      type: (p) => p.archetype,
      aav: (p) => p.contract?.salary ?? 0,
      yrs: (p) => p.contract?.yearsLeft ?? 0,
      value: (p) => p.value,
    },
    { key: 'value' },
    'fantasy-available',
  );
  return (
    <Card title={`Available (${filtered.length})`}>
      <PlayerFilterBar value={filters} onChange={setFilters} types={types} className="mb-3" />
      <div className="-mx-4 -mb-4 max-h-[44rem] overflow-auto">
        <table className="table">
          <thead className="sticky top-0 z-10 bg-rink-900">
            <tr>
              <th className="w-0" />
              <Th k="name">Player</Th>
              <Th k="pos">Pos</Th>
              <Th k="age" className="num">Age</Th>
              <Th k="ht" className="num">Ht</Th>
              <Th k="ovr" className="num">OVR</Th>
              <Th k="pot">Pot</Th>
              <Th k="type">Type</Th>
              <Th k="aav" className="num">AAV</Th>
              <Th k="yrs" className="num">Yrs</Th>
              <Th k="value" className="num" title="How the AI rates him for your team: ability, upside for young players, age and salary">
                Value
              </Th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, n).map((p) => (
              <tr key={p.id}>
                <td className="w-0 whitespace-nowrap">
                  {canPick && (
                    <Button className="px-2 py-0.5 text-xs" disabled={!!p.problem} title={p.problem ?? undefined} onClick={() => onPick(p.id)}>
                      Draft
                    </Button>
                  )}
                  {b.me && !canPick && !listed.has(p.id) && (
                    <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => onList(p.id)}>
                      + List
                    </Button>
                  )}
                </td>
                <td className="whitespace-nowrap">
                  <Link to={`/league/${L.id}/player/${p.id}`} className="text-ice-50 hover:underline">
                    {p.name}
                  </Link>
                  {p.injury && <span className="ml-1.5 text-[10px] text-red-300">INJ</span>}
                </td>
                <td className="text-ice-400">{p.pos}</td>
                <td className="num">{p.age}</td>
                <td className="num whitespace-nowrap">{ht(p.height)}</td>
                <td className="num">
                  <Rating value={p.overall} />
                </td>
                <td>
                  <PotentialBadge potential={p} />
                </td>
                <td className="text-xs whitespace-nowrap text-ice-400">{p.archetype}</td>
                <td className="num">{p.contract ? money(p.contract.salary) : '—'}</td>
                <td className="num">{p.contract?.yearsLeft ?? '—'}</td>
                <td className="num text-ice-300">{p.value.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > n && (
          <button className="w-full py-2 text-sm text-blue-300 hover:underline" onClick={() => setN(n + 150)}>
            Show more ({sorted.length - n} left)
          </button>
        )}
      </div>
    </Card>
  );
}
