import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, cx, Empty, ErrorBox, Rating, Spinner } from '../components/ui';
import { money } from '../format';
import { useTRPC } from '../trpc';
import { useLeague } from './LeagueLayout';
import { Stat } from './Resign';

export function FreeAgentsPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const q = useQuery(trpc.offseason.freeAgents.queryOptions({ leagueId: L.id }));
  const sign = useMutation(trpc.offseason.signFreeAgent.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const [pos, setPos] = useState('All');
  if (q.isLoading || !q.data) return <Spinner />;
  const d = q.data;
  const list = d.players.filter((p) => pos === 'All' || (pos === 'F' ? ['C', 'LW', 'RW'].includes(p.pos) : p.pos === pos));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Free agents</h1>
        <p className="text-sm text-ice-400">
          {d.phase === 'offseason'
            ? d.canSign
              ? 'Sign players at their asking price, first come first served. Unsigned players lower their asks as the summer goes on.'
              : 'Free agency opens after the re-signing stage.'
            : 'In-season free agents sign one-year deals at a discount.'}
        </p>
      </div>
      {L.myTeamId && d.capRoom !== null && (
        <Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Cap space" value={money(d.capRoom)} tone={d.capRoom < 0 ? 'bad' : 'good'} />
            <Stat label="Payroll" value={money(d.payroll!)} />
            <Stat label="Roster" value={`${d.rosterCount} / ${d.rosterMax}`} tone={d.rosterCount! >= d.rosterMax ? 'bad' : undefined} />
          </div>
        </Card>
      )}
      <ErrorBox error={sign.error} />
      <Card
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
          <div className="-m-4 max-h-[40rem] overflow-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Pos</th>
                  <th className="num">Age</th>
                  <th className="num">OVR</th>
                  <th>Style</th>
                  <th className="num">Career GP</th>
                  <th className="num">Asking</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const affordable = d.capRoom === null || p.ask.salary <= d.capRoom;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/league/${L.id}/player/${p.id}`} className="text-ice-50 hover:underline">
                          {p.name}
                        </Link>
                        {p.injury && <span className="ml-2 text-xs text-red-300">injured</span>}
                      </td>
                      <td className="text-ice-400">{p.pos}</td>
                      <td className="num">{p.age}</td>
                      <td className="num">
                        <Rating value={p.overall} />
                      </td>
                      <td className="text-xs text-ice-400">{p.archetype}</td>
                      <td className="num">{p.careerGp}</td>
                      <td className={cx('num', affordable ? 'text-white' : 'text-red-300')}>
                        {money(p.ask.salary)} <span className="text-ice-500">× {p.ask.years}y</span>
                      </td>
                      <td className="text-right">
                        {L.myTeamId && d.canSign && (
                          <Button
                            className="px-2 py-0.5 text-xs"
                            disabled={!affordable || sign.isPending || d.rosterCount! >= d.rosterMax}
                            onClick={() => sign.mutate({ leagueId: L.id, playerId: p.id })}
                          >
                            Sign
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
