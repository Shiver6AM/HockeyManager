import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EMPTY_FILTERS, matchesFilters, PlayerFilterBar, SortTh, useSort, type Filters } from '../components/PlayerFilters';
import { TradeSearch } from '../components/TradeSearch';
import { Badge, Button, Card, cx, Empty, ErrorBox, PotentialBadge, Rating, Spinner, TeamChip, TeamLink } from '../components/ui';
import { money, posLabel } from '../format';
import { usePollInterval } from '../live';
import { useTRPC, type Outputs } from '../trpc';
import { dayLabel } from '../format';
import { useLeague } from './LeagueLayout';

type Asset = { kind: 'player'; id: string; retain?: number } | { kind: 'pick'; key: string };
type Assets = Outputs['trades']['assets'];
type AssetPlayer = Assets['players'][number];
type AssetPick = Assets['picks'][number];
type Trade = Outputs['trades']['list']['incoming'][number];

const keyOf = (a: Asset) => (a.kind === 'pick' ? a.key : a.id);

const NEED_LABEL: Record<string, string> = {
  C: 'Center',
  W: 'Winger',
  D: 'Defenseman',
  G: 'Goalie',
  young: 'Young players',
  prospects: 'Prospects',
  picks: 'Draft picks',
  veteran: 'Proven veterans',
  'cap-space': 'Cap relief',
};
const ROUND = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];
/** Short forms for badges inside tables. */
const NEED_SHORT: Record<string, string> = {
  C: 'C',
  W: 'W',
  D: 'D',
  G: 'G',
  young: 'Young',
  prospects: 'Prospect',
  picks: 'Pick',
  veteran: 'Vet',
  'cap-space': 'Cap',
};

