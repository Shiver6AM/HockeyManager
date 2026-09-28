import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { money } from '../format';
import { useLeague } from '../pages/LeagueLayout';
import { useTRPC, type Outputs } from '../trpc';
import { compensationText, InterestPill, OfferForm } from './OfferForm';
import { Badge, Button, Card, cx, ErrorBox, Rating, TeamChip } from './ui';

type Rfa = NonNullable<Outputs['offseason']['rfa']>;

const STATUS: Record<string, { text: string; tone: 'good' | 'bad' | 'warn' | 'info' | 'neutral' }> = {
  unsigned: { text: 'Unsigned (on his qualifying offer)', tone: 'warn' },
  signed: { text: 'Signed', tone: 'good' },
  awarded: { text: 'Arbitration award', tone: 'info' },
  walked: { text: 'Walked away', tone: 'bad' },
  departed: { text: 'Left on an offer sheet', tone: 'bad' },
};

/** Re-sign page: your qualified RFAs through free agency, offer sheets and arbitration. */
export function MyRfas() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery(trpc.offseason.rfa.queryOptions({ leagueId: L.id }));
  const done = { onSuccess: () => qc.invalidateQueries() };
  const decide = useMutation(trpc.offseason.decideOfferSheet.mutationOptions(done));
  const walk = useMutation(trpc.offseason.walkAway.mutationOptions(done));
  const [open, setOpen] = useState<string | null>(null);
  const d = q.data;
  if (!d || !d.mine.length) return null;
  return (
    <Card title={`Your restricted free agents (${d.mine.length})`}>
      <p className="mb-3 text-sm text-ice-400">
        Qualified RFAs without a new deal stay with you on their qualifying offer. During free agency other teams can tender offer sheets: if he signs one, you
        can match (he stays at those terms) or let him go for draft-pick compensation. Decide before the next advance, or your assistant GM decides. Players who
        filed for arbitration get a hearing when free agency ends; in training camp you can walk away from an award of {money(d.walkAwayThreshold)} or more. You
        can keep negotiating with an unsigned RFA the whole time.
      </p>
      <ul className="divide-y divide-rink-700/60">
        {d.mine.map((p) => {
          const st = STATUS[p.status];
          return (
            <li key={p.id} className="py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="min-w-56 flex-1">
                  <Link to={`/league/${L.id}/player/${p.id}`} className="font-semibold text-white hover:underline">
                    {p.name}
                  </Link>{' '}
                  <span className="text-sm text-ice-400">
                    {p.pos} · {p.age} · <Rating value={p.overall} />
                  </span>{' '}
                  {p.arbitration && p.status === 'unsigned' && <Badge tone="info">Filed for arbitration</Badge>}
                  {p.deal && (
                    <div className="mt-1">
                      <InterestPill interest={p.deal.interest} />
                    </div>
                  )}
                </div>
                <span className="text-sm text-ice-300">
                  QO {money(p.qualifyingOffer.salary)}
                  {p.award && (
                    <>
                      {' '}
                      · award <span className="text-white">{money(p.award.salary)}</span> × {p.award.years}y
                    </>
                  )}
                </span>
                <Badge tone={st.tone}>{st.text}</Badge>
                {p.status === 'unsigned' && !p.sheet && p.deal && (
                  <Button className="px-2 py-0.5 text-xs" disabled={p.attemptsLeft === 0} onClick={() => setOpen(open === p.id ? null : p.id)}>
                    {p.attemptsLeft === 0 ? 'Not negotiating' : open === p.id ? 'Close' : 'Negotiate'}
                  </Button>
                )}
                {p.canWalkAway && (
                  <Button
                    variant="danger"
                    className="px-2 py-0.5 text-xs"
                    disabled={walk.isPending}
                    onClick={() => confirm(`Walk away from ${p.name}'s award? He becomes an unrestricted free agent.`) && walk.mutate({ leagueId: L.id, playerId: p.id })}
                  >
                    Walk away
                  </Button>
                )}
              </div>
              {p.sheet && p.status === 'unsigned' && (
                <div className="mt-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
                  <p className="text-ice-100">
                    <TeamChip team={p.sheet.from} size="sm" /> He signed an offer sheet with{' '}
                    <Link to={`/league/${L.id}/team/${p.sheet.from.id}`} className="hover:underline">
                      {p.sheet.from.city}
                    </Link>
                    :{' '}
                    <span className="font-semibold text-white">
                      {money(p.sheet.offer.salary)} × {p.sheet.offer.years}y
                    </span>
                    . If you don't match, you receive: {p.sheet.compensation.length ? p.sheet.compensation.join(', ') : 'no compensation'}.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      className="px-2 py-0.5 text-xs"
                      variant={p.sheet.decision === 'match' ? 'primary' : 'secondary'}
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ leagueId: L.id, playerId: p.id, match: true })}
                    >
                      {p.sheet.decision === 'match' ? '✓ Matching' : 'Match'}
                    </Button>
                    <Button
                      className="px-2 py-0.5 text-xs"
                      variant={p.sheet.decision === 'decline' ? 'danger' : 'ghost'}
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ leagueId: L.id, playerId: p.id, match: false })}
                    >
                      {p.sheet.decision === 'decline' ? '✓ Taking the picks' : 'Take the picks'}
                    </Button>
                    <span className="text-xs text-ice-400">
                      {p.sheet.decision ? 'Settled at the next advance.' : 'Undecided: your assistant GM will decide at the next advance.'}
                    </span>
                  </div>
                </div>
              )}
              {open === p.id && p.deal && p.status === 'unsigned' && (
                <OfferForm leagueId={L.id} playerId={p.id} deal={p.deal} mode="negotiate" attemptsLeft={p.attemptsLeft} capRoom={d.capRoom} onClose={() => setOpen(null)} />
              )}
            </li>
          );
        })}
      </ul>
      <ErrorBox error={decide.error ?? walk.error} />
    </Card>
  );
}

