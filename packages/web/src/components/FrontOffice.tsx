import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, cx, Empty, ErrorBox, Spinner } from './ui';
import { money } from '../format';
import { useTRPC } from '../trpc';

const EFFECT: Record<string, (r: number) => string> = {
  coach: (r) => `Young players develop ${signedPct(((r - 65) / 30) * 0.1)} vs. average`,
  scout: (r) => `Prospect potential read within ±${(6 - ((r - 40) / 55) * 4).toFixed(1)}`,
  trainer: (r) => `Injuries last ${signedPct(-((r - 65) / 30) * 0.2)}`,
};
const signedPct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
/** Short effect label for the hiring list. */
const SHORT: Record<string, (r: number) => string> = {
  coach: (r) => `${signedPct(((r - 65) / 30) * 0.1)} dev`,
  scout: (r) => `±${(6 - ((r - 40) / 55) * 4).toFixed(1)} read`,
  trainer: (r) => `${signedPct(-((r - 65) / 30) * 0.2)} injuries`,
};

function StaffRating({ r }: { r: number }) {
  return <span className={cx('tabular font-semibold', r >= 80 ? 'text-win' : r >= 65 ? 'text-ice-50' : r >= 55 ? 'text-ice-300' : 'text-red-300')}>{r}</span>;
}

