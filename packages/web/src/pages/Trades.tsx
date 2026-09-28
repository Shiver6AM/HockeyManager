import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, cx, Empty, ErrorBox, Rating, Spinner, TeamChip } from '../components/ui';
import { money } from '../format';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

type Asset = { kind: 'player'; id: string } | { kind: 'pick'; key: string };
type Assets = Outputs['trades']['assets'];
type Trade = Outputs['trades']['list']['incoming'][number];

const keyOf = (a: Asset) => (a.kind === 'pick' ? a.key : a.id);

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function TradesPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const partner = params.get('with') ?? '';
  const [give, setGive] = useState<Asset[]>([]);
  const [get, setGet] = useState<Asset[]>([]);
  useEffect(() => {
    setGive([]);
    setGet([]);
  }, [partner]);

  const status = useQuery(trpc.trades.status.queryOptions({ leagueId: L.id }));
  const teams = useQuery(trpc.leagues.teams.queryOptions({ leagueId: L.id }));
  const mine = useQuery({ ...trpc.trades.assets.queryOptions({ leagueId: L.id, teamId: L.myTeamId ?? '' }), enabled: !!L.myTeamId });
  const theirs = useQuery({ ...trpc.trades.assets.queryOptions({ leagueId: L.id, teamId: partner }), enabled: !!partner });
  const list = useQuery({ ...trpc.trades.list.queryOptions({ leagueId: L.id }), refetchInterval: 6000 });
  const dealInput = useDebounced({ leagueId: L.id, partner, give, get });
  const evalQ = useQuery({ ...trpc.trades.evaluate.queryOptions(dealInput), enabled: !!partner && !!L.myTeamId && (give.length + get.length > 0) });
  const isAi = theirs.data?.controller === 'ai';
  const ask = useQuery({ ...trpc.trades.askAi.queryOptions(dealInput), enabled: false });
  const done = { onSuccess: () => qc.invalidateQueries() };
  const propose = useMutation(
    trpc.trades.propose.mutationOptions({
      onSuccess: (t) => {
        qc.invalidateQueries();
        if (t.status === 'completed' || t.status === 'pending' || t.status === 'awaiting-approval') {
          setGive([]);
          setGet([]);
        }
      },
    }),
  );
  const respond = useMutation(trpc.trades.respond.mutationOptions(done));
  const withdraw = useMutation(trpc.trades.withdraw.mutationOptions(done));
  const review = useMutation(trpc.trades.review.mutationOptions(done));

  if (!L.myTeamId) return <Card><Empty>Claim a team to make trades.</Empty></Card>;
  if (!status.data || !mine.data) return <Spinner />;

  const toggle = (side: 'give' | 'get', a: Asset) => {
    const [xs, set] = side === 'give' ? [give, setGive] : [get, setGet];
    set(xs.some((x) => keyOf(x) === keyOf(a)) ? xs.filter((x) => keyOf(x) !== keyOf(a)) : [...xs, a]);
  };
  const last = propose.data;
  const v = evalQ.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Trade center</h1>
          <p className="text-sm text-ice-400">
            {status.data.open ? 'The trade window is open.' : status.data.reason}{' '}
            {status.data.phase === 'regular-season' && `Deadline: day ${status.data.deadlineDay + 1} of the season.`}{' '}
            {status.data.review === 'commissioner' && 'Trades involving managers need commissioner approval.'}
          </p>
        </div>
        <label className="text-sm text-ice-300">
          Trade with{' '}
          <select className="slot inline-block w-64" value={partner} onChange={(e) => setParams(e.target.value ? { with: e.target.value } : {})}>
            <option value="">Choose a team…</option>
            {teams.data
              ?.filter((t) => t.id !== L.myTeamId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.city} {t.name} {t.manager ? `(${t.manager})` : '(AI)'}
                </option>
              ))}
          </select>
        </label>
      </div>

      <TradeLists
        incoming={list.data?.incoming ?? []}
        outgoing={list.data?.outgoing ?? []}
        approval={list.data?.awaitingApproval ?? []}
        onRespond={(tradeId, accept) => respond.mutate({ leagueId: L.id, tradeId, accept })}
        onWithdraw={(tradeId) => withdraw.mutate({ leagueId: L.id, tradeId })}
        onReview={(tradeId, approve) => review.mutate({ leagueId: L.id, tradeId, approve })}
      />
      <ErrorBox error={respond.error ?? withdraw.error ?? review.error} />

      {partner && theirs.data && (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-64 flex-1">
                {give.length + get.length === 0 ? (
                  <p className="text-sm text-ice-400">Tick players, prospects or picks on either side to build a deal.</p>
                ) : v?.error ? (
                  <p className="text-sm text-red-300">{v.error}</p>
                ) : isAi && v?.verdict ? (
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-ice-400">
                      <span>{theirs.data.team.city}'s interest</span>
                      <span className={cx(v.verdict.accept ? 'text-win' : v.verdict.meter >= 0.85 ? 'text-warn' : 'text-ice-400')}>{v.verdict.reason}</span>
                    </div>
                    <div className="h-2 rounded-full bg-rink-700">
                      <div
                        className={cx('h-2 rounded-full transition-all', v.verdict.accept ? 'bg-win' : v.verdict.meter >= 0.85 ? 'bg-warn' : 'bg-goal')}
                        style={{ width: `${Math.round(v.verdict.meter * 100)}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-ice-300">A manager runs {theirs.data.team.city}; they'll see your proposal and can accept or decline.</p>
                )}
                {v && !v.error && (
                  <p className="mt-2 text-xs text-ice-400">
                    Cap: you {v.myCapChange >= 0 ? '+' : '−'}
                    {money(Math.abs(v.myCapChange))} · them {v.theirCapChange >= 0 ? '+' : '−'}
                    {money(Math.abs(v.theirCapChange))}
                  </p>
                )}
              </div>
              {isAi && (
                <Button variant="secondary" disabled={!status.data.open || ask.isFetching} onClick={() => ask.refetch()}>
                  What would they want?
                </Button>
              )}
              <Button
                disabled={!status.data.open || propose.isPending || !!v?.error || give.length + get.length === 0}
                onClick={() => propose.mutate({ leagueId: L.id, partner, give, get })}
              >
                {isAi ? 'Make the trade' : 'Send proposal'}
              </Button>
            </div>
            {ask.data !== undefined && ask.isFetched && (
              <p className="mt-3 text-sm text-ice-200">
                {ask.data ? (
                  <>
                    They'd do it if you add <span className="font-semibold text-white">{ask.data.map((x) => x.label).join(' + ')}</span>.{' '}
                    <Button
                      variant="ghost"
                      className="px-2 py-0.5 text-xs"
                      onClick={() => setGive([...give, ...ask.data!.map((x) => (x.kind === 'pick' ? { kind: 'pick' as const, key: x.key } : { kind: 'player' as const, id: x.id }))])}
                    >
                      Add {ask.data.length > 1 ? 'them' : 'it'}
                    </Button>
                  </>
                ) : (
                  'Nothing from your side gets this done. Try asking for less.'
                )}
              </p>
            )}
            {last && (
              <p
                className={cx(
                  'mt-3 rounded-md px-3 py-2 text-sm',
                  last.status === 'completed' ? 'bg-win/15 text-win' : last.status === 'rejected' ? 'bg-goal/10 text-red-200' : 'bg-blueline/15 text-blue-200',
                )}
              >
                {last.status === 'completed'
                  ? 'Trade completed!'
                  : last.status === 'pending'
                    ? 'Proposal sent.'
                    : last.status === 'awaiting-approval'
                      ? 'Accepted. Waiting for the commissioner to approve.'
                      : `Declined: ${last.note}`}
              </p>
            )}
            <div className="mt-2">
              <ErrorBox error={propose.error} />
            </div>
          </Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <AssetPicker title={`You give (${mine.data.team.city})`} data={mine.data} selected={give} onToggle={(a) => toggle('give', a)} />
            <AssetPicker title={`You get (${theirs.data.team.city})`} data={theirs.data} selected={get} onToggle={(a) => toggle('get', a)} />
          </div>
        </>
      )}

      <Card title="Recent trades around the league">
        {list.data?.leagueCompleted.length ? (
          <ul className="space-y-2 text-sm">
            {list.data.leagueCompleted.map((t) => (
              <TradeLine key={t.id} t={t} />
            ))}
          </ul>
        ) : (
          <Empty>No trades yet.</Empty>
        )}
      </Card>
    </div>
  );
}

function AssetPicker({ title, data, selected, onToggle }: { title: string; data: Assets; selected: Asset[]; onToggle: (a: Asset) => void }) {
  const L = useLeague();
  const chosen = useMemo(() => new Set(selected.map(keyOf)), [selected]);
  const row = (p: Assets['players'][number]) => (
    <label key={p.id} className={cx('flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-rink-800', chosen.has(p.id) && 'bg-blueline/15')}>
      <input type="checkbox" checked={chosen.has(p.id)} onChange={() => onToggle({ kind: 'player', id: p.id })} />
      <Link to={`/league/${L.id}/player/${p.id}`} className="flex-1 truncate hover:underline" onClick={(e) => e.stopPropagation()}>
        {p.name}
      </Link>
      <span className="w-6 text-xs text-ice-500">{p.pos}</span>
      <span className="w-6 text-xs text-ice-400">{p.age}</span>
      <span className="w-7 text-right">
        <Rating value={p.overall} />
      </span>
      <span className="w-24 text-right text-xs text-ice-400">{p.contract ? `${money(p.contract.salary)}×${p.contract.yearsLeft}` : 'unsigned'}</span>
    </label>
  );
  return (
    <Card title={title} action={<span className="text-xs text-ice-400">Cap space {money(data.capRoom)}</span>}>
      <p className="mb-1 text-xs font-semibold tracking-wider text-ice-500 uppercase">Roster</p>
      <div className="max-h-80 overflow-y-auto">{data.players.map(row)}</div>
      {data.prospects.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-xs font-semibold tracking-wider text-ice-500 uppercase">Prospects</p>
          <div className="max-h-48 overflow-y-auto">{data.prospects.map(row)}</div>
        </>
      )}
      <p className="mt-3 mb-1 text-xs font-semibold tracking-wider text-ice-500 uppercase">Draft picks</p>
      <div className="grid max-h-48 grid-cols-2 gap-x-2 overflow-y-auto">
        {data.picks.map((pk) => (
          <label key={pk.key} className={cx('flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-rink-800', chosen.has(pk.key) && 'bg-blueline/15')}>
            <input type="checkbox" checked={chosen.has(pk.key)} onChange={() => onToggle({ kind: 'pick', key: pk.key })} />
            {pk.label}
          </label>
        ))}
      </div>
    </Card>
  );
}

function TradeLine({ t }: { t: Trade }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <TeamChip team={t.from} size="sm" />
      <span className="text-ice-300">gets</span>
      <span className="text-ice-100">{t.get.map((a) => a.label).join(', ') || 'nothing'}</span>
      <span className="text-ice-500">·</span>
      <TeamChip team={t.to} size="sm" />
      <span className="text-ice-300">gets</span>
      <span className="text-ice-100">{t.give.map((a) => a.label).join(', ') || 'nothing'}</span>
    </li>
  );
}

function TradeLists({
  incoming,
  outgoing,
  approval,
  onRespond,
  onWithdraw,
  onReview,
}: {
  incoming: Trade[];
  outgoing: Trade[];
  approval: Trade[];
  onRespond: (id: string, accept: boolean) => void;
  onWithdraw: (id: string) => void;
  onReview: (id: string, approve: boolean) => void;
}) {
  if (!incoming.length && !outgoing.length && !approval.length) return null;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {incoming.length > 0 && (
        <Card title={`Offers for you (${incoming.length})`}>
          <ul className="space-y-3">
            {incoming.map((t) => (
              <li key={t.id} className="rounded-lg border border-blueline/40 bg-blueline/5 p-3">
                <TradeLine t={t} />
                <div className="mt-2 flex gap-2">
                  <Button className="px-2 py-0.5 text-xs" onClick={() => onRespond(t.id, true)}>
                    Accept
                  </Button>
                  <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => onRespond(t.id, false)}>
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {outgoing.length > 0 && (
        <Card title="Your open proposals">
          <ul className="space-y-3">
            {outgoing.map((t) => (
              <li key={t.id} className="rounded-lg border border-rink-600 p-3">
                <TradeLine t={t} />
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone={t.status === 'awaiting-approval' ? 'warn' : 'info'}>{t.status === 'awaiting-approval' ? 'Awaiting approval' : 'Pending'}</Badge>
                  <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => onWithdraw(t.id)}>
                    Withdraw
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {approval.length > 0 && (
        <Card title="Commissioner review">
          <ul className="space-y-3">
            {approval.map((t) => (
              <li key={t.id} className="rounded-lg border border-warn/40 p-3">
                <TradeLine t={t} />
                <div className="mt-2 flex gap-2">
                  <Button className="px-2 py-0.5 text-xs" onClick={() => onReview(t.id, true)}>
                    Approve
                  </Button>
                  <Button variant="danger" className="px-2 py-0.5 text-xs" onClick={() => onReview(t.id, false)}>
                    Veto
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