/** Free-agents page: other teams' unsigned RFAs, open to offer sheets. */
export function OfferSheetTargets() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery(trpc.offseason.rfa.queryOptions({ leagueId: L.id }));
  const withdraw = useMutation(trpc.offseason.withdrawOfferSheet.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const [open, setOpen] = useState<string | null>(null);
  const d = q.data;
  if (!d || d.stage !== 'free-agency' || !d.others.length || !L.myTeamId) return null;
  return (
    <Card title={`Restricted free agents: offer sheets (${d.others.length})`}>
      <p className="mb-3 text-sm text-ice-400">
        These RFAs are unsigned but still belong to their teams. Tender an offer sheet: if he signs it, his team can match or let him go, and you pay
        compensation in your own draft picks, scaled by salary ({compensationTable(d.compensation)}).
      </p>
      <ul className="-my-2 max-h-[40rem] divide-y divide-rink-700/60 overflow-y-auto">
        {d.others.map((p) => (
          <li key={p.id} className={cx('py-2.5', p.signedSheet && 'opacity-60')}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <div className="min-w-52 flex-1">
                <Link to={`/league/${L.id}/player/${p.id}`} className="font-semibold text-ice-50 hover:underline">
                  {p.name}
                </Link>{' '}
                <span className="text-sm text-ice-400">
                  {p.pos} · {p.age} · <Rating value={p.overall} />
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <TeamChip team={p.team} size="sm" />
                  {p.deal && <InterestPill interest={p.deal.interest} />}
                  {p.arbitration && <Badge tone="info">Arbitration filed</Badge>}
                </div>
              </div>
              <span className="text-sm text-ice-300">QO {money(p.qualifyingOffer.salary)}</span>
              {p.signedSheet ? (
                <Badge tone="warn">Signed a sheet; team deciding</Badge>
              ) : p.myTender ? (
                <span className="flex items-center gap-2 text-sm">
                  <Badge tone="info">
                    Your sheet: {money(p.myTender.salary)} × {p.myTender.years}y
                  </Badge>
                  <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => withdraw.mutate({ leagueId: L.id, playerId: p.id })}>
                    Withdraw
                  </Button>
                </span>
              ) : (
                p.deal && (
                  <Button className="px-2 py-0.5 text-xs" onClick={() => setOpen(open === p.id ? null : p.id)}>
                    {open === p.id ? 'Close' : 'Offer sheet…'}
                  </Button>
                )
              )}
            </div>
            {open === p.id && p.deal && !p.myTender && (
              <OfferForm
                leagueId={L.id}
                playerId={p.id}
                deal={p.deal}
                mode="sheet"
                initial={{ salary: Math.max(p.deal.ask.salary, p.qualifyingOffer.salary + 25_000), years: Math.min(7, p.deal.ask.years) }}
                capRoom={d.capRoom}
                compensation={(salary) => compensationText(d.compensation, salary)}
                onClose={() => setOpen(null)}
              />
            )}
          </li>
        ))}
      </ul>
      <ErrorBox error={withdraw.error} />
    </Card>
  );
}

function compensationTable(rows: Rfa['compensation']): string {
  return rows
    .filter((r) => r.rounds.length)
    .map((r) => `${money(r.from)}+: ${compensationText(rows, r.from)}`)
    .join('; ');
}
