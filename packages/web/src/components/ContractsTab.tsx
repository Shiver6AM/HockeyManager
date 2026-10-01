/**
 * Contracts: every signed player's deal season by season (with agreed
 * extensions and when he hits free agency), the cap picture for the next seven
 * seasons, how keen each player is to re-sign, and extend/release actions.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { money } from '../format';
import { useSort } from '../sort';
import { useTRPC, type Outputs } from '../trpc';
import { InterestPill, OfferForm } from './OfferForm';
import { Badge, Button, Card, cx, ErrorBox, Modal, PotentialBadge, Rating, RatingChange, Spinner } from './ui';

type Data = Outputs['data']['contracts'];
type Row = Data['players'][number];

const short = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(x >= 1e7 ? 1 : 2)}M` : `${Math.round(x / 1000)}K`);
const seasonLabel = (y: number) => `${String(y).slice(2)}-${String(y + 1).slice(2)}`;

export function ContractsTab({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.data.contracts.queryOptions({ leagueId, teamId }));
  const [scope, setScope] = useState<'nhl' | 'farm' | 'all'>('nhl');
  const [expiringOnly, setExpiringOnly] = useState(false);
  const rows = (q.data?.players ?? []).filter((p) => (scope === 'all' || (scope === 'farm') === p.farm) && (!expiringOnly || p.expiringSoon));
  const cols: Record<string, (r: Row) => number | string | null> = {
    name: (r) => r.lastName,
    pos: (r) => r.pos,
    age: (r) => r.age,
    ovr: (r) => r.overall,
    pot: (r) => ['F', 'D', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'].indexOf(r.potential.grade),
    hit: (r) => r.capHit,
    left: (r) => r.remaining,
    type: (r) => (r.twoWay ? 1 : 0),
    interest: (r) => r.interest?.score ?? null,
  };
  (q.data?.seasons ?? []).forEach((y, i) => (cols[`s${y}`] = (r) => r.grid[i].salary ?? (r.grid[i].kind ? -1 : null)));
  const { sorted, Th } = useSort(rows, cols, { key: 'hit' }, 'contracts');
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Spinner />;
  const d = q.data;

  return (
    <div className="space-y-5">
      <Card title="Cap outlook">
        <div className="-m-4 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Season</th>
                <th className="num" title="Projected: the cap grows about 2.5% a year">Cap</th>
                <th className="num">Committed</th>
                <th className="num">Dead cap</th>
                <th className="num">Space</th>
                <th className="num">Signed</th>
                {d.isMine && (
                  <th className="num" title="AAV of your open offers (re-signing, free agents, offer sheets) that would count that season if accepted">
                    Offered
                  </th>
                )}
                {d.isMine && (
                  <th className="num" title="Cap space left if every open offer were accepted">
                    If accepted
                  </th>
                )}
                <th className="w-1/3" />
              </tr>
            </thead>
            <tbody>
              {d.cap.map((c, i) => (
                <tr key={c.season}>
                  <td className="tabular">
                    {seasonLabel(c.season)}
                    {i === 0 && <span className="ml-1 text-[10px] text-ice-500">now</span>}
                  </td>
                  <td className="num">{money(c.cap)}</td>
                  <td className="num text-white">{money(c.committed)}</td>
                  <td className={cx('num', c.dead ? 'text-red-300' : 'text-ice-600')}>{c.dead ? money(c.dead) : '—'}</td>
                  <td className={cx('num font-semibold', c.space < 0 ? 'text-red-300' : 'text-win')}>{money(c.space)}</td>
                  <td className="num">{c.signed}</td>
                  {d.isMine && <td className={cx('num', c.offered ? 'font-semibold text-warn' : 'text-ice-600')}>{c.offered ? money(c.offered) : '—'}</td>}
                  {d.isMine && (
                    <td className={cx('num', !c.offered ? 'text-ice-600' : c.spaceIfAccepted < 0 ? 'font-semibold text-red-300' : 'text-ice-100')}>
                      {c.offered ? money(c.spaceIfAccepted) : '—'}
                    </td>
                  )}
                  <td>
                    <div
                      className="flex h-2 overflow-hidden rounded-full bg-rink-700"
                      title={`${Math.round((c.committed / c.cap) * 100)}% of the cap committed${c.offered ? `, ${Math.round((c.offered / c.cap) * 100)}% more offered` : ''}`}
                    >
                      <div className={cx('h-2', c.committed > c.cap ? 'bg-goal' : 'bg-blueline')} style={{ width: `${Math.min(100, (c.committed / c.cap) * 100)}%` }} />
                      {c.offered > 0 && (
                        <div
                          className={cx('h-2', c.spaceIfAccepted < 0 ? 'bg-goal/60' : 'bg-warn/70')}
                          style={{ width: `${Math.max(0, Math.min(100 - (c.committed / c.cap) * 100, (c.offered / c.cap) * 100))}%` }}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {d.isMine && d.offers.length > 0 && (
        <Card title={`Open offers (${d.offers.length})`}>
          <ul className="divide-y divide-rink-700/60 text-sm">
            {d.offers.map((o) => (
              <li key={`${o.kind}-${o.playerId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <Link to={`/league/${leagueId}/player/${o.playerId}`} className="min-w-0 flex-1 truncate font-semibold text-ice-50 hover:underline">
                  {o.name} <span className="text-xs font-normal text-ice-500">{o.pos}</span>
                </Link>
                <Badge tone={o.kind === 're-sign' ? 'info' : o.kind === 'free-agent' ? 'good' : 'warn'}>
                  {o.kind === 're-sign' ? 'Re-sign' : o.kind === 'free-agent' ? 'Free agent' : 'Offer sheet'}
                </Badge>
                <span className="tabular text-white">
                  {money(o.offer.salary)} × {o.offer.years}y
                </span>
                <span className="tabular text-xs text-ice-400">
                  {seasonLabel(d.seasons[o.startIndex])}
                  {o.offer.years > 1 ? ` to ${seasonLabel(d.seasons[0] + o.startIndex + o.offer.years - 1)}` : ''}
                </span>
                <span className="w-32 text-right text-xs text-warn">{o.status}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ice-400">
            Offers aren't on your cap until they're accepted; the cap outlook above shows what they'd add each season.
          </p>
        </Card>
      )}

      <Card
        title={`Contracts (${d.players.length}/${d.contractMax})`}
        action={
          <span className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-ice-300">
              <input type="checkbox" checked={expiringOnly} onChange={(e) => setExpiringOnly(e.target.checked)} /> Expiring soon
            </label>
            <span className="flex rounded-md bg-rink-800 p-0.5">
              {(['nhl', 'farm', 'all'] as const).map((s) => (
                <button key={s} onClick={() => setScope(s)} className={cx('rounded px-2 py-0.5 font-semibold', scope === s ? 'bg-rink-600 text-white' : 'text-ice-400')}>
                  {s === 'nhl' ? 'NHL' : s === 'farm' ? 'Farm' : 'All'}
                </button>
              ))}
            </span>
          </span>
        }
      >
        <p className="-mt-1 mb-3 text-xs text-ice-400">
          Each season column shows his cap hit that year: <span className="text-blue-200">current deal</span>,{' '}
          <span className="text-win">agreed extension</span>, <span className="text-warn">your offer awaiting an answer</span>, then <Badge tone="bad">UFA</Badge> or <Badge tone="warn">RFA</Badge> when it runs out. Interest
          is how keen he is to stay, from your team's standing, his role, loyalty and ambition, the market and his age. Players in their final year can be
          extended; releasing a player with years left is a buyout.
        </p>
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <Th k="name">Player</Th>
                <Th k="pos">Pos</Th>
                <Th k="age" className="num">Age</Th>
                <Th k="ovr" className="num">OVR</Th>
                <Th k="pot">Pot</Th>
                <Th k="hit" className="num" title="Cap hit now (farm: only the part above $1.15M)">Cap hit</Th>
                <Th k="left" className="num" title="Seasons left on his current deal">Left</Th>
                <Th k="type" title="One-way deals pay the full salary anywhere; two-way deals pay an AHL salary while he's on the farm">Type</Th>
                {d.seasons.map((y) => (
                  <Th key={y} k={`s${y}`} className="num">
                    {seasonLabel(y)}
                  </Th>
                ))}
                <Th k="interest">Re-sign interest</Th>
                {d.isMine && <th />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <ContractRow key={r.id} r={r} d={d} leagueId={leagueId} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ContractRow({ r, d, leagueId }: { r: Row; d: Data; leagueId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const release = useMutation(trpc.offseason.release.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const [extending, setExtending] = useState(false);
  const buyoutNote = r.buyout
    ? `He'll be bought out: ${money(r.buyout.perSeason)} of dead cap per season for ${r.buyout.seasons} seasons (${money(r.buyout.total)} in all).`
    : 'His contract comes off your cap and he becomes a free agent.';
  return (
    <tr className={cx(r.expiringSoon && 'bg-warn/5')}>
      <td className="whitespace-nowrap">
        <Link to={`/league/${leagueId}/player/${r.id}`} className="font-semibold text-ice-50 hover:underline">
          {r.name}
        </Link>
        <span className="ml-1.5 text-[10px] text-ice-500">
          {r.farm && <span className="mr-1 rounded bg-rink-700 px-1 text-ice-300">AHL</span>}
          {r.contract?.kind === 'ELC' && <span className="rounded bg-blueline/20 px-1 text-blue-200">ELC</span>}
        </span>
        {r.myOffer ? (
          <span className="ml-1.5 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn" title={`Your offer: ${money(r.myOffer.offer.salary)} × ${r.myOffer.offer.years}y`}>
            Offer sent · {r.myOffer.status}
          </span>
        ) : r.answer?.result === 'counter' && r.answer.counter ? (
          <span className="ml-1.5 rounded bg-blueline/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-200" title={r.answer.message}>
            Countered {short(r.answer.counter.salary)} × {r.answer.counter.years}y
          </span>
        ) : r.answer && (r.answer.result === 'reject' || r.answer.result === 'refuse') ? (
          <span className="ml-1.5 rounded bg-goal/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-300" title={r.answer.message}>
            Offer turned down
          </span>
        ) : null}
      </td>
      <td className="text-ice-300">{r.pos}</td>
      <td className="num">{r.age}</td>
      <td className="num">
        <RatingChange value={r.overall} change={r.ovrChange} prevSeason={r.ovrPrevSeason} />
      </td>
      <td>
        <PotentialBadge potential={r.potential} />
      </td>
      <td className="num text-white">{money(r.capHit)}</td>
      <td className="num">{r.remaining}</td>
      <td className="text-xs whitespace-nowrap">
        {r.contract ? (
          r.twoWay ? (
            <span className="text-ice-400" title={`Two-way: ${money(r.minorSalary ?? 0)} while in the AHL`}>
              2-way <span className="text-ice-500">({short(r.minorSalary ?? 0)} AHL)</span>
            </span>
          ) : (
            <span className="text-ice-200">1-way</span>
          )
        ) : (
          '—'
        )}
      </td>
      {r.grid.map((g) => (
        <td key={g.season} className="num text-xs">
          {g.kind === 'contract' ? (
            <span className="rounded bg-blueline/15 px-1 py-0.5 text-blue-100">{short(g.salary!)}</span>
          ) : g.kind === 'extension' ? (
            <span className="rounded bg-win/15 px-1 py-0.5 text-win">{short(g.salary!)}</span>
          ) : g.kind === 'offer' ? (
            <span className="rounded border border-dashed border-warn/60 px-1 py-0.5 text-warn" title="Your offer, waiting for his answer">
              {short(g.salary!)}
            </span>
          ) : g.kind === 'ufa' ? (
            <Badge tone="bad">UFA</Badge>
          ) : g.kind === 'rfa' ? (
            <Badge tone="warn">RFA</Badge>
          ) : (
            ''
          )}
        </td>
      ))}
      <td className="whitespace-nowrap">
        {r.interest ? (
          <span title={r.interest.factors.map((f) => `${f.good ? '+' : '−'} ${f.label}`).join('\n')}>
            <InterestPill interest={r.interest} />
          </span>
        ) : (
          <span className="text-ice-600">—</span>
        )}
      </td>
      {d.isMine && (
        <td className="whitespace-nowrap">
          {r.canExtend && r.deal && (
            <Button variant="ghost" className="px-1.5 py-0 text-[11px] text-blue-300" onClick={() => setExtending(true)}>
              {r.myOffer ? 'Change offer' : 'Extend'}
            </Button>
          )}
          <Button
            variant="ghost"
            className="px-1.5 py-0 text-[11px] hover:text-red-300"
            disabled={release.isPending}
            onClick={() => confirm(`Release ${r.name}? ${buyoutNote}`) && release.mutate({ leagueId, playerId: r.id })}
          >
            Release
          </Button>
          {release.error && <span className="text-[11px] text-red-300">{release.error.message}</span>}
          {extending && r.deal && (
            <Modal title={`Extend ${r.name}`} onClose={() => setExtending(false)}>
              <OfferForm leagueId={leagueId} playerId={r.id} deal={r.deal} mode="negotiate" attemptsLeft={r.attemptsLeft} />
            </Modal>
          )}
        </td>
      )}
    </tr>
  );
}