// Session memory for the trade builder (per-tab; survives navigating away and back).
function loadDeal(leagueId: string, partner: string): { give: Asset[]; get: Asset[] } {
  try {
    const raw = partner ? sessionStorage.getItem(`hgm:trade:${leagueId}:${partner}`) : null;
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v.give) && Array.isArray(v.get)) return v;
    }
  } catch {
    /* storage unavailable */
  }
  return { give: [], get: [] };
}
function saveDeal(leagueId: string, partner: string, deal: { give: Asset[]; get: Asset[] }) {
  try {
    const key = `hgm:trade:${leagueId}:${partner}`;
    if (deal.give.length + deal.get.length) sessionStorage.setItem(key, JSON.stringify(deal));
    else sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}
function loadFilters(leagueId: string): Filters {
  try {
    const raw = sessionStorage.getItem(`hgm:tradeFilters:${leagueId}`);
    if (raw) return { ...EMPTY_FILTERS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return EMPTY_FILTERS;
}
function saveFilters(leagueId: string, f: Filters) {
  try {
    sessionStorage.setItem(`hgm:tradeFilters:${leagueId}`, JSON.stringify(f));
  } catch {
    /* storage unavailable */
  }
}

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
  const tab = params.get('tab') === 'block' ? 'block' : params.get('tab') === 'search' ? 'search' : 'build';
  // Selections are remembered per partner for this browser session, so looking
  // at a player and coming back doesn't lose the deal you're building.
  const [give, setGive] = useState<Asset[]>(() => loadDeal(L.id, partner).give);
  const [get, setGet] = useState<Asset[]>(() => loadDeal(L.id, partner).get);
  const pendingGet = useRef<Asset[] | null>(null);
  const loadedFor = useRef(partner);
  useEffect(() => {
    if (loadedFor.current === partner && !pendingGet.current) return; // first render already loaded
    loadedFor.current = partner;
    const saved = loadDeal(L.id, partner);
    const extra = (pendingGet.current ?? []).filter((a) => !saved.get.some((x) => keyOf(x) === keyOf(a)));
    setGive(saved.give);
    setGet([...saved.get, ...extra]);
    pendingGet.current = null;
  }, [partner, L.id]);
  useEffect(() => {
    if (partner && loadedFor.current === partner) saveDeal(L.id, partner, { give, get });
  }, [give, get, partner, L.id]);
  // Linked from elsewhere ("trade for this pick / player"): ?get=pick:<key> or ?get=player:<id> lands in the deal.
  useEffect(() => {
    const want = params.get('get');
    if (!want || !partner) return;
    const [kind, ...rest] = want.split(':');
    const a: Asset | null = kind === 'pick' ? { kind: 'pick', key: rest.join(':') } : kind === 'player' ? { kind: 'player', id: rest.join(':') } : null;
    if (a) setGet((xs) => (xs.some((x) => keyOf(x) === keyOf(a)) ? xs : [...xs, a]));
    const next = new URLSearchParams(params);
    next.delete('get');
    setParams(next, { replace: true });
  }, [params, partner]); // eslint-disable-line react-hooks/exhaustive-deps

  // A remembered deal can go stale (a player traded or released since): drop what's no longer there.
  const pruneTo = (data: Assets | undefined, set: (f: (xs: Asset[]) => Asset[]) => void) => {
    if (!data) return;
    const ok = new Set([...data.players.map((p) => p.id), ...data.prospects.map((p) => p.id), ...data.picks.map((p) => p.key)]);
    set((xs) => {
      const kept = xs.filter((a) => ok.has(keyOf(a)));
      return kept.length === xs.length ? xs : kept;
    });
  };
  const status = useQuery(trpc.trades.status.queryOptions({ leagueId: L.id }));
  const teams = useQuery(trpc.leagues.teams.queryOptions({ leagueId: L.id }));
  const partners = useQuery(trpc.trades.partners.queryOptions({ leagueId: L.id }));
  const mine = useQuery({ ...trpc.trades.assets.queryOptions({ leagueId: L.id, teamId: L.myTeamId ?? '', fitsFor: partner || undefined }), enabled: !!L.myTeamId });
  const theirs = useQuery({ ...trpc.trades.assets.queryOptions({ leagueId: L.id, teamId: partner, fitsFor: L.myTeamId ?? undefined }), enabled: !!partner });
  const list = useQuery({ ...trpc.trades.list.queryOptions({ leagueId: L.id }), refetchInterval: usePollInterval(6000) });
  useEffect(() => pruneTo(mine.data, setGive), [mine.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => pruneTo(theirs.data, setGet), [theirs.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const dealInput = useDebounced({ leagueId: L.id, partner, give, get });
  const evalQ = useQuery({ ...trpc.trades.evaluate.queryOptions(dealInput), enabled: !!partner && !!L.myTeamId && give.length + get.length > 0 });
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
  const [filters, setFiltersState] = useState<Filters>(() => loadFilters(L.id));
  const setFilters = (f: Filters) => {
    setFiltersState(f);
    saveFilters(L.id, f);
  };

  if (!L.myTeamId) return <Card><Empty>Claim a team to make trades.</Empty></Card>;
  if (!status.data || !mine.data) return <Spinner />;

  const setTab = (t: 'build' | 'block' | 'search') => setParams({ ...(partner ? { with: partner } : {}), ...(t !== 'build' ? { tab: t } : {}) });
  const toggle = (side: 'give' | 'get', a: Asset) => {
    const [xs, set] = side === 'give' ? [give, setGive] : [get, setGet];
    set(xs.some((x) => keyOf(x) === keyOf(a)) ? xs.filter((x) => keyOf(x) !== keyOf(a)) : [...xs, a]);
  };
  const tradeFor = (teamId: string, a: Asset) => {
    if (teamId === partner) {
      setGet((xs) => (xs.some((x) => keyOf(x) === keyOf(a)) ? xs : [...xs, a]));
      setParams({ with: teamId });
    } else {
      pendingGet.current = [a];
      setParams({ with: teamId });
    }
  };
  // "Counter": load an offer into the builder, from my side of the table.
  const strip = (a: Trade['give'][number]): Asset => (a.kind === 'pick' ? { kind: 'pick', key: a.key } : { kind: 'player', id: a.id, ...(a.retain ? { retain: a.retain } : {}) });
  const counter = (t: Trade) => {
    const deal = { give: t.get.map(strip), get: t.give.map(strip) };
    if (t.fromTeam === partner) {
      setGive(deal.give);
      setGet(deal.get);
    } else saveDeal(L.id, t.fromTeam, deal);
    setParams({ with: t.fromTeam });
    setTimeout(() => document.getElementById('trade-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const answered = respond.data;
  const last = propose.data;
  const v = evalQ.data;
  const types = [...new Set([...mine.data.players, ...mine.data.prospects, ...(theirs.data?.players ?? []), ...(theirs.data?.prospects ?? [])].map((p) => p.archetype))].sort();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Trade center</h1>
          <p className="text-sm text-ice-400">
            {status.data.open ? 'The trade window is open.' : status.data.reason}{' '}
            {status.data.phase === 'regular-season' &&
              status.data.daysToDeadline !== null &&
              status.data.daysToDeadline >= 0 &&
              `Trade deadline: ${dayLabel(L.season, status.data.deadlineDay, { month: 'short', day: 'numeric' })} (${status.data.daysToDeadline === 0 ? 'today' : `${status.data.daysToDeadline} day${status.data.daysToDeadline === 1 ? '' : 's'} away`}). After it, trades close until the season ends.`}{' '}
            {status.data.duringDraft && 'Draft-day trading: this year’s unused picks can change hands while the draft runs.'}{' '}
            {status.data.review === 'commissioner' && 'Trades involving managers need commissioner approval.'}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-rink-900 p-1 text-sm">
          {(['build', 'search', 'block'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)} className={cx('rounded-md px-4 py-1.5 font-semibold', tab === k ? 'bg-rink-600 text-white' : 'text-ice-400 hover:text-ice-100')}>
              {k === 'build' ? 'Build a trade' : k === 'search' ? 'Search players' : 'Trade block'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-5">
        <TradeLists
          incoming={list.data?.incoming ?? []}
          outgoing={list.data?.outgoing ?? []}
          approval={list.data?.awaitingApproval ?? []}
          busy={respond.isPending}
          onCounter={counter}
          onRespond={(tradeId, accept) => respond.mutate({ leagueId: L.id, tradeId, accept })}
          onWithdraw={(tradeId) => withdraw.mutate({ leagueId: L.id, tradeId })}
          onReview={(tradeId, approve) => review.mutate({ leagueId: L.id, tradeId, approve })}
        />
        <ErrorBox error={respond.error ?? withdraw.error ?? review.error} />
        {answered && !respond.isPending && answered.status !== 'rejected' && (
          <p
            className={cx('rounded-lg border px-3 py-2 text-sm', answered.status === 'completed' ? 'border-win/40 bg-win/10 text-win' : 'border-warn/40 bg-warn/10 text-warn')}
            role="status"
          >
            {answered.status === 'completed'
              ? `Trade made with ${answered.from.city}.`
              : answered.status === 'awaiting-approval'
                ? 'Accepted. The trade now waits for the commissioner’s approval.'
                : (answered.note ?? 'That offer is no longer available.')}
          </p>
        )}

        {tab === 'search' ? (
          <TradeSearch
            leagueId={L.id}
            onTradeFor={(teamId, id) => {
              tradeFor(teamId, { kind: 'player', id });
              setTimeout(() => document.getElementById('trade-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            }}
          />
        ) : tab === 'block' ? (
          <BlockTab mine={mine.data} onTradeFor={tradeFor} />
        ) : (
          <>
            <label id="trade-builder" className="block scroll-mt-32 text-sm text-ice-300">
              Trade with{' '}
              <span className="inline-block w-80 max-w-full align-middle">
              <select className="slot" value={partner} onChange={(e) => setParams(e.target.value ? { with: e.target.value } : {})}>
              <option value="">Choose a team…</option>
              {(partners.data ?? [])
                .filter((t) => t.team.id !== L.myTeamId)
                .map((t) => (
                  <option key={t.team.id} value={t.team.id}>
                    {t.rank}. {t.team.city} {t.team.name} · {t.w}-{t.l}-{t.otl}, {t.pts} pts · {t.goal ?? '—'}
                    {t.manager ? ` (${t.manager})` : ''}
                  </option>
                ))}
            </select>
              </span>
            </label>

            {!partner && (
              <Card>
                <Empty>
                  Choose a team to trade with,{' '}
                  <button className="text-blue-300 hover:underline" onClick={() => setTab('search')}>
                    search every team's players
                  </button>
                  , or browse every team's{' '}
                  <button className="text-blue-300 hover:underline" onClick={() => setTab('block')}>
                    trade block
                  </button>
                  .
                </Empty>
              </Card>
            )}

            {partner && theirs.data && (
              <>
                <Card title="Trade preview">
                  <div className="grid gap-4 md:grid-cols-2">
                    <PreviewSide
                      title={`You give · ${mine.data.team.city}`}
                      data={mine.data}
                      assets={give}
                      onRemove={(a) => toggle('give', a)}
                      onRetain={(id, share) => setGive((xs) => xs.map((x) => (x.kind === 'player' && x.id === id ? { ...x, retain: share || undefined } : x)))}
                      retainNote="you keep"
                    />
                    <PreviewSide
                      title={`You get · ${theirs.data.team.city}`}
                      data={theirs.data}
                      assets={get}
                      onRemove={(a) => toggle('get', a)}
                      onRetain={(id, share) => setGet((xs) => xs.map((x) => (x.kind === 'player' && x.id === id ? { ...x, retain: share || undefined } : x)))}
                      retainNote="they keep"
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-rink-700 pt-4">
                    <div className="min-w-64 flex-1">
                      {give.length + get.length === 0 ? (
                        <p className="text-sm text-ice-400">Tick players, prospects or picks on either side below; they'll collect here.</p>
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
                      {v && v.retained.length > 0 && (
                        <p className="mt-1 text-xs text-ice-400">
                          Retained salary:{' '}
                          {v.retained.map((r, i) => (
                            <span key={r.playerId}>
                              {i > 0 && '; '}
                              {r.side === 'me' ? 'you keep' : `${theirs.data.team.city} keeps`} {money(r.amount)} of {r.name}'s salary for {r.seasons} season{r.seasons > 1 ? 's' : ''}
                            </span>
                          ))}
                          . Retained contracts: you {v.myRetainedCount}/{v.retentionMax.maxContracts}, them {v.theirRetainedCount}/{v.retentionMax.maxContracts}.
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

                <BlockSummary data={theirs.data} />

                <PlayerFilterBar
                  value={filters}
                  onChange={setFilters}
                  types={types}
                  extras={[
                    { key: 'block', label: 'Only players on a trade block' },
                    { key: 'fits', label: 'Only players that fit the other side’s needs' },
                  ]}
                />
                <div className="grid gap-5 xl:grid-cols-2">
                  <AssetPicker
                    title={`You give (${mine.data.team.city})`}
                    data={mine.data}
                    selected={give}
                    onToggle={(a) => toggle('give', a)}
                    filters={filters}
                    fitsLabel={`${theirs.data.team.city} want`}
                    editableBlock
                  />
                  <AssetPicker
                    title={`You get (${theirs.data.team.city})`}
                    data={theirs.data}
                    selected={get}
                    onToggle={(a) => toggle('get', a)}
                    filters={filters}
                    fitsLabel="You want"
                  />
                </div>
              </>
            )}
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
        <PartnerSidebar partner={partner} onPick={(id) => setParams({ with: id })} />
      </div>
    </div>
  );
}

/** One side of the preview: players by overall, then picks by round (then year). */
const RETAIN_OPTIONS = [0, 0.1, 0.15, 0.2, 0.25, 0.33, 0.4, 0.5];

function PreviewSide({
  title,
  data,
  assets,
  onRemove,
  onRetain,
  retainNote,
}: {
  title: string;
  data: Assets;
  assets: Asset[];
  onRemove: (a: Asset) => void;
  onRetain: (id: string, share: number) => void;
  retainNote: string;
}) {
  const retainOf = new Map(assets.flatMap((a) => (a.kind === 'player' && a.retain ? [[a.id, a.retain] as const] : [])));
  const L = useLeague();
  const byId = new Map([...data.players, ...data.prospects].map((p) => [p.id, p]));
  const byKey = new Map(data.picks.map((p) => [p.key, p]));
  const players = assets.flatMap((a) => (a.kind === 'player' && byId.get(a.id) ? [byId.get(a.id)!] : [])).sort((a, b) => b.overall - a.overall);
  const picks = assets.flatMap((a) => (a.kind === 'pick' && byKey.get(a.key) ? [byKey.get(a.key)!] : [])).sort((a, b) => a.round - b.round || a.season - b.season);
  const salary = players.reduce((s, p) => s + (p.contract?.salary ?? 0) * (1 - (retainOf.get(p.id) ?? 0)), 0);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-semibold tracking-wider text-ice-400 uppercase">
          <TeamChip team={data.team} size="sm" /> {title}
        </span>
        {players.length + picks.length > 0 && (
          <span className="text-xs text-ice-500" title={VALUE_HELP}>
            {players.length > 0 && `${money(salary)} in salary · `}value {Math.round(players.reduce((s, p) => s + p.value, 0) + picks.reduce((s, p) => s + p.value, 0))}
          </span>
        )}
      </div>
      {players.length + picks.length === 0 ? (
        <p className="rounded-md border border-dashed border-rink-600 px-3 py-4 text-center text-sm text-ice-500">Nothing yet</p>
      ) : (
        <ul className="divide-y divide-rink-700/60 rounded-md border border-rink-700">
          {players.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <Rating value={p.overall} />
              <span className="min-w-0 flex-1 truncate text-ice-50">
                <Link to={`/league/${L.id}/player/${p.id}`} className="hover:underline">
                  {p.name}
                </Link>{' '}
                <span className="text-xs text-ice-500">
                  {p.pos} · {p.age}
                  {p.prospect ? ' · prospect' : ''}
                </span>
              </span>
              <PotentialBadge potential={p.potential} />
              <span className="tabular text-right text-xs text-ice-300">
                {p.contract ? (
                  retainOf.get(p.id) ? (
                    <>
                      <span className="text-ice-500 line-through">{money(p.contract.salary)}</span> {money(p.contract.salary * (1 - retainOf.get(p.id)!))} · {p.contract.yearsLeft}y
                    </>
                  ) : (
                    `${money(p.contract.salary)} · ${p.contract.yearsLeft}y`
                  )
                ) : (
                  'unsigned'
                )}
              </span>
              {p.contract && !p.prospect && (
                <select
                  className="rounded border border-rink-600 bg-rink-900 px-1 py-0.5 text-[11px] text-ice-100 focus:border-blueline focus:outline-none"
                  value={retainOf.get(p.id) ?? 0}
                  onChange={(e) => onRetain(p.id, Number(e.target.value))}
                  title={`Salary retention: the share of his salary ${retainNote} for the rest of his contract (max 50%, 3 retained contracts per team)`}
                  aria-label={`Retain part of ${p.name}'s salary`}
                >
                  {RETAIN_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r ? `Retain ${Math.round(r * 100)}%` : 'No retention'}
                    </option>
                  ))}
                </select>
              )}
              <button className="px-1 text-ice-500 hover:text-red-300" aria-label={`Remove ${p.name}`} onClick={() => onRemove({ kind: 'player', id: p.id })}>
                ×
              </button>
            </li>
          ))}
          {picks.map((pk) => (
            <li key={pk.key} className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <span className="w-6 text-center text-xs font-semibold text-blue-300">{ROUND[pk.round]}</span>
              <span className="flex-1 text-ice-100">{pk.label}</span>
              <button className="px-1 text-ice-500 hover:text-red-300" aria-label={`Remove ${pk.label}`} onClick={() => onRemove({ kind: 'pick', key: pk.key })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NeedChips({ needs }: { needs: string[] }) {
  if (!needs.length) return <span className="text-sm text-ice-500">Nothing in particular</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {needs.map((n) => (
        <Badge key={n} tone="info">
          {NEED_LABEL[n] ?? n}
        </Badge>
      ))}
    </span>
  );
}

function BlockSummary({ data }: { data: Assets }) {
  const n = data.block.players.length + data.block.picks.length;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-rink-700 bg-rink-900 px-4 py-3 text-sm">
      <span className="flex items-center gap-2">
        <TeamChip team={data.team} size="sm" />
        <span className="text-ice-400">Looking for</span>
        <NeedChips needs={data.block.needs} />
      </span>
      <span className="text-ice-400">
        On their block: <span className="text-ice-100">{n ? `${n} asset${n > 1 ? 's' : ''}` : 'nothing listed'}</span>
      </span>
      {data.block.note && <span className="text-ice-300 italic">“{data.block.note}”</span>}
    </div>
  );
}

function FitBadges({ fits, label }: { fits: string[]; label: string }) {
  if (!fits.length) return null;
  return (
    <span className="ml-1 inline-flex items-center rounded bg-win/15 px-1.5 py-0.5 text-[10px] font-semibold text-win" title={`${label}: ${fits.map((f) => NEED_LABEL[f]).join(', ')}`}>
      ★ {fits.map((f) => NEED_SHORT[f]).join('/')}
    </span>
  );
}

function AssetPicker({
  title,
  data,
  selected,
  onToggle,
  filters,
  fitsLabel,
  editableBlock,
}: {
  title: string;
  data: Assets;
  selected: Asset[];
  onToggle: (a: Asset) => void;
  filters: Filters;
  fitsLabel: string;
  editableBlock?: boolean;
}) {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const sort = useSort('overall');
  const chosen = useMemo(() => new Set(selected.map(keyOf)), [selected]);
  const setBlock = useMutation(trpc.trades.setBlock.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.trades.assets.queryKey() }) }));
  const tests = { block: (p: AssetPlayer) => p.onBlock, fits: (p: AssetPlayer) => p.fits.length > 0 };
  const players = sort.sort(data.players.filter((p) => matchesFilters(p, filters, tests)));
  const prospects = sort.sort(data.prospects.filter((p) => matchesFilters(p, filters, tests)));
  const pickFilterOn = filters.extras.block || filters.extras.fits;
  const picks = data.picks.filter((pk) => !pickFilterOn || (filters.extras.block && pk.onBlock) || (filters.extras.fits && pk.fits.length > 0));
  const seasons = [...new Set(picks.map((p) => p.season))].sort();

  const pin = (kind: 'player' | 'pick', id: string) => {
    const b = data.block;
    const list = kind === 'player' ? b.players : b.picks;
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    setBlock.mutate({ leagueId: L.id, players: kind === 'player' ? next : b.players, picks: kind === 'pick' ? next : b.picks, needs: b.needs as never, note: b.note });
  };

  const table = (rows: AssetPlayer[]) => (
    <div className="-mx-4 max-h-96 overflow-auto">
      <table className="table">
        <thead className="sticky top-0 z-10 bg-rink-900">
          <tr>
            <th className="w-6" />
            <SortTh label="Player" k="name" sort={sort} />
            <SortTh label="Pos" k="pos" sort={sort} />
            <SortTh label="Type" k="type" sort={sort} className="hidden 2xl:table-cell" />
            <SortTh label="Age" k="age" sort={sort} className="num" />
            <SortTh label="OVR" k="overall" sort={sort} className="num" />
            <SortTh label="Pot" k="pot" sort={sort} title="Scouts' grade for his ceiling (hover for the projected role)" />
            <SortTh label="Value" k="value" sort={sort} className="num" title={VALUE_HELP} />
            <SortTh label="AAV" k="aav" sort={sort} className="num" />
            <SortTh label="Yrs" k="years" sort={sort} className="num" />
            <SortTh label="Expiry" k="status" sort={sort} />
            {editableBlock && <th className="w-10" title="Your trade block">Block</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className={cx('cursor-pointer', chosen.has(p.id) ? 'bg-blueline/15' : p.fits.length ? 'bg-win/5' : '')} onClick={() => onToggle({ kind: 'player', id: p.id })}>
              <td>
                <input type="checkbox" checked={chosen.has(p.id)} readOnly aria-label={`Select ${p.name}`} />
              </td>
              <td className="whitespace-nowrap">
                <Link to={`/league/${L.id}/player/${p.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                  {p.name}
                </Link>
                {p.onBlock && (
                  <span className="ml-1 rounded bg-warn/15 px-1 py-0.5 text-[10px] font-semibold text-warn" title="On the trade block">
                    BLK
                  </span>
                )}
                <FitBadges fits={p.fits} label={fitsLabel} />
                {p.injury && <span className="ml-1 text-[10px] text-red-300">INJ</span>}
              </td>
              <td className="text-ice-400">{posLabel(p)}</td>
              <td className="hidden text-xs whitespace-nowrap text-ice-400 2xl:table-cell">{p.archetype}</td>
              <td className="num">{p.age}</td>
              <td className="num">
                <Rating value={p.overall} />
              </td>
              <td>
                <PotentialBadge potential={p.potential} />
              </td>
              <td className="num">
                <TradeValue v={p.value} />
              </td>
              <td className="num tabular">{p.contract ? money(p.contract.salary) : '—'}</td>
              <td className="num tabular">{p.contract ? p.contract.yearsLeft : '—'}</td>
              <td className="text-xs whitespace-nowrap text-ice-400">{p.contract ? (p.contract.kind === 'ELC' ? `ELC→${p.contract.expiresAs}` : p.contract.expiresAs) : '—'}</td>
              {editableBlock && (
                <td>
                  <button
                    className={cx('rounded px-1.5 py-0.5 text-[10px] font-semibold', p.onBlock ? 'bg-warn/20 text-warn' : 'text-ice-500 hover:bg-rink-800 hover:text-ice-200')}
                    title={p.onBlock ? 'Remove from your trade block' : 'Put on your trade block'}
                    disabled={setBlock.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      pin('player', p.id);
                    }}
                  >
                    {p.onBlock ? '✓' : '+'}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Card title={title} action={<span className="text-xs text-ice-400">Cap space {money(data.capRoom)}</span>}>
      <p className="mb-1 text-xs font-semibold tracking-wider text-ice-500 uppercase">
        Roster ({players.length}
        {players.length !== data.players.length ? ` of ${data.players.length}` : ''})
      </p>
      {players.length ? table(players) : <p className="py-2 text-sm text-ice-500">No roster players match.</p>}
      {data.prospects.length > 0 && (
        <>
          <p className="mt-4 mb-1 text-xs font-semibold tracking-wider text-ice-500 uppercase">
            Prospects ({prospects.length}
            {prospects.length !== data.prospects.length ? ` of ${data.prospects.length}` : ''})
          </p>
          {prospects.length ? table(prospects) : <p className="py-2 text-sm text-ice-500">No prospects match.</p>}
        </>
      )}
      <p className="mt-4 mb-1 text-xs font-semibold tracking-wider text-ice-500 uppercase">Draft picks ({picks.length})</p>
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {seasons.map((season) => (
          <div key={season}>
            <p className="text-xs text-ice-400">{season} draft</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {picks
                .filter((pk) => pk.season === season)
                .sort((a, b) => a.round - b.round)
                .map((pk) => (
                  <PickChip
                    key={pk.key}
                    pk={pk}
                    selected={chosen.has(pk.key)}
                    onToggle={() => onToggle({ kind: 'pick', key: pk.key })}
                    own={pk.original === data.team.id}
                    onPin={editableBlock ? () => pin('pick', pk.key) : undefined}
                  />
                ))}
            </div>
          </div>
        ))}
        {!picks.length && <p className="text-sm text-ice-500">No picks match.</p>}
      </div>
      <ErrorBox error={setBlock.error} />
    </Card>
  );
}

const VALUE_HELP =
  "Trade value: what he (or the pick) is worth league-wide, from a neutral front office's view: current ability on a steep scale (stars are worth far more), upside for young players by league-consensus scouting, age, contract surplus or overpay, and injuries. Each AI team adjusts it for its own scouting, needs and plans (contenders want help now, rebuilders want youth and picks), and asks for a little extra to say yes. Several smaller pieces add up to less than one star of the same total.";

/** A trade value with a small bar (about 600 is a franchise player). */
function TradeValue({ v }: { v: number }) {
  const w = Math.max(0, Math.min(100, (v / 600) * 100));
  return (
    <span className="inline-flex items-center justify-end gap-1.5" title={VALUE_HELP}>
      <span className="hidden h-1.5 w-12 overflow-hidden rounded bg-rink-800 xl:inline-block">
        <span className={cx('block h-full', v >= 300 ? 'bg-win' : v >= 120 ? 'bg-blueline' : v > 0 ? 'bg-ice-500' : 'bg-goal')} style={{ width: `${w}%` }} />
      </span>
      <span className={cx('tabular font-semibold', v < 0 ? 'text-red-300' : 'text-ice-100')}>{v}</span>
    </span>
  );
}

function PickChip({ pk, selected, onToggle, own, onPin }: { pk: AssetPick; selected: boolean; onToggle: () => void; own: boolean; onPin?: () => void }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs',
        selected ? 'border-blueline bg-blueline/15 text-white' : pk.fits.length ? 'border-win/40 bg-win/5 text-ice-100' : 'border-rink-600 text-ice-200',
      )}
    >
      <label className="flex cursor-pointer items-center gap-1">
        <input type="checkbox" checked={selected} onChange={onToggle} />
        <span className="font-semibold">{ROUND[pk.round]}</span>
        {!own && <span className="text-ice-400">({pk.original})</span>}
      </label>
      <span className="tabular text-[10px] text-ice-400" title={VALUE_HELP}>
        {pk.value}
      </span>
      {pk.onBlock && !onPin && <span className="text-[10px] font-semibold text-warn">BLOCK</span>}
      {pk.fits.length > 0 && <span className="text-[10px] text-win">★</span>}
      {onPin && (
        <button className={cx('text-[10px] font-semibold', pk.onBlock ? 'text-warn' : 'text-ice-500 hover:text-ice-200')} title={pk.onBlock ? 'Remove from your block' : 'Put on your block'} onClick={onPin}>
          {pk.onBlock ? 'BLOCK' : '+'}
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Trade block tab
// ---------------------------------------------------------------------------

function BlockTab({ mine, onTradeFor }: { mine: Assets; onTradeFor: (teamId: string, a: Asset) => void }) {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const league = useQuery(trpc.trades.leagueBlock.queryOptions({ leagueId: L.id }));
  const setBlock = useMutation(trpc.trades.setBlock.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const [note, setNote] = useState(mine.block.note ?? '');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [onlyFits, setOnlyFits] = useState(false);
  const save = (patch: Partial<{ needs: string[]; note: string; players: string[]; picks: string[] }>) =>
    setBlock.mutate({
      leagueId: L.id,
      players: patch.players ?? mine.block.players,
      picks: patch.picks ?? mine.block.picks,
      needs: (patch.needs ?? mine.block.needs) as never,
      note: patch.note ?? mine.block.note,
    });
  const myBlockPlayers = [...mine.players, ...mine.prospects].filter((p) => p.onBlock);
  const myBlockPicks = mine.picks.filter((p) => p.onBlock);

  const rows = (league.data?.teams ?? []).flatMap((t) => t.players.map((p) => ({ ...p, team: t.team })));
  const types = [...new Set(rows.map((p) => p.archetype))].sort();
  const sort = useSort('overall');
  const shown = sort.sort(rows.filter((p) => matchesFilters(p, filters) && (!onlyFits || p.fits.length > 0)));

  return (
    <div className="space-y-5">
      <Card title="Your trade block">
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm text-ice-400">What you're looking for (other managers and the AI see this, and AI teams value what fits their own needs a little higher):</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(NEED_LABEL).map(([k, label]) => {
                const on = mine.block.needs.includes(k as never);
                return (
                  <button
                    key={k}
                    disabled={setBlock.isPending}
                    onClick={() => save({ needs: on ? mine.block.needs.filter((x) => x !== k) : [...mine.block.needs, k] })}
                    className={cx('rounded-full border px-3 py-1 text-xs font-semibold', on ? 'border-blueline bg-blueline/20 text-white' : 'border-rink-600 text-ice-400 hover:text-ice-100')}
                  >
                    {on ? '✓ ' : ''}
                    {label}
                  </button>
                );
              })}
            </div>
            <label className="mt-3 block text-xs text-ice-400">
              Note to other managers
              <span className="mt-1 flex gap-2">
                <input className="slot" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Open to moving a winger for a top-4 D" />
                <Button variant="secondary" disabled={setBlock.isPending || note === (mine.block.note ?? '')} onClick={() => save({ note })}>
                  Save
                </Button>
              </span>
            </label>
          </div>
          <div>
            <p className="mb-2 text-sm text-ice-400">
              On your block ({myBlockPlayers.length + myBlockPicks.length}). Add players and picks with the <span className="text-ice-200">+</span> in the Block column of the trade builder.
            </p>
            {myBlockPlayers.length + myBlockPicks.length ? (
              <ul className="space-y-1 text-sm">
                {myBlockPlayers.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <Rating value={p.overall} />
                    <span className="flex-1 truncate">
                      {p.name}{' '}
                      <span className="text-xs text-ice-500">
                        {p.pos} · {p.age}
                      </span>
                    </span>
                    <button className="text-xs text-ice-500 hover:text-red-300" onClick={() => save({ players: mine.block.players.filter((x) => x !== p.id) })}>
                      Remove
                    </button>
                  </li>
                ))}
                {myBlockPicks.map((pk) => (
                  <li key={pk.key} className="flex items-center gap-2">
                    <span className="w-6 text-xs font-semibold text-blue-300">{ROUND[pk.round]}</span>
                    <span className="flex-1">{pk.label}</span>
                    <button className="text-xs text-ice-500 hover:text-red-300" onClick={() => save({ picks: mine.block.picks.filter((x) => x !== pk.key) })}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ice-500">Nothing listed.</p>
            )}
          </div>
        </div>
        <ErrorBox error={setBlock.error} />
      </Card>

      <Card title="Around the league">
        {!league.data ? (
          <Spinner />
        ) : (
          <>
            <PlayerFilterBar value={filters} onChange={setFilters} types={types} className="mb-3" />
            <label className="mb-3 flex items-center gap-2 text-sm text-ice-300">
              <input type="checkbox" checked={onlyFits} onChange={(e) => setOnlyFits(e.target.checked)} /> Only players who fit what you're looking for
              {!mine.block.needs.length && <span className="text-xs text-ice-500">(set your needs above)</span>}
            </label>
            <div className="-mx-4 max-h-[32rem] overflow-auto">
              <table className="table">
                <thead className="sticky top-0 z-10 bg-rink-900">
                  <tr>
                    <SortTh label="Team" k="team" sort={sort} />
                    <SortTh label="Player" k="name" sort={sort} />
                    <SortTh label="Pos" k="pos" sort={sort} />
                    <SortTh label="Type" k="type" sort={sort} />
                    <SortTh label="Age" k="age" sort={sort} className="num" />
                    <SortTh label="OVR" k="overall" sort={sort} className="num" />
                    <SortTh label="Potential" k="pot" sort={sort} />
                    <SortTh label="AAV" k="aav" sort={sort} className="num" />
                    <SortTh label="Yrs" k="years" sort={sort} className="num" />
                    <SortTh label="Expiry" k="status" sort={sort} />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id} className={cx(p.fits.length > 0 && 'bg-win/5')}>
                      <td>
                        <TeamLink leagueId={L.id} team={p.team} />
                      </td>
                      <td className="whitespace-nowrap">
                        <Link to={`/league/${L.id}/player/${p.id}`} className="hover:underline">
                          {p.name}
                        </Link>
                        {p.prospect && <span className="ml-1 text-[10px] text-ice-500">prospect</span>}
                        <FitBadges fits={p.fits} label="You want" />
                      </td>
                      <td className="text-ice-400">{posLabel(p)}</td>
                      <td className="text-xs text-ice-400">{p.archetype}</td>
                      <td className="num">{p.age}</td>
                      <td className="num">
                        <Rating value={p.overall} />
                      </td>
                      <td>
                        <PotentialBadge potential={p.potential} showLabel />
                      </td>
                      <td className="num tabular">{p.contract ? money(p.contract.salary) : '—'}</td>
                      <td className="num tabular">{p.contract ? p.contract.yearsLeft : '—'}</td>
                      <td className="text-xs text-ice-400">{p.contract ? p.contract.expiresAs : 'unsigned'}</td>
                      <td>
                        <Button variant="ghost" className="px-2 py-0.5 text-xs whitespace-nowrap" onClick={() => onTradeFor(p.team.id, { kind: 'player', id: p.id })}>
                          Trade for →
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!shown.length && <Empty>No players on the block match.</Empty>}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {league.data.teams
                .filter((t) => t.needs.length || t.picks.length || t.note)
                .map((t) => (
                  <div key={t.team.id} className="rounded-lg border border-rink-700 p-3 text-sm">
                    <TeamLink leagueId={L.id} team={t.team} full />
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="text-xs text-ice-500">Looking for</span>
                      <NeedChips needs={t.needs} />
                    </div>
                    {t.picks.length > 0 && <p className="mt-1 text-xs text-ice-400">Shopping {t.picks.length} pick{t.picks.length > 1 ? 's' : ''}</p>}
                    {t.note && <p className="mt-1 text-xs text-ice-300 italic">“{t.note}”</p>}
                  </div>
                ))}
            </div>
          </>
        )}
      </Card>
    </div>
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

function AssetLines({ assets }: { assets: Trade['give'] }) {
  if (!assets.length) return <p className="text-ice-500">Nothing</p>;
  return (
    <ul className="mt-0.5 space-y-0.5">
      {assets.map((a) => (
        <li key={a.kind === 'pick' ? a.key : a.id} className="text-ice-100">
          {a.label}
        </li>
      ))}
    </ul>
  );
}

function TradeLists({
  incoming,
  outgoing,
  approval,
  busy,
  onCounter,
  onRespond,
  onWithdraw,
  onReview,
}: {
  busy: boolean;
  onCounter: (t: Trade) => void;
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
              <li key={t.id} className="rounded-lg border border-warn/50 bg-warn/5 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <TeamChip team={t.from} size="sm" />
                  <span className="font-semibold text-white">
                    {t.from.city} {t.from.name}
                  </span>
                  {t.fromAi && <Badge tone="neutral">Their GM called</Badge>}
                  {t.daysLeft !== null && (
                    <Badge tone={t.daysLeft <= 2 ? 'bad' : 'warn'}>{t.daysLeft === 1 ? 'Expires when the next day is played' : `Stands for ${t.daysLeft} more days`}</Badge>
                  )}
                </div>
                {t.pitch && <p className="mb-2 text-sm text-ice-200 italic">“{t.pitch}”</p>}
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div className="rounded bg-rink-900 p-2">
                    <p className="text-[11px] font-semibold tracking-wider text-win uppercase">You get</p>
                    <AssetLines assets={t.give} />
                  </div>
                  <div className="rounded bg-rink-900 p-2">
                    <p className="text-[11px] font-semibold tracking-wider text-red-300 uppercase">You give</p>
                    <AssetLines assets={t.get} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button className="px-3 py-1 text-xs" disabled={busy} onClick={() => onRespond(t.id, true)}>
                    Accept
                  </Button>
                  <Button variant="ghost" className="px-3 py-1 text-xs" disabled={busy} onClick={() => onRespond(t.id, false)}>
                    Decline
                  </Button>
                  <Button variant="ghost" className="px-3 py-1 text-xs" onClick={() => onCounter(t)} title="Open this deal in the trade builder to see the values and change it">
                    Look closer / counter
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

const STRATEGY: Record<string, { label: string; tone: string }> = {
  contend: { label: 'Buying', tone: 'text-win' },
  balanced: { label: 'Balanced', tone: 'text-ice-400' },
  rebuild: { label: 'Selling', tone: 'text-warn' },
};

/** League standings with each club's goal for the season: who's buying and who's selling. Click a team to trade with it. */
function PartnerSidebar({ partner, onPick }: { partner: string; onPick: (teamId: string) => void }) {
  const L = useLeague();
  const trpc = useTRPC();
  const q = useQuery(trpc.trades.partners.queryOptions({ leagueId: L.id }));
  return (
    <Card title="Standings & team goals" className="xl:sticky xl:top-28 xl:self-start">
      {!q.data ? (
        <Spinner />
      ) : (
        <div className="-mx-4 -mb-4 max-h-[calc(100vh-10rem)] overflow-y-auto">
          <table className="table text-xs">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Team</th>
                <th className="num">Record</th>
                <th className="num">Pts</th>
                <th>Goal</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((t) => {
                const me = t.team.id === L.myTeamId;
                return (
                  <tr
                    key={t.team.id}
                    className={cx(!me && 'cursor-pointer', t.team.id === partner && 'bg-blueline/15', me && 'bg-rink-800/60')}
                    onClick={() => !me && onPick(t.team.id)}
                    title={me ? 'Your team' : `Trade with ${t.team.city}`}
                  >
                    <td className="num text-ice-500">{t.rank}</td>
                    <td className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <TeamChip team={t.team} size="sm" />
                        <span className={cx('font-semibold', me ? 'text-white' : 'text-ice-100')}>{t.team.abbr}</span>
                        {t.manager && <span className="text-[10px] text-blue-300">{me ? 'you' : t.manager}</span>}
                      </span>
                    </td>
                    <td className="num text-ice-300">
                      {t.w}-{t.l}-{t.otl}
                    </td>
                    <td className="num font-semibold text-white">{t.pts}</td>
                    <td className="whitespace-nowrap leading-tight" title={`Owner's goal: ${t.goal ?? '—'}${t.strategy ? ` · front office: ${STRATEGY[t.strategy].label}` : ''}`}>
                      <span className="block text-ice-200">{t.goal ? t.goal.replace('Contend for the championship', 'Contend').replace('Make the playoffs', 'Playoffs').replace('Develop young talent', 'Youth').replace('Turn a profit', 'Profit') : '—'}</span>
                      {t.strategy && <span className={cx('block text-[10px] font-semibold', STRATEGY[t.strategy].tone)}>{STRATEGY[t.strategy].label}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
