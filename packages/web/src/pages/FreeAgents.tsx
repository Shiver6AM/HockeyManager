import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { InterestPill, OfferForm, Priorities } from '../components/OfferForm';
import { OfferSheetTargets } from '../components/RfaPanels';
import { Badge, Button, Card, cx, Empty, ErrorBox, Rating, Spinner, TeamChip } from '../components/ui';
import { money } from '../format';
import { useTRPC } from '../trpc';
import { useLeague } from './LeagueLayout';
import { Stat } from './Resign';

export function FreeAgentsPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery(trpc.offseason.freeAgents.queryOptions({ leagueId: L.id }));
  const done = { onSuccess: () => qc.invalidateQueries() };
  const withdraw = useMutation(trpc.offseason.withdrawBid.mutationOptions(done));
  const [pos, setPos] = useState('All');
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading || !q.data) return <Spinner />;
  const d = q.data;
  const list = d.players.filter((p) => pos === 'All' || (pos === 'F' ? ['C', 'LW', 'RW'].includes(p.pos) : p.pos === pos));
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
            <Stat label="Roster" value={`${d.rosterCount} / ${d.rosterMax}`} tone={d.rosterCount! >= d.rosterMax ? 'bad' : undefined} />
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
        <Card
          className="xl:col-span-2"
          title={`Available (${d.players.length})`}
          action={
            <div className="flex rounded-md bg-rink-800 p-0.5 text-xs">
              {['All', 'F', 'D', 'G'].map((x) => (
                <button key={x} onClick={() => setPos(x)} className={cx('rounded px-2 py-0.5 font-semibold', pos === x ? 'bg-rink-600 text-white' : 'text-ice-400')}>
                  {x}
                </button>
              ))}
            </div>
          }
        >
          {list.length === 0 ? (
            <Empty>No free agents.</Empty>
          ) : (
            <ul className="-my-2 max-h-[48rem] divide-y divide-rink-700/60 overflow-y-auto">
              {list.map((p) => (
                <li key={p.id} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <div className="min-w-52 flex-1">
                      <Link to={`/league/${L.id}/player/${p.id}`} className="font-semibold text-ice-50 hover:underline">
                        {p.name}
                      </Link>{' '}
                      <span className="text-sm text-ice-400">
                        {p.pos} · {p.age} · <Rating value={p.overall} />
                      </span>
                      {p.injury && <span className="ml-2 text-xs text-red-300">injured</span>}
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {p.deal ? <InterestPill interest={p.deal.interest} /> : <Priorities items={p.priorities} />}
                      </div>
                    </div>
                    <span className="text-xs text-ice-400">
                      {p.archetype} · {p.careerGp} career GP
                    </span>
                    <span className="text-sm">
                      {p.deal ? 'Asks you for ' : 'Asking '}
                      <span className="text-white">{money((p.deal?.ask ?? p.ask).salary)}</span> × {(p.deal?.ask ?? p.ask).years}y
                    </span>
                    {L.myTeamId && d.bidding && (
                      <Button variant={p.myBid ? 'secondary' : 'primary'} className="px-2 py-0.5 text-xs" onClick={() => setOpen(open === p.id ? null : p.id)}>
                        {p.myBid ? `Your bid: ${money(p.myBid.salary)} × ${p.myBid.years}y` : 'Bid'}
                      </Button>
                    )}
                    {L.myTeamId && d.canSign && (
                      <Button
                        className="px-2 py-0.5 text-xs"
                        disabled={p.attemptsLeft === 0}
                        onClick={() => setOpen(open === p.id ? null : p.id)}
                      >
                        {p.attemptsLeft === 0 ? 'Not negotiating' : open === p.id ? 'Close' : 'Sign…'}
                      </Button>
                    )}
                  </div>
                  {open === p.id && p.deal && (d.bidding || d.canSign) && (
                    <OfferForm
                      leagueId={L.id}
                      playerId={p.id}
                      deal={p.deal}
                      mode={d.bidding ? 'bid' : 'sign'}
                      initial={p.myBid}
                      attemptsLeft={d.bidding ? undefined : p.attemptsLeft}
                      capRoom={d.capRoom}
                      blocked={d.rosterCount! >= d.rosterMax ? `Your roster is full (${d.rosterCount}/${d.rosterMax}). Release or send down a player first.` : undefined}
                      onClose={() => setOpen(null)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

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
