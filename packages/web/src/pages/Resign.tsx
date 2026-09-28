import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { OfferForm, Priorities } from '../components/OfferForm';
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
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return <Card><Empty>Contract decisions happen during the offseason.</Empty></Card>;
  const room = d.salaryCap - d.committedWithResigns;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Expiring contracts</h1>
        <p className="text-sm text-ice-400">
          Negotiate with each player. He weighs money, term, whether your team can win, his role and his loyalty, and gets annoyed by lowballs.
          You get three offers per player. Restricted free agents (RFA) can also be qualified: if you don't reach a deal, he stays on a one-year
          qualifying offer. Anyone without a deal or a qualifying offer leaves when this stage ends.
        </p>
      </div>
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Committed next season" value={money(d.committed)} />
          <Stat label="With agreed deals & QOs" value={money(d.committedWithResigns)} />
          <Stat label="Cap space left" value={money(room)} tone={room < 0 ? 'bad' : 'good'} />
        </div>
        {!d.open && <p className="mt-3 text-sm text-warn">The re-signing window has closed.</p>}
      </Card>
      <ErrorBox error={letGo.error ?? qualify.error} />
      <Card title={`Your expiring players (${d.players.length})`}>
        {d.players.length === 0 ? (
          <Empty>No contracts expire this summer.</Empty>
        ) : (
          <ul className="-my-2 divide-y divide-rink-700/60">
            {d.players.map((p) => {
              const status = p.agreed
                ? { tone: 'good' as const, text: `Agreed: ${money(p.agreed.salary)} × ${p.agreed.years}y` }
                : p.qualified
                  ? { tone: 'info' as const, text: `Qualified at ${money(p.qualifyingOffer!.salary)} × 1y` }
                  : p.letGo
                    ? { tone: 'bad' as const, text: 'Letting him go' }
                    : { tone: 'warn' as const, text: 'No deal yet (will leave)' };
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
                        <Priorities items={p.priorities} />
                      </div>
                    </div>
                    <div className="text-sm text-ice-300">
                      {p.stats ? `${p.stats.gp} GP · ${p.stats.g + p.stats.a} P` : p.goalieStats ? `${p.goalieStats.gp} GP · ${p.goalieStats.w} W` : '—'}
                    </div>
                    <div className="text-sm">
                      Asking <span className="text-white">{money(p.ask.salary)}</span> × {p.ask.years}y
                    </div>
                    <Badge tone={status.tone}>{status.text}</Badge>
                    {d.open && !p.agreed && (
                      <div className="flex gap-1">
                        <Button className="px-2 py-0.5 text-xs" onClick={() => setOpen(open === p.id ? null : p.id)} disabled={p.attemptsLeft === 0}>
                          {p.attemptsLeft === 0 ? 'No longer negotiating' : 'Negotiate'}
                        </Button>
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
                  {open === p.id && !p.agreed && (
                    <OfferForm leagueId={L.id} playerId={p.id} ask={p.ask} mode="negotiate" attemptsLeft={p.attemptsLeft} onClose={() => setOpen(null)} />
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
