import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { InterestPill, OfferForm } from '../components/OfferForm';
import { MyRfas } from '../components/RfaPanels';
import { Badge, Button, Card, cx, Empty, ErrorBox, Rating, Spinner } from '../components/ui';
import { money } from '../format';
import { useTRPC } from '../trpc';
import { useLeague } from './LeagueLayout';

export function ResignPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery(trpc.offseason.expiring.queryOptions({ leagueId: L.id }));
  const done = { onSuccess: () => qc.invalidateQueries() };
  const letGo = useMutation(trpc.offseason.setResign.mutationOptions(done));
  const qualify = useMutation(trpc.offseason.setQualify.mutationOptions(done));
  const qualifyAll = useMutation(trpc.offseason.setQualifyAll.mutationOptions(done));
  const withdraw = useMutation(trpc.offseason.withdrawOffer.mutationOptions(done));
  const acceptCounter = useMutation(trpc.offseason.acceptCounter.mutationOptions(done));
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return <Card><Empty>Contract decisions happen during the offseason.</Empty></Card>;
  const room = d.salaryCap - d.committedWithResigns;
  const unqualified = d.players.filter((p) => p.status === 'RFA' && !p.qualified && !p.agreed && !p.letGo && !p.signedNow);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Expiring contracts</h1>
        <p className="text-sm text-ice-400">
          Each player has his own level of interest in your team (contender status, role, loyalty, market, your coach), which sets what he asks
          you for. He then weighs money against term in his own way: veterans want security, young players avoid being locked in. Lowballs annoy
          him, and you get three offers per player. The week before free agency is your exclusive window: offers are answered by his agent the next
          day (close calls can take an extra day), so start early. Restricted free agents (RFA) can also be qualified: a qualified RFA without a deal stays yours on his qualifying offer, but other teams can tender offer sheets during free agency, and he may file for arbitration. Players you never decide on are handled by
          your assistant GM when this stage ends; press Let go to release someone.
        </p>
      </div>
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Committed next season" value={money(d.committed)} />
          <Stat label="With agreed deals & QOs" value={money(d.committedWithResigns)} />
          <Stat label="Cap space left" value={money(room)} tone={room < 0 ? 'bad' : 'good'} />
        </div>
        {!d.open && <p className="mt-3 text-sm text-warn">The re-signing window has closed.</p>}
        {d.resignDay !== null && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-white">
              Re-signing week · day {d.resignDay} of {d.resignDays}
            </span>
            <span className="flex gap-1" aria-hidden>
              {Array.from({ length: d.resignDays }, (_, i) => (
                <span key={i} className={cx('h-2 w-6 rounded-full', i < d.resignDay! ? 'bg-blueline' : 'bg-rink-700')} />
              ))}
            </span>
            <span className="text-xs text-ice-400">
              {d.resignDay < d.resignDays ? 'Offers made today are answered tomorrow.' : 'Last day: every open offer is answered before free agency opens.'}
            </span>
          </div>
        )}
        {d.resignDay === null && d.deferred && (
          <p className="mt-3 text-xs text-ice-400">During the draft, offers are answered once the draft wraps up.</p>
        )}
        {d.open && unqualified.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ice-300">
            <span>
              {unqualified.length} RFA{unqualified.length > 1 ? 's' : ''} without a deal or a qualifying offer (
              {money(unqualified.reduce((s, p) => s + (p.qualifyingOffer?.salary ?? 0), 0))} to qualify all).
            </span>
            <Button variant="secondary" className="px-2 py-0.5 text-xs" disabled={qualifyAll.isPending} onClick={() => qualifyAll.mutate({ leagueId: L.id, qualify: true })}>
              Qualify all RFAs
            </Button>
          </div>
        )}
      </Card>
      <MyRfas />
      <ErrorBox error={letGo.error ?? qualify.error ?? qualifyAll.error ?? withdraw.error ?? acceptCounter.error} />
      <Card title={`Your expiring players (${d.players.length})`}>
        {d.players.length === 0 ? (
          <Empty>No contracts expire this summer.</Empty>
        ) : (
          <ul className="-my-2 divide-y divide-rink-700/60">
            {d.players.map((p) => {
              const resp = p.response;
              const status = p.signedNow
                ? { tone: 'good' as const, text: `Re-signed: ${money(p.signedNow.salary)} × ${p.signedNow.yearsLeft}y` }
                : p.agreed
                ? { tone: 'good' as const, text: `Agreed: ${money(p.agreed.salary)} × ${p.agreed.years}y` }
                : p.qualified
                  ? { tone: 'info' as const, text: `Qualified at ${money(p.qualifyingOffer!.salary)} × 1y` }
                  : p.pending
                    ? { tone: 'info' as const, text: `Offer out: ${money(p.pending.offer.salary)} × ${p.pending.offer.years}y` }
                    : p.letGo
                      ? { tone: 'bad' as const, text: 'Letting him go' }
                      : { tone: 'warn' as const, text: 'Undecided (assistant GM decides)' };
              return (
                <li key={p.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <div className="min-w-56 flex-1">
                      <Link to={`/league/${L.id}/player/${p.id}`} className="font-semibold text-white hover:underline">
                        {p.name}
                      </Link>{' '}
                      <span className="text-sm text-ice-400">
                        {p.pos} · {p.age} · <Rating value={p.overall} /> OVR
                      </span>{' '}
                      <Badge tone={p.status === 'RFA' ? 'info' : 'neutral'}>{p.status}</Badge>
                      <div className="mt-1">
                        <InterestPill interest={p.interest} />
                      </div>
                    </div>
                    <div className="text-sm text-ice-300">
                      {p.stats ? `${p.stats.gp} GP · ${p.stats.g + p.stats.a} P` : p.goalieStats ? `${p.goalieStats.gp} GP · ${p.goalieStats.w} W` : '—'}
                    </div>
                    <div className="text-sm">
                      Asks you for <span className="text-white">{money(p.ask.salary)}</span> × {p.ask.years}y
                    </div>
                    <Badge tone={status.tone}>{status.text}</Badge>
                    {d.open && !p.agreed && (
                      <div className="flex gap-1">
                        <Button className="px-2 py-0.5 text-xs" onClick={() => setOpen(open === p.id ? null : p.id)} disabled={p.attemptsLeft === 0}>
                          {p.attemptsLeft === 0 ? 'No longer negotiating' : p.pending ? 'Revise offer' : 'Negotiate'}
                        </Button>
                        {p.pending && (
                          <Button variant="ghost" className="px-2 py-0.5 text-xs" disabled={withdraw.isPending} onClick={() => withdraw.mutate({ leagueId: L.id, playerId: p.id })}>
                            Withdraw
                          </Button>
                        )}
                        {p.status === 'RFA' && (
                          <Button
                            variant={p.qualified ? 'primary' : 'secondary'}
                            className="px-2 py-0.5 text-xs"
                            onClick={() => qualify.mutate({ leagueId: L.id, playerId: p.id, qualify: !p.qualified })}
                          >
                            {p.qualified ? '✓ Qualified' : 'Qualify'}
                          </Button>
                        )}
                        <Button
                          variant={p.letGo ? 'danger' : 'ghost'}
                          className="px-2 py-0.5 text-xs"
                          onClick={() => letGo.mutate({ leagueId: L.id, playerId: p.id, resign: p.letGo })}
                        >
                          {p.letGo ? 'Undo' : 'Let go'}
                        </Button>
                      </div>
                    )}
                  </div>
                  {p.qoOutlook && p.qualifyingOffer && !p.agreed && !p.signedNow && (
                    <p className="mt-1.5 text-xs text-ice-400">
                      Qualifying offer <span className="text-ice-100">{money(p.qualifyingOffer.salary)} × 1y</span>. If qualified, he'd likely{' '}
                      <span className="text-ice-100">
                        {p.qoOutlook.response === 'accept'
                          ? 'accept it'
                          : p.qoOutlook.response === 'arbitration'
                            ? `file for arbitration (award around ${money(p.qoOutlook.expectedAward)})`
                            : 'hold out for more (other teams can tender offer sheets)'}
                      </span>
                      {!p.qoOutlook.arbitrationEligible && ' · not yet arbitration-eligible'}. If not qualified, he becomes an unrestricted free agent.
                    </p>
                  )}
                  {resp && !p.signedNow && (
                    <div
                      className={cx(
                        'mt-2 flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-sm',
                        resp.result === 'accept'
                          ? 'bg-win/15 text-win'
                          : resp.result === 'counter'
                            ? 'bg-blueline/15 text-blue-200'
                            : resp.result === 'considering'
                              ? 'bg-rink-800 text-ice-200'
                              : 'bg-goal/10 text-red-200',
                      )}
                    >
                      <span className="text-xs text-ice-400">Day {resp.day}:</span>
                      <span>{resp.message}</span>
                      {resp.result === 'counter' && resp.counter && !p.agreed && (
                        <Button className="px-2 py-0.5 text-xs" disabled={acceptCounter.isPending} onClick={() => acceptCounter.mutate({ leagueId: L.id, playerId: p.id })}>
                          Accept {money(resp.counter.salary)} × {resp.counter.years}y
                        </Button>
                      )}
                    </div>
                  )}
                  {open === p.id && !p.agreed && (
                    <OfferForm leagueId={L.id} playerId={p.id} deal={p} mode="negotiate" attemptsLeft={p.attemptsLeft} capRoom={room} onClose={() => setOpen(null)} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg bg-rink-850 p-3">
      <p className="text-[11px] font-semibold tracking-wider text-ice-500 uppercase">{label}</p>
      <p className={cx('tabular font-display text-xl', tone === 'bad' ? 'text-red-300' : tone === 'good' ? 'text-win' : 'text-white')}>{value}</p>
    </div>
  );
}
