import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, cx, Empty, ErrorBox, Rating, Spinner } from '../components/ui';
import { money } from '../format';
import { useTRPC } from '../trpc';
import { useLeague } from './LeagueLayout';

export function ResignPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery(trpc.offseason.expiring.queryOptions({ leagueId: L.id }));
  const set = useMutation(trpc.offseason.setResign.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return <Card><Empty>Contract decisions happen during the offseason.</Empty></Card>;
  const editable = d.stage === 'draft' || d.stage === 're-sign';
  const room = d.salaryCap - d.committedWithResigns;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Expiring contracts</h1>
        <p className="text-sm text-ice-400">
          Re-sign players at their asking price, or let them go to free agency. Asking prices are fixed for now; negotiation arrives with Phase 4.
        </p>
      </div>
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Committed next season" value={money(d.committed)} />
          <Stat label="With your re-signings" value={money(d.committedWithResigns)} />
          <Stat label="Cap space left" value={money(room)} tone={room < 0 ? 'bad' : 'good'} />
        </div>
        {!editable && <p className="mt-3 text-sm text-warn">The re-signing window has closed.</p>}
      </Card>
      <ErrorBox error={set.error} />
      <Card title={`Your expiring players (${d.players.length})`}>
        {d.players.length === 0 ? (
          <Empty>No contracts expire this summer.</Empty>
        ) : (
          <div className="-m-4 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Pos</th>
                  <th className="num">Age</th>
                  <th className="num">OVR</th>
                  <th>Status</th>
                  <th className="num">Last season</th>
                  <th className="num">Asking</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {d.players.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/league/${L.id}/player/${p.id}`} className="text-ice-50 hover:underline">
                        {p.name}
                      </Link>
                      {p.age <= 25 && <span className="ml-2 text-xs text-ice-400">{p.projection}</span>}
                    </td>
                    <td className="text-ice-400">{p.pos}</td>
                    <td className="num">{p.age}</td>
                    <td className="num">
                      <Rating value={p.overall} />
                    </td>
                    <td>
                      <Badge tone={p.status === 'RFA' ? 'info' : 'neutral'}>{p.status}</Badge>
                    </td>
                    <td className="num text-ice-300">
                      {p.stats ? `${p.stats.gp} GP · ${p.stats.g + p.stats.a} P` : p.goalieStats ? `${p.goalieStats.gp} GP · ${p.goalieStats.w} W` : '—'}
                    </td>
                    <td className="num text-white">
                      {money(p.ask.salary)} <span className="text-ice-500">× {p.ask.years}y</span>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <Button
                          variant={p.decision === true ? 'primary' : 'secondary'}
                          className={cx('px-2 py-0.5 text-xs', p.decision === true && 'bg-win text-rink-950 hover:bg-win')}
                          disabled={!editable || set.isPending}
                          onClick={() => set.mutate({ leagueId: L.id, playerId: p.id, resign: true })}
                        >
                          Re-sign
                        </Button>
                        <Button
                          variant={p.decision === false ? 'danger' : 'ghost'}
                          className="px-2 py-0.5 text-xs"
                          disabled={!editable || set.isPending}
                          onClick={() => set.mutate({ leagueId: L.id, playerId: p.id, resign: false })}
                        >
                          Let go
                        </Button>
                      </div>
                      {p.decision === null && editable && <p className="mt-0.5 text-[11px] text-warn">Undecided (will leave)</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
