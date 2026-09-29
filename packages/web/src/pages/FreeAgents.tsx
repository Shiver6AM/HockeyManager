import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { InterestPill, OfferForm, Priorities } from '../components/OfferForm';
import { OfferSheetTargets } from '../components/RfaPanels';
import { Badge, Button, Card, cx, Empty, ErrorBox, PotentialBadge, Rating, Spinner, TeamChip } from '../components/ui';
import { money, svPct } from '../format';
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
            ? `Blind bidding, round ${Math.min(d.faRound ?? 1, d.faRounds)} of ${d.faRounds}. Place sealed offers on as many players as you like. When the league advances, every player picks the best offer he received (money, term, contender, role), so nobody wins just by being online first. Players who don't sign lower their bar and their ask for the next round.`
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
            {d.bidding && <Stat label="Open bids" value={`${d.myBids.length} · ${money(myBidTotal)}`} />}
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
        <Card title="Your sealed bids">
          <ul className="space-y-1 text-sm">
            {d.myBids.map((b) => (
              <li key={b.playerId} className="flex items-center gap-3">
                <Link to={`/league/${L.id}/player/${b.playerId}`} className="flex-1 text-ice-100 hover:underline">
                  {b.name}
                </Link>
                <span className="tabular text-white">
                  {money(b.offer.salary)} × {b.offer.years}y
                </span>
                <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => withdraw.mutate({ leagueId: L.id, playerId: b.playerId })}>
                  Withdraw
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <OfferSheetTargets />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <FreeAgentTable d={d} open={open} setOpen={setOpen} />
        </div>

        <Card title="Signings so far">
          {d.results.length === 0 ? (
            <Empty>{d.bidding ? 'Results appear after each round resolves.' : 'No bidding results yet.'}</Empty>
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
                    R{r.round} · {r.bidders} bid{r.bidders === 1 ? '' : 's'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
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
    },
    { key: 'ovr' },
    'free-agents',
  );
  const n = Object.entries(f).filter(([k, v]) => v !== (EMPTY as Record<string, unknown>)[k]).length;
  const cols = 17 + (L.myTeamId ? 1 : 0);
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
                <Th k="name">Player</Th>
                <Th k="pos">Pos</Th>
                <Th k="age" className="num">Age</Th>
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
                {L.myTeamId && <th />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <Fragment key={p.id}>
                  <tr className={cx(open === p.id && 'bg-rink-800/60')}>
                    <td className="whitespace-nowrap">
                      <Link to={`/league/${L.id}/player/${p.id}`} className="font-semibold text-ice-50 hover:underline">
                        {p.name}
                      </Link>
                      {p.injury && <span className="ml-1.5 text-[10px] text-red-300">INJ</span>}
                    </td>
                    <td className="text-ice-400">{p.pos}</td>
                    <td className="num">{p.age}</td>
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
                    {L.myTeamId && (
                      <td className="text-right whitespace-nowrap">
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
