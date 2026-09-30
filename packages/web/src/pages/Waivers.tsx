/**
 * The waiver wire: players other teams have tried to send to the farm. Claim
 * one and, if your team has the highest priority (worst record) among the
 * claimants when the next day is played, he's yours, contract and all.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { TraitChips } from '../components/Traits';
import { Badge, Button, Card, cx, Empty, ErrorBox, PotentialBadge, Rating, Spinner, TeamChip } from '../components/ui';
import { dayLabel, money } from '../format';
import { useTRPC } from '../trpc';
import { useLeague } from './LeagueLayout';

export function WaiversPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery(trpc.offseason.waivers.queryOptions({ leagueId: L.id }));
  const claim = useMutation(trpc.offseason.claimWaiver.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  if (!q.data) return <Spinner />;
  const d = q.data;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Waiver wire</h1>
        <p className="max-w-4xl text-sm text-ice-400">
          From training camp through the regular season, a player who isn't waiver-exempt has to clear waivers before he can be sent to the farm. Any team
          can claim him (and take on his contract); if several do, the team with the worst record gets him. Claims close when the next day is played.
          Young players early in their careers, and anyone recalled in the last 30 days, go down without waivers.
          {d.myPriority && (
            <>
              {' '}
              Your claim priority right now: <span className="font-semibold text-white">#{d.myPriority}</span> of {d.teams}.
            </>
          )}
        </p>
      </div>
      <ErrorBox error={claim.error} />
      <Card title={`On waivers (${d.players.length})`}>
        {d.players.length === 0 ? (
          <Empty>Nobody is on waivers right now.</Empty>
        ) : (
          <div className="-mx-4 -mb-4 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  {L.myTeamId && <th className="w-0" />}
                  <th>Player</th>
                  <th>From</th>
                  <th>Pos</th>
                  <th className="num">Age</th>
                  <th className="num">OVR</th>
                  <th>Pot</th>
                  <th className="num">Cap hit</th>
                  <th className="num">Years</th>
                  <th>Type</th>
                  <th>Placed</th>
                </tr>
              </thead>
              <tbody>
                {d.players.map((p) => {
                  const o = p.outlook;
                  const cant = !o ? 'Manage a team to claim' : !o.fitsCap ? 'Not enough cap room' : !o.fitsContracts ? 'At the 50-contract limit' : null;
                  return (
                    <tr key={p.id}>
                      {L.myTeamId && (
                        <td className="w-0 whitespace-nowrap">
                          {p.mine ? (
                            <span className="text-xs text-ice-500">Yours</span>
                          ) : p.claimed ? (
                            <Button variant="secondary" className="px-2 py-0.5 text-xs" disabled={claim.isPending} onClick={() => claim.mutate({ leagueId: L.id, playerId: p.id, claim: false })}>
                              Claimed · withdraw
                            </Button>
                          ) : (
                            <Button className="px-2 py-0.5 text-xs" disabled={!!cant || claim.isPending} title={cant ?? undefined} onClick={() => claim.mutate({ leagueId: L.id, playerId: p.id, claim: true })}>
                              Claim
                            </Button>
                          )}
                        </td>
                      )}
                      <td className="whitespace-nowrap">
                        <Link to={`/league/${L.id}/player/${p.id}`} className="font-semibold text-ice-50 hover:underline">
                          {p.name}
                        </Link>
                        <TraitChips traits={p.traits} />
                        {o?.overMax && !p.mine && <span className="ml-2 text-[10px] text-warn">(you'd have to send someone down)</span>}
                      </td>
                      <td className="text-xs whitespace-nowrap text-ice-300">
                        <span className="inline-flex items-center gap-1.5">
                          <TeamChip team={p.from} size="sm" />
                          {p.from.abbr}
                        </span>
                      </td>
                      <td className="text-ice-400">{p.pos}</td>
                      <td className="num">{p.age}</td>
                      <td className="num">
                        <Rating value={p.overall} />
                      </td>
                      <td>
                        <PotentialBadge potential={p.potential} />
                      </td>
                      <td className="num text-white">{p.contract ? money(p.contract.salary) : '—'}</td>
                      <td className="num">{p.contract?.yearsLeft ?? '—'}</td>
                      <td className="text-xs text-ice-300">{p.twoWay ? '2-way' : '1-way'}</td>
                      <td className="text-xs text-ice-400">{dayLabel(L.season, p.placedDay, { month: 'short', day: 'numeric' })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Recent waiver moves">
        {d.recent.length === 0 ? (
          <Empty>No waiver moves yet this season.</Empty>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {d.recent.map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <TeamChip team={t.team} size="sm" />
                <span className={cx('flex-1', t.type === 'waiver-claim' ? 'text-white' : 'text-ice-300')}>{t.note}</span>
                <Badge tone={t.type === 'waiver-claim' ? 'good' : t.type === 'waivers' ? 'warn' : 'neutral'}>
                  {t.type === 'waiver-claim' ? 'Claimed' : t.type === 'waivers' ? 'Placed' : 'Cleared'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
