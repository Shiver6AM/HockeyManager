import { TraitChips } from '../components/Traits';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { InterestPill, OfferForm, Priorities } from '../components/OfferForm';
import { OfferSheetTargets } from '../components/RfaPanels';
import { Badge, Button, Card, CollapsibleCard, cx, Empty, ErrorBox, PotentialBadge, Rating, Spinner, TeamChip } from '../components/ui';
import { ht, money, svPct, posLabel } from '../format';
import { useSort } from '../sort';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';
import { Stat } from './Resign';

export function FreeAgentsPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery(trpc.offseason.freeAgents.queryOptions({ leagueId: L.id }));
  const done = { onSuccess: () => qc.invalidateQueries() };
  const withdraw = useMutation(trpc.offseason.withdrawBid.mutationOptions(done));
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading || !q.data) return <Spinner />;
  const d = q.data;
  const myBidTotal = d.myBids.reduce((s, b) => s + b.offer.salary, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Free agents</h1>
        <p className="text-sm text-ice-400">
          {d.bidding
            ? `Day ${d.faDay} of ${d.faDays}. Make sealed offers on as many players as you like. A player listens for ${d.listenDays[0]}-${d.listenDays[1]} days from his first offer, then signs the best one he has (money, term, contender, role), so every manager has time to get an offer in. Offers stand until he decides; you can change or withdraw yours until then. If nothing is good enough, he turns them all down and comes back a little cheaper. On the last day, everyone with an offer decides.`
            : d.phase === 'offseason'
              ? d.canSign
                ? 'Bidding is over. Negotiate with leftover free agents directly: they sign on the spot when they accept.'
                : 'Free agency opens after the re-signing stage.'
              : 'Negotiate with in-season free agents directly: slim pickings mid-year, so they come cheaper.'}
        </p>
      </div>
      {L.myTeamId && d.capRoom !== null && (
        <Card>
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="Cap space" value={money(d.capRoom)} tone={d.capRoom < 0 ? 'bad' : 'good'} />
            <Stat label="Payroll" value={money(d.payroll!)} />
            <Stat label="Contracts" value={`${d.rosterCount} / ${d.rosterMax}`} tone={d.rosterCount! >= d.rosterMax ? 'bad' : undefined} />
            {!d.bidding && d.active !== null && <Stat label="NHL roster (healthy)" value={`${d.active} / ${d.activeMax}`} />}
            {d.bidding && <Stat label="Your offers" value={`${d.myBids.length} · ${money(myBidTotal)}`} />}
          </div>
          {d.bidding && myBidTotal > d.capRoom && (
            <p className="mt-3 text-sm text-warn">
              Your bids add up to more than your cap space. That's allowed, but once you win some, later offers you can no longer afford are dropped.
            </p>
          )}
        </Card>
      )}
      <ErrorBox error={withdraw.error} />

      {d.bidding && d.myBids.length > 0 && (
        <Card title="Your offers">
          <ul className="space-y-1 text-sm">
            {d.myBids.map((b) => (
              <li key={b.playerId} className="flex items-center gap-3">
                <Link to={`/league/${L.id}/player/${b.playerId}`} className="flex-1 text-ice-100 hover:underline">
                  {b.name}
                </Link>
                <span className="tabular text-white">
                  {money(b.offer.salary)} × {b.offer.years}y
                </span>
                {b.decidesIn !== null && (
                  <span className="w-28 text-right text-xs text-ice-400">{b.decidesIn === 0 ? 'Decides today' : `Decides in ${b.decidesIn} day${b.decidesIn === 1 ? '' : 's'}`}</span>
                )}
                <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => withdraw.mutate({ leagueId: L.id, playerId: b.playerId })}>
                  Withdraw
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <OfferSheetTargets />
      {d.pending.length > 0 && <PendingFreeAgents d={d} />}

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0">
          <FreeAgentTable d={d} open={open} setOpen={setOpen} />
        </div>

        <Card title="Signings so far">
          {d.results.length === 0 ? (
            <Empty>{d.bidding ? 'Signings appear as players make up their minds.' : 'No free-agency signings yet.'}</Empty>
          ) : (
            <ul className="max-h-[48rem] space-y-2 overflow-y-auto text-sm">
              {d.results.map((r) => (
                <li key={`${r.round}-${r.playerId}`} className={cx('flex items-center gap-2', r.mine && 'font-semibold')}>
                  <TeamChip team={r.team} size="sm" />
                  <Link to={`/league/${L.id}/player/${r.playerId}`} className="flex-1 truncate text-ice-100 hover:underline">
                    {r.name}
                  </Link>
                  <span className="tabular text-xs text-ice-300">
                    {money(r.offer.salary)} × {r.offer.years}y
                  </span>
                  <Badge tone={r.bidders > 1 ? 'warn' : 'neutral'}>
                    Day {r.round} · {r.bidders} offer{r.bidders === 1 ? '' : 's'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {d.holdouts.length > 0 && (
            <div className="mt-4 border-t border-rink-700 pt-3">
              <p className="mb-2 text-xs font-semibold tracking-wider text-ice-500 uppercase">Turned down every offer</p>
              <ul className="space-y-1.5 text-sm">
                {d.holdouts.map((h) => (
                  <li key={`${h.day}-${h.playerId}`} className={cx('flex items-center gap-2', h.mine && 'font-semibold')}>
                    <Link to={`/league/${L.id}/player/${h.playerId}`} className="flex-1 truncate text-ice-200 hover:underline">
                      {h.name}
                    </Link>
                    {h.signed && <span className="text-[10px] text-ice-500 uppercase">since signed</span>}
                    <Badge>
                      Day {h.day} · {h.bidders} offer{h.bidders === 1 ? '' : 's'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Where a free agent stands: no offers yet, or listening and deciding in a few days. */
function OfferStatus({ p }: { p: { decidesIn: number | null; offers: number; holdouts: number } }) {
  if (p.decidesIn === null)
    return <span className="text-ice-500">{p.holdouts ? 'Back on the market' : 'No offers yet'}</span>;
  return (
    <span className={cx('rounded px-1.5 py-0.5 font-semibold', p.decidesIn === 0 ? 'bg-goal/20 text-red-200' : p.decidesIn === 1 ? 'bg-warn/20 text-warn' : 'bg-blueline/20 text-blue-200')}>
      {p.offers} offer{p.offers === 1 ? '' : 's'} · {p.decidesIn === 0 ? 'decides today' : `decides in ${p.decidesIn}d`}
    </span>
  );
}

type FAData = Outputs['offseason']['freeAgents'];
type FA = FAData['players'][number];

const POS: Record<string, (p: string) => boolean> = {
  All: () => true,
  F: (p) => p === 'C' || p === 'LW' || p === 'RW',
  C: (p) => p === 'C',
  W: (p) => p === 'LW' || p === 'RW',
  D: (p) => p === 'D',
  G: (p) => p === 'G',
};
const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'];
const EMPTY = { pos: 'All', type: '', ageMin: '', ageMax: '', ovrMin: '', potMin: '', termMin: '', termMax: '', aavMax: '', ptsMin: '', gpMin: '', health: 'any', interested: false };
type FAFilters = typeof EMPTY;

const ask = (p: FA) => p.deal?.ask ?? p.ask;
const pts = (p: FA) => (p.skaterStats ? p.skaterStats.g + p.skaterStats.a : null);
const gp = (p: FA) => p.skaterStats?.gp ?? p.goalieStats?.gp ?? 0;

function F({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold tracking-wider text-ice-500 uppercase">
      {label}
      <span className="mt-0.5 flex items-center gap-1 normal-case">{children}</span>
    </label>
  );
}
const num = (v: string) => v.replace(/[^\d.]/g, '');

function FreeAgentTable({ d, open, setOpen }: { d: FAData; open: string | null; setOpen: (id: string | null) => void }) {
  const L = useLeague();
  const [f, setF] = useState<FAFilters>(EMPTY);
  const set = (patch: Partial<FAFilters>) => setF({ ...f, ...patch });
  const types = useMemo(() => [...new Set(d.players.map((p) => p.archetype))].sort(), [d.players]);
  const gradeRank = (g: string) => GRADES.indexOf(g);
  const list = d.players.filter((p) => {
    if (!POS[f.pos](p.pos)) return false;
    if (f.type && p.archetype !== f.type) return false;
    if (f.ageMin && p.age < Number(f.ageMin)) return false;
    if (f.ageMax && p.age > Number(f.ageMax)) return false;
    if (f.ovrMin && p.overall < Number(f.ovrMin)) return false;
    if (f.potMin && gradeRank(p.grade) > gradeRank(f.potMin)) return false;
    if (f.termMin && ask(p).years < Number(f.termMin)) return false;
    if (f.termMax && ask(p).years > Number(f.termMax)) return false;
    if (f.aavMax && ask(p).salary > Number(f.aavMax) * 1e6) return false;
    if (f.ptsMin && (pts(p) ?? 0) < Number(f.ptsMin)) return false;
    if (f.gpMin && gp(p) < Number(f.gpMin)) return false;
    if (f.health === 'healthy' && p.injury) return false;
    if (f.health === 'injured' && !p.injury) return false;
    if (f.interested && (!p.deal || p.deal.interest.score < 50)) return false;
    return true;
  });
  const { sorted, Th } = useSort(
    list,
    {
      name: (p) => p.lastName,
      pos: (p) => p.pos,
      age: (p) => p.age,
      ht: (p) => p.height,
      wt: (p) => p.weight,
      ovr: (p) => p.overall,
      pot: (p) => p.potentialValue,
      type: (p) => p.archetype,
      nat: (p) => p.nationality,
      aav: (p) => ask(p).salary,
      term: (p) => ask(p).years,
      interest: (p) => p.deal?.interest.score ?? null,
      gp: (p) => gp(p),
      g: (p) => (p.pos === 'G' ? (p.goalieStats?.w ?? null) : (p.skaterStats?.g ?? null)),
      a: (p) => (p.pos === 'G' ? (p.goalieStats?.sa ? 1 - p.goalieStats.ga / p.goalieStats.sa : null) : (p.skaterStats?.a ?? null)),
      p: (p) => (p.pos === 'G' ? null : pts(p)),
      pm: (p) => p.skaterStats?.pm ?? null,
      career: (p) => p.careerGp,
      status: (p) => (p.decidesIn === null ? 99 : p.decidesIn),
    },
    { key: 'ovr' },
    'free-agents',
  );
  const n = Object.entries(f).filter(([k, v]) => v !== (EMPTY as Record<string, unknown>)[k]).length;
  const cols = 19 + (L.myTeamId ? 1 : 0) + (d.bidding ? 1 : 0);
  return (
    <Card title={`Available (${list.length}${list.length !== d.players.length ? ` of ${d.players.length}` : ''})`}>
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-rink-700 bg-rink-850 p-3 sm:grid-cols-4 lg:grid-cols-6">
        <F label="Position">
          <select className="slot" value={f.pos} onChange={(e) => set({ pos: e.target.value })}>
            {Object.keys(POS).map((k) => (
              <option key={k} value={k}>
                {k === 'F' ? 'Forwards' : k === 'W' ? 'Wingers' : k}
              </option>
            ))}
          </select>
        </F>
        <F label="Archetype">
          <select className="slot" value={f.type} onChange={(e) => set({ type: e.target.value })}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </F>
        <F label="Age">
          <input className="slot text-center" inputMode="numeric" placeholder="min" value={f.ageMin} onChange={(e) => set({ ageMin: num(e.target.value) })} />
          <span className="text-ice-500">–</span>
          <input className="slot text-center" inputMode="numeric" placeholder="max" value={f.ageMax} onChange={(e) => set({ ageMax: num(e.target.value) })} />
        </F>
        <F label="Min overall">
          <input className="slot text-center" inputMode="numeric" placeholder="any" value={f.ovrMin} onChange={(e) => set({ ovrMin: num(e.target.value) })} />
        </F>
        <F label="Min potential">
          <select className="slot" value={f.potMin} onChange={(e) => set({ potMin: e.target.value })}>
            <option value="">Any</option>
            {GRADES.slice(0, -1).map((g) => (
              <option key={g} value={g}>
                {g} or better
              </option>
            ))}
          </select>
        </F>
        <F label="Health">
          <select className="slot" value={f.health} onChange={(e) => set({ health: e.target.value })}>
            <option value="any">Any</option>
            <option value="healthy">Healthy</option>
            <option value="injured">Injured</option>
          </select>
        </F>
        <F label="Term wanted (yrs)">
          <input className="slot text-center" inputMode="numeric" placeholder="min" value={f.termMin} onChange={(e) => set({ termMin: num(e.target.value) })} />
          <span className="text-ice-500">–</span>
          <input className="slot text-center" inputMode="numeric" placeholder="max" value={f.termMax} onChange={(e) => set({ termMax: num(e.target.value) })} />
        </F>
        <F label="Max AAV wanted ($M)">
          <input className="slot text-center" inputMode="decimal" placeholder="any" value={f.aavMax} onChange={(e) => set({ aavMax: num(e.target.value) })} />
        </F>
        <F label="Min points">
          <input className="slot text-center" inputMode="numeric" placeholder="any" value={f.ptsMin} onChange={(e) => set({ ptsMin: num(e.target.value) })} />
        </F>
        <F label="Min games played">
          <input className="slot text-center" inputMode="numeric" placeholder="any" value={f.gpMin} onChange={(e) => set({ gpMin: num(e.target.value) })} />
        </F>
        <div className="flex items-end pb-1.5">
          {L.myTeamId && (
            <label className="flex items-center gap-1.5 text-sm text-ice-300">
              <input type="checkbox" checked={f.interested} onChange={(e) => set({ interested: e.target.checked })} /> Interested in us
            </label>
          )}
        </div>
        <div className="flex items-end">
          <button className="w-full rounded-md px-2 py-1.5 text-sm font-semibold text-blue-300 hover:bg-rink-800 disabled:opacity-40" disabled={!n} onClick={() => setF(EMPTY)}>
            Clear{n ? ` (${n})` : ''}
          </button>
        </div>
      </div>
      <p className="mb-2 text-xs text-ice-500">Stats are from his most recent NHL season (the season is shown on hover). Click any column to sort.</p>
      {sorted.length === 0 ? (
        <Empty>No free agents match these filters.</Empty>
      ) : (
        <div className="-mx-4 -mb-4 max-h-[48rem] overflow-auto">
          <table className="table">
            <thead className="sticky top-0 z-10 bg-rink-900">
              <tr>
                {L.myTeamId && <th className="w-0" />}
                <Th k="name">Player</Th>
                {d.bidding && (
                  <Th k="status" title="Each player listens to offers for a few days from the first one, then decides">
                    Offers
                  </Th>
                )}
                <Th k="pos">Pos</Th>
                <Th k="age" className="num">Age</Th>
                <Th k="ht" className="num">Ht</Th>
                <Th k="wt" className="num">Wt</Th>
                <Th k="ovr" className="num">OVR</Th>
                <Th k="pot">Pot</Th>
                <Th k="type">Archetype</Th>
                <Th k="nat">Nat</Th>
                <Th k="aav" className="num" title="Salary he's asking for (from your team, if you manage one)">AAV wanted</Th>
                <Th k="term" className="num" title="Years he's asking for">Term</Th>
                <Th k="interest" title="Interest in signing with your team">Interest</Th>
                <Th k="gp" className="num">GP</Th>
                <Th k="g" className="num" title="Goals (goalies: wins)">G</Th>
                <Th k="a" className="num" title="Assists (goalies: save %)">A</Th>
                <Th k="p" className="num">P</Th>
                <Th k="pm" className="num">+/-</Th>
                <Th k="career" className="num" title="Career NHL games">Career GP</Th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <Fragment key={p.id}>
                  <tr className={cx(open === p.id && 'bg-rink-800/60')}>
                    {L.myTeamId && (
                      <td className="w-0 whitespace-nowrap">
                        {d.bidding && (
                          <Button variant={p.myBid ? 'secondary' : 'primary'} className="px-2 py-0.5 text-xs" onClick={() => setOpen(open === p.id ? null : p.id)}>
                            {p.myBid ? `Bid: ${money(p.myBid.salary)} × ${p.myBid.years}y` : 'Bid'}
                          </Button>
                        )}
                        {d.canSign && (
                          <Button className="px-2 py-0.5 text-xs" disabled={p.attemptsLeft === 0} onClick={() => setOpen(open === p.id ? null : p.id)}>
                            {p.attemptsLeft === 0 ? 'Not negotiating' : open === p.id ? 'Close' : 'Sign…'}
                          </Button>
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap">
                      <Link to={`/league/${L.id}/player/${p.id}`} className="font-semibold text-ice-50 hover:underline">
                        {p.name}
                      </Link>
                      {p.injury && <span className="ml-1.5 text-[10px] text-red-300">INJ</span>}
                      <TraitChips traits={p.traits} />
                    </td>
                    {d.bidding && (
                      <td className="text-xs whitespace-nowrap">
                        <OfferStatus p={p} />
                      </td>
                    )}
                    <td className="text-ice-400">{posLabel(p)}</td>
                    <td className="num">{p.age}</td>
                    <td className="num whitespace-nowrap">{ht(p.height)}</td>
                    <td className="num">{p.weight}</td>
                    <td className="num">
                      <Rating value={p.overall} />
                    </td>
                    <td>
                      <PotentialBadge potential={p} />
                    </td>
                    <td className="text-xs whitespace-nowrap text-ice-400">{p.archetype}</td>
                    <td className="text-xs text-ice-400">{p.nationality}</td>
                    <td className="num text-white">{money(ask(p).salary)}</td>
                    <td className="num">{ask(p).years}</td>
                    <td className="whitespace-nowrap">{p.deal ? <InterestPill interest={p.deal.interest} /> : <span className="text-ice-600">—</span>}</td>
                    <td className="num" title={p.statsSeason ? `${p.statsSeason}-${String(p.statsSeason + 1).slice(2)}` : 'No NHL games'}>
                      {gp(p) || '—'}
                    </td>
                    {p.pos === 'G' ? (
                      <>
                        <td className="num">{p.goalieStats?.w ?? '—'}</td>
                        <td className="num">{p.goalieStats?.sa ? svPct(p.goalieStats.sa, p.goalieStats.ga) : '—'}</td>
                        <td className="num">—</td>
                        <td className="num">—</td>
                      </>
                    ) : (
                      <>
                        <td className="num">{p.skaterStats?.g ?? '—'}</td>
                        <td className="num">{p.skaterStats?.a ?? '—'}</td>
                        <td className="num font-semibold text-white">{pts(p) ?? '—'}</td>
                        <td className="num">{p.skaterStats ? (p.skaterStats.pm > 0 ? `+${p.skaterStats.pm}` : p.skaterStats.pm) : '—'}</td>
                      </>
                    )}
                    <td className="num">{p.careerGp}</td>
                    <td className="text-[11px] whitespace-nowrap text-ice-500">{p.deal ? p.deal.term : <Priorities items={p.priorities} />}</td>
                  </tr>
                  {open === p.id && p.deal && (d.bidding || d.canSign) && (
                    <tr>
                      <td colSpan={cols} className="bg-rink-850">
                        <OfferForm
                          leagueId={L.id}
                          playerId={p.id}
                          deal={p.deal}
                          mode={d.bidding ? 'bid' : 'sign'}
                          initial={p.myBid}
                          attemptsLeft={d.bidding ? undefined : p.attemptsLeft}
                          capRoom={d.capRoom}
                          blocked={d.rosterCount! >= d.rosterMax ? `You're at the ${d.rosterMax}-contract limit. Release a player first.` : undefined}
                          onClose={() => setOpen(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Before free agency: who's still unsigned and could hit the market. */
function PendingFreeAgents({ d }: { d: FAData }) {
  const L = useLeague();
  const [mineToo, setMineToo] = useState(false);
  const [onlyLeaving, setOnlyLeaving] = useState(false);
  const rows = d.pending.filter((p) => (mineToo || !p.mine) && (!onlyLeaving || p.lettingGo));
  const { sorted, Th } = useSort(
    rows,
    {
      name: (p) => p.lastName,
      team: (p) => p.team.abbr,
      pos: (p) => p.pos,
      age: (p) => p.age,
      ovr: (p) => p.overall,
      status: (p) => p.status,
      ask: (p) => p.ask.salary,
    },
    { key: 'ovr' },
    'pending-fa',
  );
  const leaving = d.pending.filter((p) => p.lettingGo && !p.mine).length;
  return (
    <CollapsibleCard
      id="fa-pending"
      defaultOpen
      title={`Pending free agents (${d.pending.filter((p) => !p.mine).length})`}
      summary={`Still unsigned by their teams${leaving ? ` · ${leaving} expected to hit the market` : ''}`}
    >
      <p className="mb-3 text-sm text-ice-400">
        Players around the league whose contracts are running out and who haven't re-signed yet. Their teams have until free agency opens; anyone still
        unsigned then becomes a free agent (RFAs who get a qualifying offer stay with their team, though you can tender an offer sheet). Asks are what
        they'd want today.
      </p>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-ice-300">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={onlyLeaving} onChange={(e) => setOnlyLeaving(e.target.checked)} /> Only players their team is letting go
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={mineToo} onChange={(e) => setMineToo(e.target.checked)} /> Include my own
        </label>
      </div>
      <div className="-mx-4 -mb-4 max-h-[28rem] overflow-auto">
        <table className="table text-sm">
          <thead className="sticky top-0 z-10 bg-rink-900">
            <tr>
              <Th k="name">Player</Th>
              <Th k="team">Team</Th>
              <Th k="pos">Pos</Th>
              <Th k="age" className="num">Age</Th>
              <Th k="ovr" className="num">OVR</Th>
              <th>Pot</th>
              <Th k="status">Status</Th>
              <Th k="ask" className="num">Asking</Th>
              <th>Outlook</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id} className={cx(p.mine && 'bg-blueline/10')}>
                <td className="whitespace-nowrap">
                  <Link to={`/league/${L.id}/player/${p.id}`} className="text-ice-50 hover:underline">
                    {p.name}
                  </Link>
                  <TraitChips traits={p.traits} />
                </td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <TeamChip team={p.team} size="sm" /> {p.team.abbr}
                  </span>
                </td>
                <td className="text-ice-400">{posLabel(p)}</td>
                <td className="num">{p.age}</td>
                <td className="num">
                  <Rating value={p.overall} />
                </td>
                <td>
                  <PotentialBadge potential={p.potential} />
                </td>
                <td>
                  <Badge tone={p.status === 'RFA' ? 'info' : 'neutral'}>{p.status}</Badge>
                </td>
                <td className="num whitespace-nowrap">
                  {money(p.ask.salary)} × {p.ask.years}y
                </td>
                <td className="text-xs whitespace-nowrap">
                  {p.mine ? (
                    <span className="text-blue-200">Yours: decide on the Re-sign page</span>
                  ) : p.lettingGo ? (
                    <span className="text-win">Expected to hit the market</span>
                  ) : p.qualified ? (
                    <span className="text-ice-300">Qualified (RFA)</span>
                  ) : (
                    <span className="text-ice-400">Undecided</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  );
}