export function FrontOffice({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.life.frontOffice.queryOptions({ leagueId, teamId }));
  const [hiring, setHiring] = useState<string | null>(null);
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Spinner />;
  const d = q.data;
  const f = d.finances;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card title="Staff" action={<span className="text-right text-xs text-ice-400">Payroll {money(d.staffPayroll)} · outside the cap</span>}>
        <ul className="divide-y divide-rink-700">
          {d.staff.map((s) => (
            <li key={s.role} className="py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-ice-500 uppercase">{s.label}</p>
                  <p className="font-semibold text-white">{s.member?.name ?? 'Vacant'}</p>
                </div>
                {s.member && (
                  <div className="text-right text-sm">
                    <StaffRating r={s.member.rating} />
                    <p className="text-xs text-ice-400">
                      {money(s.member.salary)} · {s.member.yearsLeft} yr
                    </p>
                  </div>
                )}
                {d.isMine && (
                  <Button variant="secondary" onClick={() => setHiring(hiring === s.role ? null : s.role)}>
                    {hiring === s.role ? 'Close' : 'Replace'}
                  </Button>
                )}
              </div>
              {s.member && <p className="mt-1 text-xs text-ice-400">{EFFECT[s.role](s.member.rating)}</p>}
              {hiring === s.role && <HirePanel leagueId={leagueId} role={s.role} current={s.member} onDone={() => setHiring(null)} />}
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-5">
        {d.owner && (
          <Card title="Owner">
            <p className="text-sm text-ice-400">This season's goal</p>
            <p className="font-semibold text-white">{d.owner.goalLabel}</p>
            <div className="mt-3 mb-1 flex justify-between text-xs text-ice-400">
              <span>Confidence</span>
              <span className="tabular">{d.owner.confidence}/100</span>
            </div>
            <div className="h-2 rounded-full bg-rink-700">
              <div
                className={cx('h-2 rounded-full', d.owner.confidence >= 60 ? 'bg-win' : d.owner.confidence >= 35 ? 'bg-warn' : 'bg-goal')}
                style={{ width: `${d.owner.confidence}%` }}
              />
            </div>
            {d.owner.lastReview && <p className="mt-3 text-sm text-ice-300">Last review: {d.owner.lastReview}</p>}
          </Card>
        )}
        <Card
          title={`Finances${f ? ` ${f.season}–${String((f.season + 1) % 100).padStart(2, '0')}` : ''}`}
          action={<Badge tone={d.cash >= 0 ? 'good' : 'bad'}>Cash {money(d.cash)}</Badge>}
        >
          {f ? (
            <>
              <p className="mb-3 text-sm text-ice-400">
                Market size {d.market.toFixed(2)}× · {f.homeGames} home game
                {f.homeGames === 1 ? '' : 's'} · avg attendance <span className="tabular text-ice-100">{f.avgAttendance.toLocaleString()}</span> /{' '}
                {f.capacity.toLocaleString()}
              </p>
              <FinanceTable f={f} />
            </>
          ) : (
            <Empty>No books yet.</Empty>
          )}
        </Card>
        {d.history.length > 0 && (
          <Card title="Past seasons">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Season</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">Expenses</th>
                    <th className="text-right">Profit</th>
                    <th className="text-right">Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {d.history.map((h) => (
                    <tr key={h.season}>
                      <td className="tabular">{h.season}</td>
                      <td className="tabular text-right">{money(h.revenue)}</td>
                      <td className="tabular text-right">{money(h.expenses)}</td>
                      <td className={cx('tabular text-right', h.profit >= 0 ? 'text-win' : 'text-red-300')}>{money(h.profit)}</td>
                      <td className="tabular text-right">{h.avgAttendance.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function FinanceTable({
  f,
}: {
  f: {
    gate: number;
    playoffGate: number;
    media: number;
    sponsorship: number;
    salaries: number;
    staff: number;
    operations: number;
    revenue: number;
    expenses: number;
    profit: number;
  };
}) {
  const row = (label: string, v: number, strong = false) => (
    <tr>
      <td className={strong ? 'font-semibold text-white' : ''}>{label}</td>
      <td className={cx('tabular text-right', strong && 'font-semibold text-white')}>{money(v)}</td>
    </tr>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <table className="table">
        <tbody>
          {row('Gate', f.gate)}
          {f.playoffGate > 0 && row('Playoff gate', f.playoffGate)}
          {row('Media', f.media)}
          {row('Sponsorship', f.sponsorship)}
          {row('Revenue', f.revenue, true)}
        </tbody>
      </table>
      <table className="table">
        <tbody>
          {row('Player salaries', f.salaries)}
          {row('Staff', f.staff)}
          {row('Operations', f.operations)}
          {row('Expenses', f.expenses, true)}
        </tbody>
      </table>
      <p className={cx('text-sm font-semibold sm:col-span-2', f.profit >= 0 ? 'text-win' : 'text-red-300')}>
        {f.profit >= 0 ? 'Profit' : 'Loss'} so far: {money(Math.abs(f.profit))}
      </p>
    </div>
  );
}

function HirePanel({
  leagueId,
  role,
  current,
  onDone,
}: {
  leagueId: string;
  role: string;
  current: { salary: number; yearsLeft: number } | null;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const pool = useQuery(trpc.life.staffPool.queryOptions({ leagueId }));
  const hire = useMutation(
    trpc.life.hireStaff.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries();
        onDone();
      },
    }),
  );
  const settlement = current ? Math.round((current.salary * Math.max(0, current.yearsLeft - 1)) / 2) : 0;
  const options = (pool.data ?? []).filter((s) => s.role === role);
  return (
    <div className="mt-2 rounded-lg border border-rink-700 bg-rink-950/60 p-3">
      <p className="mb-2 text-xs text-ice-400">
        {settlement > 0 ? `Replacing costs a ${money(settlement)} settlement this season.` : 'No settlement owed for the current staffer.'} Staff salaries come
        out of the budget, not the cap.
      </p>
      <ErrorBox error={hire.error} />
      {options.length ? (
        <ul className="space-y-1 text-sm">
          {options.map((s) => (
            <li key={s.id} className="flex items-center gap-3">
              <span className="flex-1 truncate">{s.name}</span>
              <StaffRating r={s.rating} />
              <span className="tabular hidden w-24 text-right text-xs text-ice-400 sm:inline">{SHORT[role](s.rating)}</span>
              <span className="tabular w-16 text-right text-ice-400">{money(s.salary)}</span>
              <Button variant="ghost" disabled={hire.isPending} onClick={() => hire.mutate({ leagueId, staffId: s.id })}>
                Hire
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No one available.</Empty>
      )}
    </div>
  );
}
